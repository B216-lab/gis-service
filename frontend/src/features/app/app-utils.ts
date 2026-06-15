import type {
  FlowmapMapLayer,
  FlowmapTableSource,
  MapLayer,
  MapSource,
} from '../connections/store';
import type { InspectableTable, InspectorColumn } from '../inspector/api';
import {
  isBooleanColumnType,
  isNumericColumnType,
} from '../inspector/table-editing';
import type { MapSelection } from '../map/selection';

export type TableSelectionKind = 'table' | 'view';

export interface DraftInsertRow {
  id: string;
  values: Record<string, unknown>;
}

export type FlowPointMode = 'coordinates' | 'geometry';

export interface FlowLayerFormState {
  name: string;
  startMode: FlowPointMode;
  startLon: string | null;
  startLat: string | null;
  startGeometry: string | null;
  endMode: FlowPointMode;
  endLon: string | null;
  endLat: string | null;
  endGeometry: string | null;
  magnitude: string | null;
  defaultMagnitude: number;
}

export function createSavedViewSelectionKey(viewId: string) {
  return `view:${viewId}`;
}

export function parseTableSelectionKey(
  tableKey: string | null,
): { kind: TableSelectionKind; value: string } | null {
  if (!tableKey) {
    return null;
  }

  if (tableKey.startsWith('view:')) {
    return {
      kind: 'view',
      value: tableKey.slice('view:'.length),
    };
  }

  return {
    kind: 'table',
    value: tableKey,
  };
}

export function getMapSelectionBadgeColor(
  objectType: MapSelection['objectType'],
) {
  switch (objectType) {
    case 'feature':
      return 'blue';
    case 'flow':
      return 'grape';
    case 'location':
      return 'teal';
    default:
      return 'gray';
  }
}

export function formatMapSelectionObjectType(
  objectType: MapSelection['objectType'],
) {
  switch (objectType) {
    case 'feature':
      return 'Feature';
    case 'flow':
      return 'Flow';
    case 'location':
      return 'Location';
    default:
      return objectType;
  }
}

export function formatMapSelectionCount(count: number) {
  return `${count} row${count === 1 ? '' : 's'}`;
}

export function formatRowCount(count: number | null | undefined) {
  return typeof count === 'number' ? count.toLocaleString() : 'unknown';
}

function createDraftInsertId() {
  return `draft-${crypto.randomUUID()}`;
}

export function serializeRowKey(
  rowKey: Record<string, unknown> | null,
  primaryKey: string[],
) {
  if (!rowKey || primaryKey.length === 0) {
    return null;
  }

  return JSON.stringify(
    primaryKey.map((columnName) => [columnName, rowKey[columnName]]),
  );
}

export function createEmptyInsertRow(columns: InspectorColumn[]) {
  const values: Record<string, unknown> = {};

  for (const column of columns) {
    if (isBooleanColumnType(column.type)) {
      values[column.name] = false;
      continue;
    }

    values[column.name] = '';
  }

  return {
    id: createDraftInsertId(),
    values,
  } satisfies DraftInsertRow;
}

export function findLayerSource(sources: MapSource[], layer: MapLayer) {
  return sources.find((source) => source.id === layer.sourceId) ?? null;
}

export function formatFlowmapSourceColumns(
  columns: FlowmapTableSource['columns'],
) {
  const departure =
    columns.startMode === 'geometry'
      ? columns.startGeometry
      : `${columns.startLat}/${columns.startLon}`;
  const destination =
    columns.endMode === 'geometry'
      ? columns.endGeometry
      : `${columns.endLat}/${columns.endLon}`;
  const density = columns.magnitude || columns.defaultMagnitude;

  return `${departure} -> ${destination} • density ${density}`;
}

function findNumericColumnName(columns: InspectorColumn[], patterns: RegExp[]) {
  return (
    columns.find(
      (column) =>
        isNumericColumnType(column.type) &&
        patterns.some((pattern) => pattern.test(column.name)),
    )?.name ?? null
  );
}

export function createFlowLayerDefaults(table: InspectableTable | null) {
  const columns = table?.columns ?? [];

  return {
    name: table ? `${table.name} flows` : 'Flow layer',
    startMode: 'coordinates',
    startLon: findNumericColumnName(columns, [
      /(start|origin|from).*(lon|lng|long|x)/i,
      /^src_?(lon|lng|long|x)$/i,
    ]),
    startLat: findNumericColumnName(columns, [
      /(start|origin|from).*(lat|y)/i,
      /^src_?(lat|y)$/i,
    ]),
    startGeometry: table?.geometryColumns[0]?.name ?? null,
    endMode: 'coordinates',
    endLon: findNumericColumnName(columns, [
      /(end|dest|to).*(lon|lng|long|x)/i,
      /^dst_?(lon|lng|long|x)$/i,
    ]),
    endLat: findNumericColumnName(columns, [
      /(end|dest|to).*(lat|y)/i,
      /^dst_?(lat|y)$/i,
    ]),
    endGeometry: table?.geometryColumns[0]?.name ?? null,
    magnitude: null,
    defaultMagnitude: 1,
  } satisfies FlowLayerFormState;
}

export function validateFlowLayerForm(
  form: FlowLayerFormState,
  table: InspectableTable | null,
) {
  const messages: string[] = [];
  const columnByName = new Map(
    (table?.columns ?? []).map((column) => [column.name, column]),
  );
  const numericFields: Array<[string, string | null]> = [];

  if (!table) {
    messages.push('Select a table with numeric coordinate columns first.');
    return messages;
  }

  if (!form.name.trim()) {
    messages.push('Layer name is required.');
  }

  if (!form.magnitude && form.defaultMagnitude <= 0) {
    messages.push('Default density must be greater than zero.');
  }

  if (form.startMode === 'geometry') {
    if (!form.startGeometry) {
      messages.push('Departure geometry column is required.');
    }
  } else {
    numericFields.push(
      ['Departure longitude', form.startLon],
      ['Departure latitude', form.startLat],
    );
  }

  if (form.endMode === 'geometry') {
    if (!form.endGeometry) {
      messages.push('Destination geometry column is required.');
    }
  } else {
    numericFields.push(
      ['Destination longitude', form.endLon],
      ['Destination latitude', form.endLat],
    );
  }

  for (const [label, columnName] of numericFields) {
    if (!columnName) {
      messages.push(`${label} column is required.`);
      continue;
    }

    const column = columnByName.get(columnName);
    if (!column || !isNumericColumnType(column.type)) {
      messages.push(`${label} must use a numeric column.`);
    }
  }

  return messages;
}

export function createDefaultFlowmapStyle(): FlowmapMapLayer['style'] {
  return {
    flowLinesRenderingMode: 'curved',
    flowLineThicknessScale: 2,
    clusteringEnabled: false,
    clusteringAuto: true,
    locationsEnabled: true,
    locationTotalsEnabled: false,
    locationLabelsEnabled: false,
    maxTopFlowsDisplayNum: 500,
    colorScheme: 'Teal',
    darkMode: false,
  };
}
