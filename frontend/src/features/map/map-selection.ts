import type { MapGeoJSONFeature } from 'maplibre-gl';

import type {
  GeoJsonMapLayer,
  GeoJsonTableSource,
  MapLayer,
  MapSource,
} from '../connections/store';
import type { MapSelection, RowReference } from './selection';
import { getVectorStyleLayerIds } from './vector-layers';

export type FeaturePickCandidate = {
  id: string;
  selection: MapSelection;
  layer: GeoJsonMapLayer;
  source: GeoJsonTableSource;
  label: string;
  detail: string;
};

export type FeaturePickState = {
  x: number;
  y: number;
  candidates: FeaturePickCandidate[];
};

export const maxFeaturePickCandidates = 50;

export function parseJSONProperty(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractRowRefs(
  rowRef: RowReference | null | undefined,
  rowRefs: RowReference[] | null | undefined,
) {
  if (rowRefs && rowRefs.length > 0) {
    return rowRefs;
  }

  return rowRef ? [rowRef] : [];
}

function formatFeatureProperty(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'object') {
    return null;
  }

  return String(value);
}

function formatFeatureRowKey(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const parts = Object.entries(value)
    .slice(0, 3)
    .map(([key, item]) => `${key}=${formatFeatureProperty(item) ?? '?'}`);

  if (parts.length === 0) {
    return null;
  }

  return `row: ${parts.join(', ')}`;
}

function getFeatureDisplayDetail(feature: MapGeoJSONFeature) {
  const properties = feature.properties ?? {};
  const labelColumns = [
    'name',
    'title',
    'label',
    'display_name',
    'official_name',
    'name_en',
  ];
  const nameLabel =
    labelColumns
      .map((column) => formatFeatureProperty(properties[column]))
      .find(Boolean) ?? null;
  const rowKey = formatFeatureRowKey(
    parseJSONProperty(properties._geopanel_row_key),
  );
  const geometryType = feature.geometry?.type ?? 'Feature';

  return [nameLabel, rowKey, geometryType].filter(Boolean).join(' • ');
}

function getFeatureIdentity(feature: MapGeoJSONFeature) {
  const rowKey =
    typeof feature.properties?._geopanel_row_key === 'string'
      ? feature.properties._geopanel_row_key
      : null;

  if (rowKey) {
    return rowKey;
  }

  if (feature.id !== undefined && feature.id !== null) {
    return String(feature.id);
  }

  return JSON.stringify(feature.properties ?? {});
}

export function buildVectorMapSelection(
  feature: MapGeoJSONFeature,
  layer: GeoJsonMapLayer,
  source: GeoJsonTableSource,
): MapSelection {
  const properties = { ...(feature.properties ?? {}) };
  const primaryKey = parseJSONProperty(properties._geopanel_primary_key);
  const rowKey = parseJSONProperty(properties._geopanel_row_key);
  const featureKey =
    typeof properties._geopanel_row_key === 'string'
      ? properties._geopanel_row_key
      : undefined;
  delete properties._geopanel_primary_key;
  delete properties._geopanel_row_key;
  delete properties._geopanel_empty;

  const rowRef =
    Array.isArray(primaryKey) &&
    primaryKey.every((value) => typeof value === 'string') &&
    rowKey &&
    typeof rowKey === 'object' &&
    !Array.isArray(rowKey)
      ? {
          primaryKey,
          rowKey: rowKey as Record<string, unknown>,
        }
      : null;

  return {
    layerId: layer.id,
    layerName: layer.name,
    sourceId: source.id,
    sourceType: source.type,
    sourceFullName: source.fullName,
    schema: source.schema,
    table: source.table,
    objectType: 'feature',
    rowRefs: rowRef ? [rowRef] : [],
    inlineProperties: properties,
    featureKey,
    title: layer.name,
  };
}

