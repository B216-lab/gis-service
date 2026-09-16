package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTokenScopeRoleCeilings(t *testing.T) {
	tests := []struct {
		role   WorkspaceRole
		scopes map[string]bool
		want   bool
	}{
		{WorkspaceViewer, map[string]bool{"analytics:read": true}, true},
		{WorkspaceViewer, map[string]bool{"analytics:write": true}, false},
		{WorkspaceEditor, map[string]bool{"dashboards:write": true}, true},
		{WorkspaceEditor, map[string]bool{"publish:write": true}, false},
		{WorkspacePublisher, map[string]bool{"publish:write": true}, true},
		{WorkspacePublisher, map[string]bool{"auth:tokens:write": true}, false},
		{WorkspaceAdmin, map[string]bool{"auth:tokens:write": true}, true},
		{WorkspaceAdmin, map[string]bool{"unknown": true}, false},
	}
	for _, test := range tests {
		if got := roleAllowsScopes(test.role, test.scopes); got != test.want {
			t.Errorf("roleAllowsScopes(%s, %v) = %t, want %t", test.role, test.scopes, got, test.want)
		}
	}
}

func TestTokenCreateRejectsExcessLifetime(t *testing.T) {
	store, err := NewPostgreSQLAPITokenStore(&tokenDB{})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(100, 0).UTC()
	store.now = func() time.Time { return now }
	_, err = store.Create(context.Background(), APITokenCreateRequest{
		Subject: "user", Workspace: "workspace", Scopes: map[string]bool{"analytics:read": true},
		ExpiresAt: now.Add(MaxAPITokenTTL + time.Second), CreatedBy: "user",
	})
	if err != ErrInvalidAPIToken {
		t.Fatalf("error = %v, want ErrInvalidAPIToken", err)
	}
}

func TestTokenRotateRouteReturnsNewSecret(t *testing.T) {
	store := &tokenHTTPTestStore{}
	handler := &tokenHTTPHandler{store: store, authz: tokenHTTPTestAuthz{roles: map[string]WorkspaceRole{"admin/ws": WorkspaceAdmin}}}
	principal := Principal{Subject: "admin", Workspace: "ws", Scopes: map[string]bool{"auth:tokens:write": true}}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/tokens/old/rotate", nil).WithContext(WithPrincipal(context.Background(), principal))
	response := httptest.NewRecorder()
	handler.token(response, request)
	if response.Code != http.StatusCreated || !strings.Contains(response.Body.String(), "gp_rotated") {
		t.Fatalf("response = (%d, %q)", response.Code, response.Body.String())
	}
}

func TestRuntimeConfigRejectsPartialBootstrap(t *testing.T) {
	_, err := RuntimeConfigFromLookup(func(name string) string {
		values := map[string]string{
			"AUTH_OIDC_ISSUER": "https://issuer.example", "AUTH_OIDC_CLIENT_ID": "web",
			"AUTH_OIDC_AUDIENCE": "api", "AUTH_OIDC_REDIRECT_URL": "https://app.example/callback",
			"AUTH_OIDC_CLIENT_SECRET": "secret", "AUTH_SESSION_SECRET": "01234567890123456789012345678901",
			"AUTH_BOOTSTRAP_WORKSPACE_ID": "workspace",
		}
		return values[name]
	})
	if err == nil {
		t.Fatal("partial bootstrap configuration accepted")
	}
}
