import type { InspectableTable, InspectorForeignKey } from './api';

export function relationDisplayKey(
  connectionId: string,
  table: InspectableTable,
  foreignKey: InspectorForeignKey,
) {
  return `${connectionId}:${table.schema}.${table.name}:${foreignKey.columnName}`;
}

export function tableDisplayKey(connectionId: string, table: InspectableTable) {
  return tableDisplayKeyFromParts(connectionId, table.schema, table.name);
}

export function tableDisplayKeyFromParts(
  connectionId: string,
  schema: string,
  table: string,
) {
  return `${connectionId}:${schema}.${table}`;
}

export function relationValueKey(value: unknown) {
  return String(value);
}
