package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
)

// OIDCConfig contains runtime settings needed to verify bearer JWTs.
// Audience is deliberately required: accepting tokens for another service is
// an authentication boundary failure.
type OIDCConfig struct {
	IssuerURL string
	ClientID  string
	Audience  string
	// RedirectURL and ClientSecret are used by the browser authorization-code
	// flow. Bearer-token callers may leave them empty.
	RedirectURL  string
	ClientSecret string
}

// RuntimeConfig contains every secret required by the application-owned auth
// boundary. Loading it is deliberately strict so an incomplete deployment
// cannot fall back to anonymous access.
type RuntimeConfig struct {
	OIDCConfig
	SessionSecret             string
	BootstrapWorkspaceID      string
	BootstrapWorkspaceName    string
	BootstrapWorkspaceSubject string
}

func RuntimeConfigFromEnv() (RuntimeConfig, error) {
	return RuntimeConfigFromLookup(os.Getenv)
}

// RuntimeConfigFromLookup is injectable for startup configuration tests.
func RuntimeConfigFromLookup(lookup func(string) string) (RuntimeConfig, error) {
	oidcConfig, err := OIDCConfigFromLookup(lookup)
	if err != nil {
		return RuntimeConfig{}, err
	}
	if strings.TrimSpace(oidcConfig.RedirectURL) == "" || strings.TrimSpace(oidcConfig.ClientSecret) == "" {
		return RuntimeConfig{}, errors.New("AUTH_OIDC_REDIRECT_URL and AUTH_OIDC_CLIENT_SECRET are required")
	}
	secret := strings.TrimSpace(lookup("AUTH_SESSION_SECRET"))
	if len(secret) < 32 {
		return RuntimeConfig{}, errors.New("AUTH_SESSION_SECRET must be at least 32 characters")
	}
	if allowAnonymous := strings.TrimSpace(lookup("AUTH_ALLOW_ANONYMOUS")); allowAnonymous != "" && !strings.EqualFold(allowAnonymous, "false") {
		return RuntimeConfig{}, errors.New("AUTH_ALLOW_ANONYMOUS must be false when application authentication is enabled")
	}
	workspaceID := strings.TrimSpace(lookup("AUTH_BOOTSTRAP_WORKSPACE_ID"))
	workspaceSubject := strings.TrimSpace(lookup("AUTH_BOOTSTRAP_WORKSPACE_SUBJECT"))
	if (workspaceID == "") != (workspaceSubject == "") {
		return RuntimeConfig{}, errors.New("AUTH_BOOTSTRAP_WORKSPACE_ID and AUTH_BOOTSTRAP_WORKSPACE_SUBJECT must be set together")
	}
	workspaceName := strings.TrimSpace(lookup("AUTH_BOOTSTRAP_WORKSPACE_NAME"))
	if workspaceID != "" && workspaceName == "" {
		workspaceName = workspaceID
	}
	return RuntimeConfig{
		OIDCConfig: oidcConfig, SessionSecret: secret,
		BootstrapWorkspaceID: workspaceID, BootstrapWorkspaceName: workspaceName,
		BootstrapWorkspaceSubject: workspaceSubject,
	}, nil
}

// OIDCConfigFromEnv loads production OIDC settings. Missing values are errors;
// callers must explicitly choose a different development authenticator.
func OIDCConfigFromEnv() (OIDCConfig, error) {
	return OIDCConfigFromLookup(os.Getenv)
}

// OIDCConfigFromLookup is injectable for configuration tests.
func OIDCConfigFromLookup(lookup func(string) string) (OIDCConfig, error) {
	config := OIDCConfig{
		IssuerURL:    strings.TrimSpace(lookup("AUTH_OIDC_ISSUER")),
		ClientID:     strings.TrimSpace(lookup("AUTH_OIDC_CLIENT_ID")),
		Audience:     strings.TrimSpace(lookup("AUTH_OIDC_AUDIENCE")),
		RedirectURL:  strings.TrimSpace(lookup("AUTH_OIDC_REDIRECT_URL")),
		ClientSecret: strings.TrimSpace(lookup("AUTH_OIDC_CLIENT_SECRET")),
	}
	if config.IssuerURL == "" || config.ClientID == "" || config.Audience == "" {
		return OIDCConfig{}, errors.New("AUTH_OIDC_ISSUER, AUTH_OIDC_CLIENT_ID, and AUTH_OIDC_AUDIENCE are required")
	}
	return config, nil
}

func (config OIDCConfig) validate() error {
	if strings.TrimSpace(config.IssuerURL) == "" || strings.TrimSpace(config.ClientID) == "" || strings.TrimSpace(config.Audience) == "" {
		return errors.New("OIDC issuer, client ID, and audience are required")
	}
	return nil
}

