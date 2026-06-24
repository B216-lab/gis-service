import type {
  DatabaseConnection,
  FlowmapTableSource,
  GeoJsonTableSource,
} from '../connections/store';
import type { RowReference } from './selection';

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export interface GeoJsonFeature {
  type: 'Feature';
  geometry: GeoJsonGeometry | null;
  properties: Record<string, unknown> & {
    __geopanel?: {
      rowRef: RowReference | null;
    };
  };
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
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

export interface LayerExtentResponse {
  schema: string;
  table: string;
  geometryColumn: string;
  geometryType: string;
  srid: number;
  bounds: GeoBounds | null;
}

export interface LayerTileSourceResponse {
  token: string;
  tiles: string[];
  sourceLayer: string;
}

export interface CreateFeatureResponse {
  schema: string;
  table: string;
}

export interface FlowmapLocation {
  id: string;
  lat: number;
  lon: number;
  name: string;
  rowRefs: RowReference[];
}

export interface FlowmapFlow {
  originId: string;
  destId: string;
  magnitude: number;
  rowRef: RowReference | null;
}

export interface FlowmapDataResponse {
  schema: string;
  table: string;
  flowCount: number;
  locationCount: number;
  locations: FlowmapLocation[];
  flows: FlowmapFlow[];
}

export interface LocateFeatureResponse {
  schema: string;
  table: string;
  geometryColumn: string;
  geometryType: string;
  srid: number;
  feature: GeoJsonFeature;
  bounds: GeoBounds | null;
  rowRef: RowReference;
  featureKey: string;
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

function connectionPayload(connection: DatabaseConnection) {
  return {
    name: connection.name,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    password: connection.password,
  };
}

function normalizeTileTemplateUrl(tileUrl: string) {
  if (/^https?:\/\//i.test(tileUrl)) {
    return tileUrl;
  }

  const normalizedPath = tileUrl.startsWith('/') ? tileUrl : `/${tileUrl}`;

  return `${window.location.origin}${normalizedPath}`;
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
  bounds: GeoBounds,
  zoom: number | null,
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
      filter: source.filter ?? null,
      spatialFilter: source.spatialFilter ?? null,
      limit: 5000,
      zoom,
      west: bounds.west,
      south: bounds.south,
      east: bounds.east,
      north: bounds.north,
    }),
  });

  return decodePayload<LayerFeaturesResponse>(
    response,
    'Failed to load layer features.',
  );
}

export async function fetchGeoJsonSourceExtent(
  connection: DatabaseConnection,
  source: GeoJsonTableSource,
  signal?: AbortSignal,
) {
  const response = await fetch('/api/v1/database-connections/layer-extent', {
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
      filter: source.filter ?? null,
      spatialFilter: source.spatialFilter ?? null,
    }),
  });

  return decodePayload<LayerExtentResponse>(
    response,
    'Failed to load layer extent.',
  );
}

export async function registerVectorTileSource(
  connection: DatabaseConnection,
  source: GeoJsonTableSource,
  signal?: AbortSignal,
) {
  const response = await fetch(
    '/api/v1/database-connections/layer-tile-source',
    {
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
        filter: source.filter ?? null,
        spatialFilter: source.spatialFilter ?? null,
      }),
    },
  );

  const payload = await decodePayload<LayerTileSourceResponse>(
    response,
    'Failed to register vector tile source.',
  );

  return {
    ...payload,
    tiles: payload.tiles.map(normalizeTileTemplateUrl),
  };
}

export async function createPolygonFeature(
  connection: DatabaseConnection,
  payload: {
    schema: string;
    table: string;
    geometryColumn: string;
    geometry: GeoJsonGeometry;
    values: Record<string, unknown>;
  },
  signal?: AbortSignal,
) {
  const response = await fetch('/api/v1/database-connections/features', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...connectionPayload(connection),
      schema: payload.schema,
      table: payload.table,
      geometryColumn: payload.geometryColumn,
      geometry: payload.geometry,
      values: payload.values,
    }),
  });

  return await decodePayload<CreateFeatureResponse>(
    response,
    'Failed to create feature.',
  );
}

export async function locateGeoJsonFeature(
  connection: DatabaseConnection,
  payload: {
    schema: string;
    table: string;
    geometryColumn: string;
    rowKey: Record<string, unknown>;
  },
  signal?: AbortSignal,
) {
  const response = await fetch('/api/v1/database-connections/features/locate', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...connectionPayload(connection),
      schema: payload.schema,
      table: payload.table,
      geometryColumn: payload.geometryColumn,
      rowKey: payload.rowKey,
    }),
  });

  return decodePayload<LocateFeatureResponse>(
    response,
    'Failed to locate feature.',
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
      spatialFilter: source.spatialFilter ?? null,
      limit: 5000,
    }),
  });

  return decodePayload<FlowmapDataResponse>(
    response,
    'Failed to load flowmap source data.',
  );
}
