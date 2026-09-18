import { expect, test } from 'bun:test';

import type {
  DatabaseConnection,
  FlowmapTableSource,
  LayerSpatialFilter,
} from '../src/features/connections/store';
import { fetchFlowmapSourceData } from '../src/features/map/api';
import { getSourceSignature } from '../src/features/map/map-rendering';

const connection: DatabaseConnection = {
  id: 'connection-1',
  name: 'Test connection',
  host: 'localhost',
  port: '5432',
  database: 'gis',
  user: 'gis',
  password: 'secret',
  isServerManaged: false,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  testStatus: 'success',
  testMessage: '',
  postgresVersion: '16',
  postgisVersion: '3',
};

const filter = {
  mode: 'builder' as const,
  conditions: [{ column: 'mode', operator: 'eq' as const, value: 'bus' }],
};

const spatialFilter: LayerSpatialFilter = {
  sourceLayerId: 'layer-1',
  sourceLayerName: 'Selected area',
  sourceSchema: 'public',
  sourceTable: 'areas',
  sourceGeometryColumn: 'geom',
  rowRefs: [{ primaryKey: ['id'], rowKey: { id: 42 } }],
  predicate: 'intersects',
};

const source: FlowmapTableSource = {
  id: 'flowmap-1',
  type: 'flowmap-table',
  connectionId: connection.id,
  schema: 'public',
  table: 'journeys',
  fullName: 'public.journeys',
  kind: 'table',
  columns: {
    startMode: 'coordinates',
    startLon: 'start_lon',
    startLat: 'start_lat',
    startGeometry: '',
    endMode: 'coordinates',
    endLon: 'end_lon',
    endLat: 'end_lat',
    endGeometry: '',
    magnitude: 'count',
    defaultMagnitude: 1,
  },
  filter,
  spatialFilter,
  rowRef: { primaryKey: ['id'], rowKey: { id: 7 } },
};

test('flowmap requests retain table filter, spatial filter, and selected row key', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        schema: source.schema,
        table: source.table,
        flowCount: 0,
        locationCount: 0,
        locations: [],
        flows: [],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    await fetchFlowmapSourceData(connection, source);
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(requestBody).toMatchObject({
    id: connection.id,
    schema: source.schema,
    table: source.table,
    filter,
    spatialFilter,
    rowKey: source.rowRef?.rowKey,
  });
  expect(source.filter).toEqual(filter);
  expect(source.spatialFilter).toEqual(spatialFilter);
  expect(source.rowRef?.rowKey).toEqual({ id: 7 });
});

test('flowmap source signature changes when table filter changes', () => {
  const originalSignature = getSourceSignature(source);
  const changedFilter = {
    ...source,
    filter: {
      mode: 'builder' as const,
      conditions: [{ column: 'mode', operator: 'eq' as const, value: 'tram' }],
    },
  };

  expect(getSourceSignature(changedFilter)).not.toBe(originalSignature);
});
