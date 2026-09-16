export type WorkspaceRole = 'viewer' | 'editor' | 'publisher' | 'admin';

export interface WorkspaceSummary {
  id: string;
  name: string;
  role?: WorkspaceRole;
}

export interface WorkspaceMember {
  subject: string;
  role: WorkspaceRole;
  groups?: string[];
}

export interface ApiTokenSummary {
  id: string;
  name?: string;
  prefix: string;
  subject: string;
  workspace: string;
  scopes: Record<string, boolean>;
  expires_at: string;
  created_at?: string;
  last_used_at?: string;
  revoked_at?: string;
  created_by: string;
}

export interface RevealedApiToken extends ApiTokenSummary {
  token: string;
}

export interface CreateTokenInput {
  name: string;
  scopes: Record<string, boolean>;
  expires_at: string;
}

type WireWorkspace = WorkspaceSummary & {
  ID?: string;
  Name?: string;
  Role?: WorkspaceRole;
};

type WireMember = WorkspaceMember & {
  Subject?: string;
  Role?: WorkspaceRole;
};

interface ErrorPayload {
  code?: string;
  message?: string;
  error?: { code?: string; message?: string };
}

export class AuthManagementError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AuthManagementError';
    this.status = status;
    this.code = code;
  }
}

function permissionMessage(status: number, fallback: string) {
  if (status === 401) return 'Your session expired. Sign in again.';
  if (status === 403)
    return 'You do not have permission to manage this workspace.';
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let payload: ErrorPayload = {};
    try {
      payload = (await response.json()) as ErrorPayload;
    } catch {
      // Non-JSON proxy errors still receive a safe status-based message.
    }
    const detail = payload.error ?? payload;
    throw new AuthManagementError(
      response.status,
      detail.code ?? `http_${response.status}`,
      permissionMessage(
        response.status,
        detail.message ?? 'Workspace request failed.',
      ),
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function workspaceQuery(workspaceId: string) {
  return `?workspace_id=${encodeURIComponent(workspaceId)}`;
}

export const authManagementApi = {
  async listWorkspaces() {
    const payload = await request<
      { workspaces: WireWorkspace[] } | WireWorkspace[]
    >('/api/v1/auth/workspaces');
    const workspaces = Array.isArray(payload) ? payload : payload.workspaces;
    return workspaces.map((workspace) => ({
      id: workspace.id ?? workspace.ID ?? '',
      name: workspace.name ?? workspace.Name ?? '',
      role: workspace.role ?? workspace.Role,
    }));
  },

  async listMembers(workspaceId: string) {
    const payload = await request<{ members: WireMember[] } | WireMember[]>(
      `/api/v1/auth/workspaces/${encodeURIComponent(workspaceId)}/members`,
    );
    const members = Array.isArray(payload) ? payload : payload.members;
    return members.map((member) => ({
      subject: member.subject ?? member.Subject ?? '',
      role: member.role ?? member.Role ?? 'viewer',
      groups: member.groups,
    }));
  },

  addMember(workspaceId: string, subject: string, role: WorkspaceRole) {
    return request<WorkspaceMember>(
      `/api/v1/auth/workspaces/${encodeURIComponent(workspaceId)}/members`,
      { method: 'POST', body: JSON.stringify({ subject, role }) },
    );
  },

  updateMember(workspaceId: string, subject: string, role: WorkspaceRole) {
    return request<WorkspaceMember>(
      `/api/v1/auth/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(subject)}`,
      { method: 'PATCH', body: JSON.stringify({ role }) },
    );
  },

  removeMember(workspaceId: string, subject: string) {
    return request<void>(
      `/api/v1/auth/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(subject)}`,
      { method: 'DELETE' },
    );
  },

  async listTokens(workspaceId: string) {
    const payload = await request<
      { tokens: ApiTokenSummary[] } | ApiTokenSummary[]
    >(`/api/v1/auth/tokens${workspaceQuery(workspaceId)}`);
    return Array.isArray(payload) ? payload : payload.tokens;
  },

  createToken(workspaceId: string, input: CreateTokenInput) {
    return request<RevealedApiToken>(
      `/api/v1/auth/tokens${workspaceQuery(workspaceId)}`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  },

  revokeToken(workspaceId: string, tokenId: string) {
    return request<void>(
      `/api/v1/auth/tokens/${encodeURIComponent(tokenId)}${workspaceQuery(workspaceId)}`,
      { method: 'DELETE' },
    );
  },

  rotateToken(workspaceId: string, tokenId: string) {
    return request<RevealedApiToken>(
      `/api/v1/auth/tokens/${encodeURIComponent(tokenId)}/rotate${workspaceQuery(workspaceId)}`,
      { method: 'POST' },
    );
  },
};
