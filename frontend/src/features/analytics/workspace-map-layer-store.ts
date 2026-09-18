import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Chart, Dataset, QueryResult } from './types';

export interface WorkspaceAnalyticsMapLayer {
  chart: Chart;
  children?: { chart: Chart; dataset: Dataset }[];
  dataset: Dataset;
  id: string;
  name: string;
  reference: boolean;
  visible: boolean;
}

export interface WorkspaceAnalyticsMapLayerResult {
  chart: Chart;
  data: QueryResult;
  dataset: Dataset;
}

interface WorkspaceAnalyticsMapLayerState {
  layers: WorkspaceAnalyticsMapLayer[];
  errors: Record<string, string>;
  results: Record<string, WorkspaceAnalyticsMapLayerResult[]>;
  addLayer: (
    chart: Chart,
    dataset: Dataset,
    reference: boolean,
    children?: { chart: Chart; dataset: Dataset }[],
  ) => void;
  removeLayer: (id: string) => void;
  setVisible: (id: string, visible: boolean) => void;
  setResult: (
    id: string,
    chartId: string,
    result: WorkspaceAnalyticsMapLayerResult | null,
  ) => void;
  setError: (id: string, chartId: string, error: string) => void;
}

export function isGeographicChart(chart: Chart) {
  return ['geoHeatmap', 'geoArc', 'compositeMap'].includes(chart.type);
}

export const useWorkspaceAnalyticsMapLayerStore =
  create<WorkspaceAnalyticsMapLayerState>()(
    persist(
      (set) => ({
        layers: [],
        errors: {},
        results: {},
        addLayer: (chart, dataset, reference, children) =>
          set((state) => ({
            layers: [
              ...state.layers,
              {
                id: crypto.randomUUID(),
                name: chart.name,
                chart,
                children,
                dataset,
                reference,
                visible: true,
              },
            ],
          })),
        removeLayer: (id) =>
          set((state) => ({
            layers: state.layers.filter((layer) => layer.id !== id),
            results: Object.fromEntries(
              Object.entries(state.results).filter(([key]) => key !== id),
            ),
            errors: Object.fromEntries(
              Object.entries(state.errors).filter(
                ([key]) => !key.startsWith(`${id}:`),
              ),
            ),
          })),
        setResult: (id, chartId, result) =>
          set((state) => {
            if (!state.layers.some((layer) => layer.id === id)) return state;
            const current = state.results[id] || [];
            const next = result
              ? [...current.filter((item) => item.chart.id !== chartId), result]
              : current.filter((item) => item.chart.id !== chartId);
            return { results: { ...state.results, [id]: next } };
          }),
        setError: (id, chartId, error) =>
          set((state) => {
            if (!state.layers.some((layer) => layer.id === id)) return state;
            const key = `${id}:${chartId}`;
            const errors = { ...state.errors };
            if (error) errors[key] = error;
            else delete errors[key];
            return { errors };
          }),
        setVisible: (id, visible) =>
          set((state) => ({
            layers: state.layers.map((layer) =>
              layer.id === id ? { ...layer, visible } : layer,
            ),
          })),
      }),
      {
        name: 'geopanel-analytics-map-layers-v1',
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({ layers: state.layers }),
      },
    ),
  );
