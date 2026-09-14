# Native analytics implementation

## Goal

Build an editable, data-backed analytics workspace inside gis-service. The Superset export at `/mnt/data/Projects/superset/dashboard_export_20260821T044555` is the acceptance reference: two virtual datasets, twelve metric definitions, twenty charts, five dashboard sections, city filtering, chart interactions, geographic layers, and sharing.

Source database stays behind existing server-managed connection. Never import credentials from the export. Metadata, saved definitions, revisions and shares belong to app-controlled storage.

## Authentication scope — updated 2026-09-11

User confirmed deployment is behind Authentik and will handle security/user authentication later. Remove the additional editor token, login UI, session cookies and legacy API gate. Analytics opens directly. Share-link identifiers remain part of dashboard sharing, not an editor login. Earlier authentication verification below is historical and superseded by this decision.

Removal verified: backend no-token CRUD/query/legacy-route tests and Go race suite passed; frontend build, 17 tests and Biome passed. Browser opened Analytics directly with two datasets and the existing reference dashboard, no password input/session requests or page errors. Local launcher preserves analytics metadata under `.dev-run/analytics.json`.

## Execution

Each step has a dedicated implementation subagent. Coordinator owns this plan, integration checks and dependency order. No commits, pushes or production mutations requested. Keep implementation evidence and unresolved limitations below; do not mark a step complete on compilation alone.

### 0 — Reference audit and sanitized fixture

- Parse both SQL datasets, calculated fields, metrics, twenty chart definitions, layout and filter metadata.
- Save credential-free fixture for importer and tests.
- Capture date semantics, row grain, relationships and incompatible cross-filter scopes.
- Verify live source availability with read-only queries when environment permits.

Acceptance: fixture accounts for every chart and dataset, contains no connection secrets, identifies unsupported semantics explicitly.

### 1 — Metadata persistence and analytics API

- Add app-owned durable storage for dataset, field, metric, relationship, chart, dashboard, publication and share definitions.
- Stable IDs, revision checks, server-managed connection references; no credentials in persisted client definitions.
- Create/read/update/delete endpoints, dependency validation, optimistic concurrency.
- Resolve deployment identity before public exposure; authorization boundary must cover analytics endpoints.

Acceptance: saved definitions survive restart, concurrent edits conflict clearly, invalid references fail, unauthorized access fails.

### 2 — Typed query engine

- Physical and SQL virtual datasets, computed fields, reusable aggregate metrics.
- Grouping, sorting, time buckets, typed categorical/range/null filters, filter options and map data.
- Parameterize filter values; validate field/metric references. Restricted source access, read-only transactions, deadlines and limits.
- Cancellation, bounded concurrency, deduplication/cache keyed by dataset revision, resolved query and access context.
- Preserve submission vs movement grain; relationship filters use EXISTS rather than multiplicative joins.

Acceptance: database-backed fixture tests prove counts, averages, ratios, dates, null handling, relationship filters and limits. Requests cannot bypass access or inject SQL through query controls.

### 3 — Dataset and metric builders

- Dataset catalog; physical table and SQL authoring with preview/schema inspection.
- Field labels/types, computed fields, metrics, dates and geographic roles.
- Visual same-connection joins and projections compile into the same model.
- Relationships declare keys, cardinality and allowed filter propagation.
- Schema changes report broken chart dependencies.

Acceptance: create both reference datasets and metrics through UI, save/reload, edit and preview errors; visual joins preserve declared grain.

### 4 — Chart builder and renderers

- Native declarative chart config independent of renderer APIs.
- Chart editor: dataset, dimensions, metrics, series, dates, filters, sorting, limits, formatting and selection.
- KPI, bars, pie, line, matrix heatmap, calendar heatmap.
- Geographic heatmap, arcs and composite map on existing geographic stack.
- Consistent result/loading/error/empty/truncation and selection interfaces.

Acceptance: all reference visualization families render real query results, save/reload configuration and emit meaningful typed selections.

### 5 — Shared filtering and dashboard builder

- Persistent responsive layout with charts, maps, text and section headings; create, resize, reorder and remove widgets.
- Shared typed filter state, explicit scopes and semantic mappings.
- Same-dataset, mapped-dataset and relationship propagation; source chart retains alternatives.
- OR within selection, AND across independent filters; matrix cell tuples preserved.
- Filter chips/reset, explicit viewport filtering, stale response rejection and no feedback loops.

Acceptance: city/gender/social-status filters span both datasets; journey-to-respondent propagation counts distinct submissions; reset restores baseline; layout survives reload.

### 6 — Publication and sharing

- Dedicated viewer route and owner/editor/viewer access.
- Published revisions pin transitive dataset/chart/layout definitions; data remains live.
- Authenticated links first; revocable scoped public links with optional expiry and saved filter state.
- Shared viewers cannot query unrelated datasets or broaden authorized scope.

Acceptance: another authorized browser opens dashboard; draft edits do not change published view; public token is scoped/revocable and permissions enforced on query/filter options.

### 7 — Export migration and end-to-end parity

- Bounded importer for reference export; stable UUID remapping and idempotent reimport.
- Translate SQL, calculated fields, metrics, charts, composite dependencies, sections/layout, dates and filter settings.
- Import report lists unsupported settings and semantic corrections.
- Browser acceptance: all twenty charts, filtered values, editor/save/reload, sharing and reset.
- Run Go tests/build, frontend build/Biome, applicable Docker lint and database/browser checks.

Acceptance: editable native dashboard covers all twenty reference widgets against configured DB; no silent unsupported settings or false parity claims.

## Semantics to preserve or explicitly resolve

