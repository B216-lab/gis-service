import { MapboxOverlay } from '@deck.gl/mapbox';
import { FlowmapLayer } from '@flowmap.gl/layers';
import { Box, Center, Loader, Stack, Text } from '@mantine/core';
import maplibregl, {
  LngLatBounds,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  type MapSourceDataEvent,
  NavigationControl,
} from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  DatabaseConnection,
  FlowmapMapLayer,
  FlowmapTableSource,
  GeoJsonMapLayer,
  GeoJsonTableSource,
  MapLayer,
  MapSource,
} from '../connections/store';
import {
  type FlowmapDataResponse,
  fetchFlowmapSourceData,
  fetchGeoJsonSourceExtent,
  type GeoBounds,
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

const vectorTileSourcePrefix = 'geopanel-source';
const vectorTileLayerPrefix = 'geopanel-layer';

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

function buildVectorMapSelection(
  feature: MapGeoJSONFeature,
  layer: GeoJsonMapLayer,
  source: GeoJsonTableSource,
): MapSelection {
  const properties = { ...(feature.properties ?? {}) };
  const primaryKey = parseJSONProperty(properties._geopanel_primary_key);
  const rowKey = parseJSONProperty(properties._geopanel_row_key);
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
    title: layer.name,
  };
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
  basemapId,
  connection,
  visibleLayers,
  sources,
  onSelectMapObject,
}: {
  basemapId: BasemapId;
  connection: DatabaseConnection | null;
  visibleLayers: MapLayer[];
  sources: MapSource[];
  onSelectMapObject: (selection: MapSelection | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const activeBasemapIdRef = useRef<BasemapId>(basemapId);
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
  const [layerError, setLayerError] = useState('');
  const [cacheVersion, setCacheVersion] = useState(0);
  const [extentVersion, setExtentVersion] = useState(0);
  const [styleVersion, setStyleVersion] = useState(0);

  visibleLayersRef.current = visibleLayers;
  sourcesRef.current = sources;
  onSelectMapObjectRef.current = onSelectMapObject;

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
      const currentVisibleLayers = visibleLayersRef.current;
      const currentSources = sourcesRef.current;
      const geoJsonLayers = currentVisibleLayers.filter(isGeoJsonMapLayer);
      const styleLayerIds = geoJsonLayers.flatMap(getVectorStyleLayerIds);
      const queryableLayerIds = styleLayerIds.filter((layerId) =>
        map.getLayer(layerId),
      );

      if (queryableLayerIds.length === 0) {
        onSelectMapObjectRef.current(null);
        return;
      }

      const [feature] = map.queryRenderedFeatures(event.point, {
        layers: queryableLayerIds,
      });
      if (!feature?.layer.id) {
        onSelectMapObjectRef.current(null);
        return;
      }

      const layer = geoJsonLayers.find((candidate) =>
        getVectorStyleLayerIds(candidate).includes(feature.layer.id),
      );
      if (!layer) {
        onSelectMapObjectRef.current(null);
        return;
      }

      const source = currentSources.find(
        (candidate): candidate is GeoJsonTableSource =>
          candidate.id === layer.sourceId && isGeoJsonTableSource(candidate),
      );
      if (!source) {
        onSelectMapObjectRef.current(null);
        return;
      }

      onSelectMapObjectRef.current(
        buildVectorMapSelection(feature, layer, source),
      );
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
    map.on('sourcedataloading', handleSourceDataLoading);
    map.on('sourcedata', handleSourceData);
    map.on('sourcedataabort', handleSourceDataAbort);
    map.on('error', handleMapError);
    map.on('idle', handleMapIdle);

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      map.off('click', handleMapClick);
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
        if (styleLayer.id.startsWith(vectorTileLayerPrefix)) {
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
    isMapReady,
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
