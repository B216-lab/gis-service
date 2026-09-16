import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { AuthManagementError, authManagementApi } from './management-api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('authManagementApi', () => {
  test('normalizes workspace fields from the current Go response', async () => {
    globalThis.fetch = (async () =>
      Response.json({
        workspaces: [{ ID: 'workspace-1', Name: 'Operations', Role: 'admin' }],
      })) as typeof fetch;

    assert.deepEqual(await authManagementApi.listWorkspaces(), [
      { id: 'workspace-1', name: 'Operations', role: 'admin' },
    ]);
  });

  test('encodes workspace and member identifiers', async () => {
    let request: [RequestInfo | URL, RequestInit | undefined] | undefined;
    globalThis.fetch = (async (input, init) => {
      request = [input, init];
      return Response.json({ subject: 'oidc/user', role: 'viewer' });
    }) as typeof fetch;

    await authManagementApi.updateMember('team/a', 'oidc/user', 'viewer');

    assert.equal(
      request?.[0],
      '/api/v1/auth/workspaces/team%2Fa/members/oidc%2Fuser',
    );
    assert.equal(request?.[1]?.credentials, 'include');
    assert.equal(request?.[1]?.method, 'PATCH');
    assert.equal(request?.[1]?.body, JSON.stringify({ role: 'viewer' }));
  });

  test('returns one-time token plaintext from create response', async () => {
    globalThis.fetch = (async () =>
      Response.json(
        {
          id: 'token-1',
          token: 'gp_secret',
          prefix: 'gp_se',
          subject: 'user-1',
          workspace: 'workspace-1',
          scopes: { 'analytics:read': true },
          expires_at: '2099-01-01T00:00:00Z',
          created_by: 'user-1',
        },
        { status: 201 },
      )) as typeof fetch;

    const token = await authManagementApi.createToken('workspace-1', {
      name: 'reader',
      scopes: { 'analytics:read': true },
      expires_at: '2099-01-01T00:00:00Z',
    });

    assert.equal(token.token, 'gp_secret');
  });

  for (const [status, message] of [
    [401, 'Your session expired. Sign in again.'],
    [403, 'You do not have permission to manage this workspace.'],
  ] as const) {
    test(`maps ${status} to an actionable auth error`, async () => {
      globalThis.fetch = (async () =>
        Response.json(
          { error: { code: 'denied', message: 'server detail' } },
          { status },
        )) as typeof fetch;

      await assert.rejects(authManagementApi.listWorkspaces(), (error) => {
        assert.ok(error instanceof AuthManagementError);
        assert.equal(error.status, status);
        assert.equal(error.message, message);
        return true;
      });
    });
  }
});
