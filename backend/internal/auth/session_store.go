package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var ErrInvalidSession = errors.New("invalid session")

// SessionDB is the small pgx surface required by PostgreSQLSessionStore.
// pgx.Row is intentionally retained so pgxpool.Pool and test doubles both fit.
type SessionDB interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

// PostgreSQLSessionStore persists sessions without ever sending the opaque
// cookie value to PostgreSQL. Session IDs are SHA-256 digests at rest.
type PostgreSQLSessionStore struct {
	db     SessionDB
	now    func() time.Time
	secret []byte
}

func NewPostgreSQLSessionStore(db SessionDB) (*PostgreSQLSessionStore, error) {
	if db == nil {
		return nil, errors.New("session database is required")
	}
	return &PostgreSQLSessionStore{db: db, now: time.Now}, nil
}

// NewPostgreSQLSessionStoreWithSecret uses a keyed digest for cookie IDs at
// rest. Production startup must use this constructor.
func NewPostgreSQLSessionStoreWithSecret(db SessionDB, secret string) (*PostgreSQLSessionStore, error) {
	store, err := NewPostgreSQLSessionStore(db)
	if err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(secret)) < 32 {
		return nil, errors.New("session secret must be at least 32 characters")
	}
	store.secret = []byte(secret)
	return store, nil
}

type sessionClaims struct {
	Name      string          `json:"name,omitempty"`
	Email     string          `json:"email,omitempty"`
	Username  string          `json:"username,omitempty"`
	TokenID   string          `json:"tokenId,omitempty"`
	Workspace string          `json:"workspace,omitempty"`
	Scopes    map[string]bool `json:"scopes,omitempty"`
	Groups    []string        `json:"groups,omitempty"`
}

func (store *PostgreSQLSessionStore) Put(ctx context.Context, session Session) error {
	if strings.TrimSpace(session.ID) == "" || strings.TrimSpace(session.Principal.Subject) == "" || !session.ExpiresAt.After(store.now()) {
		return ErrInvalidSession
	}
	claims, err := json.Marshal(sessionClaims{
		Name: session.Principal.Name, Email: session.Principal.Email, Username: session.Principal.Username,
		TokenID: session.Principal.TokenID, Workspace: session.Principal.Workspace,
		Scopes: cloneScopes(session.Principal.Scopes), Groups: append([]string(nil), session.Principal.Groups...),
	})
	if err != nil {
		return fmt.Errorf("marshal session claims: %w", err)
	}
	_, err = store.db.Exec(ctx, `
		INSERT INTO auth_sessions (id_hash, subject, claims, expires_at)
		VALUES ($1, $2, $3::jsonb, $4)
		ON CONFLICT (id_hash) DO UPDATE SET subject = EXCLUDED.subject, claims = EXCLUDED.claims, expires_at = EXCLUDED.expires_at`,
		store.hash(session.ID), session.Principal.Subject, claims, session.ExpiresAt)
	if err != nil {
		return fmt.Errorf("store session: %w", err)
	}
	return nil
}

func (store *PostgreSQLSessionStore) Get(ctx context.Context, id string) (Session, bool, error) {
	if strings.TrimSpace(id) == "" {
		return Session{}, false, nil
	}
	var subject string
	var claimsJSON []byte
	var expiresAt time.Time
	err := store.db.QueryRow(ctx, `
		SELECT subject, claims, expires_at
		FROM auth_sessions
		WHERE id_hash = $1 AND expires_at > NOW()`, store.hash(id)).Scan(&subject, &claimsJSON, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, false, nil
	}
	if err != nil {
		return Session{}, false, fmt.Errorf("load session: %w", err)
	}
	if !expiresAt.After(store.now()) {
		return Session{}, false, nil
	}
	var claims sessionClaims
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		return Session{}, false, fmt.Errorf("decode session claims: %w", err)
	}
	return Session{ID: id, Principal: Principal{Subject: subject, Name: claims.Name, Email: claims.Email, Username: claims.Username, TokenID: claims.TokenID, Workspace: claims.Workspace, Scopes: cloneScopes(claims.Scopes), Groups: append([]string(nil), claims.Groups...)}, ExpiresAt: expiresAt}, true, nil
}

func (store *PostgreSQLSessionStore) Delete(ctx context.Context, id string) error {
	if strings.TrimSpace(id) == "" {
		return nil
	}
	if _, err := store.db.Exec(ctx, `DELETE FROM auth_sessions WHERE id_hash = $1`, store.hash(id)); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

func sessionHash(id string) []byte {
	digest := sha256.Sum256([]byte(id))
	return digest[:]
}

func (store *PostgreSQLSessionStore) hash(id string) []byte {
	if len(store.secret) == 0 {
		return sessionHash(id)
	}
	mac := hmac.New(sha256.New, store.secret)
	_, _ = mac.Write([]byte(id))
	return mac.Sum(nil)
}

func cloneScopes(scopes map[string]bool) map[string]bool {
	if scopes == nil {
		return nil
	}
	clone := make(map[string]bool, len(scopes))
	for scope, enabled := range scopes {
		clone[scope] = enabled
	}
	return clone
}
