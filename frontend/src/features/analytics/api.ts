import type {
  Connection,
  Dataset,
  Metadata,
  Query,
  QueryResult,
} from './types';
import type { WorkspaceSource } from './workspace-store';

export class AnalyticsError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function analyticsRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/v1/analytics${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new AnalyticsError(
      response.status === 409
        ? 'Another editor changed this object. Reload before saving again.'
        : data?.error?.message ||
            data?.message ||
            `Request failed (${response.status}).`,
      response.status,
    );
  return data as T;
}
export async function listObjects<T>(kind: string): Promise<T[]> {
  const result = await analyticsRequest<T[] | { items: T[] }>(`/${kind}`);
  return Array.isArray(result) ? result : result.items;
}
export function saveObject<T extends Metadata>(
  kind: string,
  value: T,
  existing: boolean,
): Promise<T> {
  return analyticsRequest(
    `/${kind}${existing ? `/${encodeURIComponent(value.id)}` : ''}`,
    { method: existing ? 'PUT' : 'POST', body: JSON.stringify(value) },
  );
}
export function deleteObject(kind: string, value: Metadata) {
  return analyticsRequest(
    `/${kind}/${encodeURIComponent(value.id)}?revision=${value.revision}`,
    { method: 'DELETE' },
  );
}
export async function listConnections(): Promise<Connection[]> {
  const response = await fetch('/api/v1/database-connections');
  if (!response.ok) throw new Error('Could not load server connections.');
  return (await response.json()).connections;
}
export function runQuery(
  query: Query,
  signal?: AbortSignal,
  bypassCache = false,
): Promise<QueryResult> {
  return analyticsRequest('/query', {
    method: 'POST',
    headers: bypassCache ? { 'Cache-Control': 'no-cache' } : undefined,
    body: JSON.stringify(query),
    signal,
  });
}
export function runWorkspaceQuery(
  query: Query,
  source: WorkspaceSource,
  signal?: AbortSignal,
  bypassCache = false,
): Promise<QueryResult> {
  return analyticsRequest('/workspace-query', {
    method: 'POST',
    headers: bypassCache ? { 'Cache-Control': 'no-cache' } : undefined,
    body: JSON.stringify({
      query,
      source: {
        connectionId: source.connectionId,
        schema: source.schema,
        table: source.table,
        filter: source.filter,
        spatialFilter: source.spatialFilter,
        geometryColumn: source.geometryColumn,
        flowColumns: source.flowColumns,
      },
    }),
    signal,
  });
}

export function previewDataset(
  dataset: Dataset,
  signal?: AbortSignal,
): Promise<QueryResult> {
  return analyticsRequest('/preview', {
    method: 'POST',
    body: JSON.stringify(dataset),
    signal,
  });
}
