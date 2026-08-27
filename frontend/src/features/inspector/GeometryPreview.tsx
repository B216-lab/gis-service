import {
  ActionIcon,
  Badge,
  Box,
  Center,
  Group,
  Stack,
  Text,
} from '@mantine/core';
import { IconBrandGoogleMaps } from '@tabler/icons-react';
import maplibregl, { LngLatBounds } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

import { type BasemapId, getBasemapStyle } from '../map/basemaps';

interface GeometryPreviewEntry {
  label: string;
  type?: string;
  value: unknown;
}

type PreviewGeometry = {
  type: string;
  coordinates?: unknown;
  geometries?: PreviewGeometry[];
};

export function GeometryMapPreviewList({
  basemapId,
  entries,
}: {
  basemapId: BasemapId;
  entries: GeometryPreviewEntry[];
}) {
  return (
    <Stack gap="xs">
      {entries.map((entry) => (
        <GeometryMapPreview
          basemapId={basemapId}
          entry={entry}
          key={entry.label}
        />
      ))}
    </Stack>
  );
}

function GeometryMapPreview({
  basemapId,
  entry,
}: {
  basemapId: BasemapId;
  entry: GeometryPreviewEntry;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const geometry = parsePreviewGeometry(entry.value);
  const googleMapsUrl = geometry ? googleMapsPointUrl(geometry) : null;

  useEffect(() => {
    if (!containerRef.current || !geometry) {
      return;
    }

    const map = new maplibregl.Map({
      attributionControl: false,
      center: [0, 0],
      container: containerRef.current,
      cooperativeGestures: false,
      interactive: false,
      style: getBasemapStyle(basemapId),
      zoom: 1,
    });

    map.on('load', () => {
      const featureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry,
            properties: {},
          },
        ],
      } as GeoJSON.FeatureCollection;

      map.addSource('preview-geometry', {
        type: 'geojson',
        data: featureCollection,
      });
      map.addLayer({
        id: 'preview-fill',
        type: 'fill',
        source: 'preview-geometry',
        paint: {
          'fill-color': '#2f9e44',
          'fill-opacity': 0.26,
        },
      });
      map.addLayer({
        id: 'preview-line',
        type: 'line',
        source: 'preview-geometry',
        paint: {
          'line-color': '#2b8a3e',
          'line-width': 3,
        },
      });
      map.addLayer({
        id: 'preview-point',
        type: 'circle',
        source: 'preview-geometry',
        paint: {
          'circle-color': '#2f9e44',
          'circle-radius': 5,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });

      fitPreviewGeometry(map, geometry);
      map.resize();
    });

    return () => {
      map.remove();
    };
  }, [basemapId, geometry]);

  return (
    <Stack gap={4}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Text fw={600} size="xs">
            {entry.label}
          </Text>
          {entry.type ? (
            <Badge color="gray" size="xs" variant="outline">
              {entry.type}
            </Badge>
          ) : null}
        </Group>
        {googleMapsUrl ? (
          <ActionIcon
            aria-label="Open in Google Maps"
            component="a"
            href={googleMapsUrl}
            rel="noopener noreferrer"
            size="sm"
            target="_blank"
            title="Open in Google Maps"
            variant="subtle"
          >
            <IconBrandGoogleMaps size={16} />
          </ActionIcon>
        ) : null}
      </Group>
      {geometry ? (
        <Box
          ref={containerRef}
          style={{
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 6,
            height: 180,
            overflow: 'hidden',
          }}
        />
      ) : (
        <Center
          h={92}
          style={{
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 6,
          }}
        >
          <Text c="dimmed" size="xs">
            Geometry preview unavailable
          </Text>
        </Center>
      )}
    </Stack>
  );
}

export function parsePreviewGeometry(value: unknown): PreviewGeometry | null {
  if (typeof value === 'string') {
    try {
      return parsePreviewGeometry(JSON.parse(value));
    } catch {
      return null;
    }
  }

  if (
    value === null ||
    typeof value !== 'object' ||
    !('type' in value) ||
    typeof value.type !== 'string'
  ) {
    return null;
  }

  if ('coordinates' in value || 'geometries' in value) {
    return value as PreviewGeometry;
  }

  return null;
}

export function googleMapsPointUrl(geometry: PreviewGeometry) {
  if (geometry.type.toLowerCase() !== 'point') {
    return null;
  }

  const coordinates = geometry.coordinates;
  if (
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    typeof coordinates[0] !== 'number' ||
    typeof coordinates[1] !== 'number'
  ) {
    return null;
  }

  const [longitude, latitude] = coordinates;
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null;
  }

  const query = encodeURIComponent(`${latitude},${longitude}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function fitPreviewGeometry(map: maplibregl.Map, geometry: PreviewGeometry) {
  const positions = collectPreviewPositions(geometry);

  if (positions.length === 0) {
    return;
  }

  if (positions.length === 1) {
    map.setCenter(positions[0]);
    map.setZoom(14);
    return;
  }

  const bounds = positions.reduce(
    (nextBounds, position) => nextBounds.extend(position),
    new LngLatBounds(positions[0], positions[0]),
  );

  map.fitBounds(bounds, {
    duration: 0,
    maxZoom: 15,
    padding: 28,
  });
}

export function collectPreviewPositions(
  geometry: PreviewGeometry,
): [number, number][] {
  if (geometry.type === 'GeometryCollection') {
    return (geometry.geometries ?? []).flatMap(collectPreviewPositions);
  }

  return collectPositionsFromCoordinates(geometry.coordinates);
}

function collectPositionsFromCoordinates(value: unknown): [number, number][] {
  if (!Array.isArray(value)) {
    return [];
  }

  if (
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  ) {
    return [[value[0], value[1]]];
  }

  return value.flatMap(collectPositionsFromCoordinates);
}
