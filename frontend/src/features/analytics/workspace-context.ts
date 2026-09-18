import type { DatabaseConnection } from '../connections/model';
import type {
  TableFilterCondition,
  TableFilterDefinition,
} from '../filters/types';
import { fetchTableMetadata, type InspectableTable } from '../inspector/api';
import type { GeoBounds } from '../map/api';
import type { RowReference } from '../map/selection';
import { saveObject } from './api';
import type { Dataset, Field, Filter } from './types';
import { sourceCompatible, type WorkspaceSource } from './workspace-store';

export { sourceCompatible } from './workspace-store';

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

export class WorkspaceBindingError extends Error {}

function scalarSQL(value: unknown): string {
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  throw new WorkspaceBindingError('Analytics filter values must be scalar.');
}

function physicalField(dataset: Dataset, fieldId: string): Field {
  const field = dataset.fields.find((candidate) => candidate.id === fieldId);
  if (!field || field.expression) {
    throw new WorkspaceBindingError(
      `Field ${fieldId || '(empty)'} cannot be used as a table filter.`,
    );
  }
  return field;
}

function sqlFilter(filter: Filter, dataset: Dataset, nested = false): string {
  if (filter.anyOf?.length) {
    if (nested || filter.fieldId || filter.operator) {
      throw new WorkspaceBindingError(
        'Nested analytics filter groups are unsupported.',
      );
    }
    if (filter.anyOf.some((group) => group.length === 0)) {
      throw new WorkspaceBindingError(
        'Analytics filter group cannot be empty.',
      );
    }
    return `(${filter.anyOf
      .map(
        (group) =>
          `(${group.map((child) => sqlFilter(child, dataset, true)).join(' AND ')})`,
      )
      .join(' OR ')})`;
  }
  if (filter.datasetId && filter.datasetId !== dataset.id) {
    throw new WorkspaceBindingError(
      'Cross-dataset filters cannot filter this table.',
    );
  }
  const column = quoteIdentifier(physicalField(dataset, filter.fieldId).name);
  const values = filter.values ?? [];
  switch (filter.operator) {
    case 'is_null':
    case 'is_not_null':
      if (values.length)
        throw new WorkspaceBindingError('Null filter takes no values.');
      return `${column} IS ${filter.operator === 'is_null' ? '' : 'NOT '}NULL`;
    case 'in':
    case 'not_in':
      if (!values.length) return filter.operator === 'in' ? 'FALSE' : 'TRUE';
      return `${column} ${filter.operator === 'in' ? 'IN' : 'NOT IN'} (${values.map(scalarSQL).join(', ')})`;
    case 'between':
      if (values.length !== 2)
        throw new WorkspaceBindingError('Between filter requires two values.');
      return `${column} BETWEEN ${scalarSQL(values[0])} AND ${scalarSQL(values[1])}`;
    case 'eq':
    case 'ne':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (values.length !== 1)
        throw new WorkspaceBindingError(
          'Comparison filter requires one value.',
        );
      const operator = {
        eq: '=',
        ne: '<>',
        gt: '>',
        gte: '>=',
        lt: '<',
        lte: '<=',
      }[filter.operator];
      return `${column} ${operator} ${scalarSQL(values[0])}`;
    }
    case 'contains':
      if (values.length !== 1 || typeof values[0] !== 'string') {
        throw new WorkspaceBindingError(
          'Contains filter requires one text value.',
        );
      }
      return `CAST(${column} AS text) ILIKE ${scalarSQL(`%${values[0].replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`)} ESCAPE '\\'`;
    default:
      throw new WorkspaceBindingError(
        `Unsupported analytics filter operator ${filter.operator}.`,
      );
  }
}

/** Converts workspace chart filters to a filter accepted by inspector/map endpoints. */
export function filtersToTableFilter(
  filters: Filter[],
  dataset: Dataset,
): TableFilterDefinition | null {
  if (!filters.length) return null;
  return {
    mode: 'sql',
    where: filters.map((filter) => sqlFilter(filter, dataset)).join(' AND '),
  };
}

/** Joins independent table scopes without dropping either side. */
export function combineTableFilters(
  left: TableFilterDefinition | null | undefined,
  right: TableFilterDefinition | null | undefined,
): TableFilterDefinition | null {
  if (!left) return right ?? null;
  if (!right) return left;
  if (left.mode !== 'sql' && right.mode !== 'sql') {
    return {
      mode: 'builder',
      conditions: [...left.conditions, ...right.conditions],
    };
  }
  const where = (filter: TableFilterDefinition) =>
    filter.mode === 'sql'
      ? `(${filter.where})`
      : `(${filter.conditions
          .map((condition) => {
            const column = quoteIdentifier(condition.column);
            return condition.operator === 'eq'
              ? `${column} = ${scalarSQL(condition.value ?? '')}`
              : `${column} IN (${(condition.values ?? []).map(scalarSQL).join(', ')})`;
          })
          .join(' AND ')})`;
  return { mode: 'sql', where: `${where(left)} AND ${where(right)}` };
}

