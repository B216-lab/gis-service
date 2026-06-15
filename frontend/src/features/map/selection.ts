export interface RowReference {
  primaryKey: string[];
  rowKey: Record<string, unknown>;
}

export type MapSelectionObjectType = 'feature' | 'flow' | 'location';

export interface MapSelection {
  layerId: string;
  layerName: string;
  sourceId: string;
  sourceType: 'geojson-table' | 'flowmap-table';
  sourceFullName: string;
  schema: string;
  table: string;
  objectType: MapSelectionObjectType;
  rowRefs: RowReference[];
  inlineProperties: Record<string, unknown> | null;
  featureKey?: string;
  title: string;
}
