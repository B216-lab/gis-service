import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core';
import {
  IconChartBar,
  IconLayoutDashboard,
  IconMapPin,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnectionStore } from '../connections/store';
import { listObjects, runQuery, runWorkspaceQuery, saveObject } from './api';
import { ChartRenderer } from './ChartRenderer';
import { type DashboardQuery, DashboardViewer } from './DashboardViewer';
import type { Chart, Dashboard, Dataset, Filter, QueryResult } from './types';
import {
  createOrReuseWorkspaceDataset,
  mapFiltersToPhysicalDataset,
  queryFiltersForWorkspace,
  viewportToAnalyticsFilter,
} from './workspace-context';
import {
  isGeographicChart,
  useWorkspaceAnalyticsMapLayerStore,
} from './workspace-map-layer-store';
import {
  overlaysForSource,
  sourceCompatible,
  useWorkspaceAnalyticsStore,
  type WorkspaceOverlay,
} from './workspace-store';

export type Scope = 'all' | 'filtered' | 'selected' | 'extent';
type Binding = 'follow' | 'pinned' | 'reference';
const emptyFilters: Filter[] = [];
const emptySelection: Parameters<typeof queryFiltersForWorkspace>[2] = [];

function displaySource(source: {
  name: string;
  schema: string;
  table: string;
}) {
  return `${source.name} · ${source.schema}.${source.table}`;
}

function sourceKey(source: {
  connectionId: string;
  schema: string;
  table: string;
}) {
  return `${source.connectionId}\u0000${source.schema}\u0000${source.table}`;
}

function createQuickChart(
  dataset: Dataset,
  dimensionId: string,
  aggregate: string,
  valueFieldId: string,
  type: string,
): Chart {
  const field = dataset.fields.find((item) => item.id === dimensionId);
  const metric = quickMetric(dataset, valueFieldId, aggregate);
  return {
    id: crypto.randomUUID(),
    name: `${field?.name || 'Records'} · ${metric.name}`,
    revision: 0,
    datasetId: dataset.id,
    type: type === 'kpi' ? 'kpi' : type,
    query: {
      datasetId: dataset.id,
      dimensions: type === 'kpi' || !dimensionId ? [] : [dimensionId],
      metrics: [metric.id],
      limit: 1000,
    },
    options: { showLegend: false },
  };
}

function quickMetric(
  dataset: Dataset,
  valueFieldId: string,
  aggregate: string,
) {
  const field = dataset.fields.find((item) => item.id === valueFieldId);
  if (aggregate === 'count')
    return (
      dataset.metrics.find((item) => item.id === 'count') || {
        id: 'count',
        name: 'Count',
        expression: 'COUNT(*)',
      }
    );
  const id = `${aggregate}_${field?.id || 'value'}`;
  return (
    dataset.metrics.find((item) => item.id === id) || {
      id,
      name: `${aggregate.toUpperCase()} ${field?.name || 'value'}`,
      expression: `${aggregate.toUpperCase()}("${(field?.name || '').replaceAll('"', '""')}")`,
    }
  );
}

function scopeLabel(scope: Scope, selectionCount: number) {
  if (scope === 'selected') return `Selected (${selectionCount})`;
  if (scope === 'filtered') return 'Filtered';
  if (scope === 'extent') return 'Map extent';
  return 'All records';
}

