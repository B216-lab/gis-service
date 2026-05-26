import type { DatabaseConnection } from '../connections/store';

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
  hasMore: boolean;
  primaryKey: string[];
  isEditable: boolean;
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

export async function fetchInspectableTables(connection: DatabaseConnection) {
  const response = await fetch('/api/v1/database-connections/tables', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: connection.name,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.user,
      password: connection.password,
    }),
  });

  const payload = (await response.json()) as
    | {
        tables: InspectableTable[];
      }
    | {
        error: {
          code: string;
          message: string;
        };
      };

  if (!response.ok || 'error' in payload) {
    throw new Error(
      'error' in payload
        ? payload.error.message
        : 'Failed to load inspectable tables.',
    );
  }

  return payload.tables;
}

export async function fetchInspectorRows(
  connection: DatabaseConnection,
  table: InspectableTable,
  offset: number,
  limit: number,
) {
  const response = await fetch('/api/v1/database-connections/rows', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: connection.name,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.user,
      password: connection.password,
      schema: table.schema,
      table: table.name,
      offset,
      limit,
    }),
  });

  const payload = (await response.json()) as
    | InspectorRowsResponse
    | {
        error: {
          code: string;
          message: string;
        };
      };

  if (!response.ok || 'error' in payload) {
    throw new Error(
      'error' in payload ? payload.error.message : 'Failed to load table rows.',
    );
  }

  return payload;
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
      name: connection.name,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.user,
      password: connection.password,
      schema: request.schema,
      table: request.table,
      operations: request.operations,
    }),
  });

  const payload = (await response.json()) as
    | {
        schema: string;
        table: string;
        applied: number;
      }
    | {
        error: {
          code: string;
          message: string;
        };
      };

  if (!response.ok || 'error' in payload) {
    throw new Error(
      'error' in payload
        ? payload.error.message
        : 'Failed to save table changes.',
    );
  }

  return payload;
}
