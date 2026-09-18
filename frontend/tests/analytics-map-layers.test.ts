import { beforeEach, expect, test } from 'bun:test';

import { createGeographicDeckLayers } from '../src/features/analytics/geographic-deck-layers';
import type { Chart, Dataset } from '../src/features/analytics/types';
import {
  isGeographicChart,
  useWorkspaceAnalyticsMapLayerStore,
} from '../src/features/analytics/workspace-map-layer-store';

const dataset: Dataset = {
  id: 'places',
  name: 'Places',
  revision: 1,
  connectionId: 'connection',
  schema: 'public',
  table: 'places',
  fields: [],
  metrics: [{ id: 'count', name: 'Count', expression: 'COUNT(*)' }],
};
const heatmap: Chart = {
  id: 'heatmap',
  name: 'Stops',
  revision: 1,
  datasetId: dataset.id,
  type: 'geoHeatmap',
  query: {
    datasetId: dataset.id,
    dimensions: ['lon', 'lat'],
    metrics: ['count'],
  },
};
const arc: Chart = {
  ...heatmap,
  id: 'arc',
  name: 'Routes',
  type: 'geoArc',
  query: {
    datasetId: dataset.id,
    dimensions: ['start_lon', 'start_lat', 'end_lon', 'end_lat'],
    metrics: ['count'],
  },
};

beforeEach(() => {
  useWorkspaceAnalyticsMapLayerStore.setState({
    layers: [],
    results: {},
    errors: {},
  });
});

test('native map layer visibility and removal are persisted state controls', () => {
  const store = useWorkspaceAnalyticsMapLayerStore.getState();
  store.addLayer(heatmap, dataset, false);
  const id = useWorkspaceAnalyticsMapLayerStore.getState().layers[0].id;
  store.setVisible(id, false);
  expect(useWorkspaceAnalyticsMapLayerStore.getState().layers[0].visible).toBe(
    false,
  );
  store.setError(id, heatmap.id, 'Query failed');
  expect(useWorkspaceAnalyticsMapLayerStore.getState().errors).toEqual({
    [`${id}:${heatmap.id}`]: 'Query failed',
  });
  store.removeLayer(id);
  store.setResult(id, heatmap.id, {
    chart: heatmap,
    dataset,
    data: { columns: [], rows: [] },
  });
  store.setError(id, heatmap.id, 'Late callback');
  expect(useWorkspaceAnalyticsMapLayerStore.getState().layers).toEqual([]);
  expect(useWorkspaceAnalyticsMapLayerStore.getState().results).toEqual({});
  expect(useWorkspaceAnalyticsMapLayerStore.getState().errors).toEqual({});
});

test('geographic charts create renderable deck layers with valid coordinates', () => {
  const layers = createGeographicDeckLayers(
    [
      {
        chart: heatmap,
        data: { columns: [], rows: [{ lon: 104, lat: 52, count: 3 }] },
      },
    ],
    'native',
  );
  expect(isGeographicChart(heatmap)).toBe(true);
  expect(layers).toHaveLength(2);
  expect(layers[0].id).toContain('native:heatmap');
});

test('arc layers keep coordinate and weight accessors, and exclude invalid rows', () => {
  const rows = [
    { start_lon: 104, start_lat: 52, end_lon: 105, end_lat: 53, count: 9 },
    { start_lon: 190, start_lat: 52, end_lon: 105, end_lat: 53, count: 1 },
  ];
  const layer = createGeographicDeckLayers(
    [{ chart: arc, data: { columns: [], rows } }],
    'native',
  )[0] as unknown as {
    props: {
      data: typeof rows;
      getSourcePosition: (row: (typeof rows)[number]) => number[];
      getTargetPosition: (row: (typeof rows)[number]) => number[];
      getWidth: (row: (typeof rows)[number]) => number;
    };
  };
  expect(layer.props.data).toEqual([rows[0]]);
  expect(layer.props.getSourcePosition(rows[0])).toEqual([104, 52]);
  expect(layer.props.getTargetPosition(rows[0])).toEqual([105, 53]);
  expect(layer.props.getWidth(rows[0])).toBe(3);
});

test('geographic clicks publish child dataset filters and composite entries keep IDs distinct', () => {
  let selected: unknown;
  const layers = createGeographicDeckLayers(
    [
      {
        chart: heatmap,
        data: { columns: [], rows: [{ lon: 104, lat: 52, count: 3 }] },
      },
      {
        chart: { ...heatmap, id: 'heatmap-2' },
        data: { columns: [], rows: [{ lon: 105, lat: 53, count: 4 }] },
      },
    ],
    'composite',
    (filters) => {
      selected = filters;
    },
  );
  expect(new Set(layers.map((layer) => layer.id)).size).toBe(layers.length);
  const pickLayer = layers[1] as unknown as {
    props: { onClick: (info: { object: Record<string, unknown> }) => boolean };
  };
  expect(
    pickLayer.props.onClick({ object: { lon: 104, lat: 52, count: 3 } }),
  ).toBe(true);
  expect(selected).toEqual([
    { datasetId: dataset.id, fieldId: 'lon', operator: 'eq', values: [104] },
    { datasetId: dataset.id, fieldId: 'lat', operator: 'eq', values: [52] },
  ]);
});
