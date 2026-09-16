package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type recordingAuthenticator struct {
	principal Principal
	err       error
	calls     int
}

func (authenticator *recordingAuthenticator) Authenticate(*http.Request) (Principal, error) {
	authenticator.calls++
	return authenticator.principal, authenticator.err
}

func TestCompositeAuthenticatorSelectsCredentialFamily(t *testing.T) {
	session := &recordingAuthenticator{principal: Principal{Subject: "session"}}
	bearer := &recordingAuthenticator{principal: Principal{Subject: "bearer"}}
	authenticator := NewCompositeAuthenticator(session, bearer)

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.AddCookie(&http.Cookie{Name: "geoform_session", Value: "opaque"})
	principal, err := authenticator.Authenticate(request)
	if err != nil || principal.Subject != "session" || session.calls != 1 || bearer.calls != 0 {
		t.Fatalf("session selection: principal=%+v err=%v calls=(%d,%d)", principal, err, session.calls, bearer.calls)
	}

	request = httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("Authorization", "Bearer opaque")
	principal, err = authenticator.Authenticate(request)
	if err != nil || principal.Subject != "bearer" || bearer.calls != 1 {
		t.Fatalf("bearer selection: principal=%+v err=%v calls=%d", principal, err, bearer.calls)
	}
}

func TestCompositeAuthenticatorMalformedBearerDoesNotFallThrough(t *testing.T) {
	session := &recordingAuthenticator{principal: Principal{Subject: "session"}}
	bearer := &recordingAuthenticator{err: ErrInvalidAPIToken}
	authenticator := NewCompositeAuthenticator(session, bearer)
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.AddCookie(&http.Cookie{Name: "geoform_session", Value: "opaque"})
	request.Header.Set("Authorization", "Basic not-bearer")

	_, err := authenticator.Authenticate(request)
	if err == nil || session.calls != 0 || bearer.calls != 1 {
		t.Fatalf("malformed bearer fell through: err=%v calls=(%d,%d)", err, session.calls, bearer.calls)
	}
}

func TestRequireScopeDeniesMissingScope(t *testing.T) {
	called := false
	handler := RequireScope("analytics:read", http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
	request := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(WithPrincipal(t.Context(), Principal{Subject: "user", Scopes: map[string]bool{"analytics:write": true}}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || called || !strings.Contains(response.Body.String(), `"code":"forbidden"`) {
		t.Fatalf("scope denial: status=%d called=%t body=%q", response.Code, called, response.Body.String())
	}
}

type fakeBrowserHandler struct{ login, callback, logout bool }

func (handler *fakeBrowserHandler) Login(http.ResponseWriter, *http.Request) { handler.login = true }
func (handler *fakeBrowserHandler) Callback(http.ResponseWriter, *http.Request) {
	handler.callback = true
}
func (handler *fakeBrowserHandler) Logout(http.ResponseWriter, *http.Request) { handler.logout = true }

func TestAuthRoutes(t *testing.T) {
	browser := &fakeBrowserHandler{}
	authenticator := AuthenticatorFunc(func(request *http.Request) (Principal, error) {
		if request.Header.Get("Authorization") == "Bearer test" {
			return Principal{Subject: "user", TokenID: "opaque-id", Workspace: "ws", Scopes: map[string]bool{"write": true, "read": true}, Groups: []string{"analyst"}}, nil
		}
		return Principal{}, ErrUnauthenticated
	})
	handler := NewHTTPHandler(browser, authenticator)

	for _, test := range []struct {
		method, path string
		seen         *bool
	}{
		{http.MethodGet, "/auth/login", &browser.login},
		{http.MethodGet, "/auth/callback", &browser.callback},
		{http.MethodPost, "/auth/logout", &browser.logout},
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(test.method, test.path, nil))
		if response.Code != http.StatusOK || !*test.seen {
			t.Fatalf("route %s %s: status=%d seen=%t", test.method, test.path, response.Code, *test.seen)
		}
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	request.Header.Set("Authorization", "Bearer test")
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" || !strings.Contains(response.Body.String(), `"subject":"user"`) || strings.Contains(response.Body.String(), "Bearer test") {
		t.Fatalf("me response: status=%d headers=%v body=%q", response.Code, response.Header(), response.Body.String())
	}

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous me status=%d", response.Code)
	}
}
