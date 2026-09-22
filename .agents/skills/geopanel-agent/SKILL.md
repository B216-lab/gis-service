---
name: geopanel-agent
description: Operate GeoPanel through its bearer-token API to inspect registered databases and create, update, query, or verify analytics datasets, charts, dashboards, and geographic cross-filters. Use for GeoPanel analytics automation; use browser automation when UI behavior must be verified.
---

# GeoPanel agent

Use GeoPanel's API instead of direct database credentials. Run commands from the repository
root with:

```bash
python .agents/skills/geopanel-agent/scripts/api.py METHOD PATH [--body FILE]
```

Set `GEOPANEL_BASE_URL` (default `https://geopanel.b216.ru`) and either  
`GEOPANEL_TOKEN` or `GEOPANEL_TOKEN_FILE`. Ask for a token only when neither is available.
Never embed or print tokens in skill files, commands, payloads, logs, or reports.

`localhost` resolves on the agent's machine. A remote agent needs a reachable GeoPanel URL.
Allow plain HTTP only for loopback; require HTTPS remotely. Never send a GeoPanel token to
Superset or a database server.

## Discover, query, build

1. GET `/api/v1/auth/me`; verify identity, workspace, and scopes.
2. GET `/api/v1/database-connections`; use returned connection IDs.
3. GET `/api/v1/analytics/datasets`, `/charts`, and `/dashboards`. Collections return
   `{items: [...]}`. Read definitions before modifying them.
4. Inspect data with POST `/api/v1/analytics/preview` and a read-only query:

   ```json
   {"id":"inspect","name":"Inspect","connectionId":"...","sql":"SELECT ...","fields":[],"metrics":[]}
   ```

   Preview returns at most 100 rows. Use aggregate SELECTs for totals. Do not use preview
   for writes, schema changes, or destructive SQL.
5. POST a collection to create an object. PUT `/collection/id` to update one. Include `id`,
   `name`, and `revision` (`0` on create; current revision on update). On HTTP 409, re-read
   and reconcile. Never blindly overwrite.
6. POST `/api/v1/analytics/query` with each chart query before adding the chart to a
   dashboard. Check `rows`, `columns`, `truncated`, and `limit`.
7. Verify user-visible work in GeoPanel: open Analysis, refresh analytics, select the saved
   dashboard, exercise cross-filtering, then clear filters and confirm baseline totals.

After an ambiguous failed POST, read back by ID before retrying. Avoid duplicate objects.

## Move dashboards between instances

GET `/api/v1/analytics/dashboards/{id}/export` to receive a versioned
`geopanel-dashboard` JSON bundle. The bundle includes the dashboard and all transitive chart,
dataset, relationship, filter, and composite-layer dependencies. It contains definitions,
not data rows or database credentials.

Before importing, GET `/api/v1/database-connections` on the destination and map every source
`connectionId` found in `bundle.datasets` to a registered destination connection. POST
`/api/v1/analytics/import-dashboard`:

```json
{
  "bundle": {},
  "connectionMapping": {"source-connection": "destination-connection"},
  "replace": false
}
```

Keep `replace` false for first import. Matching object IDs return HTTP 409 without changing
anything. Set `replace` true only when explicitly deploying an updated bundle; the import
then replaces matching dataset, chart, and dashboard definitions atomically and advances
their revisions. Validate destination queries and UI behavior after import.

## Object definitions

Dataset:
`{id,name,revision,connectionId,sql?,schema?,table?,grain?,fields,metrics,relationships?}`.
Choose SQL or physical `schema`/`table`. Fields:
`{id,name,type,label?,expression?,semanticId?}`. `name` is the physical SQL column;
`label` is display text. Metrics: `{id,name,expression}` with expressions such as
`COUNT(*)` and `AVG(duration_min)`.

Relationship:
`{id,targetDatasetId,sourceFieldId,targetFieldId,cardinality,allowFiltering}`.

Chart: `{id,name,revision,datasetId,type,query,options?}`. Query:
`{datasetId,dimensions:[fieldId],metrics:[metricId],filters?,sort?,limit?}`. Filter:
`{datasetId?,fieldId,operator,values?}`. Common operators: `eq`, `in`, `between`, `gte`,
`lt`, `is_null`, `is_not_null`. Sort: `{fieldId,desc}`; the field must be selected.

Supported chart types: `kpi`, `bar`, `pie`, `line`, `matrixHeatmap`, `calendarHeatmap`,
`geoHeatmap`, `geoArc`, `compositeMap`, and `regionMap`. Options include `horizontal`,
`decimals`, `suffix`, `showLegend`, and `showLabels`.

Dashboard: `{id,name,revision,description?,widgets,filters?,nativeFilters?}`. Widget:
`{id,chartId?,text?,x,y,w,h,filterTargetWidgetIds?}` on a 12-column grid. Native filter:
`{id,name,datasetId,fieldId,targetWidgetIds?}`.

## Region maps and cross-filtering

A `regionMap` requires exactly two dimensions `[region_name,region_geojson]` and one
metric. Geometry must be a GeoJSON Polygon or MultiPolygon object or JSON string using
longitude/latitude coordinates. Map clicks filter only `region_name`; never put polygon
geometry into filter payloads. Ctrl/Shift click supports multiple regions.

Prefer one dataset for all receiver charts. Across datasets, use matching `semanticId`
values only when their domains truly match, or define an explicit filtering relationship.
Preserve dataset grain so spatial joins do not multiply totals. Report unmatched records.
Use original geometry for spatial membership; simplify geometry only for display.

Existing development examples: dataset `agent-region-trips`, dashboard
`agent-regions-dashboard`, reference dashboard
`5dc6032d-4845-44d2-ba75-4e4bf287b93a`.

POST `/api/v1/analytics/import-reference` with `{connectionId}` imports GeoPanel's built-in
Superset reference, not any arbitrary export. It may update existing reference objects.
Inspect current objects first, invoke only when requested, and read conversion warnings.

## Authorization limits

The token grants API access; it does not grant direct database credentials. Analytics
metadata is instance-wide in this version. Most analytics routes authenticate callers but
do not yet enforce every declared scope or full workspace isolation. Treat tokens as access
for trusted agents, not as a complete boundary between mutually untrusted users.

Create or modify only analytics authorized by the task. Do not alter auth roles, publish
shares, delete objects, or overwrite existing user edits unless explicitly requested.
