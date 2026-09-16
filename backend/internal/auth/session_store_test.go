package auth

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type fakeSessionDB struct {
	query string
	args  []any
	row   pgx.Row
	err   error
}

func (db *fakeSessionDB) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	db.query, db.args = query, args
	return pgconn.CommandTag{}, db.err
}
func (db *fakeSessionDB) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	db.query, db.args = query, args
	return db.row
}

type fakeSessionRow struct {
	subject string
	claims  []byte
	expires time.Time
	err     error
}

func (row fakeSessionRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*(dest[0].(*string)) = row.subject
	*(dest[1].(*[]byte)) = append([]byte(nil), row.claims...)
	*(dest[2].(*time.Time)) = row.expires
	return nil
}

func TestPostgreSQLSessionStoreRoundTripAndHashLookup(t *testing.T) {
	db := &fakeSessionDB{}
	store, err := NewPostgreSQLSessionStore(db)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(100, 0).UTC()
	store.now = func() time.Time { return now }
	session := Session{ID: "opaque-session", Principal: Principal{Subject: "user-1", TokenID: "token-1", Workspace: "ws", Scopes: map[string]bool{"read": true}, Groups: []string{"analyst"}}, ExpiresAt: now.Add(time.Hour)}
	if err := store.Put(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	if reflect.DeepEqual(db.args[0], []byte(session.ID)) {
		t.Fatal("plaintext session ID sent to DB")
	}
	if got, want := db.args[0], sessionHash(session.ID); !reflect.DeepEqual(got, want) {
		t.Fatalf("hash = %x, want %x", got, want)
	}
	var claims sessionClaims
	if err := json.Unmarshal(db.args[2].([]byte), &claims); err != nil {
		t.Fatal(err)
	}
	db.row = fakeSessionRow{subject: session.Principal.Subject, claims: db.args[2].([]byte), expires: session.ExpiresAt}
	got, ok, err := store.Get(context.Background(), session.ID)
	if err != nil || !ok {
		t.Fatalf("Get = %#v, %v, want session", got, err)
	}
	if !reflect.DeepEqual(got, session) {
		t.Fatalf("Get = %#v, want %#v", got, session)
	}
	if reflect.DeepEqual(db.args[0], []byte(session.ID)) || !reflect.DeepEqual(db.args[0], sessionHash(session.ID)) {
		t.Fatal("Get did not use hashed ID")
	}
}

func TestPostgreSQLSessionStoreExpiryAndInvalidPut(t *testing.T) {
	now := time.Unix(100, 0).UTC()
	store, _ := NewPostgreSQLSessionStore(&fakeSessionDB{row: fakeSessionRow{subject: "user", claims: []byte(`{}`), expires: now}})
	store.now = func() time.Time { return now }
	if _, ok, err := store.Get(context.Background(), "expired"); err != nil || ok {
		t.Fatalf("expired Get = %v, %v", ok, err)
	}
	if err := store.Put(context.Background(), Session{ID: "expired", Principal: Principal{Subject: "user"}, ExpiresAt: now}); !errors.Is(err, ErrInvalidSession) {
		t.Fatalf("expired Put = %v", err)
	}
}

func TestPostgreSQLSessionStoreDeleteHashesID(t *testing.T) {
	db := &fakeSessionDB{}
	store, _ := NewPostgreSQLSessionStore(db)
	if err := store.Delete(context.Background(), "opaque-session"); err != nil {
		t.Fatal(err)
	}
	if reflect.DeepEqual(db.args[0], []byte("opaque-session")) || !reflect.DeepEqual(db.args[0], sessionHash("opaque-session")) {
		t.Fatalf("Delete arg = %x, want hash", db.args[0])
	}
}
