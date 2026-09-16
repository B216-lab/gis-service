package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

type fakeCodeExchanger struct {
	identity OIDCIdentity
	err      error
}

func (fake fakeCodeExchanger) Exchange(context.Context, string) (OIDCIdentity, error) {
	return fake.identity, fake.err
}

func newBrowserHandler(t *testing.T, exchanger CodeExchanger) (*BrowserOIDCHandler, *InMemoryFlowStore, *InMemorySessionStore) {
	t.Helper()
	flows := NewInMemoryFlowStore()
	sessions := NewInMemorySessionStore()
	handler, err := NewBrowserOIDCHandler(BrowserAuthConfig{
		RedirectURL:  "https://app.example/callback",
		ClientSecret: "test-secret",
		SecureCookie: true,
		FlowTTL:      time.Minute,
		SessionTTL:   time.Hour,
	}, func(state string) string { return "https://issuer.example/auth?state=" + state }, exchanger, flows, sessions)
	if err != nil {
		t.Fatal(err)
	}
	handler.randomString = func() (string, error) {
		if _, ok, _ := flows.Take(context.Background(), "fixed-state"); !ok {
			return "fixed-state", nil
		}
		return "fixed-nonce", nil
	}
	return handler, flows, sessions
}

func TestBrowserCallbackRejectsStateMismatch(t *testing.T) {
	handler, flows, _ := newBrowserHandler(t, fakeCodeExchanger{identity: OIDCIdentity{Principal: Principal{Subject: "user"}, Nonce: "fixed-nonce"}})
	if err := flows.Put(context.Background(), FlowState{State: "fixed-state", Nonce: "fixed-nonce", ExpiresAt: time.Now().Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/callback?state=wrong&code=code", nil)
	response := httptest.NewRecorder()
	handler.Callback(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestBrowserCallbackRejectsNonceMismatch(t *testing.T) {
	handler, flows, _ := newBrowserHandler(t, fakeCodeExchanger{identity: OIDCIdentity{Principal: Principal{Subject: "user"}, Nonce: "wrong-nonce"}})
	if err := flows.Put(context.Background(), FlowState{State: "fixed-state", Nonce: "fixed-nonce", ExpiresAt: time.Now().Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/callback?state=fixed-state&code=code", nil)
	response := httptest.NewRecorder()
	handler.Callback(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestBrowserCallbackSetsSecureSessionCookieAndExpiry(t *testing.T) {
	handler, flows, sessions := newBrowserHandler(t, fakeCodeExchanger{identity: OIDCIdentity{Principal: Principal{Subject: "user"}, Nonce: "fixed-nonce"}})
	if err := flows.Put(context.Background(), FlowState{State: "fixed-state", Nonce: "fixed-nonce", ExpiresAt: time.Now().Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/callback?state=fixed-state&code=code", nil)
	response := httptest.NewRecorder()
	handler.Callback(response, request)
	if response.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusFound)
	}
	cookie := response.Result().Cookies()[0]
	if cookie.Name != defaultSessionCookie || cookie.Value == "" || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" {
		t.Fatalf("cookie flags = %#v", cookie)
	}
	if cookie.MaxAge <= 0 || cookie.Expires.Before(time.Now()) {
		t.Fatalf("cookie expiry = %#v", cookie)
	}
	if _, ok, _ := sessions.Get(context.Background(), cookie.Value); !ok {
		t.Fatal("session not stored")
	}
	if !strings.Contains(response.Header().Get("Location"), "/") {
		t.Fatal("callback did not redirect")
	}
}

func TestBrowserLoginSendsNonceToProvider(t *testing.T) {
	handler, _, _ := newBrowserHandler(t, fakeCodeExchanger{})
	response := httptest.NewRecorder()
	handler.Login(response, httptest.NewRequest(http.MethodGet, "/auth/login", nil))
	if response.Code != http.StatusFound {
		t.Fatalf("status = %d", response.Code)
	}
	location, err := url.Parse(response.Header().Get("Location"))
	if err != nil || location.Query().Get("nonce") == "" {
		t.Fatalf("login URL = %q, err = %v", response.Header().Get("Location"), err)
	}
}
