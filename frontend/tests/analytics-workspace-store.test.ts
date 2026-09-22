import { beforeEach, expect, test } from 'bun:test';

import type { Dataset, Filter } from '../src/features/analytics/types';
import {
  overlaysForSource,
  sanitizeOverlayRect,
  sanitizePersistedOverlays,
  useWorkspaceAnalyticsStore,
  type WorkspaceSource,
} from '../src/features/analytics/workspace-store';

const sourceA: WorkspaceSource = {
  connectionId: 'connection-a',
  schema: 'public',
  table: 'trips',
  name: 'Trips',
};
const sourceB: WorkspaceSource = {
  connectionId: 'connection-b',
  schema: 'public',
  table: 'trips',
  name: 'Other trips',
};
const datasetA: Dataset = {
  id: 'dataset-a',
  name: 'Trips',
  revision: 1,
  connectionId: sourceA.connectionId,
  schema: sourceA.schema,
  table: sourceA.table,
  fields: [{ id: 'id', name: 'id', type: 'integer' }],
  metrics: [{ id: 'count', name: 'Count', expression: 'COUNT(*)' }],
};
const datasetB: Dataset = {
  ...datasetA,
  id: 'dataset-b',
  connectionId: 'connection-b',
};
const filter: Filter = {
  datasetId: datasetA.id,
  fieldId: 'id',
  operator: 'eq',
  values: [1],
};
const chart = {
  id: 'chart',
  name: 'Trips',
  revision: 1,
  datasetId: datasetA.id,
  type: 'kpi',
  query: { datasetId: datasetA.id, metrics: ['count'] },
};

beforeEach(() => {
  useWorkspaceAnalyticsStore.setState({
    activeSource: null,
    selection: [],
    filters: [],
    filterDataset: null,
    viewport: null,
    refreshVersion: 0,
    overlays: [],
  });
});

test('source updates retain same-table selection but clear incompatible state', () => {
  const store = useWorkspaceAnalyticsStore.getState();
  store.setSource(sourceA);
  store.setSelection([{ primaryKey: ['id'], rowKey: { id: 1 } }]);
  store.setFilters([filter], datasetA);
  store.setSource({
    ...sourceA,
    name: 'Trips with a saved view',
    filter: {
      mode: 'builder',
      conditions: [{ column: 'id', operator: 'eq', value: '1' }],
    },
  });
  expect(useWorkspaceAnalyticsStore.getState()).toMatchObject({
    selection: [{ primaryKey: ['id'], rowKey: { id: 1 } }],
    filters: [filter],
    filterDataset: datasetA,
  });
  store.setSource(sourceB);
  expect(useWorkspaceAnalyticsStore.getState()).toMatchObject({
    selection: [],
    filters: [],
    filterDataset: null,
  });
});

test('reference overlays remain visible across sources; linked overlays do not', () => {
  const store = useWorkspaceAnalyticsStore.getState();
  store.setSource(sourceA);
  expect(store.addOverlay(chart, datasetA, false)).toBe(true);
  expect(store.addOverlay(chart, datasetB, true)).toBe(true);
  store.setSource(sourceB);
  const visible = overlaysForSource(
    useWorkspaceAnalyticsStore.getState().overlays,
    sourceB,
  );
  expect(visible).toHaveLength(1);
  expect(visible[0].reference).toBe(true);
  expect(store.addOverlay(chart, datasetA, false)).toBe(false);
});

test('overlay rects are bounded before cache writes and invalid cached rects reset', () => {
  const store = useWorkspaceAnalyticsStore.getState();
  store.setSource(sourceA);
  store.addOverlay(chart, datasetA, false);
  const id = useWorkspaceAnalyticsStore.getState().overlays[0].id;
  store.updateOverlayRect(id, { x: -8, y: -4, width: 1, height: 9000 });
  expect(useWorkspaceAnalyticsStore.getState().overlays[0].rect).toEqual({
    x: 0,
    y: 0,
    width: 220,
    height: 1600,
  });
  expect(
    sanitizeOverlayRect({ x: Number.NaN, y: 0, width: 1, height: 1 }),
  ).toBeUndefined();
  expect(
    sanitizePersistedOverlays([
      {
        id: 'cached',
        chart,
        dataset: datasetA,
        reference: false,
        rect: { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 20 },
      },
    ])[0].rect,
  ).toBeUndefined();
});