/** Rows selected in map/table stay an OR of complete primary-key tuples. */
export function selectionToAnalyticsFilter(
  selection: RowReference[],
  dataset: Dataset,
): Filter {
  if (!selection.length) {
    throw new WorkspaceBindingError('No selected rows to filter.');
  }
  const primaryKey = selection[0].primaryKey;
  if (
    !primaryKey.length ||
    selection.some((row) => row.primaryKey.join('\0') !== primaryKey.join('\0'))
  ) {
    throw new WorkspaceBindingError(
      'Selected rows must share one primary key.',
    );
  }
  const groups = selection.map((row) =>
    primaryKey.map((column) => {
      const field = dataset.fields.find(
        (candidate) => candidate.name === column,
      );
      if (!field)
        throw new WorkspaceBindingError(
          `Primary key column ${column} is absent from dataset.`,
        );
      if (!(column in row.rowKey))
        throw new WorkspaceBindingError(
          `Selected row is missing primary key column ${column}.`,
        );
      const value = row.rowKey[column];
      return value === null
        ? { fieldId: field.id, datasetId: dataset.id, operator: 'is_null' }
        : {
            fieldId: field.id,
            datasetId: dataset.id,
            operator: 'eq',
            values: [value],
          };
    }),
  );
  return { fieldId: '', operator: '', datasetId: dataset.id, anyOf: groups };
}

/** Empty selection means no results, never an accidental unfiltered query. */
export function queryFiltersForWorkspace(
  filters: Filter[],
  dataset: Dataset,
  selection: RowReference[],
  selectionActive: boolean,
): Filter[] | null {
  // Callers must render a clear empty state instead of asking analytics to
  // interpret no selection as every record.
  if (selectionActive && !selection.length) return null;
  return selectionActive
    ? [...filters, selectionToAnalyticsFilter(selection, dataset)]
    : filters;
}

/** Rebinds same-table filters by physical field name across dataset definitions. */
export function mapFiltersToPhysicalDataset(
  filters: Filter[],
  sourceDataset: Dataset,
  targetDataset: Dataset,
): Filter[] {
  if (
    sourceDataset.sql ||
    targetDataset.sql ||
    !sourceDataset.schema ||
    !sourceDataset.table ||
    !targetDataset.schema ||
    !targetDataset.table ||
    !sourceCompatible(
      {
        connectionId: sourceDataset.connectionId,
        schema: sourceDataset.schema || '',
        table: sourceDataset.table || '',
        name: sourceDataset.name,
      },
      targetDataset,
    )
  ) {
    throw new WorkspaceBindingError(
      'Analytics filters cannot cross physical datasets.',
    );
  }
  const mapFilter = (filter: Filter, nested = false): Filter => {
    if (filter.anyOf?.length) {
      if (nested || filter.fieldId || filter.operator) {
        throw new WorkspaceBindingError(
          'Nested analytics filter groups are unsupported.',
        );
      }
      return {
        ...filter,
        datasetId: targetDataset.id,
        anyOf: filter.anyOf.map((group) =>
          group.map((child) => mapFilter(child, true)),
        ),
      };
    }
    if (filter.datasetId && filter.datasetId !== sourceDataset.id) {
      throw new WorkspaceBindingError(
        'Analytics filters belong to another dataset.',
      );
    }
    const sourceField = physicalField(sourceDataset, filter.fieldId);
    const targetField = targetDataset.fields.find(
      (candidate) =>
        !candidate.expression && candidate.name === sourceField.name,
    );
    if (!targetField) {
      throw new WorkspaceBindingError(
        `Physical field ${sourceField.name} is absent from target dataset.`,
      );
    }
    return {
      ...filter,
      datasetId: targetDataset.id,
      fieldId: targetField.id,
    };
  };
  return filters.map((filter) => mapFilter(filter));
}

/** Applies chart filters to a physical source while retaining its saved-view scope. */
export function filtersForSource(
  filters: Filter[],
  dataset: Dataset,
  source: WorkspaceSource,
): TableFilterDefinition | null {
  if (dataset.connectionId !== source.connectionId) {
    throw new WorkspaceBindingError(
      'Analytics filters cannot cross database connections.',
    );
  }
  if (!sourceCompatible(source, dataset)) {
    throw new WorkspaceBindingError(
      'Analytics dataset does not match active workspace source.',
    );
  }
  return combineTableFilters(
    source.filter,
    filtersToTableFilter(filters, dataset),
  );
}

