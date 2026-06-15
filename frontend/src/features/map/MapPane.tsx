import { MapboxOverlay } from '@deck.gl/mapbox';
import { FlowmapLayer } from '@flowmap.gl/layers';
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  IconDeviceFloppy,
  IconPolygon,
  IconPolygonOff,
  IconX,
} from '@tabler/icons-react';
import maplibregl, {
  LngLatBounds,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  type MapSourceDataEvent,
  NavigationControl,
} from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type HexColor, TerraDraw, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';

import type {
  DatabaseConnection,
  FlowmapMapLayer,
  FlowmapTableSource,
  GeoJsonMapLayer,
  GeoJsonTableSource,
  MapLayer,
  MapSource,
} from '../connections/store';
import type { InspectableTable, InspectorColumn } from '../inspector/api';
import {
  createPolygonFeature,
  type FlowmapDataResponse,
  fetchFlowmapSourceData,
  fetchGeoJsonSourceExtent,
  type GeoBounds,
  type GeoJsonGeometry,
  type LayerTileSourceResponse,
  registerVectorTileSource,
} from './api';
import { type BasemapId, getBasemapStyle } from './basemaps';
import type { MapSelection, RowReference } from './selection';

const defaultCenter: [number, number] = [104.295, 52.302];

declare global {
  interface Window {
    __geopanelPmtilesProtocolRegistered?: boolean;
  }
}

type FlowmapSourceData = {
  sourceType: 'flowmap-table';
  data: FlowmapDataResponse;
};

type LoadedSourceData = FlowmapSourceData;
type SourceCacheEntry = {
  signature: string;
  payload: LoadedSourceData;
};
type SourceDataCache = Record<string, SourceCacheEntry>;
type SourceExtentCacheEntry = {
  signature: string;
  bounds: GeoBounds | null;
};
type SourceExtentCache = Record<string, SourceExtentCacheEntry>;
type VectorTileSourceCacheEntry = {
  signature: string;
  source: LayerTileSourceResponse;
};
type VectorTileSourceCache = Record<string, VectorTileSourceCacheEntry>;
type DrawTarget = {
  layer: GeoJsonMapLayer;
  source: GeoJsonTableSource;
  table: InspectableTable;
};
type FeaturePickCandidate = {
  id: string;
  selection: MapSelection;
  layer: GeoJsonMapLayer;
  source: GeoJsonTableSource;
  label: string;
  detail: string;
};
type FeaturePickState = {
  x: number;
  y: number;
  candidates: FeaturePickCandidate[];
};

const vectorTileSourcePrefix = 'geopanel-source';
const vectorTileLayerPrefix = 'geopanel-layer';
const vectorTileHighlightLayerPrefix = 'geopanel-selection';
const vectorTileHoverLayerPrefix = 'geopanel-hover';
const maxFeaturePickCandidates = 50;

function getSourceSignature(source: MapSource) {
  return JSON.stringify(source);
}

function registerPmtilesProtocol() {
  if (window.__geopanelPmtilesProtocolRegistered) {
    return;
  }

  const protocol = new Protocol({ metadata: true });
  maplibregl.addProtocol('pmtiles', protocol.tile);
  window.__geopanelPmtilesProtocolRegistered = true;
}

function extendBoundsWithSourceData(
  bounds: LngLatBounds,
  sourceData: LoadedSourceData,
) {
  for (const location of sourceData.data.locations) {
    bounds.extend([location.lon, location.lat]);
  }
}

function extendBoundsWithGeoBounds(bounds: LngLatBounds, geoBounds: GeoBounds) {
  bounds.extend([geoBounds.west, geoBounds.south]);
  bounds.extend([geoBounds.east, geoBounds.north]);
}

function computeVisibleBounds(params: {
  extentCache: SourceExtentCache;
  sourceCache: SourceDataCache;
  visibleSources: MapSource[];
}) {
  const bounds = new LngLatBounds();
  let hasCoordinates = false;

  for (const source of params.visibleSources) {
    if (source.type === 'geojson-table') {
      const extentEntry = params.extentCache[source.id];
      if (!extentEntry?.bounds) {
        continue;
      }

      extendBoundsWithGeoBounds(bounds, extentEntry.bounds);
      hasCoordinates = true;
      continue;
    }

    const sourceData = params.sourceCache[source.id];
    if (!sourceData) {
      continue;
    }

    extendBoundsWithSourceData(bounds, sourceData.payload);
    hasCoordinates = hasCoordinates || !bounds.isEmpty();
  }

  return hasCoordinates ? bounds : null;
}

