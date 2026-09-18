import { expect, test } from 'bun:test';

import { runWorkspaceQuery } from '../src/features/analytics/api';
import type { Query } from '../src/features/analytics/types';
import type { WorkspaceSource } from '../src/features/analytics/workspace-store';

const query: Query = {
  datasetId: 'journeys',
  dimensions: ['mode'],
  metrics: ['count'],
};

const polygonSource: WorkspaceSource = {
  connectionId: 'connection-1',
  schema: 'public',
  table: 'journeys',
  name: 'Bus journeys',
  layerId: 'layer-1',
  geometryColumn: 'geom',
  filter: {
    mode: 'sql',
    where: `"mode" = 'bus'`,
  },
  spatialFilter: {
    sourceLayerId: 'areas-layer',
    sourceLayerName: 'Areas',
    sourceSchema: 'public',
    sourceTable: 'areas',
    sourceGeometryColumn: 'geom',
    rowRefs: [{ primaryKey: ['id'], rowKey: { id: 42 } }],
    predicate: 'intersects',
  },
  flowColumns: {
    startMode: 'geometry',
    startLon: '',
    startLat: '',
    startGeometry: 'origin_geom',
    endMode: 'geometry',
    endLon: '',
    endLat: '',
    endGeometry: 'destination_geom',
    magnitude: 'passengers',
    defaultMagnitude: 1,
  },
};

function successfulResponse() {
  return new Response(JSON.stringify({ columns: [], rows: [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

test('workspace query sends SQL, polygon, and flow source scope without UI fields', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    requestInit = init;
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return successfulResponse();
  };

  try {
    await runWorkspaceQuery(query, polygonSource);
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(requestInit?.method).toBe('POST');
  expect(requestBody).toEqual({
    query,
    source: {
      connectionId: polygonSource.connectionId,
      schema: polygonSource.schema,
      table: polygonSource.table,
      filter: polygonSource.filter,
      spatialFilter: polygonSource.spatialFilter,
      geometryColumn: polygonSource.geometryColumn,
      flowColumns: polygonSource.flowColumns,
    },
  });
  expect(requestBody?.source).not.toHaveProperty('name');
  expect(requestBody?.source).not.toHaveProperty('layerId');
});

test('workspace query propagates scoped backend errors without broadening the request', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ error: { message: 'Spatial scope rejected.' } }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    await expect(runWorkspaceQuery(query, polygonSource)).rejects.toEqual(
      expect.objectContaining({
        message: 'Spatial scope rejected.',
        status: 422,
      }),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(requestBody?.source).toEqual({
    connectionId: polygonSource.connectionId,
    schema: polygonSource.schema,
    table: polygonSource.table,
    filter: polygonSource.filter,
    spatialFilter: polygonSource.spatialFilter,
    geometryColumn: polygonSource.geometryColumn,
    flowColumns: polygonSource.flowColumns,
  });
});

test('workspace query forwards abort signal and cache bypass header', async () => {
  const originalFetch = globalThis.fetch;
  const requests: RequestInit[] = [];
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    return successfulResponse();
  };

  try {
    const controller = new AbortController();
    await runWorkspaceQuery(query, polygonSource, controller.signal, true);
    await runWorkspaceQuery(query, polygonSource);
    expect(requests[0].signal).toBe(controller.signal);
    expect(requests[0].headers).toEqual({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    });
    expect(requests[1].headers).toEqual({
      'Content-Type': 'application/json',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('workspace query preserves abort failures', async () => {
  const originalFetch = globalThis.fetch;
  const abortError = new DOMException(
    'The operation was aborted.',
    'AbortError',
  );
  globalThis.fetch = async () => {
    throw abortError;
  };

  try {
    await expect(runWorkspaceQuery(query, polygonSource)).rejects.toBe(
      abortError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
