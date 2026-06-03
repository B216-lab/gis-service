import type { StyleSpecification } from 'maplibre-gl';

export const defaultBasemapId = 'light';

export const basemapOptions = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'Satellite', value: 'satellite' },
] as const;

export type BasemapId = (typeof basemapOptions)[number]['value'];
export type BasemapStyleDefinition = StyleSpecification | string;

const lightStyle: StyleSpecification = {
  version: 8,
  sources: {
    'osm-light': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-light-layer',
      type: 'raster',
      source: 'osm-light',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

const darkStyle: StyleSpecification = {
  version: 8,
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors © CARTO',
    },
  },
  layers: [
    {
      id: 'carto-dark-layer',
      type: 'raster',
      source: 'carto-dark',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

const satelliteStyle: StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Tiles © Esri',
    },
  },
  layers: [
    {
      id: 'satellite-layer',
      type: 'raster',
      source: 'satellite',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

const basemapStyles: Record<BasemapId, StyleSpecification> = {
  light: lightStyle,
  dark: darkStyle,
  satellite: satelliteStyle,
};

export function getBasemapStyle(
  basemapId: string | null | undefined,
): BasemapStyleDefinition {
  const normalizedBasemapId = basemapId ?? defaultBasemapId;

  if (normalizedBasemapId === 'light') {
    const legacyStyleUrl = import.meta.env.VITE_MAP_STYLE_URL;
    const lightStyleUrl = import.meta.env.VITE_MAP_STYLE_LIGHT_URL;

    if (lightStyleUrl || legacyStyleUrl) {
      return lightStyleUrl || legacyStyleUrl;
    }
  }

  if (normalizedBasemapId === 'dark') {
    const darkStyleUrl = import.meta.env.VITE_MAP_STYLE_DARK_URL;

    if (darkStyleUrl) {
      return darkStyleUrl;
    }
  }

  if (normalizedBasemapId === 'satellite') {
    const satelliteStyleUrl = import.meta.env.VITE_MAP_STYLE_SATELLITE_URL;

    if (satelliteStyleUrl) {
      return satelliteStyleUrl;
    }
  }

  return basemapStyles[normalizedBasemapId as BasemapId] ?? basemapStyles.light;
}
