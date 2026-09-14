import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  filtersForWidget,
  mapFilter,
  placeWidgets,
} from '../src/features/analytics/dashboard-filters';
import type {
  Chart,
  Dataset,
  Filter,
  Widget,
} from '../src/features/analytics/types';

function dataset(id: string, column: string): Dataset {
  return {
    id,
    name: id,
    revision: 1,
    connectionId: 'source',
    fields: [{ id: column, name: column, type: 'string', semanticId: 'city' }],
    metrics: [],
  };
}
const submissions = dataset('submissions', 'home_city');
const journeys = dataset('journeys', 'city');
const city: Filter = {
  datasetId: submissions.id,
  fieldId: 'home_city',
  operator: 'in',
  values: ['A', 'B'],
};
const widget: Widget = {
  id: 'count',
  chartId: 'count-chart',
  x: 0,
  y: 0,
  w: 6,
  h: 4,
};
const chart: Chart = {
  id: 'count-chart',
  name: 'Count',
  revision: 1,
  datasetId: journeys.id,
  type: 'kpi',
  query: { datasetId: journeys.id, metrics: ['count'] },
};

test('semantic mappings translate field IDs without changing selected values', () => {
  const result = mapFilter(city, journeys, [submissions, journeys]);
  assert.equal(result?.fieldId, 'city');
  assert.equal(result?.datasetId, journeys.id);
  assert.deepEqual(result?.values, ['A', 'B']);
});
test('unknown datasets and coincidentally matching field names do not propagate', () => {
  const unrelated = {
    ...dataset('unrelated', 'home_city'),
    fields: [{ id: 'home_city', name: 'home_city', type: 'string' }],
  };
  assert.equal(mapFilter(city, unrelated, [submissions, unrelated]), null);
  assert.equal(
    mapFilter({ ...city, datasetId: 'missing' }, journeys, [journeys]),
    null,
  );
});
test('unmapped filters require an explicitly enabled relationship', () => {
  const target = {
    ...journeys,
    fields: [],
    relationships: [
      {
        id: 'submission',
        targetDatasetId: submissions.id,
        sourceFieldId: 'submission_id',
        targetFieldId: 'id',
        cardinality: 'many-to-one',
        allowFiltering: true,
      },
    ],
  };
  assert.equal(
    mapFilter(city, target, [submissions, target])?.datasetId,
    submissions.id,
  );
  target.relationships[0].allowFiltering = false;
  assert.equal(mapFilter(city, target, [submissions, target]), null);
});
test('matrix selections retain OR-of-AND tuples during mapping', () => {
  const selection: Filter = {
    datasetId: submissions.id,
    fieldId: '',
    operator: '',
    anyOf: [[{ ...city, values: ['A'] }], [{ ...city, values: ['B'] }]],
  };
  const mapped = mapFilter(selection, journeys, [submissions, journeys]);
  assert.deepEqual(
    mapped?.anyOf?.map((group) =>
      group.map((field) => [field.fieldId, field.values]),
    ),
    [[['city', ['A']]], [['city', ['B']]]],
  );
});
test('source widget excludes its own selection; scopes exclude unrelated targets', () => {
  assert.equal(
    filtersForWidget([{ ...city, sourceWidgetId: widget.id }], widget, chart, [
      submissions,
      journeys,
    ]).length,
    0,
  );
  assert.equal(
    filtersForWidget([{ ...city, targetWidgetIds: ['other'] }], widget, chart, [
      submissions,
      journeys,
    ]).length,
    0,
  );
  assert.equal(
    filtersForWidget(
      [{ ...city, targetWidgetIds: [widget.id] }],
      widget,
      chart,
      [submissions, journeys],
    ).length,
    1,
  );
});
test('resized dashboard cards pack without crossing twelve columns', () => {
  const result = placeWidgets([
    { ...widget, w: 8, h: 2 },
    { ...widget, id: 'second', w: 6, h: 3 },
  ]);
  assert.deepEqual(
    result.map(({ x, y }) => ({ x, y })),
    [
      { x: 0, y: 0 },
      { x: 0, y: 2 },
    ],
  );
});
