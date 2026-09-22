export interface Metadata {
  id: string;
  name: string;
  revision: number;
  updatedAt?: string;
}
export interface Field {
  label?: string;
  id: string;
  name: string;
  type: string;
  expression?: string;
  semanticId?: string;
  role?: string;
  format?: string;
}
export interface Metric {
  id: string;
  name: string;
  expression: string;
  format?: string;
}
export interface Relationship {
  id: string;
  targetDatasetId: string;
  sourceFieldId: string;
  targetFieldId: string;
  cardinality: string;
  allowFiltering: boolean;
}
export interface Dataset extends Metadata {
  connectionId: string;
  sql?: string;
  schema?: string;
  table?: string;
  grain?: string;
  fields: Field[];
  metrics: Metric[];
  relationships?: Relationship[];
  defaultTimeFieldId?: string;
}
export interface Filter {
  anyOf?: Filter[][];
  fieldId: string;
  operator: string;
  values?: unknown[];
  datasetId?: string;
  sourceWidgetId?: string;
  targetWidgetIds?: string[];
}
export interface Query {
  having?: Filter[];
  datasetId: string;
  dimensions?: string[];
  metrics?: string[];
  filters?: Filter[];
  sort?: { fieldId: string; desc: boolean }[];
  limit?: number;
  timeFieldId?: string;
  timeGrain?: string;
}
export interface Chart extends Metadata {
  datasetId: string;
  type: string;
  query: Query;
  options?: Record<string, unknown>;
  layerChartIds?: string[];
}
export interface Widget {
  filterTargetWidgetIds?: string[];
  id: string;
  chartId?: string;
  text?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Dashboard extends Metadata {
  refreshIntervalSeconds?: number;
  nativeFilters?: NativeFilter[];
  widgets: Widget[];
  filters?: Filter[];
  description?: string;
}
export interface DashboardBundle {
  format: 'geopanel-dashboard';
  version: 1;
  exportedAt: string;
  dashboard: Dashboard;
  charts: Chart[];
  datasets: Dataset[];
}
export interface DashboardImportReport {
  dashboardId: string;
  datasetIds: string[];
  chartIds: string[];
  created: number;
  updated: number;
}
export interface Connection {
  id: string;
  name: string;
}
export interface QueryResult {
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
  truncated?: boolean;
  limit?: number;
}

export interface Publication extends Metadata {
  dashboard: Dashboard;
  charts: Chart[];
  datasets: Dataset[];
  filters?: Filter[];
}
export interface Share extends Metadata {
  publicationId: string;
  expiresAt?: string;
  revoked: boolean;
  filters?: Filter[];
}

export interface NativeFilter {
  id: string;
  name: string;
  datasetId: string;
  fieldId: string;
  targetWidgetIds?: string[];
}
