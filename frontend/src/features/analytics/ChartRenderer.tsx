import { Alert, Box, Center, Loader, Stack, Text } from '@mantine/core';
import { lazy, Suspense } from 'react';
import { useI18n } from '../i18n/i18n';
import { formatValue, optionsFor } from './chart-utils';
import type { Chart, Filter, QueryResult } from './types';

const StatisticalChart = lazy(() => import('./StatisticalChart'));
const GeographicChart = lazy(() => import('./GeographicChart'));
export interface ChartRendererProps {
  chart: Chart;
  data?: QueryResult;
  loading?: boolean;
  error?: string;
  onSelect?: (filters: Filter[]) => void;
  layers?: { chart: Chart; data: QueryResult }[];
  selection?: Filter[];
  height?: number;
}
export function ChartRenderer(props: ChartRendererProps) {
  const { language } = useI18n();
  const { chart, data, loading, error, height = 360 } = props;
  if (error)
    return (
      <Alert color="red" title="Chart failed">
        {error}
      </Alert>
    );
  if (loading)
    return (
      <Center h={height}>
        <Loader size="sm" />
      </Center>
    );
  if (
    (!data?.rows.length && chart.type !== 'compositeMap') ||
    (chart.type === 'compositeMap' &&
      !props.layers?.some((layer) => layer.data.rows.length))
  )
    return (
      <Center h={height}>
        <Text c="dimmed">No data for current filters.</Text>
      </Center>
    );
  if (chart.type === 'kpi')
    return (
      <Stack align="center" justify="center" h={height}>
        {(chart.query.metrics || []).map((metric) => (
          <Box key={metric} ta="center">
            {(chart.query.metrics || []).length > 1 && (
              <Text translate="no" c="dimmed" size="sm">
                {optionsFor(chart).metricLabels?.[metric] || metric}
              </Text>
            )}
            <Text
              fz={48}
              fw={700}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatValue(
                data?.rows[0]?.[metric],
                optionsFor(chart),
                language,
              )}
            </Text>
          </Box>
        ))}
      </Stack>
    );
  return (
    <Stack gap={4}>
      <Suspense
        fallback={
          <Center h={height}>
            <Loader size="sm" />
          </Center>
        }
      >
        {['geoHeatmap', 'geoArc', 'compositeMap'].includes(chart.type) ? (
          <GeographicChart {...props} />
        ) : (
          <StatisticalChart {...props} />
        )}
      </Suspense>
      {(data?.truncated ||
        props.layers?.some((layer) => layer.data.truncated)) && (
        <Text size="xs" c="orange">
          Row limit reached. Narrow filters to display complete results.
        </Text>
      )}
    </Stack>
  );
}
