import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { Layer } from '@deck.gl/core';
import { ArcLayer, ScatterplotLayer } from '@deck.gl/layers';

import {
  geographicRows,
  numeric,
  optionsFor,
  type Row,
  rowFilters,
} from './chart-utils';
import type { Chart, Filter, QueryResult } from './types';

export interface GeographicLayerResult {
  chart: Chart;
  data: QueryResult;
}

const heatColors = [
  [239, 243, 255],
  [198, 219, 239],
  [158, 202, 225],
  [107, 174, 214],
  [49, 130, 189],
  [8, 81, 156],
] as const;
const alternateHeatColors = [
  [255, 255, 204],
  [255, 237, 160],
  [254, 178, 76],
  [253, 141, 60],
  [240, 59, 32],
  [189, 0, 38],
] as const;

export function createGeographicDeckLayers(
  entries: GeographicLayerResult[],
  layerId: string,
  onSelect?: (filters: Filter[]) => void,
): Layer[] {
  return entries.flatMap<Layer>(({ chart, data }, index) => {
    const options = optionsFor(chart);
    const dimensions = chart.query.dimensions || [];
    const longitude = options.longitudeFieldId || dimensions[0];
    const latitude = options.latitudeFieldId || dimensions[1];
    const targetLongitude = options.targetLongitudeFieldId || dimensions[2];
    const targetLatitude = options.targetLatitudeFieldId || dimensions[3];
    const weight = options.weightMetricId || chart.query.metrics?.[0];
    const records = geographicRows(chart, data);
    const position = (row: Row): [number, number] => [
      Number(row[longitude]),
      Number(row[latitude]),
    ];
    const shared = {
      id: `${layerId}:${chart.id}:${index}`,
      data: records,
      pickable: Boolean(onSelect),
      onClick: (info: { object?: Row }) => {
        if (info.object) onSelect?.(rowFilters(chart, info.object));
        return true;
      },
    };
    if (chart.type === 'geoArc')
      return [
        new ArcLayer<Row>({
          ...shared,
          getSourcePosition: position,
          getTargetPosition: (row) => [
            Number(row[targetLongitude]),
            Number(row[targetLatitude]),
          ],
          getSourceColor: [34, 139, 230],
          getTargetColor: [250, 82, 82],
          getWidth: (row) =>
            weight
              ? Math.max(1, Math.min(10, Math.sqrt(numeric(row[weight]) ?? 1)))
              : 2,
        }),
      ];
    return [
      new HeatmapLayer<Row>({
        ...shared,
        id: `${shared.id}:heat`,
        getPosition: position,
        getWeight: (row) =>
          weight ? Math.max(0, numeric(row[weight]) ?? 0) : 1,
        radiusPixels: options.radius || 30,
        opacity: index ? 0.5 : 0.8,
        colorRange: (index % 2 ? alternateHeatColors : heatColors).map(
          (color) => [...color],
        ),
      }),
      new ScatterplotLayer<Row>({
        ...shared,
        id: `${shared.id}:pick`,
        getPosition: position,
        getRadius: 5,
        radiusUnits: 'pixels',
        getFillColor: [34, 139, 230, 25],
      }),
    ];
  });
}
