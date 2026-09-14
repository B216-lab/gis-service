import type { Chart, Filter, QueryResult } from './types';

export const chartTypes = [
  { value: 'kpi', label: 'KPI' },
  { value: 'bar', label: 'Bar' },
  { value: 'pie', label: 'Pie' },
  { value: 'line', label: 'Line chart' },
  { value: 'matrixHeatmap', label: 'Matrix heatmap' },
  { value: 'calendarHeatmap', label: 'Calendar heatmap' },
  { value: 'geoHeatmap', label: 'Geographic heatmap' },
  { value: 'geoArc', label: 'Movement arcs' },
  { value: 'compositeMap', label: 'Composite map' },
];
export type Row = Record<string, unknown>;
export interface ChartOptions {
  normalize?: 'row' | 'column' | 'all';
  normalized?: boolean;
  showPercentage?: boolean;
  xSort?: AxisSort;
  ySort?: AxisSort;
  metricLabels?: Record<string, string>;
  color?: string;
  colors?: string[];
  decimals?: number;
  prefix?: string;
  suffix?: string;
  showLegend?: boolean;
  showLabels?: boolean;
  stacked?: boolean;
  horizontal?: boolean;
  longitudeFieldId?: string;
  latitudeFieldId?: string;
  targetLongitudeFieldId?: string;
  targetLatitudeFieldId?: string;
  weightMetricId?: string;
  radius?: number;
}
export function optionsFor(chart: Chart): ChartOptions {
  return chart.options || {};
}
export function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function label(value: unknown): string {
  return value == null ? '(null)' : String(value);
}
export function formatValue(
  value: unknown,
  options: ChartOptions = {},
  language?: 'en' | 'ru',
): string {
  const n = numeric(value);
  if (n === null) return '—';
  return `${options.prefix || ''}${new Intl.NumberFormat(
    language === 'ru' ? 'ru-RU' : language === 'en' ? 'en-US' : undefined,
    {
      maximumFractionDigits: Math.max(0, Math.min(10, options.decimals ?? 2)),
    },
  ).format(n)}${options.suffix || ''}`;
}
export function rowFilters(chart: Chart, row: Row): Filter[] {
  return (chart.query.dimensions || []).flatMap((id): Filter[] => {
    const value = row[id];
    if (value === undefined) return [];
    const base = { fieldId: id, datasetId: chart.datasetId };
    if (value === null) return [{ ...base, operator: 'is_null' }];
    if (id === chart.query.timeFieldId && chart.query.timeGrain) {
      const start = new Date(String(value));
      const end = new Date(start);
      if (!Number.isNaN(start.getTime())) {
        switch (chart.query.timeGrain) {
          case 'hour':
            end.setUTCHours(end.getUTCHours() + 1);
            break;
          case 'day':
            end.setUTCDate(end.getUTCDate() + 1);
            break;
          case 'week':
            end.setUTCDate(end.getUTCDate() + 7);
            break;
          case 'month':
            end.setUTCMonth(end.getUTCMonth() + 1);
            break;
          case 'quarter':
            end.setUTCMonth(end.getUTCMonth() + 3);
            break;
          case 'year':
            end.setUTCFullYear(end.getUTCFullYear() + 1);
            break;
          default:
            return [];
        }
        return [
          { ...base, operator: 'gte', values: [start.toISOString()] },
          { ...base, operator: 'lt', values: [end.toISOString()] },
        ];
      }
    }
    return [{ ...base, operator: 'eq', values: [value] }];
  });
}
export function selectionFilters(chart: Chart, rows: Row[]): Filter[] {
  if (!rows.length) return [];
  const groups = rows
    .map((row) => rowFilters(chart, row))
    .filter((group) => group.length);
  if (groups.length === 1) return groups[0];
  return [
    { fieldId: '', operator: '', datasetId: chart.datasetId, anyOf: groups },
  ];
}
export function geographicRows(chart: Chart, result?: QueryResult): Row[] {
  const options = optionsFor(chart);
  const dims = chart.query.dimensions || [];
  const lon = options.longitudeFieldId || dims[0];
  const lat = options.latitudeFieldId || dims[1];
  const endLon = options.targetLongitudeFieldId || dims[2];
  const endLat = options.targetLatitudeFieldId || dims[3];
  const valid = (row: Row, x: string, y: string) => {
    const a = numeric(row[x]);
    const b = numeric(row[y]);
    return a !== null && b !== null && Math.abs(a) <= 180 && Math.abs(b) <= 90;
  };
  return (result?.rows || []).filter(
    (row) =>
      valid(row, lon, lat) &&
      (chart.type !== 'geoArc' || valid(row, endLon, endLat)),
  );
}

export type AxisSort = 'labelAsc' | 'labelDesc' | 'sumAsc' | 'sumDesc';
export function axisValues(
  rows: Row[],
  field: string,
  metric: string,
  sort?: AxisSort,
): string[] {
  const values = [...new Set(rows.map((row) => label(row[field])))];
  if (!sort) return values;
  const totals = new Map<string, number>();
  for (const row of rows)
    totals.set(
      label(row[field]),
      (totals.get(label(row[field])) || 0) + (numeric(row[metric]) || 0),
    );
  const direction = sort.endsWith('Desc') ? -1 : 1;
  return values.sort(
    (a, b) =>
      direction *
      (sort.startsWith('sum')
        ? (totals.get(a) || 0) - (totals.get(b) || 0)
        : a.localeCompare(b, undefined, { numeric: true })),
  );
}
// Superset normalized heatmaps color by average percentile rank (ties share rank).
// Percentage labels are a separate value/sum calculation over the chosen scope.
export function heatmapValues(
  chart: Chart,
  rows: Row[],
): { row: Row; value: number; rank: number; percentage: number }[] {
  const o = optionsFor(chart);
  const [x, y] = chart.query.dimensions || [];
  const metric = chart.query.metrics?.[0] || '';
  const groupKey = (row: Row) =>
    o.normalize === 'row'
      ? label(row[y])
      : o.normalize === 'column'
        ? label(row[x])
        : '';
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const values = groups.get(key) || [];
    const n = numeric(row[metric]);
    if (n !== null) values.push(n);
    groups.set(key, values);
  }
  const ranks = new Map<string, Map<number, number>>();
  const totals = new Map<string, number>();
  for (const [key, values] of groups) {
    values.sort((a, b) => a - b);
    const ranked = new Map<number, number>();
    for (let i = 0; i < values.length; ) {
      let end = i + 1;
      while (end < values.length && values[end] === values[i]) end++;
      ranked.set(values[i], (i + 1 + end) / 2 / values.length);
      i = end;
    }
    ranks.set(key, ranked);
    totals.set(
      key,
      values.reduce((a, b) => a + b, 0),
    );
  }
  return rows.map((row) => {
    const key = groupKey(row);
    const value = numeric(row[metric]) || 0;
    const total = totals.get(key) || 0;
    return {
      row,
      value,
      rank: ranks.get(key)?.get(value) || 0,
      percentage: total ? value / total : 0,
    };
  });
}
