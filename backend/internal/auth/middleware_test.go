package auth

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMiddlewareAttachesCopiedPrincipal(t *testing.T) {
	scopes := map[string]bool{"analytics:read": true}
	groups := []string{"analysts"}
	principal := Principal{Subject: "user-1", Scopes: scopes, Groups: groups}
	var got Principal

	handler := Middleware(AuthenticatorFunc(func(*http.Request) (Principal, error) {
		return principal, nil
	}), http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var ok bool
		got, ok = PrincipalFromRequest(request)
		if !ok {
			t.Error("principal missing from request")
		}
		writer.WriteHeader(http.StatusNoContent)
	}))

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/private", nil))
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
	}

	scopes["analytics:write"] = true
	groups[0] = "mutated"
	if got.Scopes["analytics:write"] || got.Groups[0] != "analysts" {
		t.Fatal("middleware did not isolate principal slices/maps")
	}
}

func TestRequireRejectsAnonymousAndAllowsAuthenticated(t *testing.T) {
	called := false
	handler := Require(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		called = true
		writer.WriteHeader(http.StatusNoContent)
	}))

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/private", nil))
	if response.Code != http.StatusUnauthorized || called {
		t.Fatalf("anonymous request: status=%d called=%t", response.Code, called)
	}
	if response.Header().Get("WWW-Authenticate") != "Bearer" {
		t.Fatal("missing bearer challenge")
	}

	request := httptest.NewRequest(http.MethodGet, "/private", nil)
	request = request.WithContext(WithPrincipal(request.Context(), Principal{Subject: "user-1"}))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || !called {
		t.Fatalf("authenticated request: status=%d called=%t", response.Code, called)
	}
}

func TestMiddlewareKeepsAnonymousRoutesAvailable(t *testing.T) {
	handler := Middleware(AuthenticatorFunc(func(*http.Request) (Principal, error) {
		return Principal{}, ErrUnauthenticated
	}), http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if _, ok := PrincipalFromRequest(request); ok {
			t.Fatal("anonymous request unexpectedly has principal")
		}
		writer.WriteHeader(http.StatusOK)
	}))

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/public", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
}

func TestMiddlewareRejectsInvalidCredentials(t *testing.T) {
	handler := Middleware(AuthenticatorFunc(func(*http.Request) (Principal, error) {
		return Principal{}, errors.New("bad token")
	}), http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("next called for invalid credentials")
	}))

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/private", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}
