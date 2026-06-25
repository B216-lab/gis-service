import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type {
  SavedTableFilter,
  SavedTableView,
  TableFilterDefinition,
} from '../filters/types';
import { type BasemapId, defaultBasemapId } from '../map/basemaps';
import type { RowReference } from '../map/selection';

export interface DatabaseConnection {
  id: string;
  name: string;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  isServerManaged: boolean;
  isActive: boolean;
  createdAt: string;
  testStatus: 'idle' | 'testing' | 'success' | 'error';
  testMessage: string;
  postgresVersion: string;
  postgisVersion: string;
}

export type LayerGlyphIcon = 'circle' | 'square' | 'diamond' | 'line' | 'flow';
export type SpatialFilterPredicate = 'intersects' | 'within';

export interface LayerSpatialFilter {
  sourceLayerId: string;
  sourceLayerName: string;
  sourceSchema: string;
  sourceTable: string;
  sourceGeometryColumn: string;
  rowRefs: RowReference[];
  predicate: SpatialFilterPredicate;
}

export interface GeoJsonTableSource {
  id: string;
  type: 'geojson-table';
  connectionId: string;
  schema: string;
  table: string;
  fullName: string;
  kind: string;
  geometryColumn: string;
  geometryType: string;
  filter?: TableFilterDefinition | null;
  spatialFilter?: LayerSpatialFilter | null;
  sourceViewId?: string | null;
  refreshKey?: string;
}

export interface FlowmapTableSource {
  id: string;
  type: 'flowmap-table';
  connectionId: string;
  schema: string;
  table: string;
  fullName: string;
  kind: string;
  columns: {
    startMode: 'coordinates' | 'geometry';
    startLon: string;
    startLat: string;
    startGeometry: string;
    endMode: 'coordinates' | 'geometry';
    endLon: string;
    endLat: string;
    endGeometry: string;
    magnitude: string;
    defaultMagnitude: number;
  };
  spatialFilter?: LayerSpatialFilter | null;
}

export type MapSource = GeoJsonTableSource | FlowmapTableSource;

interface BaseMapLayer {
  id: string;
  connectionId: string;
  sourceId: string;
  name: string;
  visible: boolean;
  icon: LayerGlyphIcon;
}

export interface GeoJsonMapLayer extends BaseMapLayer {
  type: 'geojson';
  color: string;
  opacity: number;
}

export interface FlowmapMapLayer extends BaseMapLayer {
  type: 'flowmap';
  style: {
    flowLinesRenderingMode: 'straight' | 'curved' | 'animated-straight';
    flowLineThicknessScale: number;
    clusteringEnabled: boolean;
    clusteringAuto: boolean;
    locationsEnabled: boolean;
    locationTotalsEnabled: boolean;
    locationLabelsEnabled: boolean;
    maxTopFlowsDisplayNum: number;
    colorScheme: string;
    darkMode: boolean;
  };
}

export type MapLayer = GeoJsonMapLayer | FlowmapMapLayer;

