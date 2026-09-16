package auth

import (
	"context"
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

type apiTokenRotator interface {
	RotateWorkspace(context.Context, string, string, string) (APIToken, error)
}

type tokenHTTPHandler struct {
	store APITokenManager
	authz WorkspaceAuthorizer
}

type tokenCreateJSON struct {
	Name      string          `json:"name"`
	Subject   string          `json:"subject,omitempty"`
	Preset    string          `json:"preset,omitempty"`
	Scopes    map[string]bool `json:"scopes"`
	ExpiresAt time.Time       `json:"expires_at"`
}

type tokenJSON struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Token      string          `json:"token,omitempty"`
	Prefix     string          `json:"prefix"`
	Subject    string          `json:"subject"`
	Workspace  string          `json:"workspace"`
	Scopes     map[string]bool `json:"scopes"`
	ExpiresAt  time.Time       `json:"expires_at"`
	RevokedAt  *time.Time      `json:"revoked_at,omitempty"`
	LastUsedAt *time.Time      `json:"last_used_at,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
	CreatedBy  string          `json:"created_by"`
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
	principal, role, ok := handler.authorize(w, r, workspace, operation)
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
			item.Token = ""
			result = append(result, tokenResponse(item))
		}
		writeAuthJSON(w, http.StatusOK, map[string]any{"tokens": result})
	case http.MethodPost:
		if role != WorkspaceAdmin || !hasTokenScope(principal, "write") {
			Forbidden(w)
			return
		}
		var input tokenCreateJSON
		if !decodeAuthJSON(r, &input) || input.ExpiresAt.IsZero() || !input.ExpiresAt.After(time.Now()) || input.ExpiresAt.After(time.Now().Add(MaxAPITokenTTL)) {
			writeAuthJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_json", "message": "invalid token request"})
			return
		}
		if input.Preset != "" {
			preset, ok := tokenScopePresets[input.Preset]
			if !ok || len(input.Scopes) != 0 {
				writeAuthError(w, http.StatusBadRequest, "invalid_request", "invalid scope preset")
				return
			}
			input.Scopes = cloneScopes(preset)
		}
		if !validTokenScopes(input.Scopes) {
			writeAuthError(w, http.StatusBadRequest, "invalid_request", "invalid token scopes")
			return
		}
		if principal.IsAPIToken && !scopesWithinCaller(principal.Scopes, input.Scopes) {
			Forbidden(w)
			return
		}
		subject := strings.TrimSpace(input.Subject)
		if subject == "" {
			subject = principal.Subject
		}
		targetRole, err := handler.authz.Role(r.Context(), subject, workspace)
		if err != nil || !roleAllowsScopes(targetRole, input.Scopes) {
			Forbidden(w)
			return
		}
		created, err := handler.store.Create(r.Context(), APITokenCreateRequest{Name: input.Name, Subject: subject, Workspace: workspace, Scopes: input.Scopes, ExpiresAt: input.ExpiresAt, CreatedBy: principal.Subject})
		if err != nil {
			if errors.Is(err, ErrInvalidAPIToken) {
				writeAuthError(w, http.StatusBadRequest, "invalid_request", "invalid token request")
				return
			}
			writeAuthJSON(w, http.StatusInternalServerError, map[string]string{"code": "internal_error", "message": "internal error"})
			return
		}
		writeAuthJSON(w, http.StatusCreated, tokenResponse(created))
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (handler *tokenHTTPHandler) token(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/v1/auth/tokens/")
	rotate := strings.HasSuffix(id, "/rotate")
	id = strings.TrimSuffix(id, "/rotate")
	workspace := strings.TrimSpace(r.URL.Query().Get("workspace_id"))
	principal, role, ok := handler.authorize(w, r, workspace, "revoke")
	expectedMethod := http.MethodDelete
	if rotate {
		expectedMethod = http.MethodPost
	}
	if !ok || r.Method != expectedMethod || id == "" || (!roleAllowsToken(role, "revoke") || !hasTokenScope(principal, "write")) {
		if ok && r.Method != expectedMethod {
			w.WriteHeader(http.StatusMethodNotAllowed)
		} else if ok {
			Forbidden(w)
		}
		return
	}
	if workspace == "" {
		workspace = principal.Workspace
	}
	if rotate {
		rotator, ok := handler.store.(apiTokenRotator)
		if !ok {
			writeAuthError(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
		created, err := rotator.RotateWorkspace(r.Context(), workspace, id, principal.Subject)
		if err != nil {
			if errors.Is(err, ErrWorkspaceMembership) {
				writeAuthError(w, http.StatusNotFound, "not_found", "not found")
				return
			}
			writeAuthError(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
		writeAuthJSON(w, http.StatusCreated, tokenResponse(created))
		return
	}
	if err := handler.store.RevokeWorkspace(r.Context(), workspace, id); err != nil {
		if errors.Is(err, ErrWorkspaceMembership) {
			writeAuthError(w, http.StatusNotFound, "not_found", "not found")
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
	role, err := roleForPrincipal(r.Context(), handler.authz, principal, workspace)
	if err != nil || !roleAllowsToken(role, operation) {
		Forbidden(w)
		return Principal{}, "", false
	}
	return principal, role, true
}

func hasTokenScope(principal Principal, operation string) bool {
	return principal.Scopes["auth:tokens:"+operation] || principal.Scopes["tokens:"+operation] || principal.Scopes["auth:tokens:write"]
}

func scopesWithinCaller(caller, requested map[string]bool) bool {
	for scope, enabled := range requested {
		if enabled && !caller[scope] {
			return false
		}
	}
	return true
}

var tokenScopePresets = map[string]map[string]bool{
	"read_only_analytics": {"analytics:read": true, "dashboards:read": true, "datasets:read": true},
	"dashboard_author":    {"analytics:read": true, "analytics:write": true, "dashboards:read": true, "dashboards:write": true, "datasets:read": true},
	"publisher":           {"analytics:read": true, "analytics:write": true, "dashboards:read": true, "dashboards:write": true, "datasets:read": true, "publish:write": true, "shares:write": true},
	"automation_admin":    {"analytics:read": true, "analytics:write": true, "dashboards:read": true, "dashboards:write": true, "datasets:read": true, "datasets:write": true, "publish:write": true, "shares:write": true, "auth:tokens:read": true, "auth:tokens:write": true, "auth:workspaces:read": true, "auth:workspaces:write": true, "auth:members:read": true, "auth:members:write": true},
}

func tokenResponse(item APIToken) tokenJSON {
	return tokenJSON{ID: item.ID, Name: item.Name, Token: item.Token, Prefix: item.Prefix, Subject: item.Subject, Workspace: item.Workspace, Scopes: item.Scopes, ExpiresAt: item.ExpiresAt, RevokedAt: item.RevokedAt, LastUsedAt: item.LastUsedAt, CreatedAt: item.CreatedAt, CreatedBy: item.CreatedBy}
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
