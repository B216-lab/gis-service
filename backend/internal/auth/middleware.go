package auth

import (
	"errors"
	"net/http"
)

// Middleware resolves optional credentials and attaches a Principal to the
// request. It leaves anonymous requests untouched so callers can mount it at
// the API boundary while keeping explicitly public routes public.
func Middleware(authenticator Authenticator, next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if authenticator == nil {
			next.ServeHTTP(writer, request)
			return
		}

		principal, err := authenticator.Authenticate(request)
		if err == nil {
			principal = clonePrincipal(principal)
			request = request.WithContext(WithPrincipal(request.Context(), principal))
		} else if !errors.Is(err, ErrUnauthenticated) {
			Unauthorized(writer)
			return
		}

		next.ServeHTTP(writer, request)
	})
}

// Require rejects requests without an authenticated Principal.
func Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if _, ok := PrincipalFromRequest(request); !ok {
			Unauthorized(writer)
			return
		}
		next.ServeHTTP(writer, request)
	})
}

// Unauthorized keeps auth failures indistinguishable to callers and avoids
// leaking details from future OIDC/token validators.
func Unauthorized(writer http.ResponseWriter) {
	writer.Header().Set("WWW-Authenticate", "Bearer")
	writeAuthJSON(writer, http.StatusUnauthorized, map[string]string{"code": "unauthorized", "message": "unauthorized"})
}

func clonePrincipal(principal Principal) Principal {
	if principal.Scopes != nil {
		principal.Scopes = map[string]bool{}
		for scope, allowed := range principal.Scopes {
			principal.Scopes[scope] = allowed
		}
	}
	principal.Groups = append([]string(nil), principal.Groups...)
	return principal
}