export function useChartQuery(
  chart: Chart | null,
  dataset: Dataset | null,
  filters: Filter[],
  selection: Parameters<typeof queryFiltersForWorkspace>[2],
  scope: Scope,
  refreshVersion: number,
  applySourceScope = false,
  ignoreFilterSource = '',
) {
  const activeSource = useWorkspaceAnalyticsStore(
    (state) => state.activeSource,
  );
  const scopedSource =
    applySourceScope || scope === 'extent' ? activeSource : null;
  const viewport = useWorkspaceAnalyticsStore((state) => state.viewport);
  const filterDataset = useWorkspaceAnalyticsStore(
    (state) => state.filterDataset,
  );
  const scopedFilterDataset = scope === 'all' ? null : filterDataset;
  const [result, setResult] = useState<QueryResult>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!chart || !dataset) {
      setResult(undefined);
      setError('');
      return;
    }
    const controller = new AbortController();
    setResult(undefined);
    setLoading(true);
    setError('');
    try {
      const scopedFilters =
        scope === 'filtered' || scope === 'selected' || scope === 'extent'
          ? filters.filter(
              (filter) => filter.sourceWidgetId !== ignoreFilterSource,
            )
          : [];
      const queryFilters = queryFiltersForWorkspace(
        scope === 'filtered' || scope === 'selected' || scope === 'extent'
          ? scopedFilterDataset && scopedFilterDataset.id !== dataset.id
            ? mapFiltersToPhysicalDataset(
                scopedFilters,
                scopedFilterDataset,
                dataset,
              )
            : scopedFilters
          : [],
        dataset,
        selection,
        scope === 'selected',
      );
      if (!queryFilters) {
        setResult({ columns: [], rows: [] });
        setLoading(false);
        return () => controller.abort();
      }
      const boundSource =
        applySourceScope &&
        scopedSource &&
        sourceCompatible(scopedSource, dataset)
          ? scopedSource
          : null;
      let extentFilters: Filter[] = [];
      if (scope === 'extent') {
        if (!viewport || !scopedSource) {
          throw new Error('Map extent is unavailable for this chart.');
        }
        extentFilters = [
          viewportToAnalyticsFilter(viewport, dataset, scopedSource),
        ];
      }
      const query = {
        ...chart.query,
        datasetId: chart.datasetId,
        filters: [
          ...(chart.query.filters || []),
          ...queryFilters,
          ...extentFilters,
        ],
      };
      const request = boundSource
        ? runWorkspaceQuery(
            query,
            boundSource,
            controller.signal,
            refreshVersion > 0,
          )
        : runQuery(query, controller.signal, refreshVersion > 0);
      void request
        .then((next) => {
          if (!controller.signal.aborted) setResult(next);
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setError(
              cause instanceof Error ? cause.message : 'Chart query failed.',
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chart query failed.');
      setLoading(false);
    }
    return () => controller.abort();
  }, [
    applySourceScope,
    chart,
    dataset,
    scopedFilterDataset,
    filters,
    refreshVersion,
    scope,
    selection,
    scopedSource,
    viewport,
    ignoreFilterSource,
  ]);
  return { result, error, loading };
}

function ChartPreview({
  chart,
  dataset,
  scope,
  allowSharedFilters,
  binding,
}: {
  chart: Chart;
  dataset: Dataset;
  scope: Scope;
  allowSharedFilters: boolean;
  binding: Binding;
}) {
  const filters = useWorkspaceAnalyticsStore((state) => state.filters);
  const selection = useWorkspaceAnalyticsStore((state) => state.selection);
  const refreshVersion = useWorkspaceAnalyticsStore(
    (state) => state.refreshVersion,
  );
  const setFilters = useWorkspaceAnalyticsStore((state) => state.setFilters);
  const query = useChartQuery(
    chart,
    dataset,
    filters,
    selection,
    scope,
    refreshVersion,
    binding !== 'reference' && scope !== 'all',
    `workspace:${chart.id}`,
  );
  return (
    <ChartRenderer
      chart={chart}
      data={query.result}
      error={query.error}
      height={250}
      loading={query.loading}
      selection={allowSharedFilters ? filters : []}
      onSelect={(picked) => {
        if (allowSharedFilters && binding !== 'reference') {
          setFilters(
            picked.map((filter) => ({
              ...filter,
              sourceWidgetId: `workspace:${chart.id}`,
            })),
            dataset,
          );
        }
      }}
    />
  );
}

