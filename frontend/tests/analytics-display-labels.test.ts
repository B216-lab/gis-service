import { expect, test } from 'bun:test';
import { formatValue } from '../src/features/analytics/chart-utils';
import { filterLabel } from '../src/features/analytics/dashboard-filters';
import {
  enumOptions,
  operatorLabel,
  operatorOptions,
} from '../src/features/analytics/display-labels';
import { statisticalOptions } from '../src/features/analytics/StatisticalChart';
import type { Chart, Dataset, Filter } from '../src/features/analytics/types';

test('operator symbols retain persisted codes including legacy aliases', () => {
  const codes = ['eq', 'ne', 'lt', 'le', 'lte', 'gt', 'ge', 'gte'];
  const options = operatorOptions(codes, 'ru');
  expect(options.map((o) => o.value)).toEqual(codes);
  expect(options.map((o) => o.label)).toEqual([
    '=',
    '≠',
    '<',
    '≤',
    '≤',
    '>',
    '≥',
    '≥',
  ]);
  expect(operatorLabel('not_in', 'ru')).toBe('не в списке');
});
test('localized enum selection preserves raw wire value', () => {
  expect(
    enumOptions(['timestamp', 'many-to-one', 'hour'], 'ru').map((o) => o.value),
  ).toEqual(['timestamp', 'many-to-one', 'hour']);
  expect(enumOptions(['timestamp'], 'ru')[0].label).not.toBe('timestamp');
});
const dataset: Dataset = {
  id: 'd',
  name: 'Dataset',
  revision: 1,
  connectionId: 'c',
  fields: [
    { id: 'city', name: 'city_name', label: 'Город', type: 'string' },
    { id: 'count', name: 'count', label: 'Count', type: 'integer' },
  ],
  metrics: [],
};
test('filter chip localizes operators, preserves labels and user data, groups tuples', () => {
  const filter: Filter = {
    fieldId: '',
    operator: '',
    datasetId: 'd',
    anyOf: [
      [
        { fieldId: 'city', operator: 'in', values: ['New chart'] },
        { fieldId: 'count', operator: 'gte', values: [2] },
      ],
      [{ fieldId: 'city', operator: 'is_null' }],
    ],
  };
  expect(filterLabel(filter, [dataset], 'ru')).toBe(
    '(Город в списке New chart ∧ Count ≥ 2) ∨ (Город не задано)',
  );
  expect(filter.anyOf?.[0][0].operator).toBe('in');
});
test('numbers and calendar labels follow chosen locale without changing data', () => {
  expect(formatValue(1.5, {}, 'ru')).toBe('1,5');
  expect(formatValue(1.5, {}, 'en')).toBe('1.5');
  const chart: Chart = {
    id: 'c',
    name: 'Count',
    revision: 1,
    datasetId: 'd',
    type: 'calendarHeatmap',
    query: { datasetId: 'd', dimensions: ['day'], metrics: ['count'] },
  };
  const options = statisticalOptions(
    chart,
    [{ day: '2026-09-13', count: 1 }],
    'ru',
  );
  expect(JSON.stringify(options.calendar)).toContain('Сен');
  expect(chart.name).toBe('Count');
});
