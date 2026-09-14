import {
  Button,
  Group,
  Paper,
  Select,
  Stack,
  TextInput,
  Title,
} from '@mantine/core';
import { useI18n } from '../i18n/i18n';
import { operatorOptions } from './display-labels';
import type { Filter } from './types';

export function AggregateFilters({
  metrics,
  filters,
  onChange,
}: {
  metrics: { value: string; label: string }[];
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
}) {
  const { language } = useI18n();
  function update(index: number, change: Partial<Filter>) {
    onChange(filters.map((f, i) => (i === index ? { ...f, ...change } : f)));
  }
  return (
    <Stack gap="xs">
      <Title order={5}>Aggregate filters</Title>
      {filters.map((filter, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Controlled positional query filters carry no persistent IDs.
        <Paper key={index} p="xs" withBorder>
          <Stack gap="xs">
            <Group grow>
              <Select
                label="Metric"
                renderOption={({ option }) => (
                  <span translate="no">{option.label}</span>
                )}
                data={metrics}
                value={filter.fieldId}
                onChange={(value) => update(index, { fieldId: value || '' })}
              />
              <Select
                label="Aggregate condition"
                data={operatorOptions(
                  [
                    'eq',
                    'ne',
                    'gt',
                    'gte',
                    'lt',
                    'lte',
                    'between',
                    'is_null',
                    'is_not_null',
                  ],
                  language,
                )}
                value={filter.operator}
                onChange={(value) =>
                  update(index, { operator: value || 'gte', values: [] })
                }
              />
            </Group>
            {!filter.operator.includes('null') && (
              <TextInput
                label="Aggregate values"
                description="Number; separate range bounds with |."
                value={(filter.values || []).join('|')}
                onChange={(e) =>
                  update(index, {
                    values: e.currentTarget.value
                      .split('|')
                      .map((v) =>
                        v.trim() && Number.isFinite(Number(v)) ? Number(v) : v,
                      ),
                  })
                }
              />
            )}
            <Button
              variant="subtle"
              color="red"
              size="compact-xs"
              onClick={() => onChange(filters.filter((_, i) => i !== index))}
            >
              Remove aggregate filter
            </Button>
          </Stack>
        </Paper>
      ))}
      <Button
        variant="light"
        size="xs"
        disabled={!metrics.length}
        onClick={() =>
          onChange([
            ...filters,
            { fieldId: metrics[0].value, operator: 'gte', values: [0] },
          ])
        }
      >
        Add aggregate filter
      </Button>
    </Stack>
  );
}
