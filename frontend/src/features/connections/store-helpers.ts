import type {
  SavedTableFilter,
  SavedTableView,
  TableFilterDefinition,
} from '../filters/types';
import type { RowReference } from '../map/selection';
import type {
  ArcMapLayer,
  DatabaseConnection,
  FlowmapMapLayer,
  FlowmapTableSource,
  GeoJsonMapLayer,
  GeoJsonTableSource,
  LayerGlyphIcon,
  LegacyImportedLayer,
  MapLayer,
  MapSource,
} from './model';

export function createConnectionId() {
  return `connection-${crypto.randomUUID()}`;
}

export function createMapSourceId() {
  return `source-${crypto.randomUUID()}`;
}

export function createMapLayerId() {
  return `layer-${crypto.randomUUID()}`;
}

export function createSavedTableViewId() {
  return `view-${crypto.randomUUID()}`;
}

export function normalizeSavedTableView(
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

export function getDefaultLayerColor(index: number) {
  return layerColors[index % layerColors.length];
}

export function getDefaultLayerIcon(geometryType: string): LayerGlyphIcon {
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

export function createDefaultFlowmapStyle(): FlowmapMapLayer['style'] {
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

export function normalizeConnection(
  connection: DatabaseConnection,
): DatabaseConnection {
  if (isBundledLocalTestConnection(connection) && connection.password === '') {
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

export function isBundledLocalTestConnection(connection: DatabaseConnection) {
  return (
    connection.name === 'Local PostGIS Test' &&
    connection.host === '127.0.0.1' &&
    connection.port === '55432' &&
    connection.database === 'geopanel_test' &&
    connection.user === 'geopanel'
  );
}

export function stripConnectionSecret(connection: DatabaseConnection) {
  return {
    ...connection,
    password: '',
  };
}

export function normalizeMapSource(
  source: Partial<MapSource>,
): MapSource | null {
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
      rowRef: source.rowRef ?? null,
      refreshKey: source.refreshKey ?? '',
    };
  }

  return null;
}

export function normalizeMapLayer(
  layer: Partial<MapLayer>,
  index: number,
): MapLayer {
  if (layer.type === 'flowmap') {
    return {
      id: layer.id ?? createMapLayerId(),
      type: 'flowmap',
      connectionId: layer.connectionId ?? '',
      sourceId: layer.sourceId ?? '',
      name: layer.name ?? 'Flow layer',
      tooltipEnabled: layer.tooltipEnabled ?? true,
      visible: layer.visible ?? true,
      icon: layer.icon ?? 'flow',
      purpose: layer.purpose ?? 'configured',
      style: layer.style ?? createDefaultFlowmapStyle(),
    };
  }

  if (layer.type === 'arc') {
    const arcLayer = layer as Partial<ArcMapLayer>;

    return {
      id: arcLayer.id ?? createMapLayerId(),
      type: 'arc',
      connectionId: arcLayer.connectionId ?? '',
      sourceId: arcLayer.sourceId ?? '',
      name: arcLayer.name ?? 'Arc layer',
      tooltipEnabled: arcLayer.tooltipEnabled ?? true,
      visible: arcLayer.visible ?? true,
      icon: arcLayer.icon ?? 'flow',
      purpose: arcLayer.purpose ?? 'configured',
      color: arcLayer.color ?? getDefaultLayerColor(index),
      opacity: arcLayer.opacity ?? 86,
      width: arcLayer.width ?? 3,
    };
  }

  const geoJsonLayer = layer as Partial<GeoJsonMapLayer> & {
    color?: string;
    opacity?: number;
  };
  const legacyColor = geoJsonLayer.color ?? getDefaultLayerColor(index);
  const legacyOpacity = geoJsonLayer.opacity ?? 80;

  return {
    id: geoJsonLayer.id ?? createMapLayerId(),
    type: 'geojson',
    connectionId: geoJsonLayer.connectionId ?? '',
    sourceId: geoJsonLayer.sourceId ?? '',
    name: geoJsonLayer.name ?? 'Layer',
    tooltipEnabled: geoJsonLayer.tooltipEnabled ?? true,
    visible: geoJsonLayer.visible ?? true,
    icon: geoJsonLayer.icon ?? getDefaultLayerIcon(''),
    purpose: geoJsonLayer.purpose ?? 'configured',
    fillColor: geoJsonLayer.fillColor ?? legacyColor,
    fillOpacity: geoJsonLayer.fillOpacity ?? legacyOpacity,
    strokeColor: geoJsonLayer.strokeColor ?? legacyColor,
    strokeOpacity:
      geoJsonLayer.strokeOpacity ?? Math.min(100, legacyOpacity + 15),
    strokeWidth: geoJsonLayer.strokeWidth ?? 2,
    pointRadius: geoJsonLayer.pointRadius ?? 6,
  };
}

export function findGeoJsonSource(
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

export function touchGeoJsonSource(
  source: GeoJsonTableSource,
): GeoJsonTableSource {
  return {
    ...source,
    refreshKey: crypto.randomUUID(),
  };
}

export function touchMapSource(source: MapSource): MapSource {
  return {
    ...source,
    refreshKey: crypto.randomUUID(),
  };
}

export function isGeoJsonSourceLinkedToView(
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

export function findFlowmapSource(
  sources: MapSource[],
  payload: {
    connectionId: string;
    schema: string;
    table: string;
    columns: FlowmapTableSource['columns'];
    rowRef?: RowReference | null;
  },
) {
  return sources.find(
    (source): source is FlowmapTableSource =>
      source.type === 'flowmap-table' &&
      source.connectionId === payload.connectionId &&
      source.schema === payload.schema &&
      source.table === payload.table &&
      JSON.stringify(source.columns) === JSON.stringify(payload.columns) &&
      JSON.stringify(source.rowRef ?? null) ===
        JSON.stringify(payload.rowRef ?? null),
  );
}

export function migrateLegacyLayers(
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
      tooltipEnabled: true,
      visible: legacyLayer.visible,
      icon: legacyLayer.icon,
      purpose: 'configured',
      fillColor: legacyLayer.color,
      fillOpacity: legacyLayer.opacity,
      strokeColor: legacyLayer.color,
      strokeOpacity: Math.min(100, legacyLayer.opacity + 15),
      strokeWidth: 2,
      pointRadius: 6,
    });
  }

  return { mapSources: sources, mapLayers: layers };
}