- Submissions: one questionnaire per row; movements: one journey per row.
- Movement-per-submission metric excludes submissions without journeys in exported definition.
- Weekly chart uses movements_date; calendar uses submission_created_at and rolling last three months.
- Gender display field exists only in submissions; cross-dataset filtering should use canonical gender values.
- Transport filters target journeys by default. Respondent propagation explicitly means respondents with matching journeys.
- Composite departure/destination map is an overlay, not mathematical subtraction.
- Export global cross-filter metadata cannot establish compatibility or actual working behavior.
- Export valid_rate expression uses integer division; flag correction rather than silently preserving misleading ratio.

## Implementation status and verification

| Step | Implementation | Evidence |
| --- | --- | --- |
| 0 | Sanitized reference fixture | Two datasets, 48 original fields, twelve original metrics, twenty chart placements; no credentials or database URI |
| 1 | Durable metadata and editor access | Restart/atomic-write/conflict/dependency/authentication tests |
| 2 | Typed queries, HAVING, cache and deduplication | Real PostGIS grain/read-only/limits tests; typed filters, cancellation, precision and cache-scope tests |
| 3 | Dataset/metric/relationship and visual SQL editor | Browser preview, schema adoption, save, conflict, reload and deletion |
| 4 | Chart editor and all nine renderer families | Statistical rendering tests; actual canvas selection; visible geographic heatmaps, arcs and composite layers |
| 5 | Dashboard layout and shared filters | Browser drag, resize, save/reload, native filters, chart-click propagation, self-exclusion and reset |
| 6 | Frozen publication and scoped sharing | Browser public view, revocation, legacy API denial; snapshot/token/session tests |
| 7 | Idempotent reference importer | All twenty actual-source widgets queried and rendered; explicit migration report |

Final coordinator checks after implementation:

- `ANALYTICS_TEST_DB=1 go test -count=1 -race ./...`: passed, including isolated PostGIS integration tests.
- `bun run build`: passed; existing main-bundle size warning remains. Statistical rendering is lazy-loaded.
- `bun test tests`: 17 passed, zero failed.
- `bun run check`: 55 files passed. Generated dist and emitted Vite config files are excluded.
- `hadolint backend/Dockerfile`: passed.
- `docker compose --env-file .env.dev -f docker-compose.dev.yml config --quiet`: passed.

Actual source verification (time-specific observations, not fixed test constants):

- Dashboard `5dc6032d-4845-44d2-ba75-4e4bf287b93a`: 13,030 journeys, 4,973 submissions, ratio 2.620148803539111.
- All twenty widgets queried successfully (21 requests including composite layers). Browser baseline: twenty named cards, seventeen non-KPI canvases, five maps, zero page errors.
- Female chart selection: 6,674 journeys and 2,564 submissions, matching independent queries.
- Bus relationship selection: 1,566 distinct respondents, matching independent distinct count.
- City filter ran across all widget/layer queries. Scoped public share retained 518 journeys; unfiltered reset restored 13,030.
- Browser Moscow native filter: 28 journeys and 15 submissions; reset restored baseline.
- HAVING selected exactly three of fourteen vehicle groups for the tested threshold.
- Cache hit reused result; explicit no-cache refresh produced fresh data; deleted draft dataset could not retrieve cached results.
- Arc chart retains exported 10,000-row cap and displays truncation.
- Saved-native-default browser check passed after final validation changes: Moscow filter survived save/reload with twenty explicit targets. Published share retained 28 journeys / 15 submissions after editable source defaults were restored; Clear filters could not remove the locked scope.
- Host memory pressure during simultaneous builds/browser runs caused temporary fetch failures; those are not counted as successful visual evidence. The clean initial twenty-widget baseline and successful filter/default/publication checks above are the recorded acceptance evidence.

Source database remained read-only. Verification metadata, screenshots and result summaries live outside repository under `/tmp/gis-analytics-verification` and `/tmp/analytics-reference-*`.

## Deployment choices and remaining limitations

- Deployment authentication is handled by Authentik. No application-level editor token or login is required.
- Application-level user identities and per-user RBAC are deferred at the user’s request.
- Metadata uses an atomic, permission-restricted JSON file mounted on a Docker volume. This supports the current single-process API; multi-replica deployment needs a transactional shared store.
- Query cache: 30-second TTL, at most 64 entries and 32 MiB cached payload; four database queries in flight. Refresh bypasses cached results.
- Visual joins generate editable same-connection SQL. Unique joined keys are required where preserving base-row grain matters; automatic cardinality proof is not implemented.
- Public filter controls accept typed values and suggestions from visible chart results. They cannot run unrestricted field-option queries against source datasets.
- Importer is bounded to this embedded reference export, not a general Superset archive importer. Migration report identifies unsupported styling/formatting and layout approximations; rendering is not pixel-identical.
- Matrix percentile-rank normalization, separate percentage values, axis sorting, relative dates, nullable counts and composite layer references are implemented. Russian gender compatibility field is added to movements; integer-division ratio bug is explicitly corrected.

## Local use

Open Analytics in the app, then use Import reference dashboard and select the existing server-managed connection. Imported datasets, charts and dashboard remain editable. Publish a revision before creating a viewer link.

Final recovered browser view: five maps and composite canvas present; zero chart failures and zero page errors.

Verification cleanup: isolated PostGIS test container stopped with volume retained. Workers closed temporary browsers and removed synthetic mutable metadata; temporary locked share revoked. Original reference definitions/defaults restored exactly apart from revision timestamps. Actual reference demo and local API/preview remain available in the temporary verification environment.
