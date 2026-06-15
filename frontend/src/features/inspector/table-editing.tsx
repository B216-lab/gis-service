import { Checkbox, TextInput } from '@mantine/core';

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
  if (isBooleanColumnType(column.type)) {
    return (
      <Checkbox
        checked={Boolean(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
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
          textAlign: getCellTextAlign(column.type),
        },
      }}
      value={formatEditorValue(value)}
    />
  );
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

export function isBooleanColumnType(columnType: string) {
  return /bool/i.test(columnType);
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
    conditions: [
      {
        column: condition.column,
        operator: condition.operator,
        value: condition.value ?? '',
      },
    ],
  };
}
