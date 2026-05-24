import type { DatabaseConnection, ImportedLayer } from '../connections/store';

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

export async function fetchLayerFeatures(
  connection: DatabaseConnection,
  layer: ImportedLayer,
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
      schema: layer.schema,
      table: layer.table,
      geometryColumn: layer.geometryColumn,
      limit: 2000,
    }),
  });

  const payload = (await response.json()) as
    | LayerFeaturesResponse
    | {
        error: {
          code: string;
          message: string;
        };
      };

  if (!response.ok || 'error' in payload) {
    throw new Error(
      'error' in payload
        ? payload.error.message
        : 'Failed to load layer features.',
    );
  }

  return payload;
}
