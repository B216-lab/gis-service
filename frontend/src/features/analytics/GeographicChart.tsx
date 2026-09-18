import { MapboxOverlay } from '@deck.gl/mapbox';
import { Alert, Box, Button, Stack } from '@mantine/core';
import { Map as LibreMap, NavigationControl } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { getBasemapStyle } from '../map/basemaps';
import type { ChartRendererProps } from './ChartRenderer';
import { geographicRows, optionsFor, type Row } from './chart-utils';
import { createGeographicDeckLayers } from './geographic-deck-layers';
import 'maplibre-gl/dist/maplibre-gl.css';

export default function GeographicChart({
  chart,
  data,
  layers,
  onSelect,
  height = 360,
}: ChartRendererProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [error, setError] = useState('');
  const fitted = useRef(false);
  useEffect(() => {
    if (!container.current) return;
    let map: LibreMap;
    try {
      map = new LibreMap({
        container: container.current,
        style: getBasemapStyle('light'),
        center: [104.3, 52.3],
        zoom: 9,
      });
      map.addControl(new NavigationControl(), 'top-right');
      const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
      map.addControl(overlay);
      mapRef.current = map;
      overlayRef.current = overlay;
      const observer = new ResizeObserver(() => map.resize());
      observer.observe(container.current);
      return () => {
        observer.disconnect();
        mapRef.current = null;
        overlayRef.current = null;
        fitted.current = false;
        map.remove();
      };
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'WebGL map unavailable.',
      );
    }
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    if (!map || !overlay) return;
    const entries =
      chart.type === 'compositeMap'
        ? layers || []
        : data
          ? [{ chart, data }]
          : [];
    const bounds: [number, number][] = [];
    const deckLayers = createGeographicDeckLayers(
      entries,
      'analytics',
      onSelectRef.current,
    );
    for (const { chart: layerChart, data: result } of entries) {
      const options = optionsFor(layerChart);
      const dimensions = layerChart.query.dimensions || [];
      const longitude = options.longitudeFieldId || dimensions[0];
      const latitude = options.latitudeFieldId || dimensions[1];
      const targetLongitude = options.targetLongitudeFieldId || dimensions[2];
      const targetLatitude = options.targetLatitudeFieldId || dimensions[3];
      const records = geographicRows(layerChart, result);
      const position = (row: Row): [number, number] => [
        Number(row[longitude]),
        Number(row[latitude]),
      ];
      for (const row of records) {
        bounds.push(position(row));
        if (layerChart.type === 'geoArc')
          bounds.push([
            Number(row[targetLongitude]),
            Number(row[targetLatitude]),
          ]);
      }
    }
    overlay.setProps({ layers: deckLayers });
    if (!fitted.current && bounds.length) {
      const extent = bounds.reduce(
        (e, p) => [
          Math.min(e[0], p[0]),
          Math.min(e[1], p[1]),
          Math.max(e[2], p[0]),
          Math.max(e[3], p[1]),
        ],
        [180, 90, -180, -90],
      );
      map.fitBounds(
        [
          [extent[0], extent[1]],
          [extent[2], extent[3]],
        ],
        { padding: 35, maxZoom: 13, duration: 0 },
      );
      fitted.current = true;
    }
  }, [chart, data, layers]);
  function filterViewport() {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const o = optionsFor(chart);
    const dims = chart.query.dimensions || [];
    const lon = o.longitudeFieldId || dims[0];
    const lat = o.latitudeFieldId || dims[1];
    if (lon && lat)
      onSelectRef.current?.([
        {
          datasetId: chart.datasetId,
          fieldId: lon,
          operator: 'between',
          values: [b.getWest(), b.getEast()],
        },
        {
          datasetId: chart.datasetId,
          fieldId: lat,
          operator: 'between',
          values: [b.getSouth(), b.getNorth()],
        },
      ]);
  }
  return (
    <Stack gap={4}>
      {error && <Alert color="red">{error}</Alert>}
      <Box
        ref={container}
        h={height}
        w="100%"
        aria-label={`${chart.name} map`}
      />
      {onSelect && chart.type !== 'compositeMap' && (
        <Button size="compact-xs" variant="subtle" onClick={filterViewport}>
          Filter to visible map area
        </Button>
      )}
    </Stack>
  );
}
