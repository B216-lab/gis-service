import { GeoJsonLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { FlowmapLayer } from '@flowmap.gl/layers';
import { Box, Center, Loader, Stack, Text } from '@mantine/core';
import maplibregl, { LngLatBounds, NavigationControl } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useEffect, useRef, useState } from 'react';

import type {
  DatabaseConnection,
  FlowmapMapLayer,
  GeoJsonMapLayer,
  GeoJsonTableSource,
  MapLayer,
  MapSource,
} from '../connections/store';
import {
  type FlowmapDataResponse,
  fetchFlowmapSourceData,
  fetchGeoJsonSourceData,
  fetchGeoJsonSourceExtent,
  type GeoBounds,
  type GeoJsonFeatureCollection,
} from './api';
import { type BasemapId, getBasemapStyle } from './basemaps';
import type { MapSelection, RowReference } from './selection';

const defaultCenter: [number, number] = [104.295, 52.302];

declare global {
  interface Window {
    __geopanelPmtilesProtocolRegistered?: boolean;
  }
}

type GeoJsonSourceData = {
  sourceType: 'geojson-table';
  data: GeoJsonFeatureCollection;
};

type FlowmapSourceData = {
  sourceType: 'flowmap-table';
  data: FlowmapDataResponse;
};

type LoadedSourceData = GeoJsonSourceData | FlowmapSourceData;
type SourceCacheEntry = {
  signature: string;
  bounds: GeoBounds | null;
  payload: LoadedSourceData;
};
type SourceDataCache = Record<string, SourceCacheEntry>;
type SourceExtentCacheEntry = {
  signature: string;
  bounds: GeoBounds | null;
};
type SourceExtentCache = Record<string, SourceExtentCacheEntry>;

const geoJsonFetchBufferRatio = 0.5;

