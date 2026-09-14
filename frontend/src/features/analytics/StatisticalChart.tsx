import { Box, useComputedColorScheme } from '@mantine/core';
import type { EChartsOption } from 'echarts';
import { BarChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts';
import {
  CalendarComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n/i18n';
import type { ChartRendererProps } from './ChartRenderer';
import {
  axisValues,
  formatValue,
  heatmapValues,
  label,
  numeric,
  optionsFor,
  type Row,
  selectionFilters,
} from './chart-utils';
import type { Chart } from './types';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  HeatmapChart,
  CalendarComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export function statisticalOptions(
  chart: Chart,
  rows: Row[],
  language: 'en' | 'ru' = 'en',
): EChartsOption {
  const [x, breakdown] = chart.query.dimensions || [];
  const metrics = chart.query.metrics || [];
  const o = optionsFor(chart);
  const base = {
    animation: false,
    backgroundColor: 'transparent',
    color: o.colors?.length
      ? o.colors
      : [
          o.color || '#228be6',
          '#12b886',
          '#fab005',
          '#fa5252',
          '#7950f2',
          '#e64980',
        ],
    tooltip: {
      trigger: 'item',
      valueFormatter: (value: unknown) => formatValue(value, o, language),
    },
    legend: { show: o.showLegend !== false, type: 'scroll', bottom: 0 },
    grid: {
      left: 65,
      right: 25,
      top: 25,
      bottom: 70,
      outerBoundsMode: 'same',
      outerBoundsContain: 'axisLabel',
    },
    aria: { enabled: true },
  };
  if (chart.type === 'pie')
    return {
      ...base,
      series: [
        {
          type: 'pie',
          radius: ['0%', '65%'],
          label: { show: o.showLabels !== false },
          data: rows.map((row) => ({
            name: label(row[x]),
            value: numeric(row[metrics[0]]) ?? 0,
            row,
          })),
        },
      ],
    } as EChartsOption;
  if (chart.type === 'matrixHeatmap') {
    const xs = axisValues(rows, x, metrics[0], o.xSort);
    const ys = axisValues(rows, breakdown, metrics[0], o.ySort);
    const values = heatmapValues(chart, rows);
    return {
      ...base,
      tooltip: {
        trigger: 'item',
        renderMode: 'richText',
        formatter: (p: unknown) => {
          const item = (p as { data: { row: Row; percentage: number } }).data;
          return `${label(item.row[x])} · ${label(item.row[breakdown])}: ${formatValue(item.row[metrics[0]], o, language)}${o.showPercentage ? ` (${(item.percentage * 100).toFixed(2)}%)` : ''}`;
        },
      },
      legend: { show: false },
      grid: {
        left: 70,
        right: 35,
        top: 20,
        bottom: 80,
        outerBoundsMode: 'same',
        outerBoundsContain: 'axisLabel',
      },
      xAxis: { type: 'category', data: xs, splitArea: { show: true } },
      yAxis: { type: 'category', data: ys, splitArea: { show: true } },
      visualMap: {
        min: 0,
        max: o.normalized
          ? 1
          : Math.max(1, ...values.map((item) => item.value)),
        dimension: o.normalized ? 3 : 2,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
      },
      series: [
        {
          type: 'heatmap',
          label: { show: o.showLabels === true },
          data: values.map(({ row, value, rank, percentage }) => ({
            value: [
              xs.indexOf(label(row[x])),
              ys.indexOf(label(row[breakdown])),
              value,
              rank,
            ],
            percentage,
            row,
          })),
        },
      ],
    } as EChartsOption;
  }
  if (chart.type === 'calendarHeatmap') {
    const dated = rows
      .map((row) => ({ row, date: String(row[x]).slice(0, 10) }))
      .filter(({ date }) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      ...base,
      legend: { show: false },
      calendar: {
        range: dated.length
          ? [dated[0].date, dated[dated.length - 1].date]
          : new Date().getFullYear(),
        cellSize: ['auto', 20],
        left: 50,
        right: 30,
        top: 65,
        yearLabel: { show: false },
        dayLabel: {
          firstDay: 1,
          nameMap:
            language === 'ru'
              ? ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
              : 'en',
        },
        monthLabel: {
          nameMap:
            language === 'ru'
              ? [
                  'Янв',
                  'Фев',
                  'Мар',
                  'Апр',
                  'Май',
                  'Июн',
                  'Июл',
                  'Авг',
                  'Сен',
                  'Окт',
                  'Ноя',
                  'Дек',
                ]
              : 'en',
        },
      },
      visualMap: {
        min: 0,
        max: Math.max(1, ...rows.map((row) => numeric(row[metrics[0]]) ?? 0)),
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
      },
      series: [
        {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          data: dated.map(({ row, date }) => ({
            value: [date, numeric(row[metrics[0]]) ?? 0],
            row,
          })),
        },
      ],
    } as EChartsOption;
  }
  const categories = axisValues(rows, x, metrics[0], o.xSort);
  const breakdowns = breakdown
    ? [...new Set(rows.map((row) => label(row[breakdown])))]
    : [''];
  const indexedRows = new Map(
    rows.map((row) => [
      JSON.stringify([label(row[x]), breakdown ? label(row[breakdown]) : '']),
      row,
    ]),
  );
  const series = metrics.flatMap((metric) =>
    breakdowns.map((group) => ({
      name: breakdown
        ? `${group}${metrics.length > 1 ? ` · ${metric}` : ''}`
        : o.metricLabels?.[metric] || metric,
      type: chart.type === 'line' ? 'line' : 'bar',
      stack: o.stacked ? metric : undefined,
      label: { show: o.showLabels === true },
      connectNulls: false,
      data: categories.map((category) => {
        const row = indexedRows.get(JSON.stringify([category, group]));
        return { value: row ? numeric(row[metric]) : null, row };
      }),
    })),
  );
  const categoryAxis = {
    type: 'category',
    data: categories,
    axisLabel: {
      hideOverlap: true,
      formatter: (value: string) => {
        if (!chart.query.timeFieldId) return value;
        const date = new Date(value);
        return Number.isNaN(date.getTime())
          ? value
          : new Intl.DateTimeFormat(language, {
              timeZone: 'UTC',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            }).format(date);
      },
    },
  };
  const valueAxis = { type: 'value' };
  return {
    ...base,
    xAxis: o.horizontal && chart.type === 'bar' ? valueAxis : categoryAxis,
    yAxis: o.horizontal && chart.type === 'bar' ? categoryAxis : valueAxis,
    series,
  } as EChartsOption;
}

export default function StatisticalChart({
  chart,
  data,
  onSelect,
  selection,
  height = 360,
}: ChartRendererProps) {
  const { language } = useI18n();
  const colorScheme = useComputedColorScheme('light');
  const container = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRows = useRef<Row[]>([]);
  useEffect(() => {
    if (!selection?.length) selectedRows.current = [];
  }, [selection]);
  useEffect(() => {
    if (!container.current) return;
    const instance = echarts.init(
      container.current,
      colorScheme === 'dark' ? 'dark' : undefined,
    );
    instance.setOption(statisticalOptions(chart, data?.rows || [], language));
    instance.on('click', (event: unknown) => {
      const e = event as {
        data?: { row?: Row };
        event?: {
          event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
        };
      };
      const row = e.data?.row;
      if (!row) return;
      const native = e.event?.event;
      const multiple = native?.ctrlKey || native?.metaKey || native?.shiftKey;
      const key = JSON.stringify(row);
      if (multiple)
        selectedRows.current = selectedRows.current.some(
          (r) => JSON.stringify(r) === key,
        )
          ? selectedRows.current.filter((r) => JSON.stringify(r) !== key)
          : [...selectedRows.current, row];
      else selectedRows.current = [row];
      onSelectRef.current?.(selectionFilters(chart, selectedRows.current));
      instance.dispatchAction({ type: 'downplay' });
      instance.dispatchAction({
        type: 'highlight',
        name: label(row[chart.query.dimensions?.[0] || '']),
      });
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.dispose();
    };
  }, [chart, data, colorScheme, language]);
  return (
    <Box
      ref={container}
      h={height}
      w="100%"
      role="img"
      aria-label={`${chart.name} interactive chart. Click to filter; Ctrl or Shift click to select multiple.`}
    />
  );
}