// tokenVerifier is the narrow verification seam. It also makes claim
// extraction testable without requiring a live issuer or network JWKS fetch.
type tokenVerifier interface {
	Verify(context.Context, string) (verifiedToken, error)
}

type verifiedToken struct {
	subject string
	claims  []byte
}

type oidcTokenVerifier struct{ verifier *oidc.IDTokenVerifier }

func (verifier oidcTokenVerifier) Verify(ctx context.Context, raw string) (verifiedToken, error) {
	token, err := verifier.verifier.Verify(ctx, raw)
	if err != nil {
		return verifiedToken{}, err
	}
	var claims map[string]any
	if err := token.Claims(&claims); err != nil {
		return verifiedToken{}, err
	}
	rawClaims, err := json.Marshal(claims)
	if err != nil {
		return verifiedToken{}, err
	}
	return verifiedToken{subject: token.Subject, claims: rawClaims}, nil
}

// OIDCAuthenticator verifies Authorization bearer tokens and maps their
// claims into the existing Principal boundary. Provider discovery creates a
// verifier backed by the issuer's JWKS endpoint.
type OIDCAuthenticator struct {
	verifier tokenVerifier
}

// NewOIDCAuthenticator discovers issuer metadata and initializes a JWKS-backed
// verifier. It performs no browser callback, session, or token persistence.
func NewOIDCAuthenticator(ctx context.Context, config OIDCConfig) (*OIDCAuthenticator, error) {
	if err := config.validate(); err != nil {
		return nil, err
	}
	provider, err := oidc.NewProvider(ctx, config.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("discover OIDC provider: %w", err)
	}
	return newOIDCAuthenticator(oidcTokenVerifier{verifier: provider.Verifier(&oidc.Config{ClientID: config.Audience})}), nil
}

func newOIDCAuthenticator(verifier tokenVerifier) *OIDCAuthenticator {
	return &OIDCAuthenticator{verifier: verifier}
}

// Authenticate verifies one bearer JWT. Missing credentials return
// ErrUnauthenticated; malformed or invalid credentials return another error
// so middleware rejects them.
func (authenticator *OIDCAuthenticator) Authenticate(request *http.Request) (Principal, error) {
	if authenticator == nil || authenticator.verifier == nil {
		return Principal{}, errors.New("OIDC authenticator is not initialized")
	}
	if request == nil {
		return Principal{}, errors.New("request is nil")
	}
	value := request.Header.Get("Authorization")
	if value == "" {
		return Principal{}, ErrUnauthenticated
	}
	parts := strings.Fields(value)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return Principal{}, errors.New("invalid bearer authorization")
	}

	token, err := authenticator.verifier.Verify(request.Context(), parts[1])
	if err != nil {
		return Principal{}, fmt.Errorf("verify bearer token: %w", err)
	}
	return principalFromIDToken(token)
}

func principalFromIDToken(token verifiedToken) (Principal, error) {
	if strings.TrimSpace(token.subject) == "" {
		return Principal{}, errors.New("verified token has no subject")
	}
	var claims struct {
		Name     string   `json:"name"`
		Email    string   `json:"email"`
		Username string   `json:"preferred_username"`
		Scope    string   `json:"scope"`
		Scp      any      `json:"scp"`
		Groups   []string `json:"groups"`
		JTI      string   `json:"jti"`
		TokenID  string   `json:"token_id"`
	}
	if err := json.Unmarshal(token.claims, &claims); err != nil {
		return Principal{}, fmt.Errorf("extract token claims: %w", err)
	}
	scopes := map[string]bool{}
	for _, scope := range strings.Fields(claims.Scope) {
		scopes[scope] = true
	}
	for _, scope := range claimStrings(claims.Scp) {
		scopes[scope] = true
	}
	tokenID := strings.TrimSpace(claims.JTI)
	if tokenID == "" {
		tokenID = strings.TrimSpace(claims.TokenID)
	}
	return Principal{Subject: token.subject, Name: strings.TrimSpace(claims.Name), Email: strings.TrimSpace(claims.Email), Username: strings.TrimSpace(claims.Username), TokenID: tokenID, Scopes: scopes, Groups: claims.Groups}, nil
}

func claimStrings(value any) []string {
	switch value := value.(type) {
	case string:
		return strings.Fields(value)
	case []any:
		values := make([]string, 0, len(value))
		for _, item := range value {
			if item, ok := item.(string); ok {
				values = append(values, strings.Fields(item)...)
			}
		}
		return values
	case []string:
		return value
	default:
		return nil
	}
}
