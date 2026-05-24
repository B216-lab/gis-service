import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface DatabaseConnection {
  id: string;
  name: string;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  isActive: boolean;
  createdAt: string;
}

interface ConnectionStoreState {
  connections: DatabaseConnection[];
  selectedConnectionId: string | null;
  addConnection: (
    connection: Omit<DatabaseConnection, 'id' | 'createdAt'>,
  ) => void;
  removeConnection: (connectionId: string) => void;
  selectConnection: (connectionId: string) => void;
  toggleConnectionActive: (connectionId: string) => void;
}

function createConnectionId() {
  return `connection-${crypto.randomUUID()}`;
}

export const useConnectionStore = create<ConnectionStoreState>()(
  persist(
    (set) => ({
      connections: [
        {
          id: createConnectionId(),
          name: 'Local PostGIS Test',
          host: '127.0.0.1',
          port: '55432',
          database: 'geopanel_test',
          user: 'geopanel',
          password: '',
          isActive: true,
          createdAt: new Date().toISOString(),
        },
      ],
      selectedConnectionId: null,
      addConnection: (connection) =>
        set((state) => {
          const nextConnection: DatabaseConnection = {
            ...connection,
            id: createConnectionId(),
            createdAt: new Date().toISOString(),
          };

          return {
            connections: [nextConnection, ...state.connections],
            selectedConnectionId: nextConnection.id,
          };
        }),
      removeConnection: (connectionId) =>
        set((state) => {
          const nextConnections = state.connections.filter(
            (connection) => connection.id !== connectionId,
          );
          const nextSelectedId =
            state.selectedConnectionId === connectionId
              ? (nextConnections[0]?.id ?? null)
              : state.selectedConnectionId;

          return {
            connections: nextConnections,
            selectedConnectionId: nextSelectedId,
          };
        }),
      selectConnection: (connectionId) =>
        set({
          selectedConnectionId: connectionId,
        }),
      toggleConnectionActive: (connectionId) =>
        set((state) => ({
          connections: state.connections.map((connection) =>
            connection.id === connectionId
              ? { ...connection, isActive: !connection.isActive }
              : connection,
          ),
        })),
    }),
    {
      name: 'geopanel-connections',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        connections: state.connections,
        selectedConnectionId: state.selectedConnectionId,
      }),
    },
  ),
);
