import type { DatabaseConnection } from '../connections/store';
import type { TableFilterDefinition } from '../filters/types';
import type { RowReference } from '../map/selection';

export interface InspectableTable {
  schema: string;
  name: string;
  fullName: string;
  kind: string;
  rowEstimate: number;
  primaryKey: string[];
  isEditable: boolean;
  columns: InspectorColumn[];
  geometryColumns: InspectorGeometryColumn[];
}

export interface InspectableSchema {
  name: string;
}

export interface InspectableTableSummary {
  schema: string;
  name: string;
  fullName: string;
  kind: string;
  rowEstimate: number;
}

export interface InspectorColumn {
  name: string;
  type: string;
}

export interface InspectorGeometryColumn {
  name: string;
  storageType: string;
  geometryType: string;
  srid: number;
}

export interface InspectorRowsResponse {
  schema: string;
  table: string;
  limit: number;
  offset: number;
  totalRows: number;
  hasMore: boolean;
  primaryKey: string[];
  isEditable: boolean;
  columns: InspectorColumn[];
  rows: InspectorRow[];
}

export interface InspectorLookupRowsResponse {
  schema: string;
  table: string;
  requestedRowCount: number;
  matchedRowCount: number;
  primaryKey: string[];
  columns: InspectorColumn[];
  rows: InspectorRow[];
}

export interface InspectorRow {
  rowKey: Record<string, unknown> | null;
  values: Record<string, unknown>;
}

export interface CommitTableChangesRequest {
  schema: string;
  table: string;
  operations: TableChangeOperation[];
}

export interface TableChangeOperation {
  type: 'insert' | 'update' | 'delete';
  rowKey?: Record<string, unknown>;
  changes?: Record<string, unknown>;
  values?: Record<string, unknown>;
}

function connectionPayload(connection: DatabaseConnection) {
  if (connection.isServerManaged) {
    return {
      id: connection.id,
    };
  }

  return {
    id: connection.id,
    name: connection.name,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    password: connection.password,
  };
}

async function decodePayload<T extends object>(
  response: Response,
  fallbackMessage: string,
) {
  const payload = (await response.json()) as
    | T
    | {
        error: {
          code: string;
          message: string;
        };
      };

  if (!response.ok || 'error' in payload) {
    throw new Error(
      'error' in payload ? payload.error.message : fallbackMessage,
    );
  }

  return payload;
}

export async function fetchInspectableSchemas(connection: DatabaseConnection) {
  const response = await fetch('/api/v1/database-connections/schemas', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(connectionPayload(connection)),
  });

  const payload = await decodePayload<{ schemas: InspectableSchema[] }>(
    response,
    'Failed to load database schemas.',
  );

  return payload.schemas;
}

export async function fetchInspectableSchemaTables(
  connection: DatabaseConnection,
  schema: string,
) {
  const response = await fetch('/api/v1/database-connections/schemas/tables', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...connectionPayload(connection),
      schema,
    }),
  });

  const payload = await decodePayload<{ tables: InspectableTableSummary[] }>(
    response,
    'Failed to load schema tables.',
  );

  return payload.tables;
}

export async function fetchTableMetadata(
  connection: DatabaseConnection,
  schema: string,
  table: string,
) {
  const response = await fetch('/api/v1/database-connections/tables/metadata', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...connectionPayload(connection),
      schema,
      table,
    }),
  });

  return await decodePayload<InspectableTable>(
    response,
    'Failed to load table metadata.',
  );
}

export async function fetchInspectableTables(connection: DatabaseConnection) {
  const response = await fetch('/api/v1/database-connections/tables', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(connectionPayload(connection)),
  });

  const payload = await decodePayload<{ tables: InspectableTable[] }>(
    response,
    'Failed to load inspectable tables.',
  );

  return payload.tables;
}

export async function fetchInspectorRows(
  connection: DatabaseConnection,
  table: InspectableTable,
  offset: number,
  limit: number,
  search?: string,
  filter?: TableFilterDefinition | null,
) {
  const response = await fetch('/api/v1/database-connections/rows', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...connectionPayload(connection),
      schema: table.schema,
      table: table.name,
      search,
      filter,
      offset,
      limit,
    }),
  });

  return await decodePayload<InspectorRowsResponse>(
    response,
    'Failed to load table rows.',
  );
}

export async function fetchInspectorRowsByKey(
  connection: DatabaseConnection,
  payload: {
    schema: string;
    table: string;
    rowRefs: RowReference[];
  },
) {
  const response = await fetch('/api/v1/database-connections/rows/lookup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...connectionPayload(connection),
      schema: payload.schema,
      table: payload.table,
      rowKeys: payload.rowRefs.map((rowRef) => rowRef.rowKey),
    }),
  });

  return await decodePayload<InspectorLookupRowsResponse>(
    response,
    'Failed to load selected rows.',
  );
}

export async function commitInspectorRows(
  connection: DatabaseConnection,
  request: CommitTableChangesRequest,
) {
  const response = await fetch('/api/v1/database-connections/rows/commit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...connectionPayload(connection),
      schema: request.schema,
      table: request.table,
      operations: request.operations,
    }),
  });

  return await decodePayload<{
    schema: string;
    table: string;
    applied: number;
  }>(response, 'Failed to save table changes.');
}
