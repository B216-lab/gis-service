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

export interface ImportedLayer {
  id: string;
  connectionId: string;
  schema: string;
  table: string;
  fullName: string;
  kind: string;
  name: string;
  icon: 'circle' | 'square' | 'diamond' | 'line';
  color: string;
  opacity: number;
  visible: boolean;
  geometryColumn: string;
  geometryType: string;
}

interface ConnectionStoreState {
  connections: DatabaseConnection[];
  importedLayers: ImportedLayer[];
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
  addImportedLayer: (payload: {
    connectionId: string;
    schema: string;
    table: string;
    fullName: string;
    kind: string;
    name: string;
    geometryColumn: string;
    geometryType: string;
  }) => void;
  toggleImportedLayerVisibility: (layerId: string) => void;
  updateImportedLayer: (
    layerId: string,
    patch: Partial<
      Pick<
        ImportedLayer,
        | 'name'
        | 'icon'
        | 'color'
        | 'opacity'
        | 'geometryColumn'
        | 'geometryType'
        | 'visible'
      >
    >,
  ) => void;
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

function createImportedLayerId() {
  return `layer-${crypto.randomUUID()}`;
}

const layerColors = [
  '#228be6',
  '#2f9e44',
  '#f08c00',
  '#e03131',
  '#7b61ff',
  '#0c8599',
];

function getDefaultLayerColor(index: number) {
  return layerColors[index % layerColors.length];
}

function getDefaultLayerIcon(geometryType: string): ImportedLayer['icon'] {
  if (/line/i.test(geometryType)) {
    return 'line';
  }

  if (/polygon/i.test(geometryType)) {
    return 'square';
  }

  if (/point/i.test(geometryType)) {
    return 'circle';
  }

  return 'diamond';
}

function normalizeImportedLayer(
  layer: Partial<ImportedLayer>,
  index: number,
): ImportedLayer {
  const geometryType = layer.geometryType ?? '';

  return {
    id: layer.id ?? createImportedLayerId(),
    connectionId: layer.connectionId ?? '',
    schema: layer.schema ?? 'public',
    table: layer.table ?? '',
    fullName:
      layer.fullName ?? `${layer.schema ?? 'public'}.${layer.table ?? ''}`,
    kind: layer.kind ?? 'table',
    name: layer.name ?? layer.table ?? 'Layer',
    icon: layer.icon ?? getDefaultLayerIcon(geometryType),
    color: layer.color ?? getDefaultLayerColor(index),
    opacity: layer.opacity ?? 80,
    visible: layer.visible ?? true,
    geometryColumn: layer.geometryColumn ?? 'geom',
    geometryType,
  };
}

function normalizeConnection(
  connection: DatabaseConnection,
): DatabaseConnection {
  const isBundledLocalTestConnection =
    connection.name === 'Local PostGIS Test' &&
    connection.host === '127.0.0.1' &&
    connection.port === '55432' &&
    connection.database === 'geopanel_test' &&
    connection.user === 'geopanel';

  if (isBundledLocalTestConnection && connection.password === '') {
    return {
      ...connection,
      password: 'geopanel',
    };
  }

  return connection;
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
          password: 'geopanel',
          isActive: true,
          createdAt: new Date().toISOString(),
          testStatus: 'idle',
          testMessage: 'Not tested yet.',
          postgresVersion: '',
          postgisVersion: '',
        },
      ],
      importedLayers: [],
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
            importedLayers: state.importedLayers.filter(
              (layer) => layer.connectionId !== connectionId,
            ),
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
      addImportedLayer: (payload) =>
        set((state) => {
          const existingLayer = state.importedLayers.find(
            (layer) =>
              layer.connectionId === payload.connectionId &&
              layer.fullName === payload.fullName,
          );

          if (existingLayer) {
            return {
              importedLayers: state.importedLayers.map((layer) =>
                layer.id === existingLayer.id
                  ? {
                      ...layer,
                      visible: true,
                      geometryColumn:
                        payload.geometryColumn || layer.geometryColumn,
                      geometryType: payload.geometryType || layer.geometryType,
                    }
                  : layer,
              ),
            };
          }

          return {
            importedLayers: [
              ...state.importedLayers,
              {
                id: createImportedLayerId(),
                connectionId: payload.connectionId,
                schema: payload.schema,
                table: payload.table,
                fullName: payload.fullName,
                kind: payload.kind,
                name: payload.name,
                icon: getDefaultLayerIcon(payload.geometryType),
                color: getDefaultLayerColor(state.importedLayers.length),
                opacity: 80,
                visible: true,
                geometryColumn: payload.geometryColumn,
                geometryType: payload.geometryType,
              },
            ],
          };
        }),
      toggleImportedLayerVisibility: (layerId) =>
        set((state) => ({
          importedLayers: state.importedLayers.map((layer) =>
            layer.id === layerId
              ? { ...layer, visible: !layer.visible }
              : layer,
          ),
        })),
      updateImportedLayer: (layerId, patch) =>
        set((state) => ({
          importedLayers: state.importedLayers.map((layer) =>
            layer.id === layerId ? { ...layer, ...patch } : layer,
          ),
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
      merge: (persistedState, currentState) => {
        const state = persistedState as Partial<ConnectionStoreState>;

        return {
          ...currentState,
          ...state,
          connections: (state.connections ?? currentState.connections).map(
            normalizeConnection,
          ),
          importedLayers: (
            state.importedLayers ?? currentState.importedLayers
          ).map((layer, index) => normalizeImportedLayer(layer, index)),
        };
      },
      partialize: (state) => ({
        connections: state.connections,
        importedLayers: state.importedLayers,
        selectedConnectionId: state.selectedConnectionId,
        selectedTableByConnectionId: state.selectedTableByConnectionId,
      }),
    },
  ),
);
