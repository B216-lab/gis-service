import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type {
  FlowmapTableSource,
  LayerSpatialFilter,
} from '../connections/model';
import type { TableFilterDefinition } from '../filters/types';
import type { GeoBounds } from '../map/api';
import type { RowReference } from '../map/selection';
import type { Chart, Dataset, Filter } from './types';

/** Physical table currently being analysed in workspace dock. */
export interface WorkspaceSource {
  connectionId: string;
  schema: string;
  table: string;
  name: string;
  filter?: TableFilterDefinition | null;
  spatialFilter?: LayerSpatialFilter | null;
  layerId?: string;
  geometryColumn?: string;
  flowColumns?: FlowmapTableSource['columns'];
}

export interface WorkspaceOverlay {
  id: string;
  chart: Chart;
  dataset: Dataset;
  /** Reference overlays deliberately stay visible across active sources. */
  reference: boolean;
  rect?: WorkspaceOverlayRect;
}

export interface WorkspaceOverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const minOverlayWidth = 220;
const minOverlayHeight = 150;
const maxOverlayWidth = 2000;
const maxOverlayHeight = 1600;

export interface AnalyticsWorkspaceState {
  activeSource: WorkspaceSource | null;
  selection: RowReference[];
  filters: Filter[];
  filterDataset: Dataset | null;
  viewport: GeoBounds | null;
  refreshVersion: number;
  overlays: WorkspaceOverlay[];
  setSource: (source: WorkspaceSource | null) => void;
  setSelection: (rows: RowReference[]) => void;
  setFilters: (filters: Filter[], dataset: Dataset | null) => void;
  clearFilters: () => void;
  refresh: () => void;
  addOverlay: (chart: Chart, dataset: Dataset, reference: boolean) => boolean;
  removeOverlay: (id: string) => void;
  updateOverlayRect: (id: string, rect: WorkspaceOverlayRect) => void;
  setViewport: (bounds: GeoBounds | null) => void;
}

export function sourceCompatible(
  source: WorkspaceSource | null,
  dataset: Dataset | null,
): boolean {
  if (!source || !dataset) return false;
  return (
    dataset.connectionId === source.connectionId &&
    dataset.schema === source.schema &&
    dataset.table === source.table &&
    !dataset.sql
  );
}

export function samePhysicalSource(
  left: WorkspaceSource | null,
  right: WorkspaceSource | null,
): boolean {
  return Boolean(
    left &&
      right &&
      left.connectionId === right.connectionId &&
      left.schema === right.schema &&
      left.table === right.table,
  );
}

export function sanitizeOverlayRect(
  rect: WorkspaceOverlayRect | null | undefined,
): WorkspaceOverlayRect | undefined {
  if (
    !rect ||
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
  ) {
    return undefined;
  }
  return {
    x: Math.max(0, rect.x),
    y: Math.max(0, rect.y),
    width: Math.min(maxOverlayWidth, Math.max(minOverlayWidth, rect.width)),
    height: Math.min(maxOverlayHeight, Math.max(minOverlayHeight, rect.height)),
  };
}

export function sanitizePersistedOverlays(value: unknown): WorkspaceOverlay[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      !('id' in candidate) ||
      !('chart' in candidate) ||
      !('dataset' in candidate) ||
      !('reference' in candidate) ||
      typeof candidate.id !== 'string' ||
      typeof candidate.reference !== 'boolean' ||
      !candidate.chart ||
      typeof candidate.chart !== 'object' ||
      !candidate.dataset ||
      typeof candidate.dataset !== 'object'
    ) {
      return [];
    }
    const overlay = candidate as WorkspaceOverlay;
    return [{ ...overlay, rect: sanitizeOverlayRect(overlay.rect) }];
  });
}

export function overlaysForSource(
  overlays: WorkspaceOverlay[],
  source: WorkspaceSource | null,
): WorkspaceOverlay[] {
  return overlays.filter(
    (overlay) => overlay.reference || sourceCompatible(source, overlay.dataset),
  );
}

export const useWorkspaceAnalyticsStore = create<AnalyticsWorkspaceState>()(
  persist(
    (set, get) => ({
      activeSource: null,
      selection: [],
      filters: [],
      filterDataset: null,
      viewport: null,
      refreshVersion: 0,
      overlays: [],
      setSource: (source) =>
        set((state) => ({
          activeSource: source,
          // Filters only make sense for their bound dataset/source.
          ...(sourceCompatible(source, state.filterDataset)
            ? {}
            : { filters: [], filterDataset: null }),
          selection: samePhysicalSource(state.activeSource, source)
            ? state.selection
            : [],
        })),
      setSelection: (selection) => set({ selection }),
      setFilters: (filters, filterDataset) =>
        set((state) =>
          sourceCompatible(state.activeSource, filterDataset)
            ? { filters, filterDataset }
            : { filters: [], filterDataset: null },
        ),
      clearFilters: () => set({ filters: [], filterDataset: null }),
      refresh: () =>
        set((state) => ({ refreshVersion: state.refreshVersion + 1 })),
      addOverlay: (chart, dataset, reference) => {
        if (!reference && !sourceCompatible(get().activeSource, dataset)) {
          return false;
        }
        const overlay: WorkspaceOverlay = {
          id: crypto.randomUUID(),
          chart,
          dataset,
          reference,
        };
        set((state) => ({ overlays: [...state.overlays, overlay] }));
        return true;
      },
      removeOverlay: (id) =>
        set((state) => ({
          overlays: state.overlays.filter((overlay) => overlay.id !== id),
        })),
      updateOverlayRect: (id, rect) =>
        set((state) => {
          const sanitized = sanitizeOverlayRect(rect);
          if (!sanitized) return state;
          return {
            overlays: state.overlays.map((overlay) =>
              overlay.id === id ? { ...overlay, rect: sanitized } : overlay,
            ),
          };
        }),
      setViewport: (viewport) => set({ viewport }),
    }),
    {
      name: 'geopanel-analytics-overlays-v1',
      storage: createJSONStorage(() => localStorage),
      // Source, selection and filters are live workspace state. Only saved visual
      // references belong in local storage.
      partialize: (state) => ({ overlays: state.overlays }),
      merge: (persisted, current) => {
        const cached = persisted as { overlays?: unknown } | undefined;
        return {
          ...current,
          overlays: sanitizePersistedOverlays(cached?.overlays),
        };
      },
    },
  ),
);
