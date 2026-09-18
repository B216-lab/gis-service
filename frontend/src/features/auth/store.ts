import { create } from 'zustand';

export interface AuthUser {
  subject: string;
  name?: string;
  email?: string;
  username?: string;
  workspace?: string;
  scopes: string[];
  groups: string[];
}

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  initialize: () => Promise<void>;
  login: () => void;
  logout: () => Promise<void>;
  markAnonymous: () => void;
}

let initialization: Promise<void> | null = null;

async function loadCurrentUser(set: (state: Partial<AuthState>) => void) {
  try {
    const response = await fetch('/api/v1/auth/me', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      // 401 is expected for anonymous visitors; keep this quiet.
      set({ status: 'anonymous', user: null });
      return;
    }
    const user = (await response.json()) as AuthUser;
    set({ status: 'authenticated', user });
  } catch {
    // Auth lookup failure must not expose credentials or produce a noisy UI.
    set({ status: 'anonymous', user: null });
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  initialize: () => {
    initialization ??= loadCurrentUser(set).finally(() => {
      initialization = null;
    });
    return initialization;
  },
  login: () => {
    window.location.assign('/auth/login');
  },
  logout: async () => {
    try {
      await fetch('/auth/logout', { credentials: 'include', method: 'POST' });
    } finally {
      set({ status: 'anonymous', user: null });
    }
  },
  markAnonymous: () => set({ status: 'anonymous', user: null }),
}));
