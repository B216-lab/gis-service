// Package auth defines the request authentication boundary used by API handlers.
// Concrete OIDC, session, and API-token authenticators can be added without
// changing handlers that consume a Principal.
package auth

import (
	"context"
	"errors"
	"net/http"
)

// Principal identifies the authenticated caller for one request.
// Scopes and Groups are copied by middleware before being stored in context.
type Principal struct {
	Subject    string
	Name       string
	Email      string
	Username   string
	TokenID    string
	IsAPIToken bool
	Workspace  string
	Scopes     map[string]bool
	Groups     []string
}

// Authenticator resolves a request into a principal. ErrUnauthenticated means
// the request has no credentials; other errors represent invalid credentials.
type Authenticator interface {
	Authenticate(*http.Request) (Principal, error)
}

// AuthenticatorFunc adapts a function into an Authenticator.
type AuthenticatorFunc func(*http.Request) (Principal, error)

func (fn AuthenticatorFunc) Authenticate(request *http.Request) (Principal, error) {
	return fn(request)
}

var ErrUnauthenticated = errors.New("request is unauthenticated")

type contextKey struct{}

// WithPrincipal returns request context carrying principal.
func WithPrincipal(ctx context.Context, principal Principal) context.Context {
	return context.WithValue(ctx, contextKey{}, principal)
}

// PrincipalFromContext returns principal, if request was authenticated.
func PrincipalFromContext(ctx context.Context) (Principal, bool) {
	principal, ok := ctx.Value(contextKey{}).(Principal)
	return principal, ok
}

// PrincipalFromRequest returns principal, if request was authenticated.
func PrincipalFromRequest(request *http.Request) (Principal, bool) {
	return PrincipalFromContext(request.Context())
}