export function sourceFiltersToAnalytics(
  source: WorkspaceSource,
  dataset: Dataset,
): Filter[] {
  assertAnalyticsSourceSupported(source);
  const savedFilter = source.filter;
  const conditions: TableFilterCondition[] =
    savedFilter && savedFilter.mode !== 'sql' ? savedFilter.conditions : [];
  return conditions.map((condition) => {
    const field = dataset.fields.find(
      (candidate) =>
        candidate.name === condition.column && !candidate.expression,
    );
    if (!field) {
      throw new WorkspaceBindingError(
        `Saved filter column ${condition.column} is absent from analytics dataset.`,
      );
    }
    if (condition.operator === 'eq') {
      return {
        datasetId: dataset.id,
        fieldId: field.id,
        operator: 'eq',
        values: [condition.value ?? ''],
      };
    }
    if (!condition.values?.length) {
      throw new WorkspaceBindingError(
        `Saved filter ${condition.column} has no values.`,
      );
    }
    return {
      datasetId: dataset.id,
      fieldId: field.id,
      operator: 'in',
      values: condition.values,
    };
  });
}

/** Builds an opt-in map-extent filter for a geometry-backed analytics source. */
export function viewportToAnalyticsFilter(
  bounds: GeoBounds,
  dataset: Dataset,
  source: WorkspaceSource,
): Filter {
  if (!sourceCompatible(source, dataset) || !source.geometryColumn) {
    throw new WorkspaceBindingError(
      'Map extent filtering requires active source geometry and its physical dataset.',
    );
  }
  if (
    ![bounds.west, bounds.south, bounds.east, bounds.north].every(
      Number.isFinite,
    )
  ) {
    throw new WorkspaceBindingError('Map extent bounds are invalid.');
  }
  const south = Math.max(-90, Math.min(90, bounds.south));
  const north = Math.max(-90, Math.min(90, bounds.north));
  if (south >= north) {
    throw new WorkspaceBindingError('Map extent bounds are invalid.');
  }
  const longitude = (value: number) =>
    ((((value + 180) % 360) + 360) % 360) - 180;
  const [west, east] =
    Math.abs(bounds.east - bounds.west) >= 360
      ? [-180, 180]
      : [longitude(bounds.west), longitude(bounds.east)];
  const field = dataset.fields.find(
    (candidate) => candidate.name === source.geometryColumn,
  );
  if (!field) {
    throw new WorkspaceBindingError(
      'Active source geometry is absent from analytics dataset.',
    );
  }
  return {
    datasetId: dataset.id,
    fieldId: field.id,
    operator: 'within_bbox',
    values: [west, south, east, north],
  };
}

function assertAnalyticsSourceSupported(source: WorkspaceSource) {
  if (source.spatialFilter) {
    throw new WorkspaceBindingError(
      'Spatial layer filters require the scoped workspace query endpoint.',
    );
  }
  if (source.filter?.mode === 'sql') {
    throw new WorkspaceBindingError(
      'SQL saved views require the scoped workspace query endpoint.',
    );
  }
}

function analyticsType(type: string): string {
  if (/bool/i.test(type)) return 'boolean';
  if (/timestamp|timestamptz/i.test(type)) return 'timestamp';
  if (/date/i.test(type)) return 'date';
  if (/int/i.test(type)) return 'integer';
  if (/numeric|decimal|real|double|float/i.test(type)) return 'number';
  return 'string';
}

export function datasetForWorkspaceSource(
  source: WorkspaceSource,
  metadata: InspectableTable,
  existing: Dataset[],
): Dataset {
  // Dataset stays physical; saved-view and polygon scopes travel separately
  // through the validated editor-only workspace query endpoint.
  const reusable = existing.find(
    (dataset) =>
      dataset.connectionId === source.connectionId &&
      dataset.schema === source.schema &&
      dataset.table === source.table &&
      !dataset.sql,
  );
  if (reusable) return reusable;
  return {
    id: crypto.randomUUID(),
    name: source.name,
    revision: 0,
    connectionId: source.connectionId,
    schema: source.schema,
    table: source.table,
    fields: metadata.columns.map((column) => ({
      id: column.name,
      name: column.name,
      type: analyticsType(column.type),
    })),
    metrics: [{ id: 'count', name: 'Count', expression: 'COUNT(*)' }],
    relationships: [],
  };
}

/** Loads current inspector metadata, then persists a reusable analytics dataset. */
export async function createOrReuseWorkspaceDataset(
  source: WorkspaceSource,
  connection: DatabaseConnection,
  existing: Dataset[],
): Promise<Dataset> {
  if (!connection.isServerManaged || connection.id !== source.connectionId) {
    throw new WorkspaceBindingError(
      'Analytics requires this source to use a server-managed connection.',
    );
  }
  const metadata = await fetchTableMetadata(
    connection,
    source.schema,
    source.table,
  );
  const dataset = datasetForWorkspaceSource(source, metadata, existing);
  return dataset.revision > 0
    ? dataset
    : saveObject('datasets', dataset, false);
}