function roundCoordinate(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function getSourceSignature(source: MapSource) {
  return JSON.stringify(source);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function expandGeoBounds(bounds: GeoBounds, ratio: number): GeoBounds {
  const longitudePadding = (bounds.east - bounds.west) * ratio;
  const latitudePadding = (bounds.north - bounds.south) * ratio;

  return {
    west: roundCoordinate(clamp(bounds.west - longitudePadding, -180, 180)),
    south: roundCoordinate(clamp(bounds.south - latitudePadding, -90, 90)),
    east: roundCoordinate(clamp(bounds.east + longitudePadding, -180, 180)),
    north: roundCoordinate(clamp(bounds.north + latitudePadding, -90, 90)),
  };
}

function boundsContain(container: GeoBounds | null, inner: GeoBounds | null) {
  if (!container || !inner) {
    return false;
  }

  return (
    container.west <= inner.west &&
    container.south <= inner.south &&
    container.east >= inner.east &&
    container.north >= inner.north
  );
}

function registerPmtilesProtocol() {
  if (window.__geopanelPmtilesProtocolRegistered) {
    return;
  }

  const protocol = new Protocol({ metadata: true });
  maplibregl.addProtocol('pmtiles', protocol.tile);
  window.__geopanelPmtilesProtocolRegistered = true;
}

function hexToRgba(hex: string, opacity: number) {
  const normalized = hex.replace('#', '');
  const fullHex =
    normalized.length === 3
      ? normalized
          .split('')
          .map((character) => `${character}${character}`)
          .join('')
      : normalized.padEnd(6, '0').slice(0, 6);

  return [
    Number.parseInt(fullHex.slice(0, 2), 16),
    Number.parseInt(fullHex.slice(2, 4), 16),
    Number.parseInt(fullHex.slice(4, 6), 16),
    Math.round((opacity / 100) * 255),
  ] as [number, number, number, number];
}

function visitCoordinates(
  coordinates: unknown,
  callback: (longitude: number, latitude: number) => void,
) {
  if (
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    typeof coordinates[0] === 'number' &&
    typeof coordinates[1] === 'number'
  ) {
    callback(coordinates[0], coordinates[1]);
    return;
  }

  if (Array.isArray(coordinates)) {
    for (const value of coordinates) {
      visitCoordinates(value, callback);
    }
  }
}

function extendBoundsWithSourceData(
  bounds: LngLatBounds,
  sourceData: LoadedSourceData,
) {
  if (sourceData.sourceType === 'geojson-table') {
    for (const feature of sourceData.data.features) {
      if (!feature.geometry) {
        continue;
      }

      visitCoordinates(feature.geometry.coordinates, (longitude, latitude) => {
        bounds.extend([longitude, latitude]);
      });
    }

    return;
  }

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

function createGeoJsonDeckLayer(
  layer: GeoJsonMapLayer,
  source: GeoJsonTableSource,
  sourceData: GeoJsonFeatureCollection,
) {
  const color = hexToRgba(layer.color, layer.opacity);
  const isLineLayer = /line/i.test(source.geometryType);
  const isPointLayer = /point/i.test(source.geometryType);

  return new GeoJsonLayer({
    id: layer.id,
    data: sourceData as never,
    pickable: true,
    stroked: true,
    filled: !isLineLayer,
    pointType: 'circle',
    lineWidthMinPixels: isPointLayer ? 0 : 2,
    getLineColor: color,
    getFillColor: isLineLayer ? [0, 0, 0, 0] : color,
    getPointRadius: 6,
    getLineWidth: isLineLayer ? 3 : 2,
    getRadius: 6,
  });
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

async function fetchSourceData(
  connection: DatabaseConnection,
  source: MapSource,
  viewportBounds: GeoBounds | null,
  signal?: AbortSignal,
): Promise<LoadedSourceData> {
  if (source.type === 'geojson-table') {
    if (!viewportBounds) {
      throw new Error('Viewport bounds are required to load map features.');
    }

    const response = await fetchGeoJsonSourceData(
      connection,
      source,
      viewportBounds,
      signal,
    );
    return {
      sourceType: 'geojson-table',
      data: response.data,
    };
  }

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
  const fittedSourceIdsRef = useRef<string>('');
  const [isMapReady, setIsMapReady] = useState(false);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [layerError, setLayerError] = useState('');
  const [cacheVersion, setCacheVersion] = useState(0);
  const [extentVersion, setExtentVersion] = useState(0);
  const [styleVersion, setStyleVersion] = useState(0);
  const [viewportBounds, setViewportBounds] = useState<GeoBounds | null>(null);

  const visibleSourceIds = Array.from(
    new Set(visibleLayers.map((layer) => layer.sourceId)),
  );
  const visibleSources = visibleSourceIds.flatMap((sourceId) => {
    const source = sources.find((candidate) => candidate.id === sourceId);
    return source ? [source] : [];
  });
  const visibleSourceSignature = visibleSourceIds.sort().join('|');
  const geoJsonVisibleSources = visibleSources.filter(
    (source): source is GeoJsonTableSource => source.type === 'geojson-table',
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

    function syncViewportBounds() {
      const nextBounds = map.getBounds();
      setViewportBounds({
        west: nextBounds.getWest(),
        south: nextBounds.getSouth(),
        east: nextBounds.getEast(),
        north: nextBounds.getNorth(),
      });
    }

    map.once('load', () => {
      setIsMapReady(true);
      map.resize();
      syncViewportBounds();
    });
    map.on('moveend', syncViewportBounds);

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      map.off('moveend', syncViewportBounds);
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
      fittedSourceIdsRef.current = '';
      setLayerError('');
      setIsLoadingSources(false);
      onSelectMapObject(null);
      return;
    }

    if (visibleSources.length === 0) {
      overlayRef.current.setProps({ layers: [] });
      fittedSourceIdsRef.current = '';
      setLayerError('');
      setIsLoadingSources(false);
      onSelectMapObject(null);
      return;
    }

    if (
      visibleSources.some((source) => source.type === 'geojson-table') &&
      !viewportBounds
    ) {
      return;
    }

    const missingSources = visibleSources.filter((source) => {
      const cacheEntry = sourceCacheRef.current[source.id];
      if (!cacheEntry || cacheEntry.signature !== getSourceSignature(source)) {
        return true;
      }

      return (
        source.type === 'geojson-table' &&
        !boundsContain(cacheEntry.bounds, viewportBounds)
      );
    });

    if (missingSources.length === 0) {
      setLayerError('');
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
            const fetchBounds =
              source.type === 'geojson-table' && viewportBounds
                ? expandGeoBounds(viewportBounds, geoJsonFetchBufferRatio)
                : null;
            const data = await fetchSourceData(
              activeConnection,
              source,
              fetchBounds,
              abortController.signal,
            );

            return [
              source.id,
              {
                signature: getSourceSignature(source),
                bounds: fetchBounds,
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
  }, [
    connection,
    isMapReady,
    onSelectMapObject,
    viewportBounds,
    visibleSources,
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
      onSelectMapObject(null);
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
        layer.type === 'geojson' &&
        source.type === 'geojson-table' &&
        sourceData.payload.sourceType === 'geojson-table'
      ) {
        layersList.push(
          createGeoJsonDeckLayer(layer, source, sourceData.payload.data),
        );
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
          onSelectMapObject(null);
          return;
        }

        const layer = resolvePickedMapLayer(pickedLayerId, visibleLayers);
        if (!layer) {
          onSelectMapObject(null);
          return;
        }

        const source = sources.find(
          (candidate) => candidate.id === layer.sourceId,
        );
        if (!source) {
          onSelectMapObject(null);
          return;
        }

        onSelectMapObject(buildMapSelection(pickInfo.object, layer, source));
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
    onSelectMapObject,
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

      {isMapReady && (isLoadingSources || layerError) ? (
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
              {isLoadingSources ? (
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
