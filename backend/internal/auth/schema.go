package auth

import (
	"context"
	"fmt"
)

// EnsurePostgreSQLSchema creates only auth-owned durable storage. Keeping the
// bootstrap here prevents unrelated application migrations from owning auth.
func EnsurePostgreSQLSchema(ctx context.Context, db SessionDB) error {
	for _, statement := range authSchema {
		if _, err := db.Exec(ctx, statement); err != nil {
			return fmt.Errorf("initialize auth schema: %w", err)
		}
	}
	return nil
}

var authSchema = []string{
	`CREATE TABLE IF NOT EXISTS auth_sessions (
    id_hash bytea PRIMARY KEY,
    subject text NOT NULL,
    claims jsonb NOT NULL,
    expires_at timestamptz NOT NULL
);`,
	`CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions (expires_at);`,
	`CREATE TABLE IF NOT EXISTS auth_oidc_flows (
    state_hash bytea PRIMARY KEY,
    nonce text NOT NULL,
    expires_at timestamptz NOT NULL
);`,
	`CREATE INDEX IF NOT EXISTS auth_oidc_flows_expires_at_idx ON auth_oidc_flows (expires_at);`,
	`CREATE TABLE IF NOT EXISTS auth_api_tokens (
    id text PRIMARY KEY,
    token_hash bytea NOT NULL UNIQUE,
    token_prefix text NOT NULL,
    subject_id text NOT NULL,
    workspace_id text NOT NULL,
    scopes text[] NOT NULL DEFAULT '{}',
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    last_used_at timestamptz,
    created_by text NOT NULL
);`,
	`ALTER TABLE auth_api_tokens ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW();`,
	`ALTER TABLE auth_api_tokens ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'API token';`,
	`CREATE INDEX IF NOT EXISTS auth_api_tokens_active_idx ON auth_api_tokens (token_hash) WHERE revoked_at IS NULL;`,
	`CREATE TABLE IF NOT EXISTS auth_workspaces (
    id text PRIMARY KEY,
    name text NOT NULL DEFAULT '',
    description text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    created_at timestamptz NOT NULL DEFAULT NOW()
);`,
	`ALTER TABLE auth_workspaces ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';`,
	`ALTER TABLE auth_workspaces ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';`,
	`ALTER TABLE auth_workspaces ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();`,
	`CREATE TABLE IF NOT EXISTS auth_workspace_members (
    workspace_id text NOT NULL REFERENCES auth_workspaces(id) ON DELETE CASCADE,
    subject_id text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'editor', 'publisher', 'viewer')),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, subject_id)
);`,
	`CREATE INDEX IF NOT EXISTS auth_workspace_members_subject_idx ON auth_workspace_members (subject_id, workspace_id);`,
	`CREATE TABLE IF NOT EXISTS auth_workspace_group_roles (
    workspace_id text NOT NULL REFERENCES auth_workspaces(id) ON DELETE CASCADE,
    group_name text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'editor', 'publisher', 'viewer')),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, group_name)
);`,
}
