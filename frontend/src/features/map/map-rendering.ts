import { ArcLayer, ScatterplotLayer } from '@deck.gl/layers';
import { FlowmapLayer } from '@flowmap.gl/layers';
import maplibregl, { type LngLatBounds } from 'maplibre-gl';
import { Protocol } from 'pmtiles';

import type {
  ArcMapLayer,
  FlowmapMapLayer,
  FlowmapTableSource,
  GeoJsonMapLayer,
  GeoJsonTableSource,
  MapLayer,
  MapSource,
} from '../connections/store';
import type { InspectorColumn } from '../inspector/api';
import type { FlowmapDataResponse, GeoBounds, GeoJsonGeometry } from './api';
import {
  buildMapSelection,
  buildSelectionPickCandidate,
  type FeaturePickCandidate,
} from './map-selection';
import type { MapSelection } from './selection';

declare global {
  interface Window {
    __geopanelPmtilesProtocolRegistered?: boolean;
  }
}

export function getSourceSignature(source: MapSource) {
  return JSON.stringify(source);
}

export function registerPmtilesProtocol() {
  if (window.__geopanelPmtilesProtocolRegistered) {
    return;
  }

  const protocol = new Protocol({ metadata: true });
  maplibregl.addProtocol('pmtiles', protocol.tile);
  window.__geopanelPmtilesProtocolRegistered = true;
}

export function extendBoundsWithGeoBounds(
  bounds: LngLatBounds,
  geoBounds: GeoBounds,
) {
  bounds.extend([geoBounds.west, geoBounds.south]);
  bounds.extend([geoBounds.east, geoBounds.north]);
}

export function createFlowmapDeckLayer(
  layer: FlowmapMapLayer,
  source: FlowmapTableSource,
  sourceData: FlowmapDataResponse,
  onPick: (candidate: FeaturePickCandidate) => void,
) {
  return new FlowmapLayer({
    id: layer.id,
    data: {
      locations: sourceData.locations,
      flows: sourceData.flows,
    },
    getLocationId: (location: FlowmapDataResponse['locations'][number]) =>
      location.id,
    getLocationLat: (location: FlowmapDataResponse['locations'][number]) =>
      location.lat,
    getLocationLon: (location: FlowmapDataResponse['locations'][number]) =>
      location.lon,
    getLocationName: (location: FlowmapDataResponse['locations'][number]) =>
      location.name,
    getFlowOriginId: (flow: FlowmapDataResponse['flows'][number]) =>
      flow.originId,
    getFlowDestId: (flow: FlowmapDataResponse['flows'][number]) => flow.destId,
    getFlowMagnitude: (flow: FlowmapDataResponse['flows'][number]) =>
      flow.magnitude,
    flowLinesRenderingMode: layer.style.flowLinesRenderingMode,
    flowLineThicknessScale: layer.style.flowLineThicknessScale,
    clusteringEnabled: layer.style.clusteringEnabled,
    clusteringAuto: layer.style.clusteringAuto,
    locationsEnabled: layer.style.locationsEnabled,
    locationTotalsEnabled: layer.style.locationTotalsEnabled,
    locationLabelsEnabled: layer.style.locationLabelsEnabled,
    maxTopFlowsDisplayNum: layer.style.maxTopFlowsDisplayNum,
    colorScheme: layer.style.colorScheme,
    darkMode: layer.style.darkMode,
    pickable: true,
    onClick: (pickInfo: { object?: unknown }) => {
      const selection = buildMapSelection(pickInfo.object, layer, source);
      if (!selection) {
        return;
      }

      onPick(buildSelectionPickCandidate(selection, layer));
    },
  });
}

interface FlowmapSelectionHighlight {
  sourcePosition: [number, number];
  targetPosition: [number, number];
}

export function findFlowmapSelectionHighlight(
  selection: MapSelection | null,
  layer: FlowmapMapLayer | ArcMapLayer,
  source: FlowmapTableSource,
  sourceData: FlowmapDataResponse,
): FlowmapSelectionHighlight | null {
  if (
    !selection ||
    selection.layerId !== layer.id ||
    selection.sourceId !== source.id ||
    selection.objectType !== 'flow' ||
    selection.rowRefs.length === 0
  ) {
    return null;
  }

  const selectedTokens = new Set(
    selection.rowRefs.map((rowRef) => JSON.stringify(rowRef.rowKey)),
  );
  const flow = sourceData.flows.find(
    (candidate) =>
      candidate.rowRef &&
      selectedTokens.has(JSON.stringify(candidate.rowRef.rowKey)),
  );
  if (!flow) {
    return null;
  }

  const origin = sourceData.locations.find(
    (location) => location.id === flow.originId,
  );
  const dest = sourceData.locations.find(
    (location) => location.id === flow.destId,
  );
  if (!origin || !dest) {
    return null;
  }

  return {
    sourcePosition: [origin.lon, origin.lat],
    targetPosition: [dest.lon, dest.lat],
  };
}

