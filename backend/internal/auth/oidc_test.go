package auth

import (
	"context"
	"errors"
	"net/http/httptest"
	"reflect"
	"testing"
)

type fakeTokenVerifier struct {
	token verifiedToken
	err   error
}

func (verifier fakeTokenVerifier) Verify(context.Context, string) (verifiedToken, error) {
	return verifier.token, verifier.err
}

func TestOIDCConfigFromLookupRequiresProductionSettings(t *testing.T) {
	_, err := OIDCConfigFromLookup(func(string) string { return "" })
	if err == nil {
		t.Fatal("missing config accepted")
	}

	config, err := OIDCConfigFromLookup(func(name string) string {
		values := map[string]string{
			"AUTH_OIDC_ISSUER":        " https://issuer.example ",
			"AUTH_OIDC_CLIENT_ID":     " web ",
			"AUTH_OIDC_AUDIENCE":      " api ",
			"AUTH_OIDC_REDIRECT_URL":  " https://app.example/callback ",
			"AUTH_OIDC_CLIENT_SECRET": " secret ",
		}
		return values[name]
	})
	if err != nil || config.IssuerURL != "https://issuer.example" || config.ClientID != "web" || config.Audience != "api" || config.RedirectURL != "https://app.example/callback" || config.ClientSecret != "secret" {
		t.Fatalf("config = %#v, err = %v", config, err)
	}
}

func TestOIDCAuthenticatorExtractsPrincipalClaims(t *testing.T) {
	authenticator := newOIDCAuthenticator(fakeTokenVerifier{token: verifiedToken{
		subject: "user-1",
		claims:  []byte(`{"name":"Ada Lovelace","email":"ada@example.com","preferred_username":"ada","scope":"read write","scp":["admin"],"groups":["analyst"],"jti":"token-1"}`),
	}})
	request := httptest.NewRequest("GET", "/", nil)
	request.Header.Set("Authorization", "Bearer signed-token")

	principal, err := authenticator.Authenticate(request)
	if err != nil {
		t.Fatal(err)
	}
	wantScopes := map[string]bool{"read": true, "write": true, "admin": true}
	if principal.Subject != "user-1" || principal.Name != "Ada Lovelace" || principal.Email != "ada@example.com" || principal.Username != "ada" || principal.TokenID != "token-1" || !reflect.DeepEqual(principal.Scopes, wantScopes) || !reflect.DeepEqual(principal.Groups, []string{"analyst"}) {
		t.Fatalf("principal = %#v", principal)
	}
}

func TestOIDCAuthenticatorFailsClosed(t *testing.T) {
	authenticator := newOIDCAuthenticator(fakeTokenVerifier{err: errors.New("signature rejected")})
	request := httptest.NewRequest("GET", "/", nil)
	if _, err := authenticator.Authenticate(request); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("missing bearer err = %v", err)
	}
	request.Header.Set("Authorization", "Basic abc")
	if _, err := authenticator.Authenticate(request); err == nil {
		t.Fatal("malformed authorization accepted")
	}
	request.Header.Set("Authorization", "Bearer signed-token")
	if _, err := authenticator.Authenticate(request); err == nil {
		t.Fatal("invalid token accepted")
	}
}
