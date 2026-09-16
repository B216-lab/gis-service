# Auth management and agent control plane

## Goal

Make the deployed GeoPanel auth foundation usable by humans, developers, and
agents without manual database work. Authentik remains the identity provider;
GeoPanel owns workspace membership, roles, API tokens, object permissions, and
audit records.

## Target flow

```text
Authentik OIDC login
  -> GeoPanel session
  -> workspace membership and role
  -> admin UI/API creates scoped agent token
  -> agent uses Authorization: Bearer gp_...
```

## Phase 1: workspace and membership control plane

- Add workspace create/list/get/update endpoints.
- Add member list/add/change-role/remove endpoints.
- Use verified OIDC subject as stable member identity.
- Support explicit mapping from Authentik group names to GeoPanel roles.
- Seed a configured bootstrap workspace/admin only through deployment config.
- Return `404` for invisible workspaces/members where enumeration matters.

Roles:

```text
viewer     read permitted objects/results
editor     create/update/delete drafts
publisher  publish revisions and create shares
admin      manage members, tokens, datasets, and workspace settings
```

## Phase 2: token management

- Keep opaque `gp_` tokens, hash-only at rest.
- Add token create/list/revoke/rotate endpoints with stable JSON errors.
- Add display metadata: name, prefix, subject, workspace, scopes, expiry,
  created/last-used/revoked timestamps.
- Show plaintext only in create response; never support later retrieval.
- Enforce scope allowlist and role ceiling; callers cannot grant permissions they
  do not possess.
- Add default presets for read-only analytics, dashboard author, publisher, and
  automation admin.
- Require expiry; cap maximum lifetime; support immediate revoke.

## Phase 3: web management UI

- Add workspace switcher and current-user/member views.
- Add member invite/role form using OIDC subject or group mapping.
- Add token creation modal with name, preset/custom scopes, expiry, and one-time
  secret reveal/copy warning.
- Add token inventory with prefix and status only, plus revoke/rotate actions.
- Never put token plaintext in URL, local storage, analytics events, or logs.
- Handle `401` by re-authentication; handle `403` with clear permission text.

## Phase 4: authorization and audit hardening

- Attach workspace/owner to dashboards, charts, datasets, revisions, and shares.
- Enforce role/action matrix before query or mutation.
- Keep public shares separate, read-only, expiring, revocable, and rate-limited.
- Add audit events for login failure/success, membership changes, token create/use/
  revoke, object mutations, publish/share, and query limits.
- Add request IDs, bounded query execution, response-size limits, and rate limits.

## Phase 5: developer/agent contract

- Publish OpenAPI for auth, workspaces, members, tokens, dashboards, charts,
  datasets, publish, and shares.
- Add curl and TypeScript examples using bearer tokens.
- Document scope presets, expiry, rotation, revoke, and `401`/`403` behavior.
- Add contract tests for role/scope/action matrix, cross-workspace isolation,
  token lifecycle, and one-time secret response.

## Rollout

1. Add schema and seed one controlled workspace/admin.
2. Add API and authorization tests.
3. Add UI and OpenAPI examples.
4. Deploy with current OIDC/proxy-cutover setup.
5. Create one short-lived agent token; verify read/write/publish boundaries.
6. Revoke token; verify immediate denial; inspect audit trail.
7. Move deployment secrets out of plaintext config.

## Definition of done

- GeoPanel admin manages workspace members without SQL.
- Admin creates scoped expiring agent token, sees secret once, revokes/rotates it.
- Authentik admin status alone grants no GeoPanel data access.
- Cross-workspace access denied.
- Editor cannot publish; publisher cannot administer members/tokens.
- Agent contract documented and tested.
