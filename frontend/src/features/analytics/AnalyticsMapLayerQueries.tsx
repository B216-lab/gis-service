import { useEffect } from 'react';
import type { Chart, Dataset } from './types';
import { useChartQuery } from './WorkspaceAnalytics';
import {
  useWorkspaceAnalyticsMapLayerStore,
  type WorkspaceAnalyticsMapLayer,
} from './workspace-map-layer-store';
import {
  sourceCompatible,
  useWorkspaceAnalyticsStore,
} from './workspace-store';

const emptyFilters: [] = [];
const emptySelection: [] = [];

function ChartQuery({
  chart,
  dataset,
  layerId,
  reference,
}: {
  chart: Chart;
  dataset: Dataset;
  layerId: string;
  reference: boolean;
}) {
  const filters = useWorkspaceAnalyticsStore((state) => state.filters);
  const refreshVersion = useWorkspaceAnalyticsStore(
    (state) => state.refreshVersion,
  );
  const setResult = useWorkspaceAnalyticsMapLayerStore(
    (state) => state.setResult,
  );
  const setError = useWorkspaceAnalyticsMapLayerStore(
    (state) => state.setError,
  );
  const query = useChartQuery(
    chart,
    dataset,
    reference ? emptyFilters : filters,
    emptySelection,
    reference ? 'all' : 'filtered',
    refreshVersion,
    !reference,
    `workspace-map:${layerId}`,
  );
  useEffect(() => {
    setResult(
      layerId,
      chart.id,
      query.result ? { chart, dataset, data: query.result } : null,
    );
    return () => setResult(layerId, chart.id, null);
  }, [chart, dataset, layerId, query.result, setResult]);
  useEffect(() => {
    setError(layerId, chart.id, query.error);
    return () => setError(layerId, chart.id, '');
  }, [chart.id, layerId, query.error, setError]);
  return null;
}

function LayerQueries({ layer }: { layer: WorkspaceAnalyticsMapLayer }) {
  const activeSource = useWorkspaceAnalyticsStore(
    (state) => state.activeSource,
  );
  if (!layer.reference && !sourceCompatible(activeSource, layer.dataset)) {
    return null;
  }
  const entries =
    layer.chart.type === 'compositeMap'
      ? layer.children || []
      : [{ chart: layer.chart, dataset: layer.dataset }];
  return entries.map((entry) => (
    <ChartQuery
      chart={entry.chart}
      dataset={entry.dataset}
      key={entry.chart.id}
      layerId={layer.id}
      reference={layer.reference}
    />
  ));
}

export function AnalyticsMapLayerQueries() {
  const layers = useWorkspaceAnalyticsMapLayerStore((state) => state.layers);
  return layers
    .filter((layer) => layer.visible)
    .map((layer) => <LayerQueries key={layer.id} layer={layer} />);
}
