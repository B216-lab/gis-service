package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const (
	defaultSessionCookie = "geoform_session"
	defaultFlowTTL       = 10 * time.Minute
	defaultSessionTTL    = 8 * time.Hour
)

// OIDCIdentity is the verified result of an authorization-code exchange.
// Nonce is checked against the server-side flow record before session creation.
type OIDCIdentity struct {
	Principal Principal
	Nonce     string
}

// CodeExchanger hides provider/network details from the callback handler.
type CodeExchanger interface {
	Exchange(context.Context, string) (OIDCIdentity, error)
}

type oidcCodeExchanger struct {
	config   oauth2.Config
	verifier tokenVerifier
}

// NewBrowserOIDCCodeExchanger discovers provider endpoints and builds the
// production code-exchange implementation. Handler tests can inject a fake
// CodeExchanger instead, avoiding network/provider dependencies.
func NewBrowserOIDCCodeExchanger(ctx context.Context, config OIDCConfig) (CodeExchanger, func(string) string, error) {
	if strings.TrimSpace(config.IssuerURL) == "" || strings.TrimSpace(config.ClientID) == "" || strings.TrimSpace(config.RedirectURL) == "" || strings.TrimSpace(config.ClientSecret) == "" {
		return nil, nil, errors.New("OIDC issuer, client ID, redirect URL, and client secret are required")
	}
	provider, err := oidc.NewProvider(ctx, config.IssuerURL)
	if err != nil {
		return nil, nil, fmt.Errorf("discover OIDC provider: %w", err)
	}
	oauthConfig := oauth2.Config{ClientID: config.ClientID, ClientSecret: config.ClientSecret, Endpoint: provider.Endpoint(), RedirectURL: config.RedirectURL, Scopes: []string{oidc.ScopeOpenID, "profile", "email"}}
	return oidcCodeExchanger{config: oauthConfig, verifier: oidcTokenVerifier{verifier: provider.Verifier(&oidc.Config{ClientID: config.ClientID})}}, func(state string) string { return oauthConfig.AuthCodeURL(state) }, nil
}

func (exchanger oidcCodeExchanger) Exchange(ctx context.Context, code string) (OIDCIdentity, error) {
	token, err := exchanger.config.Exchange(ctx, code)
	if err != nil {
		return OIDCIdentity{}, fmt.Errorf("exchange authorization code: %w", err)
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		return OIDCIdentity{}, errors.New("authorization response has no ID token")
	}
	verified, err := exchanger.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return OIDCIdentity{}, fmt.Errorf("verify ID token: %w", err)
	}
	principal, err := principalFromIDToken(verified)
	if err != nil {
		return OIDCIdentity{}, err
	}
	var claims struct {
		Nonce string `json:"nonce"`
	}
	if err := json.Unmarshal(verified.claims, &claims); err != nil || strings.TrimSpace(claims.Nonce) == "" {
		return OIDCIdentity{}, errors.New("ID token has no nonce")
	}
	return OIDCIdentity{Principal: principal, Nonce: claims.Nonce}, nil
}

// FlowState binds one login attempt to its nonce and expiry. Store consumes
// records so authorization codes cannot be replayed through this handler.
type FlowState struct {
	State     string
	Nonce     string
	ExpiresAt time.Time
}

type FlowStateStore interface {
	Put(context.Context, FlowState) error
	Take(context.Context, string) (FlowState, bool, error)
}

// Session is deliberately opaque at the cookie boundary. Persisting this
// record requires a SessionStore implementation supplied by the application.
type Session struct {
	ID        string
	Principal Principal
	ExpiresAt time.Time
}

type SessionStore interface {
	Put(context.Context, Session) error
	Get(context.Context, string) (Session, bool, error)
	Delete(context.Context, string) error
}

// BrowserAuthConfig controls browser flow and cookie behavior. No production
// storage is implied: stores are explicit constructor dependencies.
type BrowserAuthConfig struct {
	RedirectURL  string
	ClientSecret string
	CookieName   string
	FlowTTL      time.Duration
	SessionTTL   time.Duration
	SecureCookie bool
}

func (config BrowserAuthConfig) validate() error {
	if strings.TrimSpace(config.RedirectURL) == "" || strings.TrimSpace(config.ClientSecret) == "" {
		return errors.New("OIDC redirect URL and client secret are required")
	}
	if config.FlowTTL <= 0 || config.SessionTTL <= 0 {
		return errors.New("OIDC flow and session TTL must be positive")
	}
	return nil
}

// BrowserOIDCHandler implements login, callback, logout, and session lookup.
// AuthURL should return provider authorization URL for state.
type BrowserOIDCHandler struct {
	config       BrowserAuthConfig
	authURL      func(string) string
	exchanger    CodeExchanger
	flows        FlowStateStore
	sessions     SessionStore
	randomString func() (string, error)
}

func NewBrowserOIDCHandler(config BrowserAuthConfig, authURL func(string) string, exchanger CodeExchanger, flows FlowStateStore, sessions SessionStore) (*BrowserOIDCHandler, error) {
	if err := config.validate(); err != nil {
		return nil, err
	}
	if authURL == nil || exchanger == nil || flows == nil || sessions == nil {
		return nil, errors.New("OIDC browser dependencies are required")
	}
	if config.CookieName == "" {
		config.CookieName = defaultSessionCookie
	}
	return &BrowserOIDCHandler{config: config, authURL: authURL, exchanger: exchanger, flows: flows, sessions: sessions, randomString: randomOpaque}, nil
}