interface LegacyImportedLayer {
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
  mapSources: MapSource[];
  mapLayers: MapLayer[];
  savedTableViews: SavedTableView[];
  selectedBasemapId: BasemapId;
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
  setSelectedTable: (connectionId: string, tableKey: string | null) => void;
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
  }) => void;
  refreshGeoJsonSourcesForTable: (payload: {
    connectionId: string;
    schema: string;
    table: string;
  }) => void;
  addFlowmapLayer: (payload: {
    connectionId: string;
    schema: string;
    table: string;
    fullName: string;
    kind: string;
    name: string;
    columns: FlowmapTableSource['columns'];
  }) => void;
  removeMapLayer: (layerId: string) => void;
  toggleMapLayerVisibility: (layerId: string) => void;
  updateGeoJsonLayer: (
    layerId: string,
    patch: Partial<
      Pick<GeoJsonMapLayer, 'name' | 'icon' | 'color' | 'opacity'>
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

function createMapSourceId() {
  return `source-${crypto.randomUUID()}`;
}

function createMapLayerId() {
  return `layer-${crypto.randomUUID()}`;
}

function createSavedTableViewId() {
  return `view-${crypto.randomUUID()}`;
}

function normalizeSavedTableView(
  view: Partial<SavedTableView & SavedTableFilter>,
): SavedTableView | null {
  const sourceSchema = view.sourceSchema ?? view.schema;
  const sourceTable = view.sourceTable ?? view.table;
  if (
    !view.name ||
    !view.connectionId ||
    !sourceSchema ||
    !sourceTable ||
    !view.filter
  ) {
    return null;
  }

  const createdAt = view.createdAt ?? new Date().toISOString();

  return {
    id: view.id ?? createSavedTableViewId(),
    name: view.name,
    connectionId: view.connectionId,
    sourceSchema,
    sourceTable,
    createdAt,
    updatedAt: view.updatedAt ?? createdAt,
    filter: view.filter,
  };
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

function getDefaultLayerIcon(geometryType: string): LayerGlyphIcon {
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

function createDefaultFlowmapStyle(): FlowmapMapLayer['style'] {
  return {
    flowLinesRenderingMode: 'curved',
    flowLineThicknessScale: 2,
    clusteringEnabled: false,
    clusteringAuto: true,
    locationsEnabled: true,
    locationTotalsEnabled: false,
    locationLabelsEnabled: false,
    maxTopFlowsDisplayNum: 500,
    colorScheme: 'Teal',
    darkMode: false,
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
      isServerManaged: connection.isServerManaged ?? false,
    };
  }

  return {
    ...connection,
    password: '',
    isServerManaged: connection.isServerManaged ?? false,
  };
}

function stripConnectionSecret(connection: DatabaseConnection) {
  return {
    ...connection,
    password: '',
  };
}

function normalizeMapSource(source: Partial<MapSource>): MapSource | null {
  if (source.type === 'geojson-table') {
    return {
      id: source.id ?? createMapSourceId(),
      type: 'geojson-table',
      connectionId: source.connectionId ?? '',
      schema: source.schema ?? 'public',
      table: source.table ?? '',
      fullName:
        source.fullName ?? `${source.schema ?? 'public'}.${source.table ?? ''}`,
      kind: source.kind ?? 'table',
      geometryColumn: source.geometryColumn ?? 'geom',
      geometryType: source.geometryType ?? '',
      filter: source.filter ?? null,
      spatialFilter: source.spatialFilter ?? null,
      sourceViewId: source.sourceViewId ?? null,
      refreshKey: source.refreshKey ?? '',
    };
  }

  if (source.type === 'flowmap-table') {
    const columns = source.columns ?? {
      startMode: 'coordinates',
      startLon: '',
      startLat: '',
      startGeometry: '',
      endMode: 'coordinates',
      endLon: '',
      endLat: '',
      endGeometry: '',
      magnitude: '',
      defaultMagnitude: 1,
    };

    return {
      id: source.id ?? createMapSourceId(),
      type: 'flowmap-table',
      connectionId: source.connectionId ?? '',
      schema: source.schema ?? 'public',
      table: source.table ?? '',
      fullName:
        source.fullName ?? `${source.schema ?? 'public'}.${source.table ?? ''}`,
      kind: source.kind ?? 'table',
      columns: {
        startMode: columns.startMode ?? 'coordinates',
        startLon: columns.startLon ?? '',
        startLat: columns.startLat ?? '',
        startGeometry: columns.startGeometry ?? '',
        endMode: columns.endMode ?? 'coordinates',
        endLon: columns.endLon ?? '',
        endLat: columns.endLat ?? '',
        endGeometry: columns.endGeometry ?? '',
        magnitude: columns.magnitude ?? '',
        defaultMagnitude: columns.defaultMagnitude ?? 1,
      },
      spatialFilter: source.spatialFilter ?? null,
    };
  }

  return null;
}

function normalizeMapLayer(layer: Partial<MapLayer>, index: number): MapLayer {
  if (layer.type === 'flowmap') {
    return {
      id: layer.id ?? createMapLayerId(),
      type: 'flowmap',
      connectionId: layer.connectionId ?? '',
      sourceId: layer.sourceId ?? '',
      name: layer.name ?? 'Flow layer',
      visible: layer.visible ?? true,
      icon: layer.icon ?? 'flow',
      style: layer.style ?? createDefaultFlowmapStyle(),
    };
  }

  const geoJsonLayer = layer as Partial<GeoJsonMapLayer>;

  return {
    id: geoJsonLayer.id ?? createMapLayerId(),
    type: 'geojson',
    connectionId: geoJsonLayer.connectionId ?? '',
    sourceId: geoJsonLayer.sourceId ?? '',
    name: geoJsonLayer.name ?? 'Layer',
    visible: geoJsonLayer.visible ?? true,
    icon: geoJsonLayer.icon ?? getDefaultLayerIcon(''),
    color: geoJsonLayer.color ?? getDefaultLayerColor(index),
    opacity: geoJsonLayer.opacity ?? 80,
  };
}

function findGeoJsonSource(
  sources: MapSource[],
  payload: {
    connectionId: string;
    schema: string;
    table: string;
    geometryColumn: string;
    filter?: TableFilterDefinition | null;
    sourceViewId?: string | null;
  },
) {
  return sources.find(
    (source): source is GeoJsonTableSource =>
      source.type === 'geojson-table' &&
      source.connectionId === payload.connectionId &&
      source.schema === payload.schema &&
      source.table === payload.table &&
      source.geometryColumn === payload.geometryColumn &&
      (source.sourceViewId ?? null) === (payload.sourceViewId ?? null) &&
      JSON.stringify(source.filter ?? null) ===
        JSON.stringify(payload.filter ?? null),
  );
}

function touchGeoJsonSource(source: GeoJsonTableSource): GeoJsonTableSource {
  return {
    ...source,
    refreshKey: crypto.randomUUID(),
  };
}

function isGeoJsonSourceLinkedToView(
  source: GeoJsonTableSource,
  view: SavedTableView,
) {
  return (
    source.sourceViewId === view.id ||
    ((source.sourceViewId ?? null) === null &&
      source.connectionId === view.connectionId &&
      source.schema === view.sourceSchema &&
      source.table === view.sourceTable &&
      JSON.stringify(source.filter ?? null) === JSON.stringify(view.filter))
  );
}

function findFlowmapSource(
  sources: MapSource[],
  payload: {
    connectionId: string;
    schema: string;
    table: string;
    columns: FlowmapTableSource['columns'];
  },
) {
  return sources.find(
    (source): source is FlowmapTableSource =>
      source.type === 'flowmap-table' &&
      source.connectionId === payload.connectionId &&
      source.schema === payload.schema &&
      source.table === payload.table &&
      JSON.stringify(source.columns) === JSON.stringify(payload.columns),
  );
}

function migrateLegacyLayers(
  legacyLayers: LegacyImportedLayer[],
  currentSources: MapSource[],
  currentLayers: MapLayer[],
) {
  const sources = [...currentSources];
  const layers = [...currentLayers];

  for (const legacyLayer of legacyLayers) {
    let source = findGeoJsonSource(sources, legacyLayer);

    if (!source) {
      source = {
        id: createMapSourceId(),
        type: 'geojson-table',
        connectionId: legacyLayer.connectionId,
        schema: legacyLayer.schema,
        table: legacyLayer.table,
        fullName: legacyLayer.fullName,
        kind: legacyLayer.kind,
        geometryColumn: legacyLayer.geometryColumn,
        geometryType: legacyLayer.geometryType,
      };
      sources.push(source);
    }

    if (
      layers.some(
        (layer) => layer.id === legacyLayer.id || layer.sourceId === source.id,
      )
    ) {
      continue;
    }

    layers.push({
      id: legacyLayer.id ?? createMapLayerId(),
      type: 'geojson',
      connectionId: legacyLayer.connectionId,
      sourceId: source.id,
      name: legacyLayer.name,
      visible: legacyLayer.visible,
      icon: legacyLayer.icon,
      color: legacyLayer.color,
      opacity: legacyLayer.opacity,
    });
  }

  return { mapSources: sources, mapLayers: layers };
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
          isServerManaged: false,
          isActive: true,
          createdAt: new Date().toISOString(),
          testStatus: 'idle',
          testMessage: 'Not tested yet.',
          postgresVersion: '',
          postgisVersion: '',
        },
      ],
      mapSources: [],
      mapLayers: [],
      savedTableViews: [],
      selectedBasemapId: defaultBasemapId,
      selectedConnectionId: null,
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
      setSelectedTable: (connectionId, tableKey) =>
        set((state) => ({
          selectedTableByConnectionId: {
            ...state.selectedTableByConnectionId,
            [connectionId]: tableKey,
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
                color: getDefaultLayerColor(state.mapLayers.length),
                opacity: 80,
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
                style: createDefaultFlowmapStyle(),
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

        return {
          ...currentState,
          ...state,
          connections: (state.connections ?? currentState.connections).map(
            normalizeConnection,
          ),
          mapSources: migratedLegacy.mapSources,
          mapLayers: migratedLegacy.mapLayers,
          savedTableViews: [
            ...(state.savedTableViews ?? []),
            ...(state.savedTableFilters ?? []),
          ]
            .map(normalizeSavedTableView)
            .filter((view): view is SavedTableView => view !== null),
        };
      },
      partialize: (state) => ({
        connections: state.connections.map(stripConnectionSecret),
        mapSources: state.mapSources,
        mapLayers: state.mapLayers,
        savedTableViews: state.savedTableViews,
        selectedConnectionId: state.selectedConnectionId,
        selectedTableByConnectionId: state.selectedTableByConnectionId,
      }),
    },
  ),
);
