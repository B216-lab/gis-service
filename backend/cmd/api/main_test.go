package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"geopanel/backend/internal/auth"
)

func TestRootHandlerProtectsLegacyAPIButKeepsExplicitPublicRoutes(t *testing.T) {
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	authRoutes := http.NewServeMux()
	authRoutes.HandleFunc("GET /api/v1/auth/me", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	root := newRootHandler(api, authRoutes, auth.AuthenticatorFunc(func(*http.Request) (auth.Principal, error) {
		return auth.Principal{}, auth.ErrUnauthenticated
	}))

	for _, test := range []struct {
		path string
		want int
	}{
		{"/api/v1/health", http.StatusNoContent},
		{"/api/v1/analytics/public/share", http.StatusNoContent},
		{"/api/v1/database-connections", http.StatusUnauthorized},
	} {
		response := httptest.NewRecorder()
		root.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
		if response.Code != test.want {
			t.Fatalf("%s status = %d, want %d", test.path, response.Code, test.want)
		}
	}
}

func TestRuntimeConfigRequiresBrowserAndSessionSettings(t *testing.T) {
	_, err := auth.RuntimeConfigFromLookup(func(string) string { return "" })
	if err == nil {
		t.Fatal("missing auth config accepted")
	}
	config, err := auth.RuntimeConfigFromLookup(func(name string) string {
		return map[string]string{
			"AUTH_OIDC_ISSUER": "https://issuer.example", "AUTH_OIDC_CLIENT_ID": "web",
			"AUTH_OIDC_AUDIENCE": "api", "AUTH_OIDC_REDIRECT_URL": "https://app.example/auth/callback",
			"AUTH_OIDC_CLIENT_SECRET": "client-secret", "AUTH_SESSION_SECRET": "01234567890123456789012345678901",
		}[name]
	})
	if err != nil || config.SessionSecret == "" {
		t.Fatalf("config = %#v, err = %v", config, err)
	}
	_, err = auth.RuntimeConfigFromLookup(func(name string) string {
		values := map[string]string{
			"AUTH_OIDC_ISSUER": "https://issuer.example", "AUTH_OIDC_CLIENT_ID": "web",
			"AUTH_OIDC_AUDIENCE": "api", "AUTH_OIDC_REDIRECT_URL": "https://app.example/auth/callback",
			"AUTH_OIDC_CLIENT_SECRET": "client-secret", "AUTH_SESSION_SECRET": "01234567890123456789012345678901",
			"AUTH_ALLOW_ANONYMOUS": "true",
		}
		return values[name]
	})
	if err == nil {
		t.Fatal("anonymous mode accepted")
	}
}
