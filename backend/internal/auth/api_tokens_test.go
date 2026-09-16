package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type tokenDB struct {
	query   string
	args    []any
	row     pgx.Row
	execErr error
}

func (db *tokenDB) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	db.query, db.args = query, args
	return pgconn.CommandTag{}, db.execErr
}
func (db *tokenDB) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	db.query, db.args = query, args
	return db.row
}

type tokenRow struct {
	id, subject, workspace string
	scopes                 []string
	expires                time.Time
	revoked                *time.Time
	created                string
	err                    error
}

func (r tokenRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	*dest[0].(*string) = r.id
	*dest[1].(*string) = r.subject
	*dest[2].(*string) = r.workspace
	*dest[3].(*[]string) = r.scopes
	*dest[4].(*time.Time) = r.expires
	*dest[5].(**time.Time) = r.revoked
	*dest[6].(*string) = r.created
	return nil
}

func TestNewAPITokenEntropyAndFormat(t *testing.T) {
	a, ap, err := NewAPIToken()
	if err != nil {
		t.Fatal(err)
	}
	b, bp, err := NewAPIToken()
	if err != nil {
		t.Fatal(err)
	}
	if a == b || len(a) != 46 || ap != a[:apiTokenMeta] || bp != b[:apiTokenMeta] {
		t.Fatalf("tokens format/entropy invalid: %q %q", a, b)
	}
}

func TestAPITokenCreateStoresHashOnly(t *testing.T) {
	db := &tokenDB{}
	store, _ := NewPostgreSQLAPITokenStore(db)
	now := time.Unix(100, 0).UTC()
	store.now = func() time.Time { return now }
	result, err := store.Create(context.Background(), APITokenCreateRequest{Subject: "user", Workspace: "ws", Scopes: map[string]bool{"read": true}, ExpiresAt: now.Add(time.Hour), CreatedBy: "user"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Token == "" {
		t.Fatal("creation must return plaintext token")
	}
	for _, arg := range db.args {
		if reflect.DeepEqual(arg, result.Token) {
			t.Fatal("plaintext token persisted")
		}
	}
	if !reflect.DeepEqual(db.args[1], apiTokenHash(result.Token)) {
		t.Fatal("token hash not persisted")
	}
}

func TestAPITokenAuthenticateScopeExpiryRevocationAndInvalidBearer(t *testing.T) {
	now := time.Unix(100, 0).UTC()
	token, _, _ := NewAPIToken()
	db := &tokenDB{row: tokenRow{id: "id", subject: "sub", workspace: "ws", scopes: []string{"read", "write"}, expires: now.Add(time.Hour)}}
	store, _ := NewPostgreSQLAPITokenStore(db)
	store.now = func() time.Time { return now }
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	principal, err := store.Authenticate(req)
	if err != nil || principal.Subject != "sub" || !principal.Scopes["read"] {
		t.Fatalf("auth = %#v, %v", principal, err)
	}
	for _, value := range []string{"Basic x", "Bearer", "Bearer wrong extra"} {
		req.Header.Set("Authorization", value)
		if _, err := store.Authenticate(req); err == nil {
			t.Fatalf("invalid bearer %q accepted", value)
		}
	}
	db.row = tokenRow{id: "id", subject: "sub", workspace: "ws", expires: now.Add(-time.Second)}
	req.Header.Set("Authorization", "Bearer "+token)
	if _, err := store.Authenticate(req); err == nil {
		t.Fatal("expired token accepted")
	}
	if err := store.Revoke(context.Background(), "id"); err != nil {
		t.Fatal(err)
	}
}

func TestParseTokenScopes(t *testing.T) {
	got := parseTokenScopes([]string{" read ", "", "read", "write"})
	if !reflect.DeepEqual(got, map[string]bool{"read": true, "write": true}) {
		t.Fatalf("scopes = %#v", got)
	}
}
