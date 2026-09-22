import { describe, expect, test } from 'bun:test';
import { chartValidation } from '../src/features/analytics/ChartBuilder';
import {
  geographicRows,
  numeric,
  rowFilters,
  selectionFilters,
} from '../src/features/analytics/chart-utils';
import type { Chart } from '../src/features/analytics/types';

const chart: Chart = {
  id: 'test',
  name: 'Example',
  revision: 1,
  datasetId: 'd',
  type: 'matrixHeatmap',
  query: {
    datasetId: 'd',
    dimensions: ['hour', 'weekday'],
    metrics: ['count'],
  },
};
describe('analytics chart selections', () => {
  test('region map filters by region without leaking polygon geometry', () => {
    const map: Chart = {
      ...chart,
      type: 'regionMap',
      query: {
        datasetId: 'd',
        dimensions: ['region', 'geometry'],
        metrics: ['count'],
      },
    };
    const rows = [
      { region: 'Irkutsk', geometry: '{"type":"Polygon"}', count: 12 },
      { region: 'Buryatia', geometry: '{"type":"MultiPolygon"}', count: 4 },
    ];
    expect(chartValidation(map)).toBe('');
    expect(selectionFilters(map, [rows[0]])).toEqual([
      {
        datasetId: 'd',
        fieldId: 'region',
        operator: 'eq',
        values: ['Irkutsk'],
      },
    ]);
    expect(selectionFilters(map, rows)[0].anyOf).toEqual([
      [
        {
          datasetId: 'd',
          fieldId: 'region',
          operator: 'eq',
          values: ['Irkutsk'],
        },
      ],
      [
        {
          datasetId: 'd',
          fieldId: 'region',
          operator: 'eq',
          values: ['Buryatia'],
        },
      ],
    ]);
    expect(selectionFilters(map, [])).toEqual([]);
    expect(
      chartValidation({
        ...map,
        query: { ...map.query, dimensions: ['region'] },
      }),
    ).toContain('GeoJSON');
  });
  test('matrix selection preserves tuples rather than Cartesian product', () => {
    const filters = selectionFilters(chart, [
      { hour: 8, weekday: 1, count: 2 },
      { hour: 9, weekday: 2, count: 3 },
    ]);
    expect(filters[0].anyOf).toEqual([
      [
        { fieldId: 'hour', datasetId: 'd', operator: 'eq', values: [8] },
        { fieldId: 'weekday', datasetId: 'd', operator: 'eq', values: [1] },
      ],
      [
        { fieldId: 'hour', datasetId: 'd', operator: 'eq', values: [9] },
        { fieldId: 'weekday', datasetId: 'd', operator: 'eq', values: [2] },
      ],
    ]);
  });
  test('weekly selection uses half-open raw timestamp range', () => {
    const filters = rowFilters(
      {
        ...chart,
        query: {
          datasetId: 'd',
          dimensions: ['at'],
          timeFieldId: 'at',
          timeGrain: 'week',
        },
      },
      { at: '2026-08-17T00:00:00Z' },
    );
    expect(filters.map((f) => [f.operator, f.values?.[0]])).toEqual([
      ['gte', '2026-08-17T00:00:00.000Z'],
      ['lt', '2026-08-24T00:00:00.000Z'],
    ]);
  });
  test('null values select null, no string coercion', () => {
    expect(rowFilters(chart, { hour: null })[0].operator).toBe('is_null');
    expect(numeric(null)).toBeNull();
  });
  test('invalid coordinates excluded, zero stays valid', () => {
    const map = {
      ...chart,
      type: 'geoArc',
      query: { datasetId: 'd', dimensions: ['x', 'y', 'a', 'b'] },
    };
    const rows = [
      { x: 0, y: 0, a: 1, b: 1 },
      { x: null, y: 1, a: 2, b: 3 },
      { x: 181, y: 5, a: 1, b: 1 },
      { x: 10, y: 10, a: 2, b: 91 },
    ];
    expect(geographicRows(map, { columns: [], rows })).toEqual([rows[0]]);
  });
  test('chart definitions reject incomplete rendering fields', () => {
    expect(chartValidation(chart)).toBe('');
    expect(
      chartValidation({
        ...chart,
        query: { datasetId: 'd', dimensions: ['hour'], metrics: ['count'] },
      }),
    ).toContain('two dimensions');
    expect(chartValidation({ ...chart, type: 'kpi' })).toContain(
      'no dimensions',
    );
    expect(
      chartValidation({ ...chart, type: 'compositeMap', layerChartIds: [] }),
    ).toContain('map layer');
  });
});

import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { statisticalOptions } from '../src/features/analytics/StatisticalChart';

echarts.use([SVGRenderer]);
for (const type of ['bar', 'line', 'pie', 'matrixHeatmap', 'calendarHeatmap']) {
  test(`${type} produces renderable chart configuration`, () => {
    const c = {
      ...chart,
      type,
      query: {
        ...chart.query,
        dimensions:
          type === 'matrixHeatmap' ? ['category', 'group'] : ['category'],
      },
    };
    const rows = [
      {
        category: type === 'calendarHeatmap' ? '2026-08-20' : 'A',
        group: 'One',
        count: 2,
      },
      {
        category: type === 'calendarHeatmap' ? '2026-08-21' : 'B',
        group: 'Two',
        count: 3,
      },
    ];
    const instance = echarts.init(null, undefined, {
      renderer: 'svg',
      ssr: true,
      width: 500,
      height: 360,
    });
    try {
      instance.setOption(statisticalOptions(c, rows));
      expect(instance.renderToSVGString()).toContain('<svg');
    } finally {
      instance.dispose();
    }
  });
}

import {
  axisValues,
  heatmapValues,
} from '../src/features/analytics/chart-utils';

test('heatmap percentile ties and percent-of-total match reference semantics', () => {
  const rows = [
    { hour: 8, weekday: 1, count: 2 },
    { hour: 9, weekday: 1, count: 2 },
    { hour: 10, weekday: 2, count: 6 },
  ];
  const values = heatmapValues(
    { ...chart, options: { normalize: 'all', normalized: true } },
    rows,
  );
  expect(values.map((v) => v.rank)).toEqual([0.5, 0.5, 1]);
  expect(values.map((v) => v.percentage)).toEqual([0.2, 0.2, 0.6]);
  expect(axisValues(rows, 'weekday', 'count', 'sumDesc')).toEqual(['2', '1']);
  expect(axisValues(rows, 'hour', 'count', 'labelAsc')).toEqual([
    '8',
    '9',
    '10',
  ]);
});
