import type {
  DatabaseConnection,
  FlowmapTableSource,
  GeoJsonTableSource,
} from '../connections/store';

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export interface GeoJsonFeature {
  type: 'Feature';
  geometry: GeoJsonGeometry | null;
  properties: Record<string, unknown>;
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

export interface LayerFeaturesResponse {
  schema: string;
  table: string;
  geometryColumn: string;
  geometryType: string;
  srid: number;
  featureCount: number;
  data: GeoJsonFeatureCollection;
}

export interface FlowmapLocation {
  id: string;
  lat: number;
  lon: number;
  name: string;
}

export interface FlowmapFlow {
  originId: string;
  destId: string;
  magnitude: number;
}

export interface FlowmapDataResponse {
  schema: string;
  table: string;
  flowCount: number;
  locationCount: number;
  locations: FlowmapLocation[];
  flows: FlowmapFlow[];
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

async function decodePayload<T extends object>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const payload = (await response.json()) as T | ErrorResponse;

  if (!response.ok || 'error' in payload) {
    throw new Error(
      'error' in payload ? payload.error.message : fallbackMessage,
    );
  }

  return payload;
}

export async function fetchGeoJsonSourceData(
  connection: DatabaseConnection,
  source: GeoJsonTableSource,
  signal?: AbortSignal,
) {
  const response = await fetch('/api/v1/database-connections/layer-features', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: connection.name,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.user,
      password: connection.password,
      schema: source.schema,
      table: source.table,
      geometryColumn: source.geometryColumn,
      limit: 2000,
    }),
  });

  return decodePayload<LayerFeaturesResponse>(
    response,
    'Failed to load layer features.',
  );
}

export async function fetchFlowmapSourceData(
  connection: DatabaseConnection,
  source: FlowmapTableSource,
  signal?: AbortSignal,
) {
  const response = await fetch('/api/v1/database-connections/flowmap-data', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: connection.name,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.user,
      password: connection.password,
      schema: source.schema,
      table: source.table,
      startMode: source.columns.startMode,
      startLonColumn: source.columns.startLon,
      startLatColumn: source.columns.startLat,
      startGeometryColumn: source.columns.startGeometry,
      endMode: source.columns.endMode,
      endLonColumn: source.columns.endLon,
      endLatColumn: source.columns.endLat,
      endGeometryColumn: source.columns.endGeometry,
      magnitudeColumn: source.columns.magnitude,
      defaultMagnitude: source.columns.defaultMagnitude,
      limit: 5000,
    }),
  });

  return decodePayload<FlowmapDataResponse>(
    response,
    'Failed to load flowmap source data.',
  );
}
