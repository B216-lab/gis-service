import {
  Alert,
  Badge,
  Button,
  Grid,
  Group,
  Loader,
  MultiSelect,
  Paper,
  Pill,
  Select,
  Stack,
  TagsInput,
  Text,
  Title,
} from '@mantine/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ColorSchemeToggle } from '../app/chrome';
import { LanguageSwitcher, useI18n } from '../i18n/i18n';
import { analyticsRequest, runQuery } from './api';
import { ChartRenderer } from './ChartRenderer';
import { filterLabel, filtersForWidget, mapFilter } from './dashboard-filters';
import type {
  Chart,
  Dashboard,
  Dataset,
  Filter,
  NativeFilter,
  Publication,
  QueryResult,
  Widget,
} from './types';

export type DashboardQuery = (
  chart: Chart,
  widget: Widget,
  filters: Filter[],
  signal: AbortSignal,
  bypassCache?: boolean,
) => Promise<QueryResult>;
export interface DashboardViewerProps {
  dashboard: Dashboard;
  charts: Chart[];
  datasets: Dataset[];
  query?: DashboardQuery;
  filters?: Filter[];
  onFiltersChange?: (filters: Filter[]) => void;
  lockedFilters?: Filter[];
  readOnlyDefaults?: boolean;
}
export function DashboardViewer({
  dashboard,
  charts,
  datasets,
  query,
  filters: supplied,
  onFiltersChange,
  lockedFilters = [],
  readOnlyDefaults = false,
}: DashboardViewerProps) {
  const { language } = useI18n();
  const [local, setLocal] = useState<Filter[]>(dashboard.filters || []);
  const filters = supplied || local;
  const change = onFiltersChange || setLocal;
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const seconds = dashboard.refreshIntervalSeconds || 0;
    if (seconds < 30) return;
    const timer = window.setInterval(
      () => setRefresh((value) => value + 1),
      seconds * 1000,
    );
    return () => clearInterval(timer);
  }, [dashboard.refreshIntervalSeconds]);
  const [fieldKey, setFieldKey] = useState<string | null>(null);
  const [values, setValues] = useState<string[]>([]);
  const [scope, setScope] = useState<string[]>([]);
  const [options, setOptions] = useState<string[]>([]);
  const [optionError, setOptionError] = useState('');
  const [search, setSearch] = useState('');
  const observed = useRef<Record<string, QueryResult>>({});
  const [observedVersion, setObservedVersion] = useState(0);
  const optionFields = datasets.flatMap((dataset) =>
    dataset.fields.map((field) => ({
      value: JSON.stringify([dataset.id, field.id]),
      label: `${dataset.name} / ${field.label || field.name}`,
    })),
  );
  const [sourceId, fieldId] = fieldKey
    ? (JSON.parse(fieldKey) as string[])
    : ['', ''];
  const source = datasets.find((dataset) => dataset.id === sourceId);
  const field = source?.fields.find((item) => item.id === fieldId);
  useEffect(() => {
    void observedVersion;
    if (!source || !fieldId) {
      setOptions([]);
      return;
    }
    const controller = new AbortController();
    setOptionError('');
    if (!query) {
      const timer = window.setTimeout(() => {
        const context = filters
          .filter(
            (filter) =>
              !(filter.datasetId === sourceId && filter.fieldId === fieldId),
          )
          .flatMap((filter) => {
            const mapped = mapFilter(filter, source, datasets);
            return mapped ? [mapped] : [];
          });
        analyticsRequest<QueryResult>('/filter-options', {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify({
            datasetId: sourceId,
            fieldId,
            search,
            filters: context,
            limit: 100,
          }),
        })
          .then((result) => {
            if (!controller.signal.aborted)
              setOptions([
                ...new Set(
                  result.rows
                    .map((row) => row[fieldId])
                    .filter((v) => v != null)
                    .map(String),
                ),
              ]);
          })
          .catch((cause) => {
            if (!controller.signal.aborted)
              setOptionError(
                cause instanceof Error
                  ? cause.message
                  : 'Filter options unavailable.',
              );
          });
      }, 250);
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    }
    const found: string[] = [];
    for (const chart of charts) {
      const dataset = datasets.find((d) => d.id === chart.datasetId);
      const candidate =
        chart.datasetId === sourceId
          ? fieldId
          : dataset?.fields.find(
              (f) => field?.semanticId && f.semanticId === field.semanticId,
            )?.id;
      if (!candidate) continue;
      for (const [key, result] of Object.entries(observed.current)) {
        if (!key.endsWith(`:${chart.id}`)) continue;
        for (const row of result.rows)
          if (row[candidate] != null) found.push(String(row[candidate]));
      }
    }
    setOptions([...new Set(found)].sort());
    return () => controller.abort();
  }, [
    source,
    sourceId,
    fieldId,
    field?.semanticId,
    query,
    filters,
    datasets,
    charts,
    search,
    observedVersion,
  ]);
  const execute = useCallback<DashboardQuery>(
    async (chart, widget, active, signal, bypassCache) => {
      const result = query
        ? await query(chart, widget, active, signal, bypassCache)
        : await runQuery(
            {
              ...chart.query,
              datasetId: chart.datasetId,
              filters: [...(chart.query.filters || []), ...active],
            },
            signal,
            bypassCache,
          );
      if (!signal.aborted) {
        observed.current[`${widget.id}:${chart.id}`] = result;
        setObservedVersion((v) => v + 1);
      }
      return result;
    },
    [query],
  );
  function select(widget: Widget, chart: Chart, picked: Filter[]) {
    const previous = filters.filter(
      (filter) => filter.sourceWidgetId === widget.id,
    );
    const others = filters.filter(
      (filter) => filter.sourceWidgetId !== widget.id,
    );
    const next = picked.map((filter) => ({
      ...filter,
      datasetId: filter.datasetId || chart.datasetId,
      sourceWidgetId: widget.id,
      targetWidgetIds: widget.filterTargetWidgetIds,
    }));
    change([
      ...others,
      ...(JSON.stringify(previous) === JSON.stringify(next) ? [] : next),
    ]);
  }
  function apply() {
    if (!field || !values.length) return;
    const typed = values.map((value) =>
      /number|integer|float|decimal|numeric|int/.test(field.type)
        ? Number(value)
        : field.type === 'boolean'
          ? value === 'true'
          : value,
    );
    if (
      typed.some(
        (value) => typeof value === 'number' && !Number.isFinite(value),
      )
    ) {
      setOptionError('Enter valid numeric values.');
      return;
    }
    change([
      ...filters.filter(
        (f) =>
          f.sourceWidgetId || f.datasetId !== sourceId || f.fieldId !== fieldId,
      ),
      {
        datasetId: sourceId,
        fieldId,
        operator: 'in',
        values: typed,
        targetWidgetIds: scope.length ? scope : undefined,
      },
    ]);
    setValues([]);
  }
  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title translate="no" order={2}>
            {dashboard.name}
          </Title>
          {dashboard.description && (
            <Text translate="no" c="dimmed">
              {dashboard.description}
            </Text>
          )}
        </div>
        <Button variant="light" onClick={() => setRefresh((v) => v + 1)}>
          Refresh charts
        </Button>
      </Group>
      <Paper withBorder p="sm">
        <Stack gap="xs">
          {(dashboard.nativeFilters || []).map((binding) => (
            <NativeFilterControl
              key={binding.id}
              binding={binding}
              datasets={datasets}
              loadOptions={!query}
              filters={filters}
              onChange={change}
            />
          ))}
          <Group align="end">
            <Select
              label="Filter field"
              searchable
              data={optionFields}
              value={fieldKey}
              onChange={(value) => {
                setFieldKey(value);
                setValues([]);
                setSearch('');
              }}
              miw={250}
            />
            <TagsInput
              label="Values"
              searchValue={search}
              onSearchChange={setSearch}
              renderOption={({ option }) => (
                <span translate="no">{String(option.value)}</span>
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
              data={[...new Set([...options, ...values])]}
              value={values}
              onChange={setValues}
              disabled={!fieldKey}
              miw={220}
            />
            <MultiSelect
              label="Target charts (empty = compatible charts)"
              data={dashboard.widgets
                .filter((w) => w.chartId)
                .map((w) => ({
                  value: w.id,
                  label: charts.find((c) => c.id === w.chartId)?.name || w.id,
                }))}
              value={scope}
              onChange={setScope}
              miw={240}
            />
            <Button disabled={!values.length} onClick={apply}>
              Apply filter
            </Button>
            <Button variant="default" onClick={() => change([])}>
              Clear filters
            </Button>
          </Group>
          {query && (
            <Text size="xs" c="dimmed">
              Filter choices come from visible chart results.
            </Text>
          )}
          {optionError && <Alert color="red">{optionError}</Alert>}
          <Group gap="xs">
            {lockedFilters.map((filter) => (
              <Badge key={JSON.stringify(filter)} variant="outline">
                Locked:{' '}
                <span translate="no">
                  {filterLabel(filter, datasets, language)}
                </span>
              </Badge>
            ))}
            {filters.map((filter, index) => (
              <Button
                size="compact-xs"
                variant="light"
                key={JSON.stringify(filter)}
                onClick={() => change(filters.filter((_, i) => i !== index))}
              >
                <span translate="no">
                  {filterLabel(filter, datasets, language)} ×
                </span>
              </Button>
            ))}
          </Group>
        </Stack>
      </Paper>
      <Grid align="stretch">
        {dashboard.widgets.map((widget) => {
          const chart = charts.find((item) => item.id === widget.chartId);
          return (
            <Grid.Col
              key={widget.id}
              span={{ base: 12, sm: Math.max(1, Math.min(12, widget.w)) }}
            >
              <Paper withBorder p="sm" h="100%">
                {chart ? (
                  <Stack gap="xs">
                    <Text translate="no" fw={600}>
                      {chart.name}
                    </Text>
                    <DashboardChart
                      widget={widget}
                      chart={chart}
                      charts={charts}
                      datasets={datasets}
                      filters={filters}
                      execute={execute}
                      refresh={refresh}
                      onSelect={(picked) => select(widget, chart, picked)}
                      readOnlyDefaults={readOnlyDefaults}
                    />
                  </Stack>
                ) : widget.chartId ? (
                  <Alert color="red">Chart definition unavailable.</Alert>
                ) : widget.text?.startsWith('# ') ? (
                  <Title translate="no" order={3}>
                    {widget.text.slice(2)}
                  </Title>
                ) : (
                  <Text translate="no" style={{ whiteSpace: 'pre-wrap' }}>
                    {widget.text}
                  </Text>
                )}
              </Paper>
            </Grid.Col>
          );
        })}
      </Grid>
    </Stack>
  );
}
function DashboardChart({
  widget,
  chart,
  charts,
  datasets,
  filters,
  execute,
  refresh,
  onSelect,
  readOnlyDefaults,
}: {
  widget: Widget;
  chart: Chart;
  charts: Chart[];
  datasets: Dataset[];
  filters: Filter[];
  execute: DashboardQuery;
  refresh: number;
  onSelect: (filters: Filter[]) => void;
  readOnlyDefaults: boolean;
}) {
  const [data, setData] = useState<QueryResult>();
  const [layers, setLayers] = useState<{ chart: Chart; data: QueryResult }[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const lastRefresh = useRef('0:0');
  const queries =
    chart.type === 'compositeMap'
      ? (chart.layerChartIds || [])
          .map((id) => charts.find((c) => c.id === id))
          .filter((c): c is Chart => !!c)
      : [chart];
  const requestKey = JSON.stringify(
    queries.map((item) => ({
      chart: item,
      filters: filtersForWidget(filters, widget, item, datasets),
    })),
  );
  const stableRequests = useMemo(
    () => JSON.parse(requestKey) as { chart: Chart; filters: Filter[] }[],
    [requestKey],
  );
  useEffect(() => {
    const refreshKey = `${refresh}:${retry}`;
    const bypassCache = lastRefresh.current !== refreshKey;
    lastRefresh.current = refreshKey;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.all(
      stableRequests.map(async (request) => ({
        chart: request.chart,
        data: await execute(
          request.chart,
          widget,
          request.filters,
          controller.signal,
          bypassCache,
        ),
      })),
    )
      .then((results) => {
        if (!controller.signal.aborted) {
          setData(results[0]?.data);
          setLayers(results);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : 'Chart query failed.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [stableRequests, execute, widget, refresh, retry]);
  return (
    <>
      <ChartRenderer
        chart={chart}
        data={data}
        layers={layers}
        loading={loading}
        error={error}
        height={Math.max(180, widget.h * 70)}
        selection={filters.filter((f) => f.sourceWidgetId === widget.id)}
        onSelect={onSelect}
      />
      {error && (
        <Button
          variant="light"
          size="xs"
          onClick={() => setRetry((v) => v + 1)}
        >
          Retry chart
        </Button>
      )}
      {readOnlyDefaults && (
        <Text size="xs" c="dimmed">
          Published definition
        </Text>
      )}
    </>
  );
}

export function SharedDashboardPage({
  shareToken,
  publicationId,
}: {
  shareToken?: string;
  publicationId?: string;
}) {
  const [publication, setPublication] = useState<Publication | null>(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<Filter[]>([]);
  const endpoint = shareToken
    ? `/public/${encodeURIComponent(shareToken)}`
    : `/publications/${encodeURIComponent(publicationId || '')}`;
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    analyticsRequest<Publication>(endpoint, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setPublication(result);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : 'Dashboard unavailable.',
          );
      });
    return () => controller.abort();
  }, [endpoint]);
  const query = useCallback<DashboardQuery>(
    (chart, widget, active, signal, bypassCache) =>
      analyticsRequest(`${endpoint}/query`, {
        method: 'POST',
        headers: bypassCache ? { 'Cache-Control': 'no-cache' } : undefined,
        signal,
        body: JSON.stringify({
          chartId: chart.id,
          widgetId: widget.id,
          filters: active,
        }),
      }),
    [endpoint],
  );
  return (
    <Stack p="lg" maw={1800} mx="auto">
      <Group gap="xs" justify="flex-end" wrap="nowrap">
        <LanguageSwitcher />
        <ColorSchemeToggle />
      </Group>
      {error ? (
        <Alert color="red" title="Dashboard unavailable">
          {error}
        </Alert>
      ) : publication ? (
        <DashboardViewer
          dashboard={publication.dashboard}
          charts={publication.charts}
          datasets={publication.datasets}
          query={query}
          filters={filters}
          onFiltersChange={setFilters}
          lockedFilters={[
            ...(publication.dashboard.filters || []),
            ...(publication.filters || []),
          ]}
          readOnlyDefaults
        />
      ) : (
        <Loader />
      )}
    </Stack>
  );
}

function NativeFilterControl({
  binding,
  datasets,
  loadOptions,
  filters,
  onChange,
}: {
  binding: NativeFilter;
  datasets: Dataset[];
  loadOptions: boolean;
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
}) {
  const [options, setOptions] = useState<string[]>([]);
  const [error, setError] = useState('');
  const source = datasets.find((d) => d.id === binding.datasetId);
  const field = source?.fields.find((f) => f.id === binding.fieldId);
  const selected =
    filters
      .find((f) => f.sourceWidgetId === `native:${binding.id}`)
      ?.values?.map(String) || [];
  useEffect(() => {
    if (!loadOptions || !source) return;
    const controller = new AbortController();
    const active = filters
      .filter((f) => f.sourceWidgetId !== `native:${binding.id}`)
      .flatMap((f) => {
        const mapped = mapFilter(f, source, datasets);
        return mapped ? [mapped] : [];
      });
    analyticsRequest<QueryResult>('/filter-options', {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify({
        datasetId: binding.datasetId,
        fieldId: binding.fieldId,
        filters: active,
        limit: 100,
      }),
    })
      .then((result) => {
        if (!controller.signal.aborted)
          setOptions([
            ...new Set(
              result.rows
                .map((row) => row[binding.fieldId])
                .filter((v) => v != null)
                .map(String),
            ),
          ]);
      })
      .catch(() => {
        if (!controller.signal.aborted) setOptions([]);
      });
    return () => controller.abort();
  }, [loadOptions, binding, source, filters, datasets]);
  return (
    <TagsInput
      label={binding.name}
      description="Choose suggestions or type values and press Enter. Multiple values match any selection."
      data={options}
      value={selected}
      error={error}
      onChange={(values) => {
        const typed = values.map((value) =>
          /number|integer|float|decimal|numeric|int/.test(field?.type || '')
            ? Number(value)
            : field?.type === 'boolean'
              ? value === 'true'
              : value,
        );
        if (
          typed.some(
            (value) => typeof value === 'number' && !Number.isFinite(value),
          )
        ) {
          setError('Enter valid numeric values.');
          return;
        }
        setError('');
        const others = filters.filter(
          (f) => f.sourceWidgetId !== `native:${binding.id}`,
        );
        onChange([
          ...others,
          ...(values.length
            ? [
                {
                  datasetId: binding.datasetId,
                  fieldId: binding.fieldId,
                  operator: 'in',
                  values: typed,
                  sourceWidgetId: `native:${binding.id}`,
                  targetWidgetIds: binding.targetWidgetIds,
                },
              ]
            : []),
        ]);
      }}
    />
  );
}
