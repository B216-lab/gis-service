package auth

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type tokenHTTPTestStore struct {
	created                     APITokenCreateRequest
	items                       []APIToken
	revokedWorkspace, revokedID string
}

func (s *tokenHTTPTestStore) Create(_ context.Context, req APITokenCreateRequest) (APIToken, error) {
	s.created = req
	return APIToken{ID: "new", Token: "gp_plaintext", Prefix: "gp_plain", Subject: req.Subject, Workspace: req.Workspace, Scopes: req.Scopes, ExpiresAt: req.ExpiresAt, CreatedBy: req.CreatedBy}, nil
}
func (s *tokenHTTPTestStore) List(_ context.Context, workspace string) ([]APIToken, error) {
	result := make([]APIToken, 0, len(s.items))
	for _, item := range s.items {
		if item.Workspace == workspace {
			result = append(result, item)
		}
	}
	return result, nil
}
func (s *tokenHTTPTestStore) RevokeWorkspace(_ context.Context, workspace, id string) error {
	s.revokedWorkspace, s.revokedID = workspace, id
	return nil
}
func (s *tokenHTTPTestStore) RotateWorkspace(_ context.Context, workspace, id, subject string) (APIToken, error) {
	return APIToken{ID: "rotated", Token: "gp_rotated", Workspace: workspace, Subject: subject}, nil
}

type tokenHTTPTestAuthz struct{ roles map[string]WorkspaceRole }

func (a tokenHTTPTestAuthz) Role(_ context.Context, subject, workspace string) (WorkspaceRole, error) {
	role, ok := a.roles[subject+"/"+workspace]
	if !ok {
		return "", ErrWorkspaceMembership
	}
	return role, nil
}

func tokenHTTPRequest(method, path string, principal Principal) *http.Request {
	return httptest.NewRequest(method, path, nil).WithContext(WithPrincipal(context.Background(), principal))
}

func TestTokenRoutesUsePrincipalWorkspaceAndNeverReturnPlaintextOnList(t *testing.T) {
	store := &tokenHTTPTestStore{items: []APIToken{{ID: "listed", Token: "must-not-leak", Prefix: "gp_x", Subject: "u", Workspace: "ws", Scopes: map[string]bool{"read": true}, ExpiresAt: time.Now().Add(time.Hour)}}}
	handler := &tokenHTTPHandler{store: store, authz: tokenHTTPTestAuthz{roles: map[string]WorkspaceRole{"u/ws": WorkspaceAdmin}}}
	principal := Principal{Subject: "u", Workspace: "ws", Scopes: map[string]bool{"auth:tokens:read": true, "auth:tokens:write": true}}

	response := httptest.NewRecorder()
	handler.tokens(response, tokenHTTPRequest(http.MethodGet, "/api/v1/auth/tokens", principal))
	if response.Code != http.StatusOK || response.Body.String() == "" || strings.Contains(response.Body.String(), "must-not-leak") {
		t.Fatalf("list response: status=%d body=%q", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	body := fmt.Sprintf(`{"scopes":{"read":true},"expires_at":%q}`, time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/tokens", strings.NewReader(body)).WithContext(WithPrincipal(context.Background(), principal))
	handler.tokens(response, request)
	if response.Code != http.StatusCreated || store.created.Workspace != "ws" || !strings.Contains(response.Body.String(), "gp_plaintext") {
		t.Fatalf("create response: status=%d workspace=%q body=%q", response.Code, store.created.Workspace, response.Body.String())
	}
}

func TestBrowserSessionAdminCanCreateTokenWithoutAPITokenScopes(t *testing.T) {
	store := &tokenHTTPTestStore{}
	handler := &tokenHTTPHandler{
		store: store,
		authz: tokenHTTPTestAuthz{roles: map[string]WorkspaceRole{
			"u/ws": WorkspaceAdmin,
		}},
	}
	body := fmt.Sprintf(`{"scopes":{"read":true},"expires_at":%q}`, time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/tokens?workspace_id=ws", strings.NewReader(body)).WithContext(
		WithPrincipal(context.Background(), Principal{Subject: "u"}),
	)
	response := httptest.NewRecorder()

	handler.tokens(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("create response: status=%d body=%q", response.Code, response.Body.String())
	}
}

func TestTokenRoutesDenyCrossWorkspacePrincipal(t *testing.T) {
	store := &tokenHTTPTestStore{}
	handler := &tokenHTTPHandler{store: store, authz: tokenHTTPTestAuthz{roles: map[string]WorkspaceRole{"u/ws-a": WorkspaceAdmin, "u/ws-b": WorkspaceAdmin}}}
	principal := Principal{Subject: "u", Workspace: "ws-a", Scopes: map[string]bool{"auth:tokens:read": true}}
	response := httptest.NewRecorder()
	handler.tokens(response, tokenHTTPRequest(http.MethodGet, "/api/v1/auth/tokens?workspace_id=ws-b", principal))
	if response.Code != http.StatusForbidden {
		t.Fatalf("cross-workspace status=%d", response.Code)
	}
}

func TestRoleAllowsTokenMatrix(t *testing.T) {
	for _, test := range []struct {
		role WorkspaceRole
		op   string
		want bool
	}{
		{WorkspaceAdmin, "read", true}, {WorkspaceEditor, "write", true}, {WorkspacePublisher, "write", false},
		{WorkspaceViewer, "revoke", false}, {WorkspacePublisher, "read", true},
	} {
		if got := roleAllowsToken(test.role, test.op); got != test.want {
			t.Errorf("%s/%s=%t want %t", test.role, test.op, got, test.want)
		}
	}
}
