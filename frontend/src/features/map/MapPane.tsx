import { Box, Center, Loader, Text } from '@mantine/core';
import { MapboxOverlay } from '@deck.gl/mapbox';
import maplibregl, {
  NavigationControl,
  type StyleSpecification,
} from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useEffect, useRef, useState } from 'react';

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

export function MapPane() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);

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
    </Box>
  );
}