export function WorkspaceAnalytics({
  onOpenLibrary,
}: {
  onOpenLibrary?: () => void;
}) {
  const activeSource = useWorkspaceAnalyticsStore(
    (state) => state.activeSource,
  );
  const selection = useWorkspaceAnalyticsStore((state) => state.selection);
  const filters = useWorkspaceAnalyticsStore((state) => state.filters);
  const filterDataset = useWorkspaceAnalyticsStore(
    (state) => state.filterDataset,
  );
  const viewport = useWorkspaceAnalyticsStore((state) => state.viewport);
  const refreshVersion = useWorkspaceAnalyticsStore(
    (state) => state.refreshVersion,
  );
  const clearFilters = useWorkspaceAnalyticsStore(
    (state) => state.clearFilters,
  );
  const setWorkspaceFilters = useWorkspaceAnalyticsStore(
    (state) => state.setFilters,
  );
  const refresh = useWorkspaceAnalyticsStore((state) => state.refresh);
  const addOverlay = useWorkspaceAnalyticsStore((state) => state.addOverlay);
  const analyticsMapLayers = useWorkspaceAnalyticsMapLayerStore(
    (state) => state.layers,
  );
  const analyticsMapLayerErrors = useWorkspaceAnalyticsMapLayerStore(
    (state) => state.errors,
  );
  const addAnalyticsMapLayer = useWorkspaceAnalyticsMapLayerStore(
    (state) => state.addLayer,
  );
  const removeAnalyticsMapLayer = useWorkspaceAnalyticsMapLayerStore(
    (state) => state.removeLayer,
  );
  const setAnalyticsMapLayerVisible = useWorkspaceAnalyticsMapLayerStore(
    (state) => state.setVisible,
  );
  const connections = useConnectionStore((state) => state.connections);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [charts, setCharts] = useState<Chart[]>([]);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [chartId, setChartId] = useState<string | null>(null);
  const [dashboardId, setDashboardId] = useState<string | null>(null);
  const [dashboardLocalFilters, setDashboardLocalFilters] = useState<Filter[]>(
    [],
  );
  const [dimensionId, setDimensionId] = useState<string | null>(null);
  const [valueFieldId, setValueFieldId] = useState<string | null>(null);
  const [chartType, setChartType] = useState('bar');
  const [aggregate, setAggregate] = useState('count');
  const [scope, setScope] = useState<Scope>('filtered');
  const [binding, setBinding] = useState<Binding>('follow');
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [creatingDataset, setCreatingDataset] = useState(false);
  const [savingChart, setSavingChart] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    setLoadingCatalog(true);
    setError('');
    try {
      const [nextDatasets, nextCharts, nextDashboards] = await Promise.all([
        listObjects<Dataset>('datasets'),
        listObjects<Chart>('charts'),
        listObjects<Dashboard>('dashboards'),
      ]);
      if (request !== requestRef.current) return;
      setDatasets(nextDatasets);
      setCharts(nextCharts);
      setDashboards(nextDashboards);
    } catch (cause) {
      if (request === requestRef.current)
        setError(
          cause instanceof Error ? cause.message : 'Could not load analytics.',
        );
    } finally {
      if (request === requestRef.current) setLoadingCatalog(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    return () => {
      requestRef.current++;
    };
  }, [reload]);

  const compatibleDatasets = useMemo(
    () =>
      activeSource
        ? datasets.filter((dataset) => sourceCompatible(activeSource, dataset))
        : [],
    [activeSource, datasets],
  );
  const activeSourceKey = activeSource ? sourceKey(activeSource) : '';
  const selectedDataset =
    datasets.find((dataset) => dataset.id === datasetId) ||
    compatibleDatasets[0] ||
    null;
  const selectedChart = charts.find((chart) => chart.id === chartId) || null;
  const selectedDashboard =
    dashboards.find((item) => item.id === dashboardId) || null;
  const dashboardExternalFilters = useMemo(
    () =>
      filters.map((filter) => ({
        ...filter,
        sourceWidgetId: 'workspace:external',
      })),
    [filters],
  );
  const dashboardFilters = useMemo(
    () => [...dashboardLocalFilters, ...dashboardExternalFilters],
    [dashboardExternalFilters, dashboardLocalFilters],
  );
  const chartDataset = selectedChart
    ? datasets.find((dataset) => dataset.id === selectedChart.datasetId) || null
    : selectedDataset;
  const quickChart = useMemo(
    () =>
      selectedDataset
        ? createQuickChart(
            selectedDataset,
            dimensionId || '',
            aggregate,
            valueFieldId || '',
            chartType,
          )
        : null,
    [aggregate, chartType, dimensionId, selectedDataset, valueFieldId],
  );
  const activeChart = selectedChart || quickChart;
  const activeDataset = selectedChart ? chartDataset : selectedDataset;
  const bindingCompatible = Boolean(
    activeSource &&
      activeDataset &&
      sourceCompatible(activeSource, activeDataset),
  );
  const canShare = binding !== 'reference' && bindingCompatible;
  const scopeError =
    binding === 'follow' && !bindingCompatible
      ? 'This chart uses another dataset. Switch to Reference, or choose a chart bound to the active source.'
      : binding === 'pinned' && scope !== 'all' && !bindingCompatible
        ? 'Pinned charts use all records until their source is active again.'
        : '';

  useEffect(() => {
    if (!datasetId && compatibleDatasets[0])
      setDatasetId(compatibleDatasets[0].id);
  }, [compatibleDatasets, datasetId]);
  useEffect(() => {
    if (binding !== 'follow') return;
    if (!activeSourceKey) {
      setChartId(null);
      setDashboardId(null);
      setDatasetId(null);
      setDimensionId(null);
      setValueFieldId(null);
      return;
    }
    setChartId(null);
    setDashboardId(null);
    setDatasetId(compatibleDatasets[0]?.id || null);
    setDimensionId(null);
    setValueFieldId(null);
  }, [binding, activeSourceKey, compatibleDatasets[0]?.id]);
  useEffect(() => {
    if (chartType !== 'kpi' && !dimensionId && selectedDataset?.fields[0])
      setDimensionId(
        selectedDataset.fields.find(
          (field) =>
            !/(^id$|_id$|geom)/i.test(field.name) &&
            /string|text|boolean|date|time/i.test(field.type),
        )?.id || selectedDataset.fields[0].id,
      );
  }, [chartType, dimensionId, selectedDataset]);
  useEffect(() => {
    setDashboardLocalFilters(selectedDashboard?.filters || []);
  }, [selectedDashboard]);
  useEffect(() => {
    if (!valueFieldId && selectedDataset)
      setValueFieldId(
        selectedDataset.fields.find((field) =>
          /number|integer|numeric|decimal|float|double|real|int/i.test(
            field.type,
          ),
        )?.id || null,
      );
  }, [selectedDataset, valueFieldId]);

  async function createDataset() {
    if (!activeSource) return;
    const requestedSource = sourceKey(activeSource);
    const connection = connections.find(
      (item) => item.id === activeSource.connectionId,
    );
    if (!connection) {
      setError(
        'The active server connection is unavailable. Reload the workspace first.',
      );
      return;
    }
    setCreatingDataset(true);
    setError('');
    try {
      const dataset = await createOrReuseWorkspaceDataset(
        activeSource,
        connection,
        datasets,
      );
      const currentSource = useWorkspaceAnalyticsStore.getState().activeSource;
      if (!currentSource || sourceKey(currentSource) !== requestedSource)
        return;
      setDatasets((items) => [
        ...items.filter((item) => item.id !== dataset.id),
        dataset,
      ]);
      setDatasetId(dataset.id);
      setDimensionId(null);
      setNotice('Dataset is ready for charting.');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not create dataset.',
      );
    } finally {
      setCreatingDataset(false);
    }
  }

  async function saveQuickChart() {
    if (!quickChart) return;
    setSavingChart(true);
    setError('');
    try {
      let dataset = selectedDataset;
      if (!dataset) return;
      const metric = quickMetric(dataset, valueFieldId || '', aggregate);
      if (!dataset.metrics.some((item) => item.id === metric.id)) {
        dataset = await saveObject(
          'datasets',
          { ...dataset, metrics: [...dataset.metrics, metric] },
          dataset.revision > 0,
        );
        setDatasets((items) =>
          items.map((item) => (item.id === dataset.id ? dataset : item)),
        );
      }
      const saved = await saveObject(
        'charts',
        createQuickChart(
          dataset,
          dimensionId || '',
          aggregate,
          valueFieldId || '',
          chartType,
        ),
        false,
      );
      setCharts((items) => [...items, saved]);
      setChartId(saved.id);
      setNotice('Chart saved.');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save chart.',
      );
    } finally {
      setSavingChart(false);
    }
  }

  function syncDashboardFilters(next: Filter[]) {
    if (!next.length) {
      clearFilters();
      return;
    }
    const datasetIds = [
      ...new Set(next.map((filter) => filter.datasetId).filter(Boolean)),
    ];
    if (datasetIds.length !== 1) {
      setError(
        'Dashboard filters across multiple datasets cannot link to the workspace yet.',
      );
      return;
    }
    const sourceDataset = datasets.find(
      (dataset) => dataset.id === datasetIds[0],
    );
    const targetDataset = activeSource
      ? datasets.find((dataset) => sourceCompatible(activeSource, dataset))
      : null;
    if (!sourceDataset || !targetDataset) {
      setError(
        'This dashboard filter has no compatible active workspace source.',
      );
      return;
    }
    try {
      setWorkspaceFilters(
        sourceDataset.id === targetDataset.id
          ? next
          : mapFiltersToPhysicalDataset(next, sourceDataset, targetDataset),
        targetDataset,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'This dashboard filter cannot link to the workspace.',
      );
    }
  }

  function changeDashboardFilters(next: Filter[]) {
    const local = next.filter(
      (filter) => filter.sourceWidgetId !== 'workspace:external',
    );
    setDashboardLocalFilters(local);
    syncDashboardFilters(local);
  }

  const dashboardQuery = useCallback<DashboardQuery>(
    (chart, _widget, dashboardQueryFilters, signal, bypassCache) => {
      const dataset = datasets.find((item) => item.id === chart.datasetId);
      const source =
        binding !== 'reference' &&
        activeSource &&
        dataset &&
        sourceCompatible(activeSource, dataset)
          ? activeSource
          : null;
      const query = {
        ...chart.query,
        datasetId: chart.datasetId,
        filters: [...(chart.query.filters || []), ...dashboardQueryFilters],
      };
      return source
        ? runWorkspaceQuery(
            query,
            source,
            signal,
            bypassCache || refreshVersion > 0,
          )
        : runQuery(query, signal, bypassCache || refreshVersion > 0);
    },
    [activeSource, binding, datasets, refreshVersion],
  );

  function addActiveChartAsMapLayer() {
    if (!activeChart || !activeDataset || !isGeographicChart(activeChart)) {
      return;
    }
    if (
      binding !== 'reference' &&
      !sourceCompatible(activeSource, activeDataset)
    ) {
      setError(
        'Choose this chart’s source or use Reference before adding a map layer.',
      );
      return;
    }
    const children =
      activeChart.type === 'compositeMap'
        ? (activeChart.layerChartIds || []).flatMap((id) => {
            const chart = charts.find((item) => item.id === id);
            const dataset = chart
              ? datasets.find((item) => item.id === chart.datasetId)
              : null;
            return chart && dataset ? [{ chart, dataset }] : [];
          })
        : undefined;
    if (
      activeChart.type === 'compositeMap' &&
      (!children?.length ||
        children.length !== activeChart.layerChartIds?.length)
    ) {
      setError('Every composite map child needs its saved chart and dataset.');
      return;
    }
    if (
      binding !== 'reference' &&
      activeSource &&
      children?.some((child) => !sourceCompatible(activeSource, child.dataset))
    ) {
      setError(
        'Linked composite maps need every child bound to the active source. Use Reference to add this map without workspace filters.',
      );
      return;
    }
    addAnalyticsMapLayer(
      activeChart,
      activeDataset,
      binding === 'reference',
      children,
    );
    setNotice('Geographic chart added as a native map layer.');
  }

  const quickMetricNeedsSave = Boolean(
    selectedDataset &&
      !selectedDataset.metrics.some(
        (metric) =>
          metric.id ===
          quickMetric(selectedDataset, valueFieldId || '', aggregate).id,
      ),
  );

  return (
    <ScrollArea h="100%" type="auto">
      <Stack gap="sm" p="xs">
        <Group justify="space-between" wrap="nowrap">
          <div>
            <Title order={5}>Analytics</Title>
            <Text c="dimmed" size="xs">
              {activeSource
                ? displaySource(activeSource)
                : 'Choose a map layer or table to analyze.'}
            </Text>
          </div>
          <Group gap={4} wrap="nowrap">
            <ActionIcon
              aria-label="Refresh analytics"
              loading={loadingCatalog}
              onClick={() => {
                refresh();
                void reload();
              }}
              variant="default"
            >
              <IconRefresh size={15} />
            </ActionIcon>
            {onOpenLibrary ? (
              <Button size="xs" onClick={onOpenLibrary} variant="default">
                Library
              </Button>
            ) : null}
          </Group>
        </Group>

        {error ? <Alert color="red">{error}</Alert> : null}
        {notice ? (
          <Alert color="green" withCloseButton onClose={() => setNotice('')}>
            {notice}
          </Alert>
        ) : null}
        {!activeSource ? (
          <Alert color="blue">
            Use Analyze from a layer or table. Saved reference charts can still
            be opened from the Library.
          </Alert>
        ) : null}

        {activeSource && !compatibleDatasets.length ? (
          <Paper p="sm" withBorder>
            <Stack gap="xs">
              <Text size="sm">
                Create a reusable dataset from this source. Column metadata is
                read from the server, not the visible table page.
              </Text>
              <Button
                leftSection={<IconChartBar size={15} />}
                loading={creatingDataset}
                onClick={() => void createDataset()}
                size="xs"
              >
                Analyze this source
              </Button>
            </Stack>
          </Paper>
        ) : null}

        {compatibleDatasets.length ? (
          <Select
            data={compatibleDatasets.map((dataset) => ({
              value: dataset.id,
              label: dataset.name,
            }))}
            label="Source dataset"
            onChange={setDatasetId}
            size="xs"
            value={selectedDataset?.id || null}
          />
        ) : null}

        <Divider label="View" labelPosition="center" />
        <Select
          clearable
          data={charts.map((chart) => ({
            value: chart.id,
            label: `${chart.name} · ${datasets.find((dataset) => dataset.id === chart.datasetId)?.name || 'missing dataset'}`,
          }))}
          label="Saved chart"
          onChange={(id) => {
            setChartId(id);
            if (id) setDashboardId(null);
          }}
          placeholder="Quick chart"
          searchable
          size="xs"
          value={chartId}
        />
        <Select
          clearable
          data={dashboards.map((dashboard) => ({
            value: dashboard.id,
            label: dashboard.name,
          }))}
          label="Saved dashboard"
          onChange={(id) => {
            setDashboardId(id);
            if (id) setChartId(null);
          }}
          placeholder="Choose dashboard"
          searchable
          size="xs"
          value={dashboardId}
        />

        {!selectedChart && !selectedDashboard && selectedDataset ? (
          <Paper p="sm" withBorder>
            <Stack gap="xs">
              <Text fw={600} size="sm">
                Quick chart
              </Text>
              <Select
                data={[
                  { value: 'bar', label: 'Bar chart' },
                  { value: 'line', label: 'Line chart' },
                  { value: 'pie', label: 'Pie chart' },
                  { value: 'kpi', label: 'KPI' },
                ]}
                label="Chart type"
                onChange={(value) => setChartType(value || 'bar')}
                size="xs"
                value={chartType}
              />
              <Select
                clearable
                data={selectedDataset.fields.map((field) => ({
                  value: field.id,
                  label: field.label || field.name,
                }))}
                disabled={chartType === 'kpi'}
                label="Category field"
                onChange={(value) => {
                  setDimensionId(value);
                  if (!value) setChartType('kpi');
                }}
                placeholder="None for KPI"
                size="xs"
                value={chartType === 'kpi' ? null : dimensionId}
              />
              <Select
                data={[
                  { value: 'count', label: 'Count records' },
                  { value: 'sum', label: 'Sum field' },
                  { value: 'avg', label: 'Average field' },
                  { value: 'min', label: 'Minimum field' },
                  { value: 'max', label: 'Maximum field' },
                ]}
                label="Aggregation"
                onChange={(value) => setAggregate(value || 'count')}
                size="xs"
                value={aggregate}
              />
              {aggregate !== 'count' ? (
                <Select
                  data={selectedDataset.fields
                    .filter((field) =>
                      /number|integer|numeric|decimal|float|double|real|int/i.test(
                        field.type,
                      ),
                    )
                    .map((field) => ({
                      value: field.id,
                      label: field.label || field.name,
                    }))}
                  label="Value field"
                  onChange={setValueFieldId}
                  placeholder="Choose numeric field"
                  size="xs"
                  value={valueFieldId}
                />
              ) : null}
              <Button
                disabled={aggregate !== 'count' && !valueFieldId}
                loading={savingChart}
                onClick={() => void saveQuickChart()}
                size="xs"
                variant="default"
              >
                Save & preview
              </Button>
            </Stack>
          </Paper>
        ) : null}

        {activeChart && activeDataset ? (
          <>
            <SegmentedControl
              data={[
                { label: 'Follow', value: 'follow' },
                { label: 'Pinned', value: 'pinned' },
                { label: 'Reference', value: 'reference' },
              ]}
              fullWidth
              onChange={(value) => setBinding(value as Binding)}
              size="xs"
              value={binding}
            />
            <Select
              data={(['all', 'filtered', 'selected', 'extent'] as Scope[]).map(
                (item) => ({
                  value: item,
                  label: scopeLabel(item, selection.length),
                  disabled:
                    item === 'extent' &&
                    (!viewport || !activeSource?.geometryColumn),
                }),
              )}
              disabled={binding === 'reference'}
              label="Scope"
              onChange={(value) => setScope((value || 'all') as Scope)}
              size="xs"
              value={scope}
            />
            {scopeError ? <Alert color="orange">{scopeError}</Alert> : null}
            {scope === 'extent' &&
            (!viewport || !activeSource?.geometryColumn) ? (
              <Alert color="orange">
                Map extent needs a visible geometry layer and current map
                bounds.
              </Alert>
            ) : null}
            {quickMetricNeedsSave && !selectedChart ? (
              <Alert color="blue">
                Save this chart to add its reusable aggregation metric, then its
                preview will use the saved definition.
              </Alert>
            ) : null}
            {scope === 'selected' && !selection.length ? (
              <Alert color="yellow">
                No records selected. This chart intentionally returns no data.
              </Alert>
            ) : null}
            {filters.length ? (
              <Group justify="space-between" wrap="nowrap">
                <Badge color="blue" variant="light">
                  {filters.length} linked filter
                  {filters.length === 1 ? '' : 's'}
                </Badge>
                <Button
                  onClick={clearFilters}
                  size="compact-xs"
                  variant="subtle"
                >
                  Clear filters
                </Button>
              </Group>
            ) : null}
            <Paper p="xs" withBorder>
              <Group justify="space-between" mb={2}>
                <Text fw={600} size="sm" w="100%">
                  {activeChart.name}
                </Text>
                <Button
                  disabled={quickMetricNeedsSave && !selectedChart}
                  leftSection={<IconMapPin size={14} />}
                  onClick={() => {
                    if (
                      !addOverlay(
                        activeChart,
                        activeDataset,
                        binding === 'reference',
                      )
                    ) {
                      setError(
                        'Only a chart bound to the active source can be added as a map overlay.',
                      );
                      return;
                    }
                    setNotice('Chart added to map.');
                  }}
                  size="compact-xs"
                  variant="light"
                >
                  Infographic
                </Button>
                {isGeographicChart(activeChart) ? (
                  <Button
                    disabled={quickMetricNeedsSave && !selectedChart}
                    leftSection={<IconChartBar size={14} />}
                    onClick={addActiveChartAsMapLayer}
                    size="compact-xs"
                    variant="light"
                  >
                    Map layer
                  </Button>
                ) : null}
              </Group>
              {quickMetricNeedsSave && !selectedChart ? null : (
                <ChartPreview
                  allowSharedFilters={canShare && !scopeError}
                  binding={binding}
                  chart={activeChart}
                  dataset={activeDataset}
                  scope={
                    binding === 'reference' ||
                    (binding === 'pinned' && !bindingCompatible)
                      ? 'all'
                      : scope
                  }
                />
              )}
            </Paper>
          </>
        ) : null}

        {selectedDashboard ? (
          <Paper p="xs" withBorder>
            <Group gap="xs" mb="xs">
              <IconLayoutDashboard size={15} />
              <Text fw={600} size="sm">
                {selectedDashboard.name}
              </Text>
            </Group>
            {filters.length &&
            !selectedDashboard.widgets.some((widget) => {
              const chart = charts.find((item) => item.id === widget.chartId);
              return chart?.datasetId === filterDataset?.id;
            }) ? (
              <Alert color="orange" mb="xs">
                Workspace filters are unsupported by this dashboard's datasets.
              </Alert>
            ) : null}
            <DashboardViewer
              dashboard={selectedDashboard}
              charts={charts}
              datasets={datasets}
              filters={dashboardFilters}
              onFiltersChange={changeDashboardFilters}
              query={dashboardQuery}
            />
          </Paper>
        ) : null}

        {analyticsMapLayers.length ? (
          <Paper p="xs" withBorder>
            <Text fw={600} mb="xs" size="sm">
              Native map layers
            </Text>
            <Stack gap="xs">
              {analyticsMapLayers.map((layer) => {
                const errors = Object.entries(analyticsMapLayerErrors)
                  .filter(([key]) => key.startsWith(`${layer.id}:`))
                  .map(([, value]) => value);
                return (
                  <Box key={layer.id}>
                    <Group justify="space-between" wrap="nowrap">
                      <Switch
                        checked={layer.visible}
                        label={layer.name}
                        onChange={(event) =>
                          setAnalyticsMapLayerVisible(
                            layer.id,
                            event.currentTarget.checked,
                          )
                        }
                        size="xs"
                      />
                      <ActionIcon
                        aria-label={`Remove ${layer.name} map layer`}
                        onClick={() => removeAnalyticsMapLayer(layer.id)}
                        size="xs"
                        variant="subtle"
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                    <Text c="dimmed" size="xs">
                      {layer.reference
                        ? 'Reference · all data'
                        : 'Linked · current workspace filters'}
                    </Text>
                    {errors.map((message) => (
                      <Text c="red" key={message} size="xs">
                        {message}
                      </Text>
                    ))}
                  </Box>
                );
              })}
            </Stack>
          </Paper>
        ) : null}
      </Stack>
    </ScrollArea>
  );
}