export function createFlowmapSelectionHighlightLayers(
  highlight: FlowmapSelectionHighlight,
) {
  return [
    new ArcLayer<FlowmapSelectionHighlight>({
      id: 'flowmap-selection-highlight-arc',
      data: [highlight],
      getSourcePosition: (item) => item.sourcePosition,
      getTargetPosition: (item) => item.targetPosition,
      getSourceColor: [255, 212, 59, 255],
      getTargetColor: [255, 212, 59, 255],
      getWidth: 7,
      greatCircle: false,
      pickable: false,
      widthUnits: 'pixels',
    }),
    new ScatterplotLayer<{ position: [number, number] }>({
      id: 'flowmap-selection-highlight-points',
      data: [
        { position: highlight.sourcePosition },
        { position: highlight.targetPosition },
      ],
      filled: false,
      getLineColor: [255, 212, 59, 255],
      getLineWidth: 3,
      getPosition: (item) => item.position,
      getRadius: 9,
      lineWidthUnits: 'pixels',
      pickable: false,
      radiusUnits: 'pixels',
      stroked: true,
    }),
  ];
}

export function createArcDeckLayers(
  layer: ArcMapLayer,
  source: FlowmapTableSource,
  sourceData: FlowmapDataResponse,
  onPick: (candidate: FeaturePickCandidate) => void,
) {
  const locationsById = new Map(
    sourceData.locations.map((location) => [location.id, location]),
  );
  const flows = sourceData.flows.flatMap((flow) => {
    const origin = locationsById.get(flow.originId);
    const dest = locationsById.get(flow.destId);
    if (!origin || !dest) {
      return [];
    }

    return [
      {
        ...flow,
        sourcePosition: [origin.lon, origin.lat] as [number, number],
        targetPosition: [dest.lon, dest.lat] as [number, number],
        origin,
        dest,
      },
    ];
  });

  return [
    new ArcLayer<(typeof flows)[number]>({
      id: layer.id,
      data: flows,
      getSourcePosition: (flow) => flow.sourcePosition,
      getTargetPosition: (flow) => flow.targetPosition,
      getSourceColor: hexToRgba(
        layer.color,
        Math.round((layer.opacity / 100) * 255),
      ),
      getTargetColor: hexToRgba(
        layer.color,
        Math.round((layer.opacity / 100) * 255),
      ),
      getWidth: layer.width,
      pickable: true,
      widthUnits: 'pixels',
      onClick: (pickInfo: { object?: unknown }) => {
        const selection = buildMapSelection(pickInfo.object, layer, source);
        if (!selection) {
          return;
        }

        onPick(buildSelectionPickCandidate(selection, layer));
      },
    }),
  ];
}

function hexToRgba(
  hex: string,
  alpha: number,
): [number, number, number, number] {
  const normalized = hex.replace('#', '');
  const value = Number.parseInt(normalized, 16);
  if (Number.isNaN(value) || normalized.length !== 6) {
    return [77, 171, 247, alpha];
  }

  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, alpha];
}

export function isGeoJsonMapLayer(layer: MapLayer): layer is GeoJsonMapLayer {
  return layer.type === 'geojson';
}

export function isGeoJsonTableSource(
  source: MapSource,
): source is GeoJsonTableSource {
  return source.type === 'geojson-table';
}

export function isPolygonGeometryType(geometryType: string) {
  return /polygon/i.test(geometryType);
}

function isNumericColumnType(columnType: string) {
  return /int|numeric|double|real|decimal|serial/i.test(columnType);
}

export function isBooleanColumnType(columnType: string) {
  return /bool/i.test(columnType);
}

export function isEditableFeatureColumn(column: InspectorColumn) {
  return (
    isNumericColumnType(column.type) ||
    isBooleanColumnType(column.type) ||
    /text|character|uuid|date|timestamp/i.test(column.type)
  );
}

export function normalizeFeatureValue(
  column: InspectorColumn,
  rawValue: string,
) {
  const trimmedValue = rawValue.trim();
  if (trimmedValue === '') {
    return undefined;
  }
  if (isBooleanColumnType(column.type)) {
    return trimmedValue === 'true';
  }

  return trimmedValue;
}

export function defaultFeatureValues(source: GeoJsonTableSource) {
  const values: Record<string, string> = {};
  const conditions =
    source.filter && source.filter.mode !== 'sql'
      ? source.filter.conditions
      : [];
  for (const condition of conditions) {
    if (condition.operator === 'eq' && condition.value !== undefined) {
      values[condition.column] = condition.value;
    }
  }

  return values;
}

export function isGeoJsonPolygonGeometry(
  value: unknown,
): value is GeoJsonGeometry {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    ((value as { type?: unknown }).type === 'Polygon' ||
      (value as { type?: unknown }).type === 'MultiPolygon')
  );
}

export function isVectorTileRequestError(event: ErrorEvent) {
  const error = event.error as
    | {
        status?: number;
        url?: string;
      }
    | undefined;

  return (
    error?.status === 404 &&
    typeof error.url === 'string' &&
    error.url.includes('/api/v1/vector-tiles/')
  );
}
