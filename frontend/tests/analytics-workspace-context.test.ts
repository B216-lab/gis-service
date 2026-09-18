import { expect, test } from 'bun:test';

import type { Dataset } from '../src/features/analytics/types';
import {
  combineTableFilters,
  datasetForWorkspaceSource,
  filtersForSource,
  filtersToTableFilter,
  mapFiltersToPhysicalDataset,
  queryFiltersForWorkspace,
  selectionToAnalyticsFilter,
  sourceFiltersToAnalytics,
  viewportToAnalyticsFilter,
} from '../src/features/analytics/workspace-context';
import type { WorkspaceSource } from '../src/features/analytics/workspace-store';

const source: WorkspaceSource = {
  connectionId: 'connection',
  schema: 'public',
  table: 'trips',
  name: 'Trips',
};
const dataset: Dataset = {
  id: 'trips',
  name: 'Trips',
  revision: 1,
  connectionId: 'connection',
  schema: 'public',
  table: 'trips',
  fields: [
    { id: 'id', name: 'id', type: 'integer' },
    { id: 'kind', name: 'kind', type: 'string' },
    { id: 'city', name: 'city', type: 'string' },
  ],
  metrics: [{ id: 'count', name: 'Count', expression: 'COUNT(*)' }],
};

test('chart filters preserve alternatives and quote malicious string values', () => {
  const result = filtersToTableFilter(
    [
      {
        fieldId: '',
        operator: '',
        anyOf: [
          [{ fieldId: 'kind', operator: 'eq', values: ["bus' OR TRUE --"] }],
          [{ fieldId: 'city', operator: 'contains', values: ['100%'] }],
        ],
      },
    ],
    dataset,
  );
  expect(result).toEqual({
    mode: 'sql',
    where: `(("kind" = 'bus'' OR TRUE --') OR (CAST("city" AS text) ILIKE '%100\\%%' ESCAPE '\\'))`,
  });
});

test('selected composite keys become OR of complete AND tuples', () => {
  const composite = {
    ...dataset,
    fields: [
      { id: 'a', name: 'a', type: 'integer' },
      { id: 'b', name: 'b', type: 'string' },
    ],
  };
  expect(
    selectionToAnalyticsFilter(
      [
        { primaryKey: ['a', 'b'], rowKey: { a: 1, b: 'x' } },
        { primaryKey: ['a', 'b'], rowKey: { a: 2, b: 'y' } },
      ],
      composite,
    ).anyOf,
  ).toEqual([
    [
      { fieldId: 'a', datasetId: composite.id, operator: 'eq', values: [1] },
      { fieldId: 'b', datasetId: composite.id, operator: 'eq', values: ['x'] },
    ],
    [
      { fieldId: 'a', datasetId: composite.id, operator: 'eq', values: [2] },
      { fieldId: 'b', datasetId: composite.id, operator: 'eq', values: ['y'] },
    ],
  ]);
});

test('active empty selection creates a false filter instead of querying all rows', () => {
  const filters = queryFiltersForWorkspace([], dataset, [], true);
  expect(filters).toBeNull();
});

test('builder saved view becomes analytics filters on physical dataset', () => {
  expect(
    sourceFiltersToAnalytics(
      {
        ...source,
        filter: {
          conditions: [{ column: 'city', operator: 'in', values: ['Irkutsk'] }],
        },
      },
      dataset,
    ),
  ).toEqual([
    {
      datasetId: dataset.id,
      fieldId: 'city',
      operator: 'in',
      values: ['Irkutsk'],
    },
  ]);
});

test('legacy source filter translation rejects opaque SQL and spatial scopes', () => {
  expect(() =>
    sourceFiltersToAnalytics(
      { ...source, filter: { mode: 'sql', where: 'city = current_user' } },
      dataset,
    ),
  ).toThrow('SQL saved views');
  expect(() =>
    sourceFiltersToAnalytics(
      {
        ...source,
        spatialFilter: {
          sourceLayerId: 'areas-layer',
          sourceLayerName: 'Areas',
          sourceSchema: 'public',
          sourceTable: 'areas',
          sourceGeometryColumn: 'geom',
          rowRefs: [{ primaryKey: ['id'], rowKey: { id: 42 } }],
          predicate: 'intersects',
        },
      },
      dataset,
    ),
  ).toThrow('Spatial layer filters');
});

test('same-table dataset filters map field ids by physical field name', () => {
  const target = {
    ...dataset,
    id: 'trips-copy',
    fields: [
      { id: 'row_id', name: 'id', type: 'integer' },
      { id: 'travel_kind', name: 'kind', type: 'string' },
      { id: 'home_city', name: 'city', type: 'string' },
    ],
  };
  expect(
    mapFiltersToPhysicalDataset(
      [
        {
          datasetId: dataset.id,
          fieldId: 'kind',
          operator: 'eq',
          values: ['bus'],
        },
      ],
      dataset,
      target,
    ),
  ).toEqual([
    {
      datasetId: target.id,
      fieldId: 'travel_kind',
      operator: 'eq',
      values: ['bus'],
    },
  ]);
});