interface OverlayRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

function defaultOverlayRect(index: number): OverlayRect {
  return { x: 16 + index * 18, y: 16 + index * 18, width: 330, height: 230 };
}

function MapOverlay({
  overlay,
  index,
}: {
  overlay: WorkspaceOverlay;
  index: number;
}) {
  const removeOverlay = useWorkspaceAnalyticsStore(
    (state) => state.removeOverlay,
  );
  const updateOverlayRect = useWorkspaceAnalyticsStore(
    (state) => state.updateOverlayRect,
  );
  const refreshVersion = useWorkspaceAnalyticsStore(
    (state) => state.refreshVersion,
  );
  const filters = useWorkspaceAnalyticsStore((state) => state.filters);
  const filterDataset = useWorkspaceAnalyticsStore(
    (state) => state.filterDataset,
  );
  const rect = overlay.rect || defaultOverlayRect(index);
  const query = useChartQuery(
    overlay.chart,
    overlay.dataset,
    overlay.reference ? emptyFilters : filters,
    emptySelection,
    overlay.reference ? 'all' : 'filtered',
    refreshVersion,
    !overlay.reference,
  );
  const drag = useRef<{
    x: number;
    y: number;
    rect: OverlayRect;
    resize: boolean;
  } | null>(null);
  const persist = useCallback(
    (next: OverlayRect) => updateOverlayRect(overlay.id, next),
    [overlay.id, updateOverlayRect],
  );
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      const dx = event.clientX - state.x;
      const dy = event.clientY - state.y;
      persist(
        state.resize
          ? {
              ...state.rect,
              width: Math.max(220, state.rect.width + dx),
              height: Math.max(150, state.rect.height + dy),
            }
          : {
              ...state.rect,
              x: Math.max(0, state.rect.x + dx),
              y: Math.max(0, state.rect.y + dy),
            },
      );
    };
    const end = () => {
      drag.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
  }, [persist]);
  return (
    <Paper
      shadow="md"
      style={{
        height: rect.height,
        left: rect.x,
        overflow: 'hidden',
        pointerEvents: 'auto',
        position: 'absolute',
        top: rect.y,
        width: rect.width,
        zIndex: 4,
      }}
      withBorder
    >
      <Group
        justify="space-between"
        onPointerDown={(event) => {
          event.stopPropagation();
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            rect,
            resize: false,
          };
        }}
        px="xs"
        py={4}
        style={{
          background: 'var(--mantine-color-body)',
          cursor: 'move',
          touchAction: 'none',
        }}
        wrap="nowrap"
      >
        <Text lineClamp={1} size="xs" fw={600}>
          {overlay.chart.name}
        </Text>
        <Group gap={2} wrap="nowrap">
          <Text c="dimmed" size="xs">
            {overlay.reference
              ? 'Reference · all'
              : filterDataset
                ? 'Linked · filtered'
                : 'Linked · source'}
          </Text>
          <ActionIcon
            aria-label="Remove map chart"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => removeOverlay(overlay.id)}
            size="xs"
            variant="subtle"
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      </Group>
      <Box px="xs">
        <ChartRenderer
          chart={overlay.chart}
          data={query.result}
          error={query.error}
          height={Math.max(105, rect.height - 42)}
          loading={query.loading}
        />
      </Box>
      <Box
        onPointerDown={(event) => {
          event.stopPropagation();
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            rect,
            resize: true,
          };
        }}
        style={{
          bottom: 0,
          cursor: 'nwse-resize',
          height: 18,
          position: 'absolute',
          right: 0,
          touchAction: 'none',
          width: 18,
        }}
      />
    </Paper>
  );
}

export function WorkspaceAnalyticsOverlays() {
  const overlays = useWorkspaceAnalyticsStore((state) => state.overlays);
  const activeSource = useWorkspaceAnalyticsStore(
    (state) => state.activeSource,
  );
  const visible = overlaysForSource(overlays, activeSource);
  if (!visible.length) return null;
  return (
    <Box
      style={{
        inset: 0,
        pointerEvents: 'none',
        position: 'absolute',
        zIndex: 3,
      }}
    >
      {visible.map((overlay, index) => (
        <MapOverlay index={index} key={overlay.id} overlay={overlay} />
      ))}
    </Box>
  );
}
