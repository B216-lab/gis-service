import { create } from 'zustand';
import {
  type ApiTokenSummary,
  AuthManagementError,
  authManagementApi,
  type CreateTokenInput,
  type RevealedApiToken,
  type WorkspaceMember,
  type WorkspaceRole,
  type WorkspaceSummary,
} from './management-api';
import { useAuthStore } from './store';

interface AuthManagementState {
  workspaces: WorkspaceSummary[];
  selectedWorkspaceId: string | null;
  members: WorkspaceMember[];
  tokens: ApiTokenSummary[];
  loading: boolean;
  busy: string | null;
  error: string;
  initialize: (currentWorkspace?: string) => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  saveMember: (subject: string, role: WorkspaceRole) => Promise<void>;
  removeMember: (subject: string) => Promise<void>;
  createToken: (input: CreateTokenInput) => Promise<RevealedApiToken>;
  revokeToken: (tokenId: string) => Promise<void>;
  rotateToken: (tokenId: string) => Promise<RevealedApiToken>;
  clearError: () => void;
  reset: () => void;
}

const emptyState = {
  workspaces: [],
  selectedWorkspaceId: null,
  members: [],
  tokens: [],
  loading: false,
  busy: null,
  error: '',
};

function messageFor(error: unknown) {
  if (error instanceof AuthManagementError) {
    if (error.status === 401) useAuthStore.getState().markAnonymous();
    return error.message;
  }
  return error instanceof Error ? error.message : 'Workspace request failed.';
}

export const useAuthManagementStore = create<AuthManagementState>(
  (set, get) => {
    async function loadWorkspace(workspaceId: string) {
      set({ loading: true, error: '' });
      try {
        const [members, tokens] = await Promise.all([
          authManagementApi.listMembers(workspaceId),
          authManagementApi.listTokens(workspaceId),
        ]);
        if (get().selectedWorkspaceId === workspaceId) set({ members, tokens });
      } catch (error) {
        set({ error: messageFor(error), members: [], tokens: [] });
      } finally {
        set({ loading: false });
      }
    }

    function selectedWorkspace() {
      const workspaceId = get().selectedWorkspaceId;
      if (!workspaceId) throw new Error('Select a workspace first.');
      return workspaceId;
    }

    return {
      ...emptyState,
      initialize: async (currentWorkspace) => {
        set({ loading: true, error: '' });
        try {
          const workspaces = await authManagementApi.listWorkspaces();
          const selectedWorkspaceId =
            (currentWorkspace &&
            workspaces.some((workspace) => workspace.id === currentWorkspace)
              ? currentWorkspace
              : workspaces[0]?.id) ?? null;
          set({ workspaces, selectedWorkspaceId });
          if (selectedWorkspaceId) await loadWorkspace(selectedWorkspaceId);
        } catch (error) {
          set({ error: messageFor(error) });
        } finally {
          set({ loading: false });
        }
      },
      selectWorkspace: async (workspaceId) => {
        set({ selectedWorkspaceId: workspaceId, members: [], tokens: [] });
        await loadWorkspace(workspaceId);
      },
      saveMember: async (subject, role) => {
        const workspaceId = selectedWorkspace();
        set({ busy: `member:${subject}`, error: '' });
        try {
          const exists = get().members.some(
            (member) => member.subject === subject,
          );
          if (exists) {
            await authManagementApi.updateMember(workspaceId, subject, role);
          } else {
            await authManagementApi.addMember(workspaceId, subject, role);
          }
          set({ members: await authManagementApi.listMembers(workspaceId) });
        } catch (error) {
          set({ error: messageFor(error) });
          throw error;
        } finally {
          set({ busy: null });
        }
      },
      removeMember: async (subject) => {
        const workspaceId = selectedWorkspace();
        set({ busy: `member:${subject}`, error: '' });
        try {
          await authManagementApi.removeMember(workspaceId, subject);
          set({
            members: get().members.filter((item) => item.subject !== subject),
          });
        } catch (error) {
          set({ error: messageFor(error) });
          throw error;
        } finally {
          set({ busy: null });
        }
      },
      createToken: async (input) => {
        const workspaceId = selectedWorkspace();
        set({ busy: 'token:create', error: '' });
        try {
          const revealed = await authManagementApi.createToken(
            workspaceId,
            input,
          );
          const { token: _secret, ...summary } = revealed;
          set({ tokens: [summary, ...get().tokens] });
          return revealed;
        } catch (error) {
          set({ error: messageFor(error) });
          throw error;
        } finally {
          set({ busy: null });
        }
      },
      revokeToken: async (tokenId) => {
        const workspaceId = selectedWorkspace();
        set({ busy: `token:${tokenId}`, error: '' });
        try {
          await authManagementApi.revokeToken(workspaceId, tokenId);
          set({ tokens: await authManagementApi.listTokens(workspaceId) });
        } catch (error) {
          set({ error: messageFor(error) });
          throw error;
        } finally {
          set({ busy: null });
        }
      },
      rotateToken: async (tokenId) => {
        const workspaceId = selectedWorkspace();
        set({ busy: `token:${tokenId}`, error: '' });
        try {
          const revealed = await authManagementApi.rotateToken(
            workspaceId,
            tokenId,
          );
          set({ tokens: await authManagementApi.listTokens(workspaceId) });
          return revealed;
        } catch (error) {
          set({ error: messageFor(error) });
          throw error;
        } finally {
          set({ busy: null });
        }
      },
      clearError: () => set({ error: '' }),
      reset: () => set(emptyState),
    };
  },
);
