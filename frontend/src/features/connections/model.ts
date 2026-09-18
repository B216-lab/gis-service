import type { TableFilterDefinition } from '../filters/types';
import type { RowReference } from '../map/selection';

export interface DatabaseConnection {
  id: string;
  name: string;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  isServerManaged: boolean;
  isActive: boolean;
  createdAt: string;
  testStatus: 'idle' | 'testing' | 'success' | 'error';
  testMessage: string;
  postgresVersion: string;
  postgisVersion: string;
}

export type LayerGlyphIcon = 'circle' | 'square' | 'diamond' | 'line' | 'flow';
export type SpatialFilterPredicate = 'intersects' | 'within';

export interface LayerSpatialFilter {
  sourceLayerId: string;
  sourceLayerName: string;
  sourceSchema: string;
  sourceTable: string;
  sourceGeometryColumn: string;
  rowRefs: RowReference[];
  predicate: SpatialFilterPredicate;
}

export interface GeoJsonTableSource {
  id: string;
  type: 'geojson-table';
  connectionId: string;
  schema: string;
  table: string;
  fullName: string;
  kind: string;
  geometryColumn: string;
  geometryType: string;
  filter?: TableFilterDefinition | null;
  spatialFilter?: LayerSpatialFilter | null;
  sourceViewId?: string | null;
  refreshKey?: string;
}

export interface FlowmapTableSource {
  id: string;
  type: 'flowmap-table';
  connectionId: string;
  schema: string;
  table: string;
  fullName: string;
  kind: string;
  filter?: TableFilterDefinition | null;
  columns: {
    startMode: 'coordinates' | 'geometry';
    startLon: string;
    startLat: string;
    startGeometry: string;
    endMode: 'coordinates' | 'geometry';
    endLon: string;
    endLat: string;
    endGeometry: string;
    magnitude: string;
    defaultMagnitude: number;
  };
  spatialFilter?: LayerSpatialFilter | null;
  rowRef?: RowReference | null;
  refreshKey?: string;
}

export type MapSource = GeoJsonTableSource | FlowmapTableSource;

export type MapLayerPurpose = 'configured' | 'record-preview';

interface BaseMapLayer {
  id: string;
  connectionId: string;
  sourceId: string;
  name: string;
  tooltipEnabled: boolean;
  visible: boolean;
  icon: LayerGlyphIcon;
  purpose: MapLayerPurpose;
}

export interface GeoJsonMapLayer extends BaseMapLayer {
  type: 'geojson';
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
  pointRadius: number;
}

export interface FlowmapMapLayer extends BaseMapLayer {
  type: 'flowmap';
  style: {
    flowLinesRenderingMode: 'straight' | 'curved' | 'animated-straight';
    flowLineThicknessScale: number;
    clusteringEnabled: boolean;
    clusteringAuto: boolean;
    locationsEnabled: boolean;
    locationTotalsEnabled: boolean;
    locationLabelsEnabled: boolean;
    maxTopFlowsDisplayNum: number;
    colorScheme: string;
    darkMode: boolean;
  };
}

export interface ArcMapLayer extends BaseMapLayer {
  type: 'arc';
  color: string;
  opacity: number;
  width: number;
}

export type MapLayer = GeoJsonMapLayer | FlowmapMapLayer | ArcMapLayer;

export interface RelationDisplayConfig {
  labelColumns: string[];
}

export interface TableDisplayConfig {
  tableAlias?: string;
  columnLabels: Record<string, string>;
  hiddenColumns: string[];
}

export interface LegacyImportedLayer {
  id: string;
  connectionId: string;
  schema: string;
  table: string;
  fullName: string;
  kind: string;
  name: string;
  icon: 'circle' | 'square' | 'diamond' | 'line';
  color: string;
  opacity: number;
  visible: boolean;
  geometryColumn: string;
  geometryType: string;
}
