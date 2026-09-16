CREATE TABLE IF NOT EXISTS auth_api_tokens (
    id text PRIMARY KEY,
    token_hash bytea NOT NULL UNIQUE,
    token_prefix text NOT NULL,
    subject_id text NOT NULL,
    workspace_id text NOT NULL,
    scopes text[] NOT NULL DEFAULT '{}',
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    last_used_at timestamptz,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auth_api_tokens_lookup_idx ON auth_api_tokens (token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_api_tokens_scope_idx ON auth_api_tokens (subject_id, workspace_id);

CREATE TABLE IF NOT EXISTS auth_workspaces (
    id text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_workspace_members (
    workspace_id text NOT NULL REFERENCES auth_workspaces(id) ON DELETE CASCADE,
    subject_id text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'editor', 'publisher', 'viewer')),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, subject_id)
);

CREATE INDEX IF NOT EXISTS auth_workspace_members_subject_idx
    ON auth_workspace_members (subject_id, workspace_id);

CREATE TABLE IF NOT EXISTS auth_oidc_flows (
    state_hash bytea PRIMARY KEY,
    nonce text NOT NULL,
    expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_oidc_flows_expires_at_idx
    ON auth_oidc_flows (expires_at);
