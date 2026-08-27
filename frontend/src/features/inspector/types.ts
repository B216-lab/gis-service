import type { DraftInsertRow } from '../app/app-utils';
import type {
  ArcMapLayer,
  FlowmapMapLayer,
  FlowmapTableSource,
  GeoJsonMapLayer,
  GeoJsonTableSource,
} from '../connections/store';
import type { InspectorRow } from './api';

export type InspectorGridRow =
  | {
      id: string;
      kind: 'draft';
      draftRow: DraftInsertRow;
      row: null;
      rowPatch: undefined;
      rowToken: null;
      values: Record<string, unknown>;
      isDeleted: false;
    }
  | {
      id: string;
      kind: 'record';
      draftRow: null;
      row: InspectorRow;
      rowPatch: Record<string, unknown> | undefined;
      rowToken: string | null;
      values: Record<string, unknown>;
      isDeleted: boolean;
    };

export interface GeoJsonLocateTarget {
  kind: 'geojson';
  layer: GeoJsonMapLayer;
  source: GeoJsonTableSource;
}

export interface FlowmapLocateTarget {
  kind: 'flowmap';
  layer: FlowmapMapLayer | ArcMapLayer;
  source: FlowmapTableSource;
}

export type LocateTarget = GeoJsonLocateTarget | FlowmapLocateTarget;
