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
  testStatus: 'idle' | 'testing' | 'success' | 'error';
  testMessage: string;
  postgresVersion: string;
  postgisVersion: string;
}

interface ConnectionStoreState {
  connections: DatabaseConnection[];
  selectedConnectionId: string | null;
  selectedTableByConnectionId: Record<string, string | null>;
  addConnection: (
    connection: Omit<
      DatabaseConnection,
      | 'id'
      | 'createdAt'
      | 'testStatus'
      | 'testMessage'
      | 'postgresVersion'
      | 'postgisVersion'
    >,
  ) => void;
  removeConnection: (connectionId: string) => void;
  selectConnection: (connectionId: string) => void;
  setSelectedTable: (connectionId: string, tableKey: string | null) => void;
  toggleConnectionActive: (connectionId: string) => void;
  setConnectionTestPending: (connectionId: string) => void;
  setConnectionTestSuccess: (
    connectionId: string,
    payload: {
      message: string;
      postgresVersion: string;
      postgisVersion: string;
    },
  ) => void;
  setConnectionTestError: (connectionId: string, message: string) => void;
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
          testStatus: 'idle',
          testMessage: 'Not tested yet.',
          postgresVersion: '',
          postgisVersion: '',
        },
      ],
      selectedConnectionId: null,
      selectedTableByConnectionId: {},
      addConnection: (connection) =>
        set((state) => {
          const nextConnection: DatabaseConnection = {
            ...connection,
            id: createConnectionId(),
            createdAt: new Date().toISOString(),
            testStatus: 'idle',
            testMessage: 'Not tested yet.',
            postgresVersion: '',
            postgisVersion: '',
          };

          return {
            connections: [nextConnection, ...state.connections],
            selectedConnectionId: nextConnection.id,
            selectedTableByConnectionId: {
              ...state.selectedTableByConnectionId,
              [nextConnection.id]: null,
            },
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
            selectedTableByConnectionId: Object.fromEntries(
              Object.entries(state.selectedTableByConnectionId).filter(
                ([key]) => key !== connectionId,
              ),
            ),
          };
        }),
      selectConnection: (connectionId) =>
        set({
          selectedConnectionId: connectionId,
        }),
      setSelectedTable: (connectionId, tableKey) =>
        set((state) => ({
          selectedTableByConnectionId: {
            ...state.selectedTableByConnectionId,
            [connectionId]: tableKey,
          },
        })),
      toggleConnectionActive: (connectionId) =>
        set((state) => ({
          connections: state.connections.map((connection) =>
            connection.id === connectionId
              ? { ...connection, isActive: !connection.isActive }
              : connection,
          ),
        })),
      setConnectionTestPending: (connectionId) =>
        set((state) => ({
          connections: state.connections.map((connection) =>
            connection.id === connectionId
              ? {
                  ...connection,
                  testStatus: 'testing',
                  testMessage: 'Testing connection...',
                }
              : connection,
          ),
        })),
      setConnectionTestSuccess: (connectionId, payload) =>
        set((state) => ({
          connections: state.connections.map((connection) =>
            connection.id === connectionId
              ? {
                  ...connection,
                  testStatus: 'success',
                  testMessage: payload.message,
                  postgresVersion: payload.postgresVersion,
                  postgisVersion: payload.postgisVersion,
                  isActive: true,
                }
              : connection,
          ),
        })),
      setConnectionTestError: (connectionId, message) =>
        set((state) => ({
          connections: state.connections.map((connection) =>
            connection.id === connectionId
              ? {
                  ...connection,
                  testStatus: 'error',
                  testMessage: message,
                  isActive: false,
                }
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
        selectedTableByConnectionId: state.selectedTableByConnectionId,
      }),
    },
  ),
);