test('map extent filter uses configured geometry field and ordered bounds', () => {
  const spatialDataset = {
    ...dataset,
    fields: [...dataset.fields, { id: 'geom', name: 'geom', type: 'string' }],
  };
  expect(
    viewportToAnalyticsFilter(
      { west: 100, south: 50, east: 110, north: 60 },
      spatialDataset,
      { ...source, geometryColumn: 'geom' },
    ),
  ).toEqual({
    datasetId: dataset.id,
    fieldId: 'geom',
    operator: 'within_bbox',
    values: [100, 50, 110, 60],
  });
  expect(
    viewportToAnalyticsFilter(
      { west: 110, south: 50, east: 100, north: 60 },
      spatialDataset,
      { ...source, geometryColumn: 'geom' },
    ),
  ).toEqual({
    datasetId: dataset.id,
    fieldId: 'geom',
    operator: 'within_bbox',
    values: [110, 50, 100, 60],
  });
  expect(
    viewportToAnalyticsFilter(
      { west: -220, south: -100, east: 220, north: 100 },
      spatialDataset,
      { ...source, geometryColumn: 'geom' },
    ),
  ).toEqual({
    datasetId: dataset.id,
    fieldId: 'geom',
    operator: 'within_bbox',
    values: [-180, -90, 180, 90],
  });
});

test('table source filters compose with chart filters without losing either', () => {
  expect(
    filtersForSource(
      [{ fieldId: 'kind', operator: 'eq', values: ['bus'] }],
      dataset,
      {
        ...source,
        filter: {
          mode: 'builder',
          conditions: [{ column: 'city', operator: 'eq', value: 'Irkutsk' }],
        },
      },
    ),
  ).toEqual({
    mode: 'sql',
    where: `("city" = 'Irkutsk') AND ("kind" = 'bus')`,
  });
  expect(
    combineTableFilters(
      {
        mode: 'builder',
        conditions: [{ column: 'city', operator: 'eq', value: 'Irkutsk' }],
      },
      {
        mode: 'builder',
        conditions: [
          { column: 'kind', operator: 'in', values: ['bus', 'tram'] },
        ],
      },
    ),
  ).toEqual({
    mode: 'builder',
    conditions: [
      { column: 'city', operator: 'eq', value: 'Irkutsk' },
      { column: 'kind', operator: 'in', values: ['bus', 'tram'] },
    ],
  });
  expect(
    filtersForSource(
      [{ fieldId: 'kind', operator: 'eq', values: ['bus'] }],
      dataset,
      {
        ...source,
        filter: { mode: 'sql', where: `"city" = 'Irkutsk'` },
      },
    ),
  ).toEqual({
    mode: 'sql',
    where: `("city" = 'Irkutsk') AND ("kind" = 'bus')`,
  });
});

test('dataset creation reuses physical sources with SQL and spatial scopes', () => {
  expect(
    datasetForWorkspaceSource(
      source,
      {
        schema: 'public',
        table: 'trips',
        fullName: 'public.trips',
        kind: 'table',
        rowEstimate: 1,
        primaryKey: ['id'],
        isEditable: true,
        columns: [{ name: 'id', type: 'integer' }],
        geometryColumns: [],
        foreignKeys: [],
      },
      [dataset],
    ),
  ).toBe(dataset);
  const scopedSource = {
    ...source,
    filter: { mode: 'sql' as const, where: 'city = current_user' },
    spatialFilter: {
      sourceLayerId: 'areas-layer',
      sourceLayerName: 'Areas',
      sourceSchema: 'public',
      sourceTable: 'areas',
      sourceGeometryColumn: 'geom',
      rowRefs: [{ primaryKey: ['id'], rowKey: { id: 42 } }],
      predicate: 'within' as const,
    },
  };
  expect(
    datasetForWorkspaceSource(
      scopedSource,
      {
        schema: 'public',
        table: 'trips',
        fullName: 'public.trips',
        kind: 'table',
        rowEstimate: 1,
        primaryKey: ['id'],
        isEditable: true,
        columns: [{ name: 'id', type: 'integer' }],
        geometryColumns: [],
        foreignKeys: [],
      },
      [dataset],
    ),
  ).toBe(dataset);
  const created = datasetForWorkspaceSource(
    scopedSource,
    {
      schema: 'public',
      table: 'trips',
      fullName: 'public.trips',
      kind: 'table',
      rowEstimate: 1,
      primaryKey: ['id'],
      isEditable: true,
      columns: [{ name: 'id', type: 'integer' }],
      geometryColumns: [],
      foreignKeys: [],
    },
    [],
  );
  expect(created.sql).toBeUndefined();
  expect(created.schema).toBe(scopedSource.schema);
  expect(created.table).toBe(scopedSource.table);
});
