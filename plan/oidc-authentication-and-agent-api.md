# OIDC authentication, authorization and agent API plan

## Goal

Replace temporary Authentik proxy protection with application-owned authentication.

Target behavior:

```text
Browser → GeoPanel OIDC login → Authentik → GeoPanel session cookie → protected API
Agent   → GeoPanel scoped API token → same authorization layer
Public dashboard share → expiring read-only share token
```

Authentik remains identity provider. GeoPanel owns sessions, roles, workspaces,
object permissions and agent credentials. Authentik proxy provider becomes a
temporary migration fallback, then is removed.

## Non-goals

- Do not make agents automate browser login or reuse browser cookies.
- Do not trust `X-authentik-*` headers as application authentication.
- Do not expose arbitrary SQL as an agent API.
- Do not make public share tokens equivalent to normal API credentials.
- Do not put database credentials in dashboard/chart definitions.

## Phase 0 — stop secret exposure

Before new auth deployment:

- Rotate exposed-looking Authentik API, Authentik database, Authentik secret-key,
  Superset OAuth and other credential values in infrastructure files.
- Search current files and Git history for credentials, tokens and private keys.
- Move secrets to Ansible Vault or external secret storage; keep only variable
  references in normal group vars/Terraform configuration.
- Encrypt and restrict Terraform state. Confirm secrets are not emitted in plans,
  logs or CI artifacts.
- Revoke old credentials after replacement is deployed.

Relevant infrastructure areas:

- `/mnt/data/Projects/geoform-full/server-setup/group_vars/preprod/`
- `/mnt/data/Projects/geoform-full/server-setup/terraform/authentik/`
- `/mnt/data/Projects/geoform-full/server-setup/roles/geopanel/`

Acceptance: repository/config review finds no active credential values; rotated
credentials fail; replacement deployment reads secrets from approved secret store.

## Phase 1 — Authentik OIDC provider

Add a dedicated OAuth2/OIDC provider and application for GeoPanel in
`server-setup/terraform/authentik/`.

Suggested resources:

```text
authentik_provider_oauth2.geopanel
authentik_application.geopanel
```

Provider requirements:

- Authorization Code flow.
- Confidential client for backend-managed callback.
- Exact redirect URI: `https://geopanel.b216.ru/auth/callback`.
- `openid profile email` scopes.
- Strict redirect URI matching.
- Short access-token lifetime.
- Refresh-token rotation/expiry according to Authentik policy.
- Property mappings for `sub`, email, display name and groups/roles.
- Separate audience value for GeoPanel API, e.g. `geopanel-api`.

Do not reuse the existing proxy provider as the OIDC provider. Keep proxy
provider resources only until migration rollback is no longer needed.

Acceptance:

- Terraform plan creates one OIDC application and provider.
- Discovery document and JWKS are reachable.
- Authorization code callback succeeds only for exact configured URI.
- Provider emits expected issuer, audience, subject and group claims.

## Phase 2 — Go OIDC authentication

Add `backend/internal/auth/` with:

```text
oidc.go        discovery, JWKS, code exchange, ID-token validation
callback.go    state/nonce validation and callback handling
session.go     durable session creation, lookup, expiry and revocation
middleware.go  browser session + agent bearer authentication
tokens.go      agent token hashing, creation, revoke and expiry
```

Add endpoints:

```text
GET  /auth/login
GET  /auth/callback
POST /auth/logout
GET  /api/v1/auth/me
POST /api/v1/auth/tokens
GET  /api/v1/auth/tokens
DELETE /api/v1/auth/tokens/{id}
```

OIDC validation must check:

```text
state
nonce
issuer
signature via JWKS
audience
expiration / not-before
authorization-code single use
```

Session cookie:

```text
HttpOnly
Secure in production
SameSite=Lax
short idle/absolute expiry
opaque random session ID
```

Store only a hash of the session ID. Store sessions in PostgreSQL or another
shared durable store, not a process-local map.

Runtime configuration:

```text
AUTH_OIDC_ISSUER
AUTH_OIDC_CLIENT_ID
AUTH_OIDC_CLIENT_SECRET
AUTH_OIDC_AUDIENCE
AUTH_SESSION_SECRET
AUTH_ALLOW_ANONYMOUS=false
```

Production must fail closed when OIDC configuration is missing. Anonymous mode
may exist only behind an explicit development flag.

Acceptance:

- Missing/invalid/expired token → `401`.
- Valid identity without permission → `403`.
- Callback rejects bad state, nonce, issuer and audience.
- Logout revokes session.
- Restart preserves valid sessions.
- No access/refresh token is stored in browser local storage.

## Phase 3 — frontend login

Update React app to use application session, not Authentik proxy state.

Startup:

```text
GET /api/v1/auth/me
  200 → render application
  401 → render sign-in action
```

Sign-in redirects to `/auth/login`. Logout calls `/auth/logout` then clears
client state. API helper handles `401` centrally and never retries mutations
blindly.

Acceptance: direct app visit shows login when no session; authenticated user can
use map, inspector and analytics; refresh keeps session; logout blocks API use.

## Phase 4 — replace proxy guard

Current deployment applies Authentik `forward_auth` to whole GeoPanel site.
After application OIDC passes acceptance:

- Set `authentik_forward_auth: false` for GeoPanel nginx site.
- Keep TLS, reverse proxy and firewall restrictions.
- Keep GeoPanel backend port reachable only from trusted nginx source.
- Remove application dependence on `X-authentik-uid`, groups and email headers.
- Keep old proxy provider until rollback window closes, then remove it from
  Terraform/Auth­entik.

Relevant infrastructure:

```text
server-setup/group_vars/nginx_node/nginx.yml
server-setup/roles/nginx/templates/proxy_site.conf.j2
server-setup/roles/geopanel/templates/compose.yml.j2
server-setup/roles/geopanel/templates/.env.j2
```

The existing proxy must not remain in front of API-token requests: it would
require a proxy cookie before GeoPanel can validate the bearer token.

Acceptance: browser uses GeoPanel OIDC callback; agent bearer request reaches
Go directly; unauthenticated private request is rejected by Go; public share
request remains available only through share route.

## Phase 5 — agent credentials

Implement GeoPanel opaque personal/service tokens. Do not use Authentik browser
sessions. Authentik service/agent accounts may be added later, but Authentik
tokens must not be accepted unless issuer, audience and permission semantics are
explicitly designed for GeoPanel.

Token record:

```text
id
token_hash
token_prefix
subject_id
workspace_id
scopes
expires_at
revoked_at
last_used_at
created_by
```

Generate high-entropy tokens, show plaintext once, hash at rest, support expiry,
rotation and revoke. Never log plaintext tokens.

Initial scopes:

```text
analytics:read
analytics:write
analytics:publish
analytics:share
datasets:read
database:read
database:write
admin
```

Default agent token should be narrow, normally:

```text
analytics:read analytics:write analytics:publish
```

Authentication result for both session and API token becomes one request
principal:

```go
type Principal struct {
    Subject   string
    TokenID   string
    Workspace string
    Scopes    map[string]bool
    Groups    []string
}
```

Acceptance: agent can create/update/publish permitted analytics objects via
`Authorization: Bearer`; token cannot use ungranted routes; revoked/expired
token fails immediately; token plaintext never appears in storage/logs.

## Phase 6 — workspace and object authorization

Analytics metadata is currently global. Add ownership before multi-user or
agent writes become available.

Minimum model:

```text
workspace
workspace_member(subject, workspace, role)
analytics_object(workspace_id, owner_subject, ...)
```

Roles:

```text
viewer     read permitted objects/results
editor     create/update/delete drafts
publisher  publish immutable revisions
admin      members, datasets, tokens and workspace settings
```

Every operation must scope by principal/workspace:

```text
List, Get, Save, Delete, Query, Publish, CreateShare, RevokeShare
```

Do not authorize after fetching global objects. Return not-found for objects
outside caller visibility where resource enumeration matters.

Acceptance: cross-workspace reads/writes fail; editor cannot publish; viewer
cannot mutate; publisher cannot administer tokens; list endpoints reveal only
authorized objects.

## Phase 7 — dataset/query boundary

Keep analytics declarative and constrained:

- No arbitrary SQL endpoint for agents.
- Dataset definitions reference approved server-side connections/tables/fields.
- Query compiler allowlists dimensions, metrics, joins, filters and ordering.
- Use parameterized values, read-only DB credentials, deadlines and row/byte
  limits.
- Separate `database:read` and `database:write`.
- Audit dataset and query access.

Acceptance: agent-created charts query only approved datasets; SQL injection via
chart/filter definitions fails; expensive/unbounded requests are rejected or
cancelled; analytics DB role cannot write source data.

## Phase 8 — public shares

Keep existing public routes separate:

```text
/api/v1/analytics/public/{token}
/api/v1/analytics/public/{token}/query
```

Required properties:

- Published snapshot only.
- High-entropy token; hash at rest.
- Expiry and revocation.
- Locked filters cannot be widened.
- Read-only query only.
- Rate limiting and response limits.
- No draft, dataset catalog, database or mutation access.

Acceptance: expired/revoked share fails; public query cannot access private
objects; public filters cannot remove locked scope; private API remains OIDC or
agent-token protected.

## Phase 9 — audit, limits and tests

Audit at minimum:

```text
login/logout/failure
token create/revoke/use
workspace membership changes
dashboard/chart/dataset mutations
publish/share/revoke
query subject/workspace/dataset/result size
```

Add integration tests for:

- OIDC callback state/nonce/issuer/audience failures.
- Session expiry/revocation.
- API token scope, expiry and revocation.
- Cross-workspace access.
- Role/action matrix.
- Public share isolation.
- Query limits and read-only DB behavior.
- Nginx/app migration paths.

Run normal verification after implementation:

```text
go test -race ./...
bun test tests
bun run build
bun run check
hadolint backend/Dockerfile frontend/Dockerfile
docker compose config --quiet
```

## Rollout and rollback

Rollout:

1. Rotate secrets.
2. Deploy OIDC provider/application.
3. Deploy Go auth in compatibility mode while proxy remains enabled.
4. Test `/auth/login`, callback, `/auth/me`, logout and agent token.
5. Disable nginx forward-auth for GeoPanel.
6. Run browser, agent and public-share smoke tests.
7. Monitor auth failures and audit events.
8. Remove proxy provider only after rollback window.

Rollback:

1. Re-enable nginx Authentik forward-auth.
2. Keep application sessions/tokens invalidated or isolated.
3. Fix OIDC/provider/config issue.
4. Repeat cutover.

Never remove proxy protection before Go rejects unauthenticated private routes.

## Definition of done

- Browser login occurs through GeoPanel OIDC flow.
- Authentik proxy is no longer required for private app/API security.
- Browser session uses secure HttpOnly cookie.
- Agents use scoped, expiring, revocable bearer tokens.
- Authenticated principal reaches every authorization decision.
- Analytics objects are workspace-scoped.
- Dataset/query access is allowlisted and bounded.
- Public shares remain isolated read-only capabilities.
- Secrets are rotated and no longer stored as plaintext config.
- Tests prove `401`, `403`, cross-workspace denial, token revocation and share
  isolation.
