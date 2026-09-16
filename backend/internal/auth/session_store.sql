-- Apply once before constructing PostgreSQLSessionStore.
CREATE TABLE IF NOT EXISTS auth_sessions (
    id_hash bytea PRIMARY KEY,
    subject text NOT NULL,
    claims jsonb NOT NULL,
    expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS auth_oidc_flows (
    state_hash bytea PRIMARY KEY,
    nonce text NOT NULL,
    expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_oidc_flows_expires_at_idx ON auth_oidc_flows (expires_at);
