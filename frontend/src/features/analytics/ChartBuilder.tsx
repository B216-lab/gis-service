import {
  Alert,
  Button,
  Checkbox,
  ColorInput,
  Group,
  MultiSelect,
  NumberInput,
  Paper,
  Pill,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { translateLabel, useI18n } from '../i18n/i18n';
import { AggregateFilters } from './AggregateFilters';
import { deleteObject, listObjects, runQuery, saveObject } from './api';
import { ChartRenderer } from './ChartRenderer';
import { type ChartOptions, chartTypes, optionsFor } from './chart-utils';
import {
  enumOptions,
  localizedOptions,
  operatorOptions,
} from './display-labels';
import type { Chart, Dataset, Filter, Query, QueryResult } from './types';

function emptyChart(dataset?: Dataset, language: 'en' | 'ru' = 'en'): Chart {
  return {
    id: crypto.randomUUID(),
    revision: 0,
    name: translateLabel('New chart', language),
    datasetId: dataset?.id || '',
    type: 'bar',
    query: {
      datasetId: dataset?.id || '',
      dimensions: dataset?.fields[0] ? [dataset.fields[0].id] : [],
      metrics: dataset?.metrics[0] ? [dataset.metrics[0].id] : [],
      limit: 1000,
    },
    options: { showLegend: true },
  };
}
export function chartValidation(chart: Chart): string {
  if (!chart.name.trim()) return 'Enter a chart name.';
  if (chart.type === 'compositeMap')
    return chart.layerChartIds?.length ? '' : 'Choose at least one map layer.';
  const dimensions = chart.query.dimensions || [];
  const metrics = chart.query.metrics || [];
  if (!chart.datasetId) return 'Choose a dataset.';
  if (chart.type === 'kpi')
    return metrics.length && !dimensions.length
      ? ''
      : 'KPI requires metrics and no dimensions.';
  if (chart.type === 'geoHeatmap' || chart.type === 'geoArc') {
    const o = optionsFor(chart);
    const required = [
      o.longitudeFieldId || dimensions[0],
      o.latitudeFieldId || dimensions[1],
      ...(chart.type === 'geoArc'
        ? [
            o.targetLongitudeFieldId || dimensions[2],
            o.targetLatitudeFieldId || dimensions[3],
          ]
        : []),
    ];
    return required.every((id) => id && dimensions.includes(id))
      ? ''
      : 'Choose coordinate fields and include each in dimensions.';
  }
  if (!metrics.length) return 'Choose at least one metric.';
  if (chart.type === 'regionMap')
    return dimensions.length === 2 && metrics.length === 1
      ? ''
      : 'Region map requires region name and GeoJSON geometry dimensions, in that order, and one metric.';
  if (chart.type === 'matrixHeatmap')
    return dimensions.length === 2 && metrics.length === 1
      ? ''
      : 'Matrix heatmap requires two dimensions and one metric.';
  if (chart.type === 'calendarHeatmap')
    return dimensions.length === 1 &&
      metrics.length === 1 &&
      chart.query.timeGrain === 'day' &&
      chart.query.timeFieldId === dimensions[0]
      ? ''
      : 'Calendar heatmap requires one date dimension, one metric, and day time grouping.';
  if (chart.type === 'pie')
    return dimensions.length === 1 && metrics.length === 1
      ? ''
      : 'Pie requires one dimension and one metric.';
  return dimensions.length >= 1 && dimensions.length <= 2
    ? ''
    : 'Choose one category dimension, optionally a second for series breakdown.';
}

export function ChartBuilder({ datasets }: { datasets: Dataset[] }) {
  const { language } = useI18n();
  const [charts, setCharts] = useState<Chart[]>([]);
  const [draft, setDraft] = useState<Chart>(() =>
    emptyChart(datasets[0], language),
  );
  const [result, setResult] = useState<QueryResult>();
  const [layerResults, setLayerResults] = useState<
    { chart: Chart; data: QueryResult }[]
  >([]);
  const [queryError, setQueryError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selection, setSelection] = useState<Filter[]>([]);
  const abort = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const initialCatalogLoaded = useRef(false);
  const dataset = datasets.find((d) => d.id === draft.datasetId);
  const fields =
    dataset?.fields.map((f) => ({ value: f.id, label: f.name })) || [];
  const metrics =
    dataset?.metrics.map((m) => ({ value: m.id, label: m.name })) || [];
  const options = optionsFor(draft);
  const validation = chartValidation(draft);
  const refresh = useCallback(async () => {
    try {
      const items = await listObjects<Chart>('charts');
      setCharts(items);
      if (!initialCatalogLoaded.current) {
        initialCatalogLoaded.current = true;
        if (items[0]) {
          setDraft(structuredClone(items[0]));
        }
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load charts.',
      );
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => {
      abort.current?.abort();
    };
  }, [refresh]);
  function update(change: Partial<Chart>) {
    abort.current?.abort();
    requestVersion.current++;
    setLoading(false);
    setResult(undefined);
    setLayerResults([]);
    setSelection([]);
    setDraft((d) => ({ ...d, ...change }));
    setNotice('');
  }
  function updateQuery(change: Partial<Query>) {
    update({ query: { ...draft.query, ...change } });
  }
  function updateOptions(change: Partial<ChartOptions>) {
    update({ options: { ...draft.options, ...change } });
  }
  async function preview() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const version = ++requestVersion.current;
    setLoading(true);
    setQueryError('');
    setSelection([]);
    try {
      if (draft.type === 'compositeMap') {
        const layers = (draft.layerChartIds || [])
          .map((id) => charts.find((chart) => chart.id === id))
          .filter((chart): chart is Chart => !!chart);
        const results = await Promise.all(
          layers.map(async (chart) => ({
            chart,
            data: await runQuery(chart.query, controller.signal),
          })),
        );
        if (version === requestVersion.current) setLayerResults(results);
      } else {
        const data = await runQuery(draft.query, controller.signal);
        if (version === requestVersion.current) setResult(data);
      }
    } catch (cause) {
      if (!controller.signal.aborted && version === requestVersion.current)
        setQueryError(
          cause instanceof Error ? cause.message : 'Preview failed.',
        );
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }
  async function save() {
    setSaving(true);
    setError('');
    try {
      const saved = await saveObject(
        'charts',
        {
          ...draft,
          options: {
            ...draft.options,
            metricLabels: Object.fromEntries(
              (dataset?.metrics || []).map((m) => [m.id, m.name]),
            ),
          },
        },
        draft.revision > 0,
      );
      setDraft(saved);
      setCharts((items) => [
        ...items.filter((item) => item.id !== saved.id),
        saved,
      ]);
      setNotice('Chart saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    setSaving(true);
    setError('');
    try {
      await deleteObject('charts', draft);
      setCharts((items) => items.filter((item) => item.id !== draft.id));
      update(emptyChart(datasets[0], language));
      setNotice('Chart deleted.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Delete failed.');
    } finally {
      setSaving(false);
    }
  }
  function replaceFilter(index: number, change: Partial<Filter>) {
    updateQuery({
      filters: (draft.query.filters || []).map((f, i) =>
        i === index ? { ...f, ...change } : f,
      ),
    });
  }
  return (
    <Stack>
      <Group align="end">
        <Select
          label={`Saved chart (${charts.length})`}
          searchable
          clearable
          miw={260}
          value={draft.revision ? draft.id : null}
          renderOption={({ option }) => (
            <span translate="no">{option.label}</span>
          )}
          data={charts.map((c) => ({ value: c.id, label: c.name }))}
          onChange={(id) => {
            const item = charts.find((c) => c.id === id);
            if (item) update(structuredClone(item));
          }}
        />
        <Button onClick={() => update(emptyChart(datasets[0], language))}>
          New chart
        </Button>
        <Button variant="default" onClick={() => void refresh()}>
          Refresh charts
        </Button>
        {draft.revision > 0 && (
          <Button
            variant="subtle"
            onClick={() => {
              const latest = charts.find((c) => c.id === draft.id);
              if (latest) update(structuredClone(latest));
            }}
          >
            Reload selected
          </Button>
        )}
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      {notice && <Alert color="green">{notice}</Alert>}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Paper withBorder p="md">
          <Stack gap="sm">
            <TextInput
              label="Chart name"
              value={draft.name}
              onChange={(e) => update({ name: e.currentTarget.value })}
            />
            <Select
              label="Visualization"
              data={localizedOptions(chartTypes, language)}
              value={draft.type}
              onChange={(type) => {
                if (type) update({ type });
              }}
            />
            <Select
              label="Dataset"
              searchable
              renderOption={({ option }) => (
                <span translate="no">{option.label}</span>
              )}
              data={datasets.map((d) => ({ value: d.id, label: d.name }))}
              value={draft.datasetId || null}
              onChange={(id) => {
                const d = datasets.find((item) => item.id === id);
                update({
                  datasetId: id || '',
                  query: { ...emptyChart(d, language).query },
                  options: {},
                });
              }}
            />
            {draft.type === 'compositeMap' ? (
              <MultiSelect
                label="Map layers"
                description="Each layer uses its saved query and coordinates."
                searchable
                renderOption={({ option }) => (
                  <span translate="no">{option.label}</span>
                )}
                renderPill={({ option, onRemove, disabled }) => (
                  <Pill
                    translate="no"
                    withRemoveButton={!disabled}
                    disabled={disabled}
                    onRemove={onRemove}
                  >
                    {option.label}
                  </Pill>
                )}
                data={charts
                  .filter(
                    (c) =>
                      c.id !== draft.id &&
                      ['geoHeatmap', 'geoArc'].includes(c.type),
                  )
                  .map((c) => ({ value: c.id, label: c.name }))}
                value={draft.layerChartIds || []}
                onChange={(layerChartIds) => update({ layerChartIds })}
              />
            ) : (
              <>
                <MultiSelect
                  label="Dimensions"
                  description="Order: category, series breakdown. Map: longitude, latitude, destination longitude, destination latitude."
                  searchable
                  renderOption={({ option }) => (
                    <span translate="no">{option.label}</span>
                  )}
                  renderPill={({ option, onRemove, disabled }) => (
                    <Pill
                      translate="no"
                      withRemoveButton={!disabled}
                      disabled={disabled}
                      onRemove={onRemove}
                    >
                      {option.label}
                    </Pill>
                  )}
                  data={fields}
                  value={draft.query.dimensions || []}
                  onChange={(dimensions) =>
                    updateQuery({
                      dimensions,
                      timeFieldId: dimensions.includes(
                        draft.query.timeFieldId || '',
                      )
                        ? draft.query.timeFieldId
                        : undefined,
                      timeGrain: dimensions.includes(
                        draft.query.timeFieldId || '',
                      )
                        ? draft.query.timeGrain
                        : undefined,
                    })
                  }
                />
                <MultiSelect
                  label="Metrics"
                  searchable
                  renderOption={({ option }) => (
                    <span translate="no">{option.label}</span>
                  )}
                  renderPill={({ option, onRemove, disabled }) => (
                    <Pill
                      translate="no"
                      withRemoveButton={!disabled}
                      disabled={disabled}
                      onRemove={onRemove}
                    >
                      {option.label}
                    </Pill>
                  )}
                  data={metrics}
                  value={draft.query.metrics || []}
                  onChange={(value) => updateQuery({ metrics: value })}
                />
                <SimpleGrid cols={2}>
                  <Select
                    label="Date field"
                    clearable
                    renderOption={({ option }) => (
                      <span translate="no">{option.label}</span>
                    )}
                    data={fields.filter((f) =>
                      draft.query.dimensions?.includes(f.value),
                    )}
                    value={draft.query.timeFieldId || null}
                    onChange={(value) =>
                      updateQuery({
                        timeFieldId: value || undefined,
                        timeGrain: value
                          ? draft.query.timeGrain || 'day'
                          : undefined,
                      })
                    }
                  />
                  <Select
                    label="Time grouping"
                    disabled={!draft.query.timeFieldId}
                    clearable
                    data={enumOptions(
                      ['hour', 'day', 'week', 'month', 'quarter', 'year'],
                      language,
                    )}
                    value={draft.query.timeGrain || null}
                    onChange={(value) =>
                      updateQuery({ timeGrain: value || undefined })
                    }
                  />
                </SimpleGrid>
                <SimpleGrid cols={2}>
                  <Select
                    label="Sort by"
                    clearable
                    renderOption={({ option }) => (
                      <span translate="no">{option.label}</span>
                    )}
                    data={[...fields, ...metrics].filter((f) =>
                      [
                        ...(draft.query.dimensions || []),
                        ...(draft.query.metrics || []),
                      ].includes(f.value),
                    )}
                    value={draft.query.sort?.[0]?.fieldId || null}
                    onChange={(value) =>
                      updateQuery({
                        sort: value
                          ? [
                              {
                                fieldId: value,
                                desc: draft.query.sort?.[0]?.desc || false,
                              },
                            ]
                          : [],
                      })
                    }
                  />
                  <NumberInput
                    label="Row limit"
                    min={1}
                    max={10000}
                    allowDecimal={false}
                    value={draft.query.limit || 1000}
                    onChange={(value) =>
                      updateQuery({ limit: Number(value) || 1000 })
                    }
                  />
                </SimpleGrid>
                <Checkbox
                  label="Descending sort"
                  checked={draft.query.sort?.[0]?.desc || false}
                  disabled={!draft.query.sort?.length}
                  onChange={(e) =>
                    updateQuery({
                      sort: [
                        {
                          fieldId: draft.query.sort?.[0]?.fieldId || '',
                          desc: e.currentTarget.checked,
                        },
                      ],
                    })
                  }
                />
                <Title order={5}>Default filters</Title>
                {(draft.query.filters || []).map((filter, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Controlled filter rows have no persisted ID; order is their query position.
                  <Paper key={index} p="xs" withBorder>
                    <Stack gap="xs">
                      <Group grow>
                        <Select
                          label="Field"
                          renderOption={({ option }) => (
                            <span translate="no">{option.label}</span>
                          )}
                          data={fields}
                          value={filter.fieldId}
                          onChange={(id) =>
                            replaceFilter(index, { fieldId: id || '' })
                          }
                        />
                        <Select
                          label="Condition"
                          data={operatorOptions(
                            [
                              'in',
                              'not_in',
                              'eq',
                              'ne',
                              'gt',
                              'gte',
                              'lt',
                              'lte',
                              'between',
                              'contains',
                              'is_null',
                              'is_not_null',
                              'last_months',
                            ],
                            language,
                          )}
                          value={filter.operator}
                          onChange={(operator) =>
                            replaceFilter(index, {
                              operator: operator || 'eq',
                              values: [],
                            })
                          }
                        />
                      </Group>
                      {!['is_null', 'is_not_null'].includes(
                        filter.operator,
                      ) && (
                        <TextInput
                          label="Values"
                          description={
                            filter.operator === 'last_months'
                              ? 'Month count, e.g. 3. Resolves at query time.'
                              : 'Separate multiple values with |. Dates use ISO 8601 (UTC).'
                          }
                          value={(filter.values || []).join('|')}
                          onChange={(e) => {
                            const value = e.currentTarget.value;
                            const fieldType =
                              dataset?.fields.find(
                                (f) => f.id === filter.fieldId,
                              )?.type || '';
                            const numbers =
                              filter.operator === 'last_months' ||
                              /int|numeric|float|double|decimal|real/.test(
                                fieldType,
                              );
                            replaceFilter(index, {
                              values: value
                                .split('|')
                                .map((v) =>
                                  numbers &&
                                  v.trim() &&
                                  Number.isFinite(Number(v))
                                    ? Number(v)
                                    : v,
                                ),
                            });
                          }}
                        />
                      )}
                      <Button
                        variant="subtle"
                        color="red"
                        size="compact-xs"
                        onClick={() =>
                          updateQuery({
                            filters: draft.query.filters?.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                      >
                        Remove filter
                      </Button>
                    </Stack>
                  </Paper>
                ))}
                <Button
                  variant="light"
                  size="xs"
                  disabled={!fields.length}
                  onClick={() =>
                    updateQuery({
                      filters: [
                        ...(draft.query.filters || []),
                        {
                          fieldId: fields[0]?.value || '',
                          operator: 'eq',
                          values: [],
                        },
                      ],
                    })
                  }
                >
                  Add filter
                </Button>
                <AggregateFilters
                  metrics={metrics.filter((m) =>
                    draft.query.metrics?.includes(m.value),
                  )}
                  filters={draft.query.having || []}
                  onChange={(having) => updateQuery({ having })}
                />
              </>
            )}
            {['geoHeatmap', 'geoArc'].includes(draft.type) && (
              <>
                <Title order={5}>Coordinates</Title>
                {(
                  [
                    'longitudeFieldId',
                    'latitudeFieldId',
                    ...(draft.type === 'geoArc'
                      ? ['targetLongitudeFieldId', 'targetLatitudeFieldId']
                      : []),
                  ] as const
                ).map((key, index) => (
                  <Select
                    key={key}
                    label={
                      [
                        'Longitude',
                        'Latitude',
                        'Destination longitude',
                        'Destination latitude',
                      ][index]
                    }
                    clearable
                    renderOption={({ option }) => (
                      <span translate="no">{option.label}</span>
                    )}
                    data={fields.filter((f) =>
                      draft.query.dimensions?.includes(f.value),
                    )}
                    value={
                      String(
                        options[key as keyof ChartOptions] ||
                          draft.query.dimensions?.[index] ||
                          '',
                      ) || null
                    }
                    onChange={(value) =>
                      updateOptions({ [key]: value || undefined })
                    }
                  />
                ))}
                <Select
                  label="Weight metric"
                  clearable
                  renderOption={({ option }) => (
                    <span translate="no">{option.label}</span>
                  )}
                  data={metrics.filter((m) =>
                    draft.query.metrics?.includes(m.value),
                  )}
                  value={options.weightMetricId || null}
                  onChange={(value) =>
                    updateOptions({ weightMetricId: value || undefined })
                  }
                />
                <NumberInput
                  label="Heat radius (pixels)"
                  min={1}
                  max={100}
                  value={options.radius || 30}
                  onChange={(value) =>
                    updateOptions({ radius: Number(value) || 30 })
                  }
                />
              </>
            )}
            <Title order={5}>Appearance</Title>
            {['bar', 'line', 'matrixHeatmap'].includes(draft.type) && (
              <Select
                label="Category order"
                clearable
                data={localizedOptions(
                  [
                    { value: 'labelAsc', label: 'Label ascending' },
                    { value: 'labelDesc', label: 'Label descending' },
                    { value: 'sumAsc', label: 'Total ascending' },
                    { value: 'sumDesc', label: 'Total descending' },
                  ],
                  language,
                )}
                value={options.xSort || null}
                onChange={(value) =>
                  updateOptions({
                    xSort: (value as ChartOptions['xSort']) || undefined,
                  })
                }
              />
            )}
            {draft.type === 'matrixHeatmap' && (
              <>
                <Select
                  label="Normalization scope"
                  data={localizedOptions(
                    [
                      { value: 'all', label: 'Entire heatmap' },
                      { value: 'row', label: 'Within each row' },
                      { value: 'column', label: 'Within each column' },
                    ],
                    language,
                  )}
                  value={options.normalize || 'all'}
                  onChange={(value) =>
                    updateOptions({
                      normalize: value as ChartOptions['normalize'],
                    })
                  }
                />
                <Checkbox
                  label="Color by percentile rank"
                  checked={!!options.normalized}
                  onChange={(e) =>
                    updateOptions({ normalized: e.currentTarget.checked })
                  }
                />
                <Checkbox
                  label="Show percentage in tooltip"
                  checked={!!options.showPercentage}
                  onChange={(e) =>
                    updateOptions({ showPercentage: e.currentTarget.checked })
                  }
                />
                <Select
                  label="Row order"
                  clearable
                  data={localizedOptions(
                    [
                      { value: 'labelAsc', label: 'Label ascending' },
                      { value: 'labelDesc', label: 'Label descending' },
                      { value: 'sumAsc', label: 'Total ascending' },
                      { value: 'sumDesc', label: 'Total descending' },
                    ],
                    language,
                  )}
                  value={options.ySort || null}
                  onChange={(value) =>
                    updateOptions({
                      ySort: (value as ChartOptions['ySort']) || undefined,
                    })
                  }
                />
              </>
            )}
            <ColorInput
              label="Primary color"
              value={options.color || '#228be6'}
              onChange={(color) => updateOptions({ color })}
            />
            <SimpleGrid cols={3}>
              <NumberInput
                label="Decimals"
                min={0}
                max={10}
                allowDecimal={false}
                value={options.decimals ?? 2}
                onChange={(value) => updateOptions({ decimals: Number(value) })}
              />
              <TextInput
                label="Prefix"
                value={options.prefix || ''}
                onChange={(e) =>
                  updateOptions({ prefix: e.currentTarget.value })
                }
              />
              <TextInput
                label="Suffix"
                value={options.suffix || ''}
                onChange={(e) =>
                  updateOptions({ suffix: e.currentTarget.value })
                }
              />
            </SimpleGrid>
            <Group>
              <Checkbox
                label="Legend"
                checked={options.showLegend !== false}
                onChange={(e) =>
                  updateOptions({ showLegend: e.currentTarget.checked })
                }
              />
              <Checkbox
                label="Value labels"
                checked={!!options.showLabels}
                onChange={(e) =>
                  updateOptions({ showLabels: e.currentTarget.checked })
                }
              />
              {draft.type === 'bar' && (
                <>
                  <Checkbox
                    label="Stacked"
                    checked={!!options.stacked}
                    onChange={(e) =>
                      updateOptions({ stacked: e.currentTarget.checked })
                    }
                  />
                  <Checkbox
                    label="Horizontal"
                    checked={!!options.horizontal}
                    onChange={(e) =>
                      updateOptions({ horizontal: e.currentTarget.checked })
                    }
                  />
                </>
              )}
            </Group>
            {validation && (
              <Text c="orange" size="sm">
                {validation}
              </Text>
            )}
            <Group>
              <Button
                disabled={!!validation}
                loading={loading}
                onClick={() => void preview()}
              >
                Run preview
              </Button>
              <Button
                disabled={!!validation}
                loading={saving}
                onClick={() => void save()}
              >
                Save chart
              </Button>
              {draft.revision > 0 && (
                <Button
                  color="red"
                  variant="subtle"
                  disabled={saving}
                  onClick={() => void remove()}
                >
                  Delete chart
                </Button>
              )}
            </Group>
          </Stack>
        </Paper>
        <Paper withBorder p="md">
          <Stack>
            <Title translate="no" order={4}>
              {draft.name}
            </Title>
            <Text size="xs" c="dimmed">
              Click marks to select. Ctrl/Shift-click combines selections.
              Dashboard determines filter targets.
            </Text>
            <ChartRenderer
              chart={draft}
              data={result}
              layers={layerResults}
              loading={loading}
              error={queryError}
              height={420}
              selection={selection}
              onSelect={setSelection}
            />
            {selection.length > 0 && (
              <Alert title="Selection ready">
                {selection.some((f) => f.anyOf)
                  ? 'Multiple selected groups'
                  : `${selection.length} filter conditions`}
                <Button
                  variant="subtle"
                  size="compact-xs"
                  ml="sm"
                  onClick={() => setSelection([])}
                >
                  Clear selection
                </Button>
              </Alert>
            )}
          </Stack>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
