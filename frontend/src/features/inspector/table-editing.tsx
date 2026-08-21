import { Checkbox, NumberInput, TextInput } from '@mantine/core';
import { DatePickerInput, DateTimePicker } from '@mantine/dates';

import type {
  TableFilterCondition,
  TableFilterDefinition,
} from '../filters/types';
import type { InspectableTable, InspectorColumn } from './api';

const emptyCellLabel = 'NULL';

export function formatCellValue(value: unknown) {
  if (value === null || value === undefined) {
    return emptyCellLabel;
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

export function renderEditableCell({
  column,
  disabled,
  onChange,
  value,
}: {
  column: InspectorColumn;
  disabled?: boolean;
  onChange: (value: unknown) => void;
  value: unknown;
}) {
  if (isDateColumnType(column.type)) {
    return (
      <DatePickerInput
        aria-label={`Edit ${column.name}`}
        clearable
        disabled={disabled}
        onChange={onChange}
        size="xs"
        value={formatDateEditorValue(value)}
        valueFormat="YYYY-MM-DD"
      />
    );
  }

  if (isTimestampColumnType(column.type)) {
    return (
      <DateTimePicker
        aria-label={`Edit ${column.name}`}
        clearable
        disabled={disabled}
        onChange={(nextValue) =>
          onChange(formatTimestampChange(column.type, nextValue, value))
        }
        size="xs"
        value={formatTimestampEditorValue(value)}
        valueFormat="YYYY-MM-DD HH:mm:ss"
        withSeconds
      />
    );
  }

  if (isBooleanColumnType(column.type)) {
    return (
      <Checkbox
        checked={Boolean(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    );
  }

  if (isNumericColumnType(column.type)) {
    return (
      <NumberInput
        allowDecimal={!isIntegerColumnType(column.type)}
        aria-label={`Edit ${column.name}`}
        disabled={disabled}
        onChange={onChange}
        size="xs"
        styles={{
          input: {
            textAlign: 'right',
          },
        }}
        value={formatNumericEditorValue(value)}
      />
    );
  }

  return (
    <TextInput
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
      size="xs"
      styles={{
        input: {
          textAlign: 'left',
        },
      }}
      value={formatEditorValue(value)}
    />
  );
}

function formatNumericEditorValue(value: unknown): string | number {
  if (typeof value === 'number' || typeof value === 'string') {
    return value;
  }

  return '';
}

function formatDateEditorValue(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function formatTimestampEditorValue(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : null;
}

function formatTimestampChange(
  columnType: string,
  value: string | null,
  originalValue: unknown,
) {
  if (value === null || !isTimestampWithTimeZoneColumnType(columnType)) {
    return value;
  }

  const originalOffset =
    typeof originalValue === 'string'
      ? originalValue.match(/(Z|[+-]\d{2}:\d{2})$/i)?.[0]
      : undefined;
  return originalOffset ? `${value.replace(' ', 'T')}${originalOffset}` : value;
}

function formatEditorValue(value: unknown) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

export function normalizeEditorValue(columnType: string, value: unknown) {
  if (isBooleanColumnType(columnType)) {
    return Boolean(value);
  }

  if (typeof value !== 'string') {
    return value;
  }

  if (isNumericColumnType(columnType)) {
    if (value.trim() === '') {
      return value;
    }

    const numericValue = Number(value);
    return Number.isNaN(numericValue) ? value : numericValue;
  }

  return value;
}

export function areEditorValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function getCellTextAlign(columnType: string) {
  return isNumericColumnType(columnType) ? 'right' : 'left';
}

export function getCellFontFamily(columnName: string, columnType: string) {
  if (
    isNumericColumnType(columnType) ||
    /(^id$|_id$|uuid|geom|geo)/i.test(`${columnName} ${columnType}`)
  ) {
    return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  }

  return 'var(--mantine-font-family)';
}

export function isNumericColumnType(columnType: string) {
  return /int|numeric|double|real|decimal|serial/i.test(columnType);
}

function isIntegerColumnType(columnType: string) {
  return /smallint|bigint|integer|smallserial|bigserial|serial|int[248]/i.test(
    columnType,
  );
}

export function isBooleanColumnType(columnType: string) {
  return /bool/i.test(columnType);
}

export function isDateColumnType(columnType: string) {
  return /^date$/i.test(columnType.trim());
}

export function isTimestampColumnType(columnType: string) {
  return /timestamp/i.test(columnType);
}

function isTimestampWithTimeZoneColumnType(columnType: string) {
  return /timestamp with time zone|timestamptz/i.test(columnType);
}

export function isEditableColumnType(columnType: string) {
  return (
    isNumericColumnType(columnType) ||
    isBooleanColumnType(columnType) ||
    /text|character|uuid|date|timestamp/i.test(columnType)
  );
}

export function createDefaultTableFilterCondition(
  table: InspectableTable | null,
): TableFilterCondition {
  const firstFilterableColumn =
    table?.columns.find((column) => isEditableColumnType(column.type))?.name ??
    '';

  return {
    column: firstFilterableColumn,
    operator: 'eq',
    value: '',
    values: [],
  };
}

export function buildTableFilterDefinition(
  condition: TableFilterCondition,
): TableFilterDefinition {
  if (condition.operator === 'in') {
    return {
      mode: 'builder',
      conditions: [
        {
          column: condition.column,
          operator: condition.operator,
          values: condition.values ?? [],
        },
      ],
    };
  }

  return {
    mode: 'builder',
    conditions: [
      {
        column: condition.column,
        operator: condition.operator,
        value: condition.value ?? '',
      },
    ],
  };
}
