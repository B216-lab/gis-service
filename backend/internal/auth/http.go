package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
)

// CompositeAuthenticator selects one credential family per request. An
// Authorization header always selects bearer auth, including malformed
// headers; this prevents an invalid bearer from falling through to a valid
// browser session on the same request.
type CompositeAuthenticator struct {
	session Authenticator
	bearer  Authenticator
}

// BearerAuthenticator routes application API tokens and OIDC JWTs without
// allowing an invalid credential to fall through to another credential type.
type BearerAuthenticator struct {
	oidc      Authenticator
	apiTokens Authenticator
}

func NewBearerAuthenticator(oidc, apiTokens Authenticator) *BearerAuthenticator {
	return &BearerAuthenticator{oidc: oidc, apiTokens: apiTokens}
}

func (authenticator *BearerAuthenticator) Authenticate(request *http.Request) (Principal, error) {
	if request == nil {
		return Principal{}, errors.New("request is nil")
	}
	parts := strings.Fields(request.Header.Get("Authorization"))
	if len(parts) == 0 {
		return Principal{}, ErrUnauthenticated
	}
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return Principal{}, ErrInvalidAPIToken
	}
	if strings.HasPrefix(parts[1], apiTokenPrefix) {
		if authenticator == nil || authenticator.apiTokens == nil {
			return Principal{}, errors.New("API-token authenticator is not initialized")
		}
		return authenticator.apiTokens.Authenticate(request)
	}
	if authenticator == nil || authenticator.oidc == nil {
		return Principal{}, errors.New("OIDC authenticator is not initialized")
	}
	return authenticator.oidc.Authenticate(request)
}

func NewCompositeAuthenticator(session, bearer Authenticator) *CompositeAuthenticator {
	return &CompositeAuthenticator{session: session, bearer: bearer}
}

func (authenticator *CompositeAuthenticator) Authenticate(request *http.Request) (Principal, error) {
	if request == nil {
		return Principal{}, errors.New("request is nil")
	}
	if hasHeader(request, "Authorization") {
		if authenticator == nil || authenticator.bearer == nil {
			return Principal{}, errors.New("bearer authenticator is not initialized")
		}
		return authenticator.bearer.Authenticate(request)
	}
	if authenticator == nil || authenticator.session == nil {
		return Principal{}, ErrUnauthenticated
	}
	return authenticator.session.Authenticate(request)
}

func hasHeader(request *http.Request, name string) bool {
	for key := range request.Header {
		if strings.EqualFold(key, name) {
			return true
		}
	}
	return false
}

// RequireScope rejects anonymous callers and authenticated callers lacking
// required scope. It intentionally emits no principal or credential details.
func RequireScope(scope string, next http.Handler) http.Handler {
	scope = strings.TrimSpace(scope)
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		principal, ok := PrincipalFromRequest(request)
		if !ok {
			Unauthorized(writer)
			return
		}
		if scope == "" || !principal.Scopes[scope] {
			Forbidden(writer)
			return
		}
		next.ServeHTTP(writer, request)
	})
}

func Forbidden(writer http.ResponseWriter) {
	writeAuthJSON(writer, http.StatusForbidden, map[string]string{"code": "forbidden", "message": "forbidden"})
}

type BrowserHandler interface {
	Login(http.ResponseWriter, *http.Request)
	Callback(http.ResponseWriter, *http.Request)
	Logout(http.ResponseWriter, *http.Request)
}

// NewHTTPHandler builds auth routes with all auth dependencies injected.
// Callers can wrap this handler with Middleware when mounting other API
// routes; /me performs its own required-auth check.
func NewHTTPHandler(browser BrowserHandler, authenticator Authenticator) http.Handler {
	return NewHTTPHandlerWithTokens(browser, authenticator, nil, nil)
}

// NewHTTPHandlerWithTokens mounts auth routes plus workspace-scoped API-token
// management. workspace IDs are accepted only as query/path parameters; token
// create bodies cannot select their owning workspace.
func NewHTTPHandlerWithTokens(browser BrowserHandler, authenticator Authenticator, tokens APITokenManager, authz WorkspaceAuthorizer) http.Handler {
	return NewHTTPHandlerWithManagement(browser, authenticator, tokens, authz, nil)
}

func NewHTTPHandlerWithManagement(browser BrowserHandler, authenticator Authenticator, tokens APITokenManager, authz WorkspaceAuthorizer, workspaces WorkspaceStore) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /auth/login", browser.Login)
	mux.HandleFunc("GET /auth/callback", browser.Callback)
	mux.HandleFunc("POST /auth/logout", browser.Logout)
	mux.Handle("GET /api/v1/auth/me", Middleware(authenticator, Require(http.HandlerFunc(meHandler))))
	if tokens != nil && authz != nil {
		registerTokenRoutes(mux, authenticator, tokens, authz)
	}
	if workspaces != nil {
		registerWorkspaceRoutes(mux, authenticator, workspaces)
	}
	return mux
}

// NewRoutes is an alias kept as the route-construction entry point for callers
// that use Register-style naming elsewhere in the service.
func NewRoutes(browser BrowserHandler, authenticator Authenticator) http.Handler {
	return NewHTTPHandler(browser, authenticator)
}

func NewRoutesWithTokens(browser BrowserHandler, authenticator Authenticator, tokens APITokenManager, authz WorkspaceAuthorizer) http.Handler {
	return NewHTTPHandlerWithTokens(browser, authenticator, tokens, authz)
}

type meResponse struct {
	Name      string   `json:"name,omitempty"`
	Email     string   `json:"email,omitempty"`
	Username  string   `json:"username,omitempty"`
	Subject   string   `json:"subject"`
	Workspace string   `json:"workspace,omitempty"`
	Scopes    []string `json:"scopes"`
	Groups    []string `json:"groups"`
}

func meHandler(writer http.ResponseWriter, request *http.Request) {
	principal, ok := PrincipalFromRequest(request)
	if !ok {
		Unauthorized(writer)
		return
	}
	scopes := make([]string, 0, len(principal.Scopes))
	for scope, enabled := range principal.Scopes {
		if enabled {
			scopes = append(scopes, scope)
		}
	}
	sort.Strings(scopes)
	groups := append([]string(nil), principal.Groups...)
	if groups == nil {
		groups = []string{}
	}
	writeAuthJSON(writer, http.StatusOK, meResponse{Name: principal.Name, Email: principal.Email, Username: principal.Username, Subject: principal.Subject, Workspace: principal.Workspace, Scopes: scopes, Groups: groups})
}

func writeAuthJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
