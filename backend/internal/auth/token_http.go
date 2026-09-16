package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type APITokenManager interface {
	Create(context.Context, APITokenCreateRequest) (APIToken, error)
	List(context.Context, string) ([]APIToken, error)
	RevokeWorkspace(context.Context, string, string) error
}

type tokenHTTPHandler struct {
	store APITokenManager
	authz WorkspaceAuthorizer
}

type tokenCreateJSON struct {
	Scopes    map[string]bool `json:"scopes"`
	ExpiresAt time.Time       `json:"expires_at"`
}

type tokenJSON struct {
	ID        string          `json:"id"`
	Token     string          `json:"token,omitempty"`
	Prefix    string          `json:"prefix"`
	Subject   string          `json:"subject"`
	Workspace string          `json:"workspace"`
	Scopes    map[string]bool `json:"scopes"`
	ExpiresAt time.Time       `json:"expires_at"`
	RevokedAt *time.Time      `json:"revoked_at,omitempty"`
	CreatedBy string          `json:"created_by"`
}

func registerTokenRoutes(mux *http.ServeMux, authenticator Authenticator, store APITokenManager, authz WorkspaceAuthorizer) {
	handler := &tokenHTTPHandler{store: store, authz: authz}
	protected := func(next http.Handler) http.Handler { return Middleware(authenticator, Require(next)) }
	mux.Handle("/api/v1/auth/tokens", protected(http.HandlerFunc(handler.tokens)))
	mux.Handle("/api/v1/auth/tokens/", protected(http.HandlerFunc(handler.token)))
}

func (handler *tokenHTTPHandler) tokens(w http.ResponseWriter, r *http.Request) {
	workspace := strings.TrimSpace(r.URL.Query().Get("workspace_id"))
	operation := "read"
	if r.Method == http.MethodPost {
		operation = "write"
	}
	principal, _, ok := handler.authorize(w, r, workspace, operation)
	if !ok {
		return
	}
	if workspace == "" {
		workspace = principal.Workspace
	}
	switch r.Method {
	case http.MethodGet:
		if !hasTokenScope(principal, "read") {
			Forbidden(w)
			return
		}
		items, err := handler.store.List(r.Context(), workspace)
		if err != nil {
			writeAuthJSON(w, http.StatusInternalServerError, map[string]string{"code": "internal_error", "message": "internal error"})
			return
		}
		result := make([]tokenJSON, 0, len(items))
		for _, item := range items {
			result = append(result, tokenJSON{ID: item.ID, Prefix: item.Prefix, Subject: item.Subject, Workspace: item.Workspace, Scopes: item.Scopes, ExpiresAt: item.ExpiresAt, RevokedAt: item.RevokedAt, CreatedBy: item.CreatedBy})
		}
		writeAuthJSON(w, http.StatusOK, map[string]any{"tokens": result})
	case http.MethodPost:
		if !hasTokenScope(principal, "write") {
			Forbidden(w)
			return
		}
		var input tokenCreateJSON
		if json.NewDecoder(r.Body).Decode(&input) != nil || input.ExpiresAt.IsZero() || !input.ExpiresAt.After(time.Now()) {
			writeAuthJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_json", "message": "invalid token request"})
			return
		}
		created, err := handler.store.Create(r.Context(), APITokenCreateRequest{Subject: principal.Subject, Workspace: workspace, Scopes: input.Scopes, ExpiresAt: input.ExpiresAt, CreatedBy: principal.Subject})
		if err != nil {
			writeAuthJSON(w, http.StatusInternalServerError, map[string]string{"code": "internal_error", "message": "internal error"})
			return
		}
		writeAuthJSON(w, http.StatusCreated, tokenJSON{ID: created.ID, Token: created.Token, Prefix: created.Prefix, Subject: created.Subject, Workspace: created.Workspace, Scopes: created.Scopes, ExpiresAt: created.ExpiresAt, CreatedBy: created.CreatedBy})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (handler *tokenHTTPHandler) token(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/v1/auth/tokens/")
	workspace := strings.TrimSpace(r.URL.Query().Get("workspace_id"))
	principal, role, ok := handler.authorize(w, r, workspace, "revoke")
	if !ok || r.Method != http.MethodDelete || id == "" || (!roleAllowsToken(role, "revoke") || !hasTokenScope(principal, "write")) {
		if ok && r.Method != http.MethodDelete {
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
		return
	}
	if workspace == "" {
		workspace = principal.Workspace
	}
	if err := handler.store.RevokeWorkspace(r.Context(), workspace, id); err != nil {
		if errors.Is(err, ErrWorkspaceMembership) {
			Forbidden(w)
			return
		}
		writeAuthJSON(w, http.StatusInternalServerError, map[string]string{"code": "internal_error", "message": "internal error"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler *tokenHTTPHandler) authorize(w http.ResponseWriter, r *http.Request, workspace, operation string) (Principal, WorkspaceRole, bool) {
	if handler.authz == nil || handler.store == nil {
		Forbidden(w)
		return Principal{}, "", false
	}
	principal, ok := PrincipalFromRequest(r)
	if !ok {
		Unauthorized(w)
		return Principal{}, "", false
	}
	// API-token principals are bound to their issuing workspace. Never let a
	// query parameter select another workspace, even when subject has membership
	// there too. Session/OIDC principals may select a workspace only after the
	// membership query below verifies access.
	if principal.Workspace != "" {
		if workspace != "" && workspace != principal.Workspace {
			Forbidden(w)
			return Principal{}, "", false
		}
		workspace = principal.Workspace
	}
	if workspace == "" {
		Forbidden(w)
		return Principal{}, "", false
	}
	role, err := handler.authz.Role(r.Context(), principal.Subject, workspace)
	if err != nil || !roleAllowsToken(role, operation) {
		Forbidden(w)
		return Principal{}, "", false
	}
	return principal, role, true
}

func hasTokenScope(principal Principal, operation string) bool {
	return principal.Scopes["auth:tokens:"+operation] || principal.Scopes["tokens:"+operation] || principal.Scopes["auth:tokens:write"]
}

func (store *PostgreSQLAPITokenStore) RevokeWorkspace(ctx context.Context, workspace, id string) error {
	if strings.TrimSpace(workspace) == "" || strings.TrimSpace(id) == "" {
		return ErrWorkspaceMembership
	}
	tag, err := store.db.Exec(ctx, `UPDATE auth_api_tokens SET revoked_at = NOW() WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL`, id, workspace)
	if err != nil {
		return fmt.Errorf("revoke API token: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrWorkspaceMembership
	}
	return nil
}
