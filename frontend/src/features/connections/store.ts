import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type {
  SavedTableFilter,
  SavedTableView,
  TableFilterDefinition,
} from '../filters/types';
import { type BasemapId, defaultBasemapId } from '../map/basemaps';
import type { RowReference } from '../map/selection';
import type {
  ArcMapLayer,
  DatabaseConnection,
  FlowmapMapLayer,
  FlowmapTableSource,
  GeoJsonMapLayer,
  GeoJsonTableSource,
  LayerGlyphIcon,
  LayerSpatialFilter,
  LegacyImportedLayer,
  MapLayer,
  MapLayerPurpose,
  MapSource,
  RelationDisplayConfig,
  TableDisplayConfig,
} from './model';

export type {
  ArcMapLayer,
  DatabaseConnection,
  FlowmapMapLayer,
  FlowmapTableSource,
  GeoJsonMapLayer,
  GeoJsonTableSource,
  LayerGlyphIcon,
  LayerSpatialFilter,
  MapLayer,
  MapLayerPurpose,
  MapSource,
  RelationDisplayConfig,
  SpatialFilterPredicate,
  TableDisplayConfig,
} from './model';

import {
  createConnectionId,
  createDefaultFlowmapStyle,
  createMapLayerId,
  createMapSourceId,
  createSavedTableViewId,
  findFlowmapSource,
  findGeoJsonSource,
  getDefaultLayerColor,
  getDefaultLayerIcon,
  isBundledLocalTestConnection,
  isGeoJsonSourceLinkedToView,
  migrateLegacyLayers,
  normalizeConnection,
  normalizeMapLayer,
  normalizeMapSource,
  normalizeSavedTableView,
  stripConnectionSecret,
  touchGeoJsonSource,
  touchMapSource,
} from './store-helpers';

