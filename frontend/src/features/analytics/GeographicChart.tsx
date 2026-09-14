import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { Layer } from '@deck.gl/core';
import { ArcLayer, ScatterplotLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { Alert, Box, Button, Stack } from '@mantine/core';
import { Map as LibreMap, NavigationControl } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { getBasemapStyle } from '../map/basemaps';
import type { ChartRendererProps } from './ChartRenderer';
import {
  geographicRows,
  numeric,
  optionsFor,
  type Row,
  rowFilters,
} from './chart-utils';
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
    const deckLayers = entries.flatMap<Layer>(
      ({ chart: layerChart, data: result }, index) => {
        const o = optionsFor(layerChart);
        const dims = layerChart.query.dimensions || [];
        const lon = o.longitudeFieldId || dims[0];
        const lat = o.latitudeFieldId || dims[1];
        const endLon = o.targetLongitudeFieldId || dims[2];
        const endLat = o.targetLatitudeFieldId || dims[3];
        const weight = o.weightMetricId || layerChart.query.metrics?.[0];
        const records = geographicRows(layerChart, result);
        const position = (row: Row): [number, number] => [
          Number(row[lon]),
          Number(row[lat]),
        ];
        for (const row of records) {
          bounds.push(position(row));
          if (layerChart.type === 'geoArc')
            bounds.push([Number(row[endLon]), Number(row[endLat])]);
        }
        const shared = {
          id: `analytics-${layerChart.id}-${index}`,
          data: records,
          pickable: true,
          onClick: (info: { object?: Row }) => {
            if (info.object)
              onSelectRef.current?.(rowFilters(layerChart, info.object));
            return true;
          },
        };
        if (layerChart.type === 'geoArc')
          return [
            new ArcLayer<Row>({
              ...shared,
              getSourcePosition: position,
              getTargetPosition: (row) => [
                Number(row[endLon]),
                Number(row[endLat]),
              ],
              getSourceColor: [34, 139, 230],
              getTargetColor: [250, 82, 82],
              getWidth: (row) =>
                weight
                  ? Math.max(
                      1,
                      Math.min(10, Math.sqrt(numeric(row[weight]) ?? 1)),
                    )
                  : 2,
            }),
          ];
        return [
          new HeatmapLayer<Row>({
            ...shared,
            id: `${shared.id}-heat`,
            getPosition: position,
            getWeight: (row) =>
              weight ? Math.max(0, numeric(row[weight]) ?? 0) : 1,
            radiusPixels: o.radius || 30,
            opacity: index ? 0.5 : 0.8,
            colorRange:
              index % 2
                ? [
                    [255, 255, 204],
                    [255, 237, 160],
                    [254, 178, 76],
                    [253, 141, 60],
                    [240, 59, 32],
                    [189, 0, 38],
                  ]
                : [
                    [239, 243, 255],
                    [198, 219, 239],
                    [158, 202, 225],
                    [107, 174, 214],
                    [49, 130, 189],
                    [8, 81, 156],
                  ],
          }),
          new ScatterplotLayer<Row>({
            ...shared,
            id: `${shared.id}-pick`,
            getPosition: position,
            getRadius: 5,
            radiusUnits: 'pixels',
            getFillColor: [34, 139, 230, 25],
          }),
        ];
      },
    );
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
