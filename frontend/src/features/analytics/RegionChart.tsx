import { Alert, Box, useComputedColorScheme } from '@mantine/core';
import { MapChart } from 'echarts/charts';
import { TooltipComponent, VisualMapComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useId, useRef, useState } from 'react';
import type { ChartRendererProps } from './ChartRenderer';
import { label, numeric, type Row, selectionFilters } from './chart-utils';

echarts.use([MapChart, TooltipComponent, VisualMapComponent, CanvasRenderer]);

export default function RegionChart({
  chart,
  data,
  onSelect,
  selection,
  height = 360,
}: ChartRendererProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapName = useId();
  const colorScheme = useComputedColorScheme('light');
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRows = useRef<Row[]>([]);
  const [error, setError] = useState('');
  const instanceRef = useRef<echarts.EChartsType | null>(null);

  useEffect(() => {
    if (!selection?.length) {
      selectedRows.current = [];
      instanceRef.current?.dispatchAction({ type: 'downplay' });
    }
  }, [selection]);

  useEffect(() => {
    if (!container.current) return;
    const [region, geometryField] = chart.query.dimensions || [];
    const metric = chart.query.metrics?.[0] || '';
    const rows = data?.rows || [];
    let instance: echarts.EChartsType | undefined;
    let observer: ResizeObserver | undefined;
    try {
      const features = rows.map((row) => {
        const value = row[geometryField];
        const geometry = typeof value === 'string' ? JSON.parse(value) : value;
        if (
          !geometry ||
          !['Polygon', 'MultiPolygon'].includes(geometry.type) ||
          !Array.isArray(geometry.coordinates) ||
          !geometry.coordinates.length
        )
          throw new Error(
            'Region map requires GeoJSON Polygon or MultiPolygon geometries.',
          );
        return {
          type: 'Feature',
          properties: { name: label(row[region]) },
          geometry,
        };
      });
      echarts.registerMap(
        mapName,
        JSON.stringify({ type: 'FeatureCollection', features }),
      );
      instance = echarts.init(
        container.current,
        colorScheme === 'dark' ? 'dark' : undefined,
      );
      instanceRef.current = instance;
      instance.setOption({
        animation: false,
        backgroundColor: 'transparent',
        tooltip: { trigger: 'item', renderMode: 'richText' },
        visualMap: {
          min: 0,
          max: Math.max(1, ...rows.map((row) => numeric(row[metric]) ?? 0)),
          left: 8,
          bottom: 8,
          calculable: true,
          inRange: { color: ['#d0ebff', '#339af0', '#1864ab'] },
        },
        series: [
          {
            type: 'map',
            map: mapName,
            roam: true,
            name:
              chart.options?.metricLabels &&
              typeof chart.options.metricLabels === 'object'
                ? (chart.options.metricLabels as Record<string, string>)[
                    metric
                  ] || metric
                : metric,
            emphasis: {
              label: { show: true },
              itemStyle: { areaColor: '#fab005' },
            },
            data: rows.map((row) => ({
              name: label(row[region]),
              value: numeric(row[metric]) ?? 0,
            })),
          },
        ],
      });
      instance.on('click', (event: unknown) => {
        const e = event as {
          name?: string;
          event?: {
            event?: {
              ctrlKey?: boolean;
              metaKey?: boolean;
              shiftKey?: boolean;
            };
          };
        };
        const row = rows.find(
          (candidate) => label(candidate[region]) === e.name,
        );
        if (!row) return;
        const multiple =
          e.event?.event?.ctrlKey ||
          e.event?.event?.metaKey ||
          e.event?.event?.shiftKey;
        selectedRows.current = multiple
          ? selectedRows.current.some((item) => item[region] === row[region])
            ? selectedRows.current.filter(
                (item) => item[region] !== row[region],
              )
            : [...selectedRows.current, row]
          : [row];
        onSelectRef.current?.(selectionFilters(chart, selectedRows.current));
        instance?.dispatchAction({ type: 'downplay' });
        for (const selected of selectedRows.current)
          instance?.dispatchAction({
            type: 'highlight',
            name: label(selected[region]),
          });
      });
      observer = new ResizeObserver(() => instance?.resize());
      observer.observe(container.current);
      setError('');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Region map unavailable.',
      );
    }
    return () => {
      observer?.disconnect();
      instance?.dispose();
      instanceRef.current = null;
    };
  }, [chart, data, mapName, colorScheme]);

  return (
    <>
      {error && <Alert color="red">{error}</Alert>}
      <Box
        ref={container}
        h={height}
        w="100%"
        role="img"
        aria-label={`${chart.name} region map. Click a region to filter; Ctrl or Shift click to select multiple.`}
      />
    </>
  );
}