interface ConnectionStoreState {
  connections: DatabaseConnection[];
  mapSources: MapSource[];
  mapLayers: MapLayer[];
  savedTableViews: SavedTableView[];
  relationDisplayByKey: Record<string, RelationDisplayConfig>;
  tableDisplayByKey: Record<string, TableDisplayConfig>;
  selectedBasemapId: BasemapId;
  selectedConnectionId: string | null;
  selectedSchemaNamesByConnectionId: Record<string, string[]>;
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
      | 'isServerManaged'
    >,
  ) => void;
  upsertServerConnections: (
    connections: Pick<DatabaseConnection, 'id' | 'name'>[],
  ) => void;
  removeConnection: (connectionId: string) => void;
  addSavedTableView: (
    view: Omit<SavedTableView, 'id' | 'createdAt' | 'updatedAt'>,
  ) => void;
  updateSavedTableView: (
    viewId: string,
    patch: Partial<Pick<SavedTableView, 'name' | 'filter'>>,
  ) => void;
  removeSavedTableView: (viewId: string) => void;
  setSelectedBasemap: (basemapId: BasemapId) => void;
  selectConnection: (connectionId: string) => void;
  setSelectedSchemaNames: (connectionId: string, schemaNames: string[]) => void;
  setSelectedTable: (connectionId: string, tableKey: string | null) => void;
  setRelationDisplayConfig: (
    key: string,
    config: RelationDisplayConfig,
  ) => void;
  setTableDisplayConfig: (key: string, config: TableDisplayConfig) => void;
  setTableDisplayConfigs: (configs: Record<string, TableDisplayConfig>) => void;
  addGeoJsonLayer: (payload: {
    connectionId: string;
    schema: string;
    table: string;
    fullName: string;
    kind: string;
    name: string;
    geometryColumn: string;
    geometryType: string;
    filter?: TableFilterDefinition | null;
    sourceViewId?: string | null;
    purpose?: MapLayerPurpose;
  }) => void;
  refreshGeoJsonSourcesForTable: (payload: {
    connectionId: string;
    schema: string;
    table: string;
  }) => void;
  refreshMapSourcesForConnection: (connectionId: string) => void;
  addFlowmapLayer: (payload: {
    connectionId: string;
    schema: string;
    table: string;
    fullName: string;
    kind: string;
    name: string;
    columns: FlowmapTableSource['columns'];
    rowRef?: RowReference | null;
    purpose?: MapLayerPurpose;
  }) => void;
  addArcLayer: (payload: {
    connectionId: string;
    schema: string;
    table: string;
    fullName: string;
    kind: string;
    name: string;
    columns: FlowmapTableSource['columns'];
    rowRef?: RowReference | null;
    purpose?: MapLayerPurpose;
  }) => void;
  removeMapLayer: (layerId: string) => void;
  toggleMapLayerVisibility: (layerId: string) => void;
  updateGeoJsonLayer: (
    layerId: string,
    patch: Partial<
      Pick<
        GeoJsonMapLayer,
        | 'name'
        | 'icon'
        | 'fillColor'
        | 'fillOpacity'
        | 'strokeColor'
        | 'strokeOpacity'
        | 'strokeWidth'
        | 'pointRadius'
      >
    >,
  ) => void;
  updateGeoJsonSource: (
    sourceId: string,
    patch: Partial<
      Pick<
        GeoJsonTableSource,
        'geometryColumn' | 'geometryType' | 'spatialFilter'
      >
    >,
  ) => void;
  updateFlowmapSource: (
    sourceId: string,
    patch: Partial<FlowmapTableSource['columns']>,
  ) => void;
  updateFlowmapSpatialFilter: (
    sourceId: string,
    spatialFilter: LayerSpatialFilter | null,
  ) => void;
  updateFlowmapLayer: (
    layerId: string,
    patch: {
      name?: string;
      icon?: LayerGlyphIcon;
      style?: Partial<FlowmapMapLayer['style']>;
    },
  ) => void;
  updateArcLayer: (
    layerId: string,
    patch: Partial<
      Pick<ArcMapLayer, 'name' | 'icon' | 'color' | 'opacity' | 'width'>
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

export const useConnectionStore = create<ConnectionStoreState>()(
  persist(
    (set) => ({
      connections: [],
      mapSources: [],
      mapLayers: [],
      savedTableViews: [],
      relationDisplayByKey: {},
      tableDisplayByKey: {},
      selectedBasemapId: defaultBasemapId,
      selectedConnectionId: null,
      selectedSchemaNamesByConnectionId: {},
      selectedTableByConnectionId: {},
      addConnection: (connection) =>
        set((state) => {
          const nextConnection: DatabaseConnection = {
            ...connection,
            isServerManaged: false,
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
            selectedSchemaNamesByConnectionId: {
              ...state.selectedSchemaNamesByConnectionId,
              [nextConnection.id]: [],
            },
            selectedTableByConnectionId: {
              ...state.selectedTableByConnectionId,
              [nextConnection.id]: null,
            },
          };
        }),
      upsertServerConnections: (connections) =>
        set((state) => {
          const serverIds = new Set(
            connections.map((connection) => connection.id),
          );
          const existingById = new Map(
            state.connections.map((connection) => [connection.id, connection]),
          );
          const nextServerConnections = connections.map((connection) => {
            const existing = existingById.get(connection.id);

            return {
              ...connection,
              host: existing?.host ?? '',
              port: existing?.port ?? '',
              database: existing?.database ?? '',
              user: existing?.user ?? '',
              password: '',
              isServerManaged: true,
              isActive: existing?.isActive ?? true,
              createdAt: existing?.createdAt ?? new Date().toISOString(),
              testStatus: existing?.testStatus ?? 'idle',
              testMessage:
                existing?.testMessage ?? 'Server-managed connection.',
              postgresVersion: existing?.postgresVersion ?? '',
              postgisVersion: existing?.postgisVersion ?? '',
            } satisfies DatabaseConnection;
          });
          const localConnections = state.connections.filter(
            (connection) =>
              !connection.isServerManaged || serverIds.has(connection.id),
          );
          const localOnlyConnections = localConnections.filter(
            (connection) => !serverIds.has(connection.id),
          );
          const nextConnections = [
            ...nextServerConnections,
            ...localOnlyConnections,
          ];
          const selectedConnectionId =
            state.selectedConnectionId &&
            nextConnections.some(
              (connection) => connection.id === state.selectedConnectionId,
            )
              ? state.selectedConnectionId
              : (nextConnections[0]?.id ?? null);

          return {
            connections: nextConnections,
            selectedConnectionId,
            selectedSchemaNamesByConnectionId: {
              ...Object.fromEntries(
                nextServerConnections.map((connection) => [connection.id, []]),
              ),
              ...state.selectedSchemaNamesByConnectionId,
            },
            selectedTableByConnectionId: {
              ...Object.fromEntries(
                nextServerConnections.map((connection) => [
                  connection.id,
                  null,
                ]),
              ),
              ...state.selectedTableByConnectionId,
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
          const nextSources = state.mapSources.filter(
            (source) => source.connectionId !== connectionId,
          );
          const nextSourceIds = new Set(nextSources.map((source) => source.id));

          return {
            connections: nextConnections,
            mapSources: nextSources,
            mapLayers: state.mapLayers.filter(
              (layer) =>
                layer.connectionId !== connectionId &&
                nextSourceIds.has(layer.sourceId),
            ),
            savedTableViews: state.savedTableViews.filter(
              (view) => view.connectionId !== connectionId,
            ),
            selectedConnectionId: nextSelectedId,
            selectedSchemaNamesByConnectionId: Object.fromEntries(
              Object.entries(state.selectedSchemaNamesByConnectionId).filter(
                ([key]) => key !== connectionId,
              ),
            ),
            selectedTableByConnectionId: Object.fromEntries(
              Object.entries(state.selectedTableByConnectionId).filter(
                ([key]) => key !== connectionId,
              ),
            ),
          };
        }),
      addSavedTableView: (view) =>
        set((state) => ({
          savedTableViews: [
            {
              ...view,
              id: createSavedTableViewId(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            ...state.savedTableViews,
          ],
        })),
      updateSavedTableView: (viewId, patch) =>
        set((state) => {
          const updatedAt = new Date().toISOString();
          const previousView =
            state.savedTableViews.find((view) => view.id === viewId) ?? null;
          const nextSavedTableViews = state.savedTableViews.map((view) =>
            view.id === viewId
              ? {
                  ...view,
                  ...patch,
                  updatedAt,
                }
              : view,
          );
          const nextView = nextSavedTableViews.find(
            (view) => view.id === viewId,
          );

          return {
            savedTableViews: nextSavedTableViews,
            mapSources: state.mapSources.map((source) =>
              source.type === 'geojson-table' &&
              previousView &&
              isGeoJsonSourceLinkedToView(source, previousView) &&
              nextView
                ? touchGeoJsonSource({
                    ...source,
                    filter: nextView.filter,
                    sourceViewId: viewId,
                  })
                : source,
            ),
          };
        }),
      removeSavedTableView: (viewId) =>
        set((state) => {
          const previousView =
            state.savedTableViews.find((view) => view.id === viewId) ?? null;

          return {
            savedTableViews: state.savedTableViews.filter(
              (view) => view.id !== viewId,
            ),
            mapSources: state.mapSources.map((source) =>
              source.type === 'geojson-table' &&
              previousView &&
              isGeoJsonSourceLinkedToView(source, previousView)
                ? touchGeoJsonSource({
                    ...source,
                    sourceViewId: null,
                  })
                : source,
            ),
          };
        }),
      setSelectedBasemap: (basemapId) =>
        set({
          selectedBasemapId: basemapId,
        }),
      selectConnection: (connectionId) =>
        set({
          selectedConnectionId: connectionId,
        }),
      setSelectedSchemaNames: (connectionId, schemaNames) =>
        set((state) => ({
          selectedSchemaNamesByConnectionId: {
            ...state.selectedSchemaNamesByConnectionId,
            [connectionId]: schemaNames,
          },
        })),
      setSelectedTable: (connectionId, tableKey) =>
        set((state) => ({
          selectedTableByConnectionId: {
            ...state.selectedTableByConnectionId,
            [connectionId]: tableKey,
          },
        })),
      setRelationDisplayConfig: (key, config) =>
        set((state) => ({
          relationDisplayByKey: {
            ...state.relationDisplayByKey,
            [key]: config,
          },
        })),
      setTableDisplayConfig: (key, config) =>
        set((state) => ({
          tableDisplayByKey: {
            ...state.tableDisplayByKey,
            [key]: config,
          },
        })),
      setTableDisplayConfigs: (configs) =>
        set((state) => ({
          tableDisplayByKey: {
            ...state.tableDisplayByKey,
            ...configs,
          },
        })),
      addGeoJsonLayer: (payload) =>
        set((state) => {
          let source = findGeoJsonSource(state.mapSources, payload);
          const nextSources = [...state.mapSources];

          if (!source) {
            source = {
              id: createMapSourceId(),
              type: 'geojson-table',
              connectionId: payload.connectionId,
              schema: payload.schema,
              table: payload.table,
              fullName: payload.fullName,
              kind: payload.kind,
              geometryColumn: payload.geometryColumn,
              geometryType: payload.geometryType,
              filter: payload.filter ?? null,
              spatialFilter: null,
              sourceViewId: payload.sourceViewId ?? null,
              refreshKey: '',
            };
            nextSources.push(source);
          }

          const existingLayer = state.mapLayers.find(
            (layer) => layer.type === 'geojson' && layer.sourceId === source.id,
          );

          if (existingLayer) {
            return {
              mapSources: nextSources,
              mapLayers: state.mapLayers.map((layer) =>
                layer.id === existingLayer.id
                  ? {
                      ...layer,
                      visible: true,
                    }
                  : layer,
              ),
            };
          }

          return {
            mapSources: nextSources,
            mapLayers: [
              ...state.mapLayers,
              {
                id: createMapLayerId(),
                type: 'geojson',
                connectionId: payload.connectionId,
                sourceId: source.id,
                name: payload.name,
                visible: true,
                icon: getDefaultLayerIcon(payload.geometryType),
                purpose: payload.purpose ?? 'configured',
                fillColor: getDefaultLayerColor(state.mapLayers.length),
                fillOpacity: /polygon/i.test(payload.geometryType) ? 50 : 80,
                strokeColor: getDefaultLayerColor(state.mapLayers.length),
                strokeOpacity: 95,
                strokeWidth: 2,
                pointRadius: 6,
              },
            ],
          };
        }),
      refreshGeoJsonSourcesForTable: (payload) =>
        set((state) => ({
          mapSources: state.mapSources.map((source) =>
            source.type === 'geojson-table' &&
            source.connectionId === payload.connectionId &&
            source.schema === payload.schema &&
            source.table === payload.table
              ? touchGeoJsonSource(source)
              : source,
          ),
        })),
      refreshMapSourcesForConnection: (connectionId) =>
        set((state) => ({
          mapSources: state.mapSources.map((source) =>
            source.connectionId === connectionId
              ? touchMapSource(source)
              : source,
          ),
        })),
      addFlowmapLayer: (payload) =>
        set((state) => {
          let source = findFlowmapSource(state.mapSources, payload);
          const nextSources = [...state.mapSources];

          if (!source) {
            source = {
              id: createMapSourceId(),
              type: 'flowmap-table',
              connectionId: payload.connectionId,
              schema: payload.schema,
              table: payload.table,
              fullName: payload.fullName,
              kind: payload.kind,
              columns: payload.columns,
              spatialFilter: null,
              rowRef: payload.rowRef ?? null,
              refreshKey: '',
            };
            nextSources.push(source);
          }

          const existingLayer = state.mapLayers.find(
            (layer) => layer.type === 'flowmap' && layer.sourceId === source.id,
          );

          if (existingLayer) {
            return {
              mapSources: nextSources,
              mapLayers: state.mapLayers.map((layer) =>
                layer.id === existingLayer.id
                  ? {
                      ...layer,
                      visible: true,
                    }
                  : layer,
              ),
            };
          }

          return {
            mapSources: nextSources,
            mapLayers: [
              ...state.mapLayers,
              {
                id: createMapLayerId(),
                type: 'flowmap',
                connectionId: payload.connectionId,
                sourceId: source.id,
                name: payload.name,
                visible: true,
                icon: 'flow',
                purpose: payload.purpose ?? 'configured',
                style: createDefaultFlowmapStyle(),
              },
            ],
          };
        }),
      addArcLayer: (payload) =>
        set((state) => {
          let source = findFlowmapSource(state.mapSources, payload);
          const nextSources = [...state.mapSources];

          if (!source) {
            source = {
              id: createMapSourceId(),
              type: 'flowmap-table',
              connectionId: payload.connectionId,
              schema: payload.schema,
              table: payload.table,
              fullName: payload.fullName,
              kind: payload.kind,
              columns: payload.columns,
              spatialFilter: null,
              rowRef: payload.rowRef ?? null,
              refreshKey: '',
            };
            nextSources.push(source);
          }

          const existingLayer = state.mapLayers.find(
            (layer) => layer.type === 'arc' && layer.sourceId === source.id,
          );

          if (existingLayer) {
            return {
              mapSources: nextSources,
              mapLayers: state.mapLayers.map((layer) =>
                layer.id === existingLayer.id
                  ? {
                      ...layer,
                      visible: true,
                    }
                  : layer,
              ),
            };
          }

          return {
            mapSources: nextSources,
            mapLayers: [
              ...state.mapLayers,
              {
                id: createMapLayerId(),
                type: 'arc',
                connectionId: payload.connectionId,
                sourceId: source.id,
                name: payload.name,
                visible: true,
                icon: 'flow',
                purpose: payload.purpose ?? 'configured',
                color: getDefaultLayerColor(state.mapLayers.length),
                opacity: 86,
                width: 3,
              },
            ],
          };
        }),
      removeMapLayer: (layerId) =>
        set((state) => {
          const removedLayer = state.mapLayers.find(
            (layer) => layer.id === layerId,
          );
          const nextLayers = state.mapLayers.filter(
            (layer) => layer.id !== layerId,
          );

          if (
            !removedLayer ||
            nextLayers.some((layer) => layer.sourceId === removedLayer.sourceId)
          ) {
            return {
              mapLayers: nextLayers,
            };
          }

          return {
            mapLayers: nextLayers,
            mapSources: state.mapSources.filter(
              (source) => source.id !== removedLayer.sourceId,
            ),
          };
        }),
      toggleMapLayerVisibility: (layerId) =>
        set((state) => ({
          mapLayers: state.mapLayers.map((layer) =>
            layer.id === layerId
              ? { ...layer, visible: !layer.visible }
              : layer,
          ),
        })),
      updateGeoJsonLayer: (layerId, patch) =>
        set((state) => ({
          mapLayers: state.mapLayers.map((layer) =>
            layer.id === layerId && layer.type === 'geojson'
              ? { ...layer, ...patch }
              : layer,
          ),
        })),
      updateGeoJsonSource: (sourceId, patch) =>
        set((state) => ({
          mapSources: state.mapSources.map((source) =>
            source.id === sourceId && source.type === 'geojson-table'
              ? touchGeoJsonSource({ ...source, ...patch })
              : source,
          ),
        })),
      updateFlowmapSource: (sourceId, patch) =>
        set((state) => ({
          mapSources: state.mapSources.map((source) =>
            source.id === sourceId && source.type === 'flowmap-table'
              ? {
                  ...source,
                  columns: {
                    ...source.columns,
                    ...patch,
                  },
                }
              : source,
          ),
        })),
      updateFlowmapSpatialFilter: (sourceId, spatialFilter) =>
        set((state) => ({
          mapSources: state.mapSources.map((source) =>
            source.id === sourceId && source.type === 'flowmap-table'
              ? {
                  ...source,
                  spatialFilter,
                }
              : source,
          ),
        })),
      updateFlowmapLayer: (layerId, patch) =>
        set((state) => ({
          mapLayers: state.mapLayers.map((layer) =>
            layer.id === layerId && layer.type === 'flowmap'
              ? {
                  ...layer,
                  ...patch,
                  style: patch.style
                    ? {
                        ...layer.style,
                        ...patch.style,
                      }
                    : layer.style,
                }
              : layer,
          ),
        })),
      updateArcLayer: (layerId, patch) =>
        set((state) => ({
          mapLayers: state.mapLayers.map((layer) =>
            layer.id === layerId && layer.type === 'arc'
              ? { ...layer, ...patch }
              : layer,
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
        const state = persistedState as Partial<
          ConnectionStoreState & {
            importedLayers?: LegacyImportedLayer[];
            mapSources?: Partial<MapSource>[];
            mapLayers?: Partial<MapLayer>[];
            savedTableFilters?: SavedTableFilter[];
            savedTableViews?: Partial<SavedTableView>[];
            relationDisplayByKey?: Record<string, RelationDisplayConfig>;
            tableDisplayByKey?: Record<string, TableDisplayConfig>;
          }
        >;

        const nextMapSources = (state.mapSources ?? currentState.mapSources)
          .map(normalizeMapSource)
          .filter((source): source is MapSource => source !== null);
        const nextMapLayers = (state.mapLayers ?? currentState.mapLayers).map(
          (layer, index) => normalizeMapLayer(layer, index),
        );
        const migratedLegacy = migrateLegacyLayers(
          state.importedLayers ?? [],
          nextMapSources,
          nextMapLayers,
        );
        const nextConnections = (
          state.connections ?? currentState.connections
        ).map(normalizeConnection);
        const filteredConnections = nextConnections.filter(
          (connection) => !isBundledLocalTestConnection(connection),
        );
        const persistedSelectedConnectionId =
          state.selectedConnectionId ?? null;
        const selectedConnectionId = filteredConnections.some(
          (connection) => connection.id === persistedSelectedConnectionId,
        )
          ? persistedSelectedConnectionId
          : (filteredConnections[0]?.id ?? null);

        return {
          ...currentState,
          ...state,
          connections: filteredConnections,
          mapSources: migratedLegacy.mapSources,
          mapLayers: migratedLegacy.mapLayers,
          savedTableViews: [
            ...(state.savedTableViews ?? []),
            ...(state.savedTableFilters ?? []),
          ]
            .map(normalizeSavedTableView)
            .filter((view): view is SavedTableView => view !== null),
          relationDisplayByKey:
            state.relationDisplayByKey ?? currentState.relationDisplayByKey,
          tableDisplayByKey:
            state.tableDisplayByKey ?? currentState.tableDisplayByKey,
          selectedConnectionId,
          selectedSchemaNamesByConnectionId:
            state.selectedSchemaNamesByConnectionId ??
            currentState.selectedSchemaNamesByConnectionId,
        };
      },
      partialize: (state) => ({
        connections: state.connections.map(stripConnectionSecret),
        mapSources: state.mapSources,
        mapLayers: state.mapLayers,
        savedTableViews: state.savedTableViews,
        relationDisplayByKey: state.relationDisplayByKey,
        selectedConnectionId: state.selectedConnectionId,
        selectedSchemaNamesByConnectionId:
          state.selectedSchemaNamesByConnectionId,
        selectedTableByConnectionId: state.selectedTableByConnectionId,
      }),
    },
  ),
);
