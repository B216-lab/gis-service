import { GeoJsonLayer } from '@deck.gl/layers';
import { Box, Center, Loader, Stack, Text } from '@mantine/core';
import { MapboxOverlay } from '@deck.gl/mapbox';
import maplibregl, {
  LngLatBounds,
  NavigationControl,
  type StyleSpecification,
} from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useEffect, useRef, useState } from 'react';

import type { DatabaseConnection, ImportedLayer } from '../connections/store';
import { fetchLayerFeatures, type GeoJsonFeatureCollection } from './api';

const defaultCenter: [number, number] = [104.295, 52.302];

const fallbackStyle: StyleSpecification = {
  version: 8,
  sources: {
    'osm-raster': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-raster-layer',
      type: 'raster',
      source: 'osm-raster',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

declare global {
  interface Window {
    __geopanelPmtilesProtocolRegistered?: boolean;
  }
}

interface LoadedMapLayer {
  layer: ImportedLayer;
  data: GeoJsonFeatureCollection;
}

type LayerSourceCache = Record<string, GeoJsonFeatureCollection>;

function registerPmtilesProtocol() {
  if (window.__geopanelPmtilesProtocolRegistered) {
    return;
  }

  const protocol = new Protocol({ metadata: true });
  maplibregl.addProtocol('pmtiles', protocol.tile);
  window.__geopanelPmtilesProtocolRegistered = true;
}

function resolveMapStyle() {
  const styleUrl = import.meta.env.VITE_MAP_STYLE_URL;

  if (styleUrl) {
    return styleUrl;
  }

  return fallbackStyle;
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

function computeBounds(layers: LoadedMapLayer[]) {
  const bounds = new LngLatBounds();
  let hasCoordinates = false;

  for (const loadedLayer of layers) {
    for (const feature of loadedLayer.data.features) {
      if (!feature.geometry) {
        continue;
      }

      visitCoordinates(feature.geometry.coordinates, (longitude, latitude) => {
        bounds.extend([longitude, latitude]);
        hasCoordinates = true;
      });
    }
  }

  return hasCoordinates ? bounds : null;
}

function createGeoJsonDeckLayer(loadedLayer: LoadedMapLayer) {
  const color = hexToRgba(loadedLayer.layer.color, loadedLayer.layer.opacity);
  const isLineLayer = /line/i.test(loadedLayer.layer.geometryType);
  const isPointLayer = /point/i.test(loadedLayer.layer.geometryType);

  return new GeoJsonLayer({
    id: loadedLayer.layer.id,
    data: loadedLayer.data as never,
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

function getLayerSourceKey(connectionId: string, layer: ImportedLayer) {
  return [connectionId, layer.schema, layer.table, layer.geometryColumn].join(
    ':',
  );
}

export function MapPane({
  connection,
  visibleLayers,
}: {
  connection: DatabaseConnection | null;
  visibleLayers: ImportedLayer[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const sourceCacheRef = useRef<LayerSourceCache>({});
  const fittedSourceKeysRef = useRef<string>('');
  const [isMapReady, setIsMapReady] = useState(false);
  const [isLoadingLayers, setIsLoadingLayers] = useState(false);
  const [layerError, setLayerError] = useState('');
  const [cacheVersion, setCacheVersion] = useState(0);

  const visibleLayerSourceSignature = connection
    ? visibleLayers
        .map((layer) => getLayerSourceKey(connection.id, layer))
        .sort()
        .join('|')
    : '';

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
      style: resolveMapStyle(),
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

    map.once('load', () => {
      setIsMapReady(true);
      map.resize();
    });

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      overlayRef.current?.finalize();
      overlayRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isMapReady || !overlayRef.current) {
      return;
    }

    if (!connection || connection.testStatus !== 'success') {
      overlayRef.current.setProps({ layers: [] });
      sourceCacheRef.current = {};
      fittedSourceKeysRef.current = '';
      setLayerError('');
      setIsLoadingLayers(false);
      return;
    }

    if (visibleLayers.length === 0) {
      overlayRef.current.setProps({ layers: [] });
      fittedSourceKeysRef.current = '';
      setLayerError('');
      setIsLoadingLayers(false);
      return;
    }

    const activeConnection = connection;
    const missingLayers = visibleLayers.filter((layer) => {
      const sourceKey = getLayerSourceKey(activeConnection.id, layer);
      return !sourceCacheRef.current[sourceKey];
    });

    if (missingLayers.length === 0) {
      setLayerError('');
      setIsLoadingLayers(false);
      return;
    }

    let isActive = true;
    const abortController = new AbortController();
    setIsLoadingLayers(true);
    setLayerError('');

    async function loadMissingLayers() {
      try {
        const loadedEntries = await Promise.all(
          missingLayers.map(async (layer) => {
            const sourceKey = getLayerSourceKey(activeConnection.id, layer);
            const response = await fetchLayerFeatures(
              activeConnection,
              layer,
              abortController.signal,
            );

            return [sourceKey, response.data] as const;
          }),
        );

        if (!isActive) {
          return;
        }

        const nextCache = { ...sourceCacheRef.current };
        for (const [sourceKey, data] of loadedEntries) {
          nextCache[sourceKey] = data;
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
          setIsLoadingLayers(false);
        }
      }
    }

    void loadMissingLayers();

    return () => {
      isActive = false;
      abortController.abort();
    };
  }, [connection, isMapReady, visibleLayerSourceSignature, visibleLayers]);

  useEffect(() => {
    if (!isMapReady || !overlayRef.current) {
      return;
    }

    if (!connection || connection.testStatus !== 'success') {
      overlayRef.current.setProps({ layers: [] });
      return;
    }

    const loadedLayers = visibleLayers.flatMap((layer) => {
      const sourceKey = getLayerSourceKey(connection.id, layer);
      const data = sourceCacheRef.current[sourceKey];

      if (!data) {
        return [];
      }

      return [{ layer, data }];
    });

    overlayRef.current.setProps({
      layers: loadedLayers.map(createGeoJsonDeckLayer),
    });

    if (loadedLayers.length === 0) {
      return;
    }

    if (visibleLayerSourceSignature !== fittedSourceKeysRef.current) {
      const bounds = computeBounds(loadedLayers);
      if (bounds && mapRef.current) {
        mapRef.current.fitBounds(bounds, {
          padding: 48,
          duration: 700,
        });
      }
      fittedSourceKeysRef.current = visibleLayerSourceSignature;
    }
  }, [
    cacheVersion,
    connection,
    isMapReady,
    visibleLayerSourceSignature,
    visibleLayers,
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

      {isMapReady && (isLoadingLayers || layerError) ? (
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
              {isLoadingLayers ? (
                <Text c="dimmed" size="xs">
                  Loading visible layers...
                </Text>
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