export function buildFeaturePickCandidates(params: {
  activeLayerId: string | null;
  features: MapGeoJSONFeature[];
  layers: GeoJsonMapLayer[];
  sources: MapSource[];
}) {
  const { activeLayerId, features, layers, sources } = params;
  const candidates: FeaturePickCandidate[] = [];
  const seenCandidateIds = new Set<string>();

  for (const feature of features) {
    if (!feature.layer.id) {
      continue;
    }

    const layer = layers.find((candidate) =>
      getVectorStyleLayerIds(candidate).includes(feature.layer.id),
    );
    if (!layer) {
      continue;
    }

    const source = sources.find(
      (candidate): candidate is GeoJsonTableSource =>
        candidate.id === layer.sourceId && candidate.type === 'geojson-table',
    );
    if (!source) {
      continue;
    }

    const id = `${layer.id}:${source.id}:${getFeatureIdentity(feature)}`;
    if (seenCandidateIds.has(id)) {
      continue;
    }

    seenCandidateIds.add(id);
    candidates.push({
      id,
      layer,
      source,
      selection: buildVectorMapSelection(feature, layer, source),
      label: layer.name,
      detail: getFeatureDisplayDetail(feature),
    });
  }

  candidates.sort((left, right) => {
    if (left.layer.id === activeLayerId && right.layer.id !== activeLayerId) {
      return -1;
    }

    if (right.layer.id === activeLayerId && left.layer.id !== activeLayerId) {
      return 1;
    }

    return 0;
  });

  return candidates.slice(0, maxFeaturePickCandidates);
}

export function buildMapSelection(
  pickedObject: unknown,
  layer: MapLayer,
  source: MapSource,
): MapSelection | null {
  if (!pickedObject) {
    return null;
  }

  if (source.type === 'geojson-table' && layer.type === 'geojson') {
    const feature = pickedObject as {
      properties?: Record<string, unknown> & {
        __geopanel?: {
          rowRef?: RowReference | null;
        };
      };
    };
    const inlineProperties = {
      ...(feature.properties ?? {}),
    };
    delete inlineProperties.__geopanel;

    return {
      layerId: layer.id,
      layerName: layer.name,
      sourceId: source.id,
      sourceType: source.type,
      sourceFullName: source.fullName,
      schema: source.schema,
      table: source.table,
      objectType: 'feature',
      rowRefs: extractRowRefs(feature.properties?.__geopanel?.rowRef, null),
      inlineProperties,
      title: layer.name,
    };
  }

  if (source.type === 'flowmap-table' && layer.type === 'flowmap') {
    const flowObject = pickedObject as {
      rowRef?: RowReference | null;
      rowRefs?: RowReference[];
      magnitude?: number;
      name?: string;
    };
    const isLocationObject = Array.isArray(flowObject.rowRefs);

    return {
      layerId: layer.id,
      layerName: layer.name,
      sourceId: source.id,
      sourceType: source.type,
      sourceFullName: source.fullName,
      schema: source.schema,
      table: source.table,
      objectType: isLocationObject ? 'location' : 'flow',
      rowRefs: extractRowRefs(flowObject.rowRef, flowObject.rowRefs),
      inlineProperties: null,
      title:
        flowObject.name ||
        (isLocationObject ? `${layer.name} node` : `${layer.name} flow`),
    };
  }

  return null;
}

function isDeckSublayerIdOfParent(
  pickedLayerId: string,
  parentLayerId: string,
) {
  return (
    pickedLayerId === parentLayerId ||
    pickedLayerId.startsWith(`${parentLayerId}/`) ||
    pickedLayerId.startsWith(`${parentLayerId}-`)
  );
}

export function resolvePickedMapLayer(
  pickedLayerId: string,
  visibleLayers: MapLayer[],
) {
  return (
    visibleLayers.find((candidate) =>
      isDeckSublayerIdOfParent(pickedLayerId, candidate.id),
    ) ?? null
  );
}