func (handler *BrowserOIDCHandler) Login(w http.ResponseWriter, request *http.Request) {
	state, err := handler.randomString()
	if err != nil {
		http.Error(w, "login unavailable", http.StatusInternalServerError)
		return
	}
	nonce, err := handler.randomString()
	if err == nil {
		err = handler.flows.Put(request.Context(), FlowState{State: state, Nonce: nonce, ExpiresAt: time.Now().Add(handler.config.FlowTTL)})
	}
	if err != nil {
		http.Error(w, "login unavailable", http.StatusInternalServerError)
		return
	}
	authURL, err := addNonce(handler.authURL(state), nonce)
	if err != nil {
		http.Error(w, "login unavailable", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, request, authURL, http.StatusFound)
}

func addNonce(rawURL, nonce string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	query := parsed.Query()
	query.Set("nonce", nonce)
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func (handler *BrowserOIDCHandler) Callback(w http.ResponseWriter, request *http.Request) {
	query := request.URL.Query()
	state := query.Get("state")
	if state == "" || query.Get("code") == "" {
		http.Error(w, "invalid callback", http.StatusBadRequest)
		return
	}
	flow, ok, err := handler.flows.Take(request.Context(), state)
	if err != nil {
		http.Error(w, "callback unavailable", http.StatusInternalServerError)
		return
	}
	if !ok || !constantTimeEqual(flow.State, state) || !flow.ExpiresAt.After(time.Now()) {
		http.Error(w, "invalid callback", http.StatusBadRequest)
		return
	}
	identity, err := handler.exchanger.Exchange(request.Context(), query.Get("code"))
	if err != nil {
		http.Error(w, "callback rejected", http.StatusBadRequest)
		return
	}
	if !constantTimeEqual(flow.Nonce, identity.Nonce) || strings.TrimSpace(identity.Principal.Subject) == "" {
		http.Error(w, "invalid callback", http.StatusBadRequest)
		return
	}
	sessionID, err := handler.randomString()
	if err != nil {
		http.Error(w, "session unavailable", http.StatusInternalServerError)
		return
	}
	session := Session{ID: sessionID, Principal: clonePrincipal(identity.Principal), ExpiresAt: time.Now().Add(handler.config.SessionTTL)}
	if err := handler.sessions.Put(request.Context(), session); err != nil {
		http.Error(w, "session unavailable", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, handler.sessionCookie(sessionID, session.ExpiresAt))
	http.Redirect(w, request, "/", http.StatusFound)
}

func (handler *BrowserOIDCHandler) Logout(w http.ResponseWriter, request *http.Request) {
	if cookie, err := request.Cookie(handler.config.CookieName); err == nil && cookie.Value != "" {
		if err := handler.sessions.Delete(request.Context(), cookie.Value); err != nil {
			http.Error(w, "logout unavailable", http.StatusInternalServerError)
			return
		}
	}
	expired := handler.sessionCookie("", time.Unix(0, 0))
	expired.MaxAge = -1
	http.SetCookie(w, expired)
	w.WriteHeader(http.StatusNoContent)
}

// SessionAuthenticator resolves the session cookie into an existing Principal.
func (handler *BrowserOIDCHandler) SessionAuthenticator() Authenticator {
	return AuthenticatorFunc(func(request *http.Request) (Principal, error) {
		cookie, err := request.Cookie(handler.config.CookieName)
		if err != nil || cookie.Value == "" {
			return Principal{}, ErrUnauthenticated
		}
		session, ok, err := handler.sessions.Get(request.Context(), cookie.Value)
		if err != nil {
			return Principal{}, err
		}
		if !ok || session.ID != cookie.Value || !session.ExpiresAt.After(time.Now()) {
			return Principal{}, ErrUnauthenticated
		}
		return clonePrincipal(session.Principal), nil
	})
}

func (handler *BrowserOIDCHandler) sessionCookie(value string, expires time.Time) *http.Cookie {
	maxAge := int(time.Until(expires).Seconds())
	if value == "" {
		maxAge = -1
	}
	return &http.Cookie{Name: handler.config.CookieName, Value: value, Path: "/", Expires: expires, MaxAge: maxAge, HttpOnly: true, Secure: handler.config.SecureCookie, SameSite: http.SameSiteLaxMode}
}

func constantTimeEqual(left, right string) bool {
	if len(left) != len(right) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func randomOpaque() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

// InMemoryFlowStore and InMemorySessionStore are process-local test/dev
// doubles. They are not durable or suitable for multi-instance production.
type InMemoryFlowStore struct {
	mu     sync.Mutex
	values map[string]FlowState
}

func NewInMemoryFlowStore() *InMemoryFlowStore {
	return &InMemoryFlowStore{values: map[string]FlowState{}}
}
func (store *InMemoryFlowStore) Put(_ context.Context, flow FlowState) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.values[flow.State] = flow
	return nil
}
func (store *InMemoryFlowStore) Take(_ context.Context, state string) (FlowState, bool, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	flow, ok := store.values[state]
	delete(store.values, state)
	return flow, ok, nil
}

type InMemorySessionStore struct {
	mu     sync.Mutex
	values map[string]Session
}

func NewInMemorySessionStore() *InMemorySessionStore {
	return &InMemorySessionStore{values: map[string]Session{}}
}
func (store *InMemorySessionStore) Put(_ context.Context, session Session) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.values[session.ID] = session
	return nil
}
func (store *InMemorySessionStore) Get(_ context.Context, id string) (Session, bool, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	session, ok := store.values[id]
	return session, ok, nil
}
func (store *InMemorySessionStore) Delete(_ context.Context, id string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	delete(store.values, id)
	return nil
}