function createFlowmapDeckLayer(
  layer: FlowmapMapLayer,
  sourceData: FlowmapDataResponse,
) {
  return new FlowmapLayer({
    id: layer.id,
    data: {
      locations: sourceData.locations,
      flows: sourceData.flows,
    },
    getLocationId: (location: FlowmapDataResponse['locations'][number]) =>
      location.id,
    getLocationLat: (location: FlowmapDataResponse['locations'][number]) =>
      location.lat,
    getLocationLon: (location: FlowmapDataResponse['locations'][number]) =>
      location.lon,
    getLocationName: (location: FlowmapDataResponse['locations'][number]) =>
      location.name,
    getFlowOriginId: (flow: FlowmapDataResponse['flows'][number]) =>
      flow.originId,
    getFlowDestId: (flow: FlowmapDataResponse['flows'][number]) => flow.destId,
    getFlowMagnitude: (flow: FlowmapDataResponse['flows'][number]) =>
      flow.magnitude,
    flowLinesRenderingMode: layer.style.flowLinesRenderingMode,
    flowLineThicknessScale: layer.style.flowLineThicknessScale,
    clusteringEnabled: layer.style.clusteringEnabled,
    clusteringAuto: layer.style.clusteringAuto,
    locationsEnabled: layer.style.locationsEnabled,
    locationTotalsEnabled: layer.style.locationTotalsEnabled,
    locationLabelsEnabled: layer.style.locationLabelsEnabled,
    maxTopFlowsDisplayNum: layer.style.maxTopFlowsDisplayNum,
    colorScheme: layer.style.colorScheme,
    darkMode: layer.style.darkMode,
    pickable: true,
  });
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

function mapLibreSourceId(sourceId: string) {
  return `${vectorTileSourcePrefix}-${sourceId}`;
}

function mapLibreLayerBaseId(layerId: string) {
  return `${vectorTileLayerPrefix}-${layerId}`;
}

function getVectorStyleLayerIds(layer: GeoJsonMapLayer) {
  const baseId = mapLibreLayerBaseId(layer.id);

  return [`${baseId}-fill`, `${baseId}-line`, `${baseId}-circle`];
}

function getVectorHighlightLayerIds(layer: GeoJsonMapLayer) {
  const baseId = `${vectorTileHighlightLayerPrefix}-${layer.id}`;

  return [`${baseId}-fill`, `${baseId}-line`, `${baseId}-circle`];
}

function getVectorHoverLayerIds(layer: GeoJsonMapLayer) {
  const baseId = `${vectorTileHoverLayerPrefix}-${layer.id}`;

  return [`${baseId}-fill`, `${baseId}-line`, `${baseId}-circle`];
}

function getQueryableVectorLayerIds(map: maplibregl.Map, layers: MapLayer[]) {
  return layers
    .filter(isGeoJsonMapLayer)
    .flatMap(getVectorStyleLayerIds)
    .filter((layerId) => map.getLayer(layerId));
}

function parseJSONProperty(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
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

function buildVectorMapSelection(
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

function buildFeaturePickCandidates(params: {
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
        candidate.id === layer.sourceId && isGeoJsonTableSource(candidate),
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

function buildMapSelection(
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

function resolvePickedMapLayer(
  pickedLayerId: string,
  visibleLayers: MapLayer[],
) {
  return (
    visibleLayers.find((candidate) =>
      isDeckSublayerIdOfParent(pickedLayerId, candidate.id),
    ) ?? null
  );
}

function isGeoJsonMapLayer(layer: MapLayer): layer is GeoJsonMapLayer {
  return layer.type === 'geojson';
}

function isGeoJsonTableSource(source: MapSource): source is GeoJsonTableSource {
  return source.type === 'geojson-table';
}

function isPolygonGeometryType(geometryType: string) {
  return /polygon/i.test(geometryType);
}

function isNumericColumnType(columnType: string) {
  return /int|numeric|double|real|decimal|serial/i.test(columnType);
}

function isBooleanColumnType(columnType: string) {
  return /bool/i.test(columnType);
}

function isEditableFeatureColumn(column: InspectorColumn) {
  return (
    isNumericColumnType(column.type) ||
    isBooleanColumnType(column.type) ||
    /text|character|uuid|date|timestamp/i.test(column.type)
  );
}

function normalizeFeatureValue(column: InspectorColumn, rawValue: string) {
  const trimmedValue = rawValue.trim();
  if (trimmedValue === '') {
    return undefined;
  }
  if (isBooleanColumnType(column.type)) {
    return trimmedValue === 'true';
  }

  return trimmedValue;
}

function defaultFeatureValues(source: GeoJsonTableSource) {
  const values: Record<string, string> = {};
  for (const condition of source.filter?.conditions ?? []) {
    if (condition.operator === 'eq' && condition.value !== undefined) {
      values[condition.column] = condition.value;
    }
  }

  return values;
}

function isGeoJsonPolygonGeometry(value: unknown): value is GeoJsonGeometry {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    ((value as { type?: unknown }).type === 'Polygon' ||
      (value as { type?: unknown }).type === 'MultiPolygon')
  );
}

function isVectorTileRequestError(event: ErrorEvent) {
  const error = event.error as
    | {
        status?: number;
        url?: string;
      }
    | undefined;

  return (
    error?.status === 404 &&
    typeof error.url === 'string' &&
    error.url.includes('/api/v1/vector-tiles/')
  );
}

function addVectorStyleLayers(params: {
  map: maplibregl.Map;
  layer: GeoJsonMapLayer;
  source: GeoJsonTableSource;
  sourceLayer: string;
}) {
  const { layer, map, source, sourceLayer } = params;
  const color = layer.color;
  const opacity = layer.opacity / 100;
  const [fillLayerId, lineLayerId, circleLayerId] =
    getVectorStyleLayerIds(layer);
  const sourceId = mapLibreSourceId(source.id);

  if (/polygon/i.test(source.geometryType) && !map.getLayer(fillLayerId)) {
    map.addLayer({
      id: fillLayerId,
      type: 'fill',
      source: sourceId,
      'source-layer': sourceLayer,
      paint: {
        'fill-color': color,
        'fill-opacity': opacity,
      },
    });
  }

  if (
    (/polygon|line/i.test(source.geometryType) || source.geometryType === '') &&
    !map.getLayer(lineLayerId)
  ) {
    map.addLayer({
      id: lineLayerId,
      type: 'line',
      source: sourceId,
      'source-layer': sourceLayer,
      paint: {
        'line-color': color,
        'line-opacity': Math.min(1, opacity + 0.15),
        'line-width': /line/i.test(source.geometryType) ? 3 : 1.5,
      },
    });
  }

  if (
    (/point/i.test(source.geometryType) || source.geometryType === '') &&
    !map.getLayer(circleLayerId)
  ) {
    map.addLayer({
      id: circleLayerId,
      type: 'circle',
      source: sourceId,
      'source-layer': sourceLayer,
      paint: {
        'circle-color': color,
        'circle-opacity': opacity,
        'circle-radius': 6,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
      },
    });
  }
}

function addVectorFeatureHighlightLayers(params: {
  map: maplibregl.Map;
  layer: GeoJsonMapLayer;
  source: GeoJsonTableSource;
  sourceLayer: string;
  featureKey: string;
  layerIds: string[];
  color: string;
  fillOpacity: number;
  lineWidth: number;
}) {
  const {
    color,
    featureKey,
    fillOpacity,
    layerIds,
    lineWidth,
    map,
    source,
    sourceLayer,
  } = params;
  const [fillLayerId, lineLayerId, circleLayerId] = layerIds;
  const sourceId = mapLibreSourceId(source.id);
  const filter: maplibregl.FilterSpecification = [
    '==',
    ['get', '_geopanel_row_key'],
    featureKey,
  ];

  if (/polygon/i.test(source.geometryType) && !map.getLayer(fillLayerId)) {
    map.addLayer({
      id: fillLayerId,
      type: 'fill',
      source: sourceId,
      'source-layer': sourceLayer,
      filter,
      paint: {
        'fill-color': color,
        'fill-opacity': fillOpacity,
      },
    });
  }

  if (
    (/polygon|line/i.test(source.geometryType) || source.geometryType === '') &&
    !map.getLayer(lineLayerId)
  ) {
    map.addLayer({
      id: lineLayerId,
      type: 'line',
      source: sourceId,
      'source-layer': sourceLayer,
      filter,
      paint: {
        'line-color': color,
        'line-opacity': 1,
        'line-width': /line/i.test(source.geometryType)
          ? lineWidth + 2
          : lineWidth,
      },
    });
  }

  if (
    (/point/i.test(source.geometryType) || source.geometryType === '') &&
    !map.getLayer(circleLayerId)
  ) {
    map.addLayer({
      id: circleLayerId,
      type: 'circle',
      source: sourceId,
      'source-layer': sourceLayer,
      filter,
      paint: {
        'circle-color': color,
        'circle-opacity': 0.95,
        'circle-radius': 9,
        'circle-stroke-color': '#212529',
        'circle-stroke-width': 2,
      },
    });
  }
}

async function fetchSourceData(
  connection: DatabaseConnection,
  source: FlowmapTableSource,
  signal?: AbortSignal,
): Promise<LoadedSourceData> {
  const response = await fetchFlowmapSourceData(connection, source, signal);
  return {
    sourceType: 'flowmap-table',
    data: response,
  };
}

export function MapPane({
  activeLayerId,
  basemapId,
  connection,
  mapSelection,
  tables,
  visibleLayers,
  sources,
  onFeatureCreated,
  onSelectMapObject,
}: {
  activeLayerId: string | null;
  basemapId: BasemapId;
  connection: DatabaseConnection | null;
  mapSelection: MapSelection | null;
  tables: InspectableTable[];
  visibleLayers: MapLayer[];
  sources: MapSource[];
  onFeatureCreated?: (source: GeoJsonTableSource) => void;
  onSelectMapObject: (selection: MapSelection | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const activeBasemapIdRef = useRef<BasemapId>(basemapId);
  const activeLayerIdRef = useRef<string | null>(activeLayerId);
  const sourceCacheRef = useRef<SourceDataCache>({});
  const sourceExtentCacheRef = useRef<SourceExtentCache>({});
  const vectorTileSourceCacheRef = useRef<VectorTileSourceCache>({});
  const appliedVectorSourceSignaturesRef = useRef<Record<string, string>>({});
  const fittedSourceIdsRef = useRef<string>('');
  const visibleLayersRef = useRef<MapLayer[]>(visibleLayers);
  const sourcesRef = useRef<MapSource[]>(sources);
  const onSelectMapObjectRef = useRef(onSelectMapObject);
  const loadingVectorSourceIdsRef = useRef<Set<string>>(new Set());
  const [isMapReady, setIsMapReady] = useState(false);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [isLoadingVectorTiles, setIsLoadingVectorTiles] = useState(false);
  const [featurePickState, setFeaturePickState] =
    useState<FeaturePickState | null>(null);
  const [hoveredFeaturePick, setHoveredFeaturePick] =
    useState<FeaturePickCandidate | null>(null);
  const [layerError, setLayerError] = useState('');
  const [cacheVersion, setCacheVersion] = useState(0);
  const [extentVersion, setExtentVersion] = useState(0);
  const [styleVersion, setStyleVersion] = useState(0);
  const [isDrawingPolygon, setIsDrawingPolygon] = useState(false);
  const [pendingGeometry, setPendingGeometry] =
    useState<GeoJsonGeometry | null>(null);
  const [pendingDrawTarget, setPendingDrawTarget] = useState<DrawTarget | null>(
    null,
  );
  const [featureValues, setFeatureValues] = useState<Record<string, string>>(
    {},
  );
  const [isSavingFeature, setIsSavingFeature] = useState(false);
  const [featureError, setFeatureError] = useState('');

  visibleLayersRef.current = visibleLayers;
  sourcesRef.current = sources;
  onSelectMapObjectRef.current = onSelectMapObject;
  activeLayerIdRef.current = activeLayerId;

  const visibleSourceIds = useMemo(
    () => Array.from(new Set(visibleLayers.map((layer) => layer.sourceId))),
    [visibleLayers],
  );
  const visibleSources = useMemo(
    () =>
      visibleSourceIds.flatMap((sourceId) => {
        const source = sources.find((candidate) => candidate.id === sourceId);
        return source ? [source] : [];
      }),
    [sources, visibleSourceIds],
  );
  const visibleSourceSignature = useMemo(
    () => [...visibleSourceIds].sort().join('|'),
    [visibleSourceIds],
  );
  const geoJsonVisibleSources = useMemo(
    () => visibleSources.filter(isGeoJsonTableSource),
    [visibleSources],
  );
  const flowmapVisibleSources = useMemo(
    () =>
      visibleSources.filter(
        (source): source is FlowmapTableSource =>
          source.type === 'flowmap-table',
      ),
    [visibleSources],
  );
  const drawTarget = useMemo<DrawTarget | null>(() => {
    const geoJsonLayers = visibleLayers.filter(isGeoJsonMapLayer);
    const candidateLayers = activeLayerId
      ? geoJsonLayers.filter((layer) => layer.id === activeLayerId)
      : geoJsonLayers;

    for (const layer of candidateLayers) {
      const source = sources.find(
        (candidate): candidate is GeoJsonTableSource =>
          candidate.id === layer.sourceId && isGeoJsonTableSource(candidate),
      );
      if (!source || !isPolygonGeometryType(source.geometryType)) {
        continue;
      }

      const table = tables.find(
        (candidate) =>
          candidate.schema === source.schema && candidate.name === source.table,
      );
      if (!table?.isEditable) {
        continue;
      }

      return {
        layer,
        source,
        table,
      };
    }

    return null;
  }, [activeLayerId, sources, tables, visibleLayers]);
  const featureTarget = pendingDrawTarget ?? drawTarget;
  const editableFeatureColumns = useMemo(
    () =>
      featureTarget?.table.columns.filter(
        (column) =>
          column.name !== featureTarget.source.geometryColumn &&
          isEditableFeatureColumn(column),
      ) ?? [],
    [featureTarget],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    registerPmtilesProtocol();

    const map = new maplibregl.Map({
      container,
      center: defaultCenter,
      zoom: 11,
      style: getBasemapStyle(activeBasemapIdRef.current),
    });

    const navigation = new NavigationControl({
      showCompass: false,
      visualizePitch: true,
    });

    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
    });

    map.addControl(navigation, 'top-left');
    map.addControl(overlay);

    function handleMapClick(event: MapMouseEvent) {
      if (drawRef.current) {
        return;
      }

      const currentVisibleLayers = visibleLayersRef.current;
      const currentSources = sourcesRef.current;
      const geoJsonLayers = currentVisibleLayers.filter(isGeoJsonMapLayer);
      const queryableLayerIds = getQueryableVectorLayerIds(
        map,
        currentVisibleLayers,
      );

      if (queryableLayerIds.length === 0) {
        setFeaturePickState(null);
        setHoveredFeaturePick(null);
        onSelectMapObjectRef.current(null);
        return;
      }

      const features = map.queryRenderedFeatures(event.point, {
        layers: queryableLayerIds,
      });
      const candidates = buildFeaturePickCandidates({
        activeLayerId: activeLayerIdRef.current,
        features,
        layers: geoJsonLayers,
        sources: currentSources,
      });

      if (candidates.length === 0) {
        setFeaturePickState(null);
        setHoveredFeaturePick(null);
        onSelectMapObjectRef.current(null);
        return;
      }

      if (candidates.length === 1) {
        setFeaturePickState(null);
        setHoveredFeaturePick(null);
        onSelectMapObjectRef.current(candidates[0].selection);
        return;
      }

      setFeaturePickState({
        x: event.point.x,
        y: event.point.y,
        candidates,
      });
      setHoveredFeaturePick(candidates[0]);
    }

    function closeFeaturePicker() {
      setFeaturePickState(null);
      setHoveredFeaturePick(null);
    }

    function handleMapMouseMove(event: MapMouseEvent) {
      if (drawRef.current) {
        map.getCanvas().style.cursor = '';
        return;
      }

      const queryableLayerIds = getQueryableVectorLayerIds(
        map,
        visibleLayersRef.current,
      );
      if (queryableLayerIds.length === 0) {
        map.getCanvas().style.cursor = '';
        return;
      }

      const features = map.queryRenderedFeatures(event.point, {
        layers: queryableLayerIds,
      });
      map.getCanvas().style.cursor = features.length > 0 ? 'pointer' : '';
    }

    function updateVectorTileLoadingState() {
      setIsLoadingVectorTiles(loadingVectorSourceIdsRef.current.size > 0);
    }

    function handleSourceDataLoading(event: MapSourceDataEvent) {
      if (
        typeof event.sourceId !== 'string' ||
        !event.sourceId.startsWith(vectorTileSourcePrefix)
      ) {
        return;
      }

      loadingVectorSourceIdsRef.current.add(event.sourceId);
      updateVectorTileLoadingState();
    }

    function handleSourceData(event: MapSourceDataEvent) {
      if (
        typeof event.sourceId !== 'string' ||
        !event.sourceId.startsWith(vectorTileSourcePrefix) ||
        !event.isSourceLoaded
      ) {
        return;
      }

      loadingVectorSourceIdsRef.current.delete(event.sourceId);
      updateVectorTileLoadingState();
    }

    function handleSourceDataAbort(event: MapSourceDataEvent) {
      if (
        typeof event.sourceId !== 'string' ||
        !event.sourceId.startsWith(vectorTileSourcePrefix)
      ) {
        return;
      }

      loadingVectorSourceIdsRef.current.delete(event.sourceId);
      updateVectorTileLoadingState();
    }

    function handleMapError(event: ErrorEvent) {
      if (!isVectorTileRequestError(event)) {
        return;
      }

      vectorTileSourceCacheRef.current = {};
      appliedVectorSourceSignaturesRef.current = {};
      loadingVectorSourceIdsRef.current.clear();
      setIsLoadingVectorTiles(false);
      setStyleVersion((current) => current + 1);
    }

    function handleMapIdle() {
      loadingVectorSourceIdsRef.current.clear();
      updateVectorTileLoadingState();
    }

    map.once('load', () => {
      setIsMapReady(true);
      map.resize();
    });
    map.on('click', handleMapClick);
    map.on('movestart', closeFeaturePicker);
    map.on('mousemove', handleMapMouseMove);
    map.on('sourcedataloading', handleSourceDataLoading);
    map.on('sourcedata', handleSourceData);
    map.on('sourcedataabort', handleSourceDataAbort);
    map.on('error', handleMapError);
    map.on('idle', handleMapIdle);

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
      map.off('click', handleMapClick);
      map.off('movestart', closeFeaturePicker);
      map.off('mousemove', handleMapMouseMove);
      map.off('sourcedataloading', handleSourceDataLoading);
      map.off('sourcedata', handleSourceData);
      map.off('sourcedataabort', handleSourceDataAbort);
      map.off('error', handleMapError);
      map.off('idle', handleMapIdle);
      if (overlayRef.current) {
        map.removeControl(overlayRef.current);
        overlayRef.current.finalize();
      }
      overlayRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady || activeBasemapIdRef.current === basemapId) {
      return;
    }

    activeBasemapIdRef.current = basemapId;

    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();
    const currentBearing = map.getBearing();
    const currentPitch = map.getPitch();

    map.once('style.load', () => {
      if (overlayRef.current) {
        map.removeControl(overlayRef.current);
        overlayRef.current.finalize();
      }

      const nextOverlay = new MapboxOverlay({
        interleaved: true,
        layers: [],
      });

      map.addControl(nextOverlay);
      overlayRef.current = nextOverlay;
      map.jumpTo({
        center: currentCenter,
        zoom: currentZoom,
        bearing: currentBearing,
        pitch: currentPitch,
      });
      setStyleVersion((current) => current + 1);
    });

    map.setStyle(getBasemapStyle(basemapId));
  }, [basemapId, isMapReady]);

  useEffect(() => {
    if (!isMapReady || !overlayRef.current) {
      return;
    }

    if (!connection || connection.testStatus !== 'success') {
      overlayRef.current.setProps({ layers: [] });
      sourceCacheRef.current = {};
      sourceExtentCacheRef.current = {};
      vectorTileSourceCacheRef.current = {};
      fittedSourceIdsRef.current = '';
      setLayerError('');
      setIsLoadingSources(false);
      onSelectMapObjectRef.current(null);
      return;
    }

    if (flowmapVisibleSources.length === 0) {
      overlayRef.current.setProps({ layers: [] });
      setIsLoadingSources(false);
      return;
    }

    const missingSources = flowmapVisibleSources.filter((source) => {
      const signature = getSourceSignature(source);
      const cacheEntry = sourceCacheRef.current[source.id];
      return !cacheEntry || cacheEntry.signature !== signature;
    });
    if (missingSources.length === 0) {
      setIsLoadingSources(false);
      return;
    }

    const activeConnection = connection;
    let isActive = true;
    const abortController = new AbortController();
    setIsLoadingSources(true);
    setLayerError('');

    async function loadMissingSources() {
      try {
        const loadedEntries = await Promise.all(
          missingSources.map(async (source) => {
            const data = await fetchSourceData(
              activeConnection,
              source,
              abortController.signal,
            );

            return [
              source.id,
              {
                signature: getSourceSignature(source),
                payload: data,
              },
            ] as const;
          }),
        );

        if (!isActive) {
          return;
        }

        const nextCache = { ...sourceCacheRef.current };
        for (const [sourceId, data] of loadedEntries) {
          nextCache[sourceId] = data;
        }
        sourceCacheRef.current = nextCache;
        setCacheVersion((value) => value + 1);
      } catch (error) {
        if (!isActive || abortController.signal.aborted) {
          return;
        }

        setLayerError(
          error instanceof Error
            ? error.message
            : 'Failed to load visible layers.',
        );
      } finally {
        if (isActive) {
          setIsLoadingSources(false);
        }
      }
    }

    void loadMissingSources();

    return () => {
      isActive = false;
      abortController.abort();
    };
  }, [connection, flowmapVisibleSources, isMapReady]);

  useEffect(() => {
    const map = mapRef.current;
    void styleVersion;

    if (!map || !isMapReady) {
      return;
    }
    const activeMap = map;

    function removeAllVectorLayers() {
      for (const styleLayer of activeMap.getStyle().layers ?? []) {
        if (
          styleLayer.id.startsWith(vectorTileLayerPrefix) ||
          styleLayer.id.startsWith(vectorTileHighlightLayerPrefix) ||
          styleLayer.id.startsWith(vectorTileHoverLayerPrefix)
        ) {
          activeMap.removeLayer(styleLayer.id);
        }
      }
    }

    function removeUnusedVectorSources(expectedSourceIds: Set<string>) {
      for (const sourceId of Object.keys(activeMap.getStyle().sources)) {
        if (
          sourceId.startsWith(vectorTileSourcePrefix) &&
          !expectedSourceIds.has(sourceId)
        ) {
          activeMap.removeSource(sourceId);
          delete appliedVectorSourceSignaturesRef.current[sourceId];
        }
      }
    }

    function applyVectorLayers() {
      removeAllVectorLayers();

      const expectedSourceIds = new Set<string>();
      for (const source of geoJsonVisibleSources) {
        const sourceId = mapLibreSourceId(source.id);
        const signature = getSourceSignature(source);
        const cacheEntry = vectorTileSourceCacheRef.current[source.id];
        if (!cacheEntry || cacheEntry.signature !== signature) {
          continue;
        }

        expectedSourceIds.add(sourceId);
        if (
          activeMap.getSource(sourceId) &&
          appliedVectorSourceSignaturesRef.current[sourceId] !== signature
        ) {
          activeMap.removeSource(sourceId);
        }

        if (!activeMap.getSource(sourceId)) {
          activeMap.addSource(sourceId, {
            type: 'vector',
            tiles: cacheEntry.source.tiles,
          });
          appliedVectorSourceSignaturesRef.current[sourceId] = signature;
        }
      }

      removeUnusedVectorSources(expectedSourceIds);

      for (const layer of visibleLayers.filter(isGeoJsonMapLayer)) {
        const source = sources.find(
          (candidate): candidate is GeoJsonTableSource =>
            candidate.id === layer.sourceId && isGeoJsonTableSource(candidate),
        );
        if (!source) {
          continue;
        }

        const cacheEntry = vectorTileSourceCacheRef.current[source.id];
        if (!cacheEntry || !activeMap.getSource(mapLibreSourceId(source.id))) {
          continue;
        }

        addVectorStyleLayers({
          map: activeMap,
          layer,
          source,
          sourceLayer: cacheEntry.source.sourceLayer,
        });
      }

      if (
        mapSelection?.objectType === 'feature' &&
        mapSelection.featureKey &&
        mapSelection.sourceType === 'geojson-table'
      ) {
        const selectedLayer = visibleLayers.find(
          (layer): layer is GeoJsonMapLayer =>
            layer.id === mapSelection.layerId && isGeoJsonMapLayer(layer),
        );
        const selectedSource = sources.find(
          (candidate): candidate is GeoJsonTableSource =>
            candidate.id === mapSelection.sourceId &&
            isGeoJsonTableSource(candidate),
        );
        const cacheEntry = selectedSource
          ? vectorTileSourceCacheRef.current[selectedSource.id]
          : null;

        if (
          selectedLayer &&
          selectedSource &&
          cacheEntry &&
          activeMap.getSource(mapLibreSourceId(selectedSource.id))
        ) {
          addVectorFeatureHighlightLayers({
            color: '#ffd43b',
            fillOpacity: 0.3,
            layerIds: getVectorHighlightLayerIds(selectedLayer),
            lineWidth: 4,
            map: activeMap,
            layer: selectedLayer,
            source: selectedSource,
            sourceLayer: cacheEntry.source.sourceLayer,
            featureKey: mapSelection.featureKey,
          });
        }
      }

      if (
        hoveredFeaturePick?.selection.objectType === 'feature' &&
        hoveredFeaturePick.selection.featureKey
      ) {
        const cacheEntry =
          vectorTileSourceCacheRef.current[hoveredFeaturePick.source.id];
        if (
          cacheEntry &&
          activeMap.getSource(mapLibreSourceId(hoveredFeaturePick.source.id))
        ) {
          addVectorFeatureHighlightLayers({
            color: '#51cf66',
            fillOpacity: 0.18,
            layerIds: getVectorHoverLayerIds(hoveredFeaturePick.layer),
            lineWidth: 2,
            map: activeMap,
            layer: hoveredFeaturePick.layer,
            source: hoveredFeaturePick.source,
            sourceLayer: cacheEntry.source.sourceLayer,
            featureKey: hoveredFeaturePick.selection.featureKey,
          });
        }
      }
    }

    if (!connection || connection.testStatus !== 'success') {
      removeAllVectorLayers();
      removeUnusedVectorSources(new Set());
      vectorTileSourceCacheRef.current = {};
      appliedVectorSourceSignaturesRef.current = {};
      loadingVectorSourceIdsRef.current.clear();
      setIsLoadingVectorTiles(false);
      return;
    }

    if (geoJsonVisibleSources.length === 0) {
      removeAllVectorLayers();
      removeUnusedVectorSources(new Set());
      loadingVectorSourceIdsRef.current.clear();
      setIsLoadingVectorTiles(false);
      onSelectMapObjectRef.current(null);
      return;
    }

    const missingSources = geoJsonVisibleSources.filter((source) => {
      const cacheEntry = vectorTileSourceCacheRef.current[source.id];
      return !cacheEntry || cacheEntry.signature !== getSourceSignature(source);
    });

    if (missingSources.length === 0) {
      applyVectorLayers();
      return;
    }

    const activeConnection = connection;
    let isActive = true;
    const abortController = new AbortController();
    setIsLoadingSources(true);
    setLayerError('');

    async function registerMissingSources() {
      try {
        const loadedEntries = await Promise.all(
          missingSources.map(async (source) => {
            const tileSource = await registerVectorTileSource(
              activeConnection,
              source,
              abortController.signal,
            );

            return [
              source.id,
              {
                signature: getSourceSignature(source),
                source: tileSource,
              },
            ] as const;
          }),
        );

        if (!isActive) {
          return;
        }

        vectorTileSourceCacheRef.current = {
          ...vectorTileSourceCacheRef.current,
          ...Object.fromEntries(loadedEntries),
        };
        applyVectorLayers();
      } catch (error) {
        if (!isActive || abortController.signal.aborted) {
          return;
        }

        setLayerError(
          error instanceof Error
            ? error.message
            : 'Failed to register vector tile source.',
        );
      } finally {
        if (isActive) {
          setIsLoadingSources(false);
        }
      }
    }

    void registerMissingSources();

    return () => {
      isActive = false;
      abortController.abort();
    };
  }, [
    connection,
    geoJsonVisibleSources,
    hoveredFeaturePick,
    isMapReady,
    mapSelection,
    sources,
    styleVersion,
    visibleLayers,
  ]);

  useEffect(() => {
    if (!isMapReady || !connection || connection.testStatus !== 'success') {
      return;
    }

    if (geoJsonVisibleSources.length === 0) {
      return;
    }

    const missingExtentSources = geoJsonVisibleSources.filter(
      (source) =>
        !sourceExtentCacheRef.current[source.id] ||
        sourceExtentCacheRef.current[source.id].signature !==
          JSON.stringify(source),
    );

    if (missingExtentSources.length === 0) {
      return;
    }

    const activeConnection = connection;
    let isActive = true;
    const abortController = new AbortController();
    setLayerError('');

    async function loadMissingExtents() {
      try {
        const loadedEntries = await Promise.all(
          missingExtentSources.map(async (source) => {
            const response = await fetchGeoJsonSourceExtent(
              activeConnection,
              source,
              abortController.signal,
            );

            return [
              source.id,
              {
                signature: JSON.stringify(source),
                bounds: response.bounds,
              },
            ] as const;
          }),
        );

        if (!isActive) {
          return;
        }

        const nextCache = { ...sourceExtentCacheRef.current };
        for (const [sourceId, extentEntry] of loadedEntries) {
          nextCache[sourceId] = extentEntry;
        }

        sourceExtentCacheRef.current = nextCache;
        setExtentVersion((value) => value + 1);
      } catch (error) {
        if (!isActive || abortController.signal.aborted) {
          return;
        }

        setLayerError(
          error instanceof Error
            ? error.message
            : 'Failed to load layer extent.',
        );
      }
    }

    void loadMissingExtents();

    return () => {
      isActive = false;
      abortController.abort();
    };
  }, [connection, geoJsonVisibleSources, isMapReady]);

  useEffect(() => {
    if (!isMapReady || !overlayRef.current) {
      return;
    }

    void cacheVersion;
    void styleVersion;

    if (!connection || connection.testStatus !== 'success') {
      overlayRef.current.setProps({ layers: [] });
      onSelectMapObjectRef.current(null);
      return;
    }

    const deckLayers = visibleLayers.reduce<unknown[]>((layersList, layer) => {
      const source = sources.find(
        (candidate) => candidate.id === layer.sourceId,
      );
      if (!source) {
        return layersList;
      }

      const sourceData = sourceCacheRef.current[source.id];
      if (!sourceData) {
        return layersList;
      }

      if (
        layer.type === 'flowmap' &&
        source.type === 'flowmap-table' &&
        sourceData.payload.sourceType === 'flowmap-table'
      ) {
        layersList.push(createFlowmapDeckLayer(layer, sourceData.payload.data));
        return layersList;
      }

      return layersList;
    }, []);

    overlayRef.current.setProps({
      layers: deckLayers as never,
      onClick: (pickInfo: {
        layer?: { id: string } | null;
        object?: unknown;
      }) => {
        const pickedLayerId = pickInfo.layer?.id;
        if (!pickedLayerId) {
          onSelectMapObjectRef.current(null);
          return;
        }

        const layer = resolvePickedMapLayer(pickedLayerId, visibleLayers);
        if (!layer) {
          onSelectMapObjectRef.current(null);
          return;
        }

        const source = sources.find(
          (candidate) => candidate.id === layer.sourceId,
        );
        if (!source) {
          onSelectMapObjectRef.current(null);
          return;
        }

        onSelectMapObjectRef.current(
          buildMapSelection(pickInfo.object, layer, source),
        );
      },
    });

    if (visibleSourceSignature !== fittedSourceIdsRef.current) {
      void extentVersion;

      const bounds = computeVisibleBounds({
        extentCache: sourceExtentCacheRef.current,
        sourceCache: sourceCacheRef.current,
        visibleSources,
      });
      if (bounds && mapRef.current) {
        mapRef.current.fitBounds(bounds, {
          padding: 48,
          duration: 700,
        });
      }
      fittedSourceIdsRef.current = visibleSourceSignature;
    }
  }, [
    cacheVersion,
    connection,
    extentVersion,
    isMapReady,
    styleVersion,
    sources,
    visibleLayers,
    visibleSources,
    visibleSourceSignature,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!isMapReady || !map || !isDrawingPolygon || !drawTarget) {
      return;
    }
    const target = drawTarget;

    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({
        map,
        prefixId: 'geopanel-draw',
      }),
      modes: [
        new TerraDrawPolygonMode({
          editable: false,
          styles: {
            fillColor: target.layer.color as HexColor,
            fillOpacity: 0.22,
            outlineColor: target.layer.color as HexColor,
            outlineWidth: 2,
          },
        }),
      ],
    });

    drawRef.current = draw;

    function handleFinish(id: string | number) {
      const feature = draw.getSnapshotFeature(id);
      if (!isGeoJsonPolygonGeometry(feature?.geometry)) {
        setFeatureError('Drawn geometry must be polygon.');
        setIsDrawingPolygon(false);
        return;
      }

      setPendingGeometry(feature.geometry);
      setPendingDrawTarget(target);
      setFeatureValues(defaultFeatureValues(target.source));
      setFeatureError('');
      setIsDrawingPolygon(false);
    }

    draw.on('finish', handleFinish);
    draw.start();
    draw.setMode('polygon');

    return () => {
      draw.off('finish', handleFinish);
      draw.stop();
      if (drawRef.current === draw) {
        drawRef.current = null;
      }
    };
  }, [drawTarget, isDrawingPolygon, isMapReady]);

  function invalidateVectorSource(sourceId: string) {
    const map = mapRef.current;
    const mapSourceId = mapLibreSourceId(sourceId);

    delete vectorTileSourceCacheRef.current[sourceId];
    delete appliedVectorSourceSignaturesRef.current[mapSourceId];
    delete sourceExtentCacheRef.current[sourceId];
    loadingVectorSourceIdsRef.current.delete(mapSourceId);

    if (map?.getSource(mapSourceId)) {
      for (const styleLayer of map.getStyle().layers ?? []) {
        if (
          styleLayer.id.startsWith(vectorTileLayerPrefix) ||
          styleLayer.id.startsWith(vectorTileHighlightLayerPrefix) ||
          styleLayer.id.startsWith(vectorTileHoverLayerPrefix)
        ) {
          map.removeLayer(styleLayer.id);
        }
      }
      map.removeSource(mapSourceId);
    }

    setIsLoadingVectorTiles(false);
    setExtentVersion((value) => value + 1);
    setStyleVersion((value) => value + 1);
  }

  function handleStartPolygonDraw() {
    if (!drawTarget) {
      setFeatureError('Select editable polygon layer first.');
      return;
    }

    setFeatureError('');
    setPendingGeometry(null);
    setPendingDrawTarget(null);
    setFeatureValues(defaultFeatureValues(drawTarget.source));
    onSelectMapObjectRef.current(null);
    setIsDrawingPolygon(true);
  }

  function handleCancelPolygonDraw() {
    setIsDrawingPolygon(false);
    setPendingGeometry(null);
    setPendingDrawTarget(null);
    setFeatureError('');
  }

  function handleFeatureValueChange(columnName: string, value: string) {
    setFeatureValues((current) => ({
      ...current,
      [columnName]: value,
    }));
    setFeatureError('');
  }

  async function handleSaveFeature() {
    if (!connection || !featureTarget || !pendingGeometry) {
      return;
    }

    const values: Record<string, unknown> = {};
    for (const column of editableFeatureColumns) {
      const value = normalizeFeatureValue(
        column,
        featureValues[column.name] ?? '',
      );
      if (value !== undefined) {
        values[column.name] = value;
      }
    }

    setIsSavingFeature(true);
    setFeatureError('');

    try {
      await createPolygonFeature(connection, {
        schema: featureTarget.source.schema,
        table: featureTarget.source.table,
        geometryColumn: featureTarget.source.geometryColumn,
        geometry: pendingGeometry,
        values,
      });

      invalidateVectorSource(featureTarget.source.id);
      setPendingGeometry(null);
      setPendingDrawTarget(null);
      setFeatureValues({});
      onFeatureCreated?.(featureTarget.source);
    } catch (error) {
      setFeatureError(
        error instanceof Error ? error.message : 'Failed to create feature.',
      );
    } finally {
      setIsSavingFeature(false);
    }
  }

  function handleSelectFeatureCandidate(candidate: FeaturePickCandidate) {
    onSelectMapObjectRef.current(candidate.selection);
    setFeaturePickState(null);
    setHoveredFeaturePick(null);
  }

  function handleCloseFeaturePicker() {
    setFeaturePickState(null);
    setHoveredFeaturePick(null);
  }

  const featurePickerMaxWidth = 360;
  const featurePickerMaxHeight = 320;
  const mapWidth = containerRef.current?.clientWidth ?? 0;
  const mapHeight = containerRef.current?.clientHeight ?? 0;
  const featurePickerLeft = featurePickState
    ? Math.min(
        Math.max(12, featurePickState.x + 12),
        Math.max(12, mapWidth - featurePickerMaxWidth - 12),
      )
    : 12;
  const featurePickerTop = featurePickState
    ? Math.min(
        Math.max(12, featurePickState.y + 12),
        Math.max(12, mapHeight - featurePickerMaxHeight - 12),
      )
    : 12;

  return (
    <Box
      style={{
        position: 'relative',
        height: '100%',
        width: '100%',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        borderRadius: 'var(--mantine-radius-md)',
      }}
    >
      <Box
        ref={containerRef}
        style={{
          height: '100%',
          width: '100%',
        }}
      />

      {featurePickState ? (
        <Box
          style={{
            background: 'var(--mantine-color-body)',
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 'var(--mantine-radius-md)',
            boxShadow: 'var(--mantine-shadow-md)',
            left: featurePickerLeft,
            maxWidth: featurePickerMaxWidth,
            minWidth: 260,
            overflow: 'hidden',
            position: 'absolute',
            top: featurePickerTop,
            zIndex: 4,
          }}
        >
          <Group justify="space-between" p="xs" wrap="nowrap">
            <Text fw={600} size="sm">
              Pick feature
            </Text>
            <ActionIcon
              aria-label="Close feature picker"
              onClick={handleCloseFeaturePicker}
              size="sm"
              variant="subtle"
            >
              <IconX size={14} />
            </ActionIcon>
          </Group>
          <ScrollArea.Autosize mah={260}>
            <Stack gap={2} p={6} pt={0}>
              {featurePickState.candidates.map((candidate) => (
                <Box
                  component="button"
                  key={candidate.id}
                  onClick={() => handleSelectFeatureCandidate(candidate)}
                  onMouseEnter={() => setHoveredFeaturePick(candidate)}
                  onMouseLeave={() => setHoveredFeaturePick(null)}
                  style={{
                    background:
                      hoveredFeaturePick?.id === candidate.id
                        ? 'var(--mantine-color-blue-light)'
                        : 'transparent',
                    border: 0,
                    borderRadius: 'var(--mantine-radius-sm)',
                    color: 'inherit',
                    cursor: 'pointer',
                    display: 'block',
                    minHeight: 48,
                    padding: '6px 8px',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  <Group gap="xs" wrap="nowrap" w="100%">
                    <Box
                      style={{
                        background: candidate.layer.color,
                        borderRadius: 2,
                        flex: '0 0 auto',
                        height: 12,
                        width: 12,
                      }}
                    />
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Text fw={600} size="sm" truncate>
                        {candidate.label}
                      </Text>
                      <Text c="dimmed" size="xs" truncate>
                        {candidate.detail || 'Feature'}
                      </Text>
                    </Box>
                  </Group>
                </Box>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Box>
      ) : null}

      {isMapReady ? (
        <Box
          style={{
            left: 12,
            position: 'absolute',
            top: 88,
            zIndex: 2,
          }}
        >
          <Stack gap={8}>
            <Tooltip
              label={
                drawTarget
                  ? `Draw polygon in ${drawTarget.layer.name}`
                  : 'No editable polygon layer selected'
              }
              position="right"
              withArrow
            >
              <ActionIcon
                aria-label="Draw polygon"
                color={isDrawingPolygon ? 'red' : 'blue'}
                disabled={!drawTarget || Boolean(pendingGeometry)}
                onClick={
                  isDrawingPolygon
                    ? handleCancelPolygonDraw
                    : handleStartPolygonDraw
                }
                size="lg"
                variant={isDrawingPolygon ? 'filled' : 'default'}
              >
                {isDrawingPolygon ? (
                  <IconPolygonOff size={18} />
                ) : (
                  <IconPolygon size={18} />
                )}
              </ActionIcon>
            </Tooltip>
          </Stack>
        </Box>
      ) : null}

      <Modal
        centered
        onClose={handleCancelPolygonDraw}
        opened={Boolean(pendingGeometry)}
        title={
          featureTarget
            ? `New feature: ${featureTarget.layer.name}`
            : 'New feature'
        }
      >
        <Stack gap="sm">
          {featureError ? (
            <Alert color="red" variant="light">
              {featureError}
            </Alert>
          ) : null}

          <ScrollArea.Autosize mah={360} type="auto">
            <Stack gap="xs" pr="xs">
              {editableFeatureColumns.length === 0 ? (
                <Text c="dimmed" size="sm">
                  Geometry only.
                </Text>
              ) : null}

              {editableFeatureColumns.map((column) =>
                isBooleanColumnType(column.type) ? (
                  <Select
                    clearable
                    data={[
                      { label: 'true', value: 'true' },
                      { label: 'false', value: 'false' },
                    ]}
                    key={column.name}
                    label={`${column.name} (${column.type})`}
                    onChange={(value) =>
                      handleFeatureValueChange(column.name, value ?? '')
                    }
                    value={featureValues[column.name] ?? ''}
                  />
                ) : (
                  <TextInput
                    key={column.name}
                    label={`${column.name} (${column.type})`}
                    onChange={(event) =>
                      handleFeatureValueChange(
                        column.name,
                        event.currentTarget.value,
                      )
                    }
                    value={featureValues[column.name] ?? ''}
                  />
                ),
              )}
            </Stack>
          </ScrollArea.Autosize>

          <Group justify="flex-end">
            <Button
              leftSection={<IconX size={16} />}
              onClick={handleCancelPolygonDraw}
              variant="default"
            >
              Cancel
            </Button>
            <Button
              leftSection={<IconDeviceFloppy size={16} />}
              loading={isSavingFeature}
              onClick={() => void handleSaveFeature()}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

      {!isMapReady ? (
        <Center
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(135deg, rgba(228,240,255,0.95) 0%, rgba(231,245,255,0.95) 35%, rgba(255,249,219,0.92) 100%)',
          }}
        >
          <Center>
            <Loader size="sm" />
            <Text c="dimmed" ml="sm" size="sm">
              Loading map...
            </Text>
          </Center>
        </Center>
      ) : null}

      {isMapReady &&
      (isLoadingSources || isLoadingVectorTiles || layerError) ? (
        <Box
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 2,
            maxWidth: 320,
          }}
        >
          <Box
            bg="rgba(255,255,255,0.92)"
            p="sm"
            style={{
              border: '1px solid var(--mantine-color-gray-3)',
              borderRadius: 'var(--mantine-radius-md)',
              backdropFilter: 'blur(6px)',
            }}
          >
            <Stack gap={4}>
              {isLoadingSources || isLoadingVectorTiles ? (
                <Box
                  style={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: 8,
                  }}
                >
                  <Loader size={14} />
                  <Text c="dimmed" size="xs">
                    Loading visible layers...
                  </Text>
                </Box>
              ) : null}
              {layerError ? (
                <Text c="red" size="xs">
                  {layerError}
                </Text>
              ) : null}
            </Stack>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
