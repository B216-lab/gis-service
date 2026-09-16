package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// PostgreSQLFlowStore makes OIDC login state survive process restarts and work
// across replicas. Callback state is hashed at rest and consumed atomically.
type PostgreSQLFlowStore struct {
	db  SessionDB
	now func() time.Time
}

func NewPostgreSQLFlowStore(db SessionDB) (*PostgreSQLFlowStore, error) {
	if db == nil {
		return nil, errors.New("flow database is required")
	}
	return &PostgreSQLFlowStore{db: db, now: time.Now}, nil
}

func (store *PostgreSQLFlowStore) Put(ctx context.Context, flow FlowState) error {
	if strings.TrimSpace(flow.State) == "" || strings.TrimSpace(flow.Nonce) == "" || !flow.ExpiresAt.After(store.now()) {
		return errors.New("invalid OIDC flow")
	}
	_, err := store.db.Exec(ctx, `
		INSERT INTO auth_oidc_flows (state_hash, nonce, expires_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (state_hash) DO UPDATE SET nonce = EXCLUDED.nonce, expires_at = EXCLUDED.expires_at`,
		flowHash(flow.State), flow.Nonce, flow.ExpiresAt)
	return err
}

func (store *PostgreSQLFlowStore) Take(ctx context.Context, state string) (FlowState, bool, error) {
	if strings.TrimSpace(state) == "" {
		return FlowState{}, false, nil
	}
	var nonce string
	var expiresAt time.Time
	err := store.db.QueryRow(ctx, `
		DELETE FROM auth_oidc_flows
		WHERE state_hash = $1 AND expires_at > NOW()
		RETURNING nonce, expires_at`, flowHash(state)).Scan(&nonce, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return FlowState{}, false, nil
	}
	if err != nil {
		return FlowState{}, false, err
	}
	if !expiresAt.After(store.now()) {
		return FlowState{}, false, nil
	}
	return FlowState{State: state, Nonce: nonce, ExpiresAt: expiresAt}, true, nil
}

func flowHash(state string) []byte {
	digest := sha256.Sum256([]byte(state))
	return digest[:]
}
