import type maplibregl from 'maplibre-gl';

import type {
  GeoJsonMapLayer,
  GeoJsonTableSource,
  MapLayer,
} from '../connections/store';

export const vectorTileSourcePrefix = 'geopanel-source';
export const vectorTileLayerPrefix = 'geopanel-layer';
export const vectorTileHighlightLayerPrefix = 'geopanel-selection';
export const vectorTileHoverLayerPrefix = 'geopanel-hover';

export function mapLibreSourceId(sourceId: string) {
  return `${vectorTileSourcePrefix}-${sourceId}`;
}

function mapLibreLayerBaseId(layerId: string) {
  return `${vectorTileLayerPrefix}-${layerId}`;
}

export function getVectorStyleLayerIds(layer: GeoJsonMapLayer) {
  const baseId = mapLibreLayerBaseId(layer.id);

  return [`${baseId}-fill`, `${baseId}-line`, `${baseId}-circle`];
}

export function getVectorHighlightLayerIds(layer: GeoJsonMapLayer) {
  const baseId = `${vectorTileHighlightLayerPrefix}-${layer.id}`;

  return [`${baseId}-fill`, `${baseId}-line`, `${baseId}-circle`];
}

export function getVectorHoverLayerIds(layer: GeoJsonMapLayer) {
  const baseId = `${vectorTileHoverLayerPrefix}-${layer.id}`;

  return [`${baseId}-fill`, `${baseId}-line`, `${baseId}-circle`];
}

export function getQueryableVectorLayerIds(
  map: maplibregl.Map,
  layers: MapLayer[],
) {
  return layers
    .filter((layer): layer is GeoJsonMapLayer => layer.type === 'geojson')
    .flatMap(getVectorStyleLayerIds)
    .filter((layerId) => map.getLayer(layerId));
}

export function addVectorStyleLayers(params: {
  map: maplibregl.Map;
  layer: GeoJsonMapLayer;
  source: GeoJsonTableSource;
  sourceLayer: string;
}) {
  const { layer, map, source, sourceLayer } = params;
  const color = layer.color;
  const opacity = layer.opacity / 100;
  const [fillLayerId, lineLayerId, circleLayerId] =
    getVectorStyleLayerIds(layer);
  const sourceId = mapLibreSourceId(source.id);

  if (/polygon/i.test(source.geometryType) && !map.getLayer(fillLayerId)) {
    map.addLayer({
      id: fillLayerId,
      type: 'fill',
      source: sourceId,
      'source-layer': sourceLayer,
      paint: {
        'fill-color': color,
        'fill-opacity': opacity,
      },
    });
  }

  if (
    (/polygon|line/i.test(source.geometryType) || source.geometryType === '') &&
    !map.getLayer(lineLayerId)
  ) {
    map.addLayer({
      id: lineLayerId,
      type: 'line',
      source: sourceId,
      'source-layer': sourceLayer,
      paint: {
        'line-color': color,
        'line-opacity': Math.min(1, opacity + 0.15),
        'line-width': /line/i.test(source.geometryType) ? 3 : 1.5,
      },
    });
  }

  if (
    (/point/i.test(source.geometryType) || source.geometryType === '') &&
    !map.getLayer(circleLayerId)
  ) {
    map.addLayer({
      id: circleLayerId,
      type: 'circle',
      source: sourceId,
      'source-layer': sourceLayer,
      paint: {
        'circle-color': color,
        'circle-opacity': opacity,
        'circle-radius': 6,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
      },
    });
  }
}

export function addVectorFeatureHighlightLayers(params: {
  map: maplibregl.Map;
  source: GeoJsonTableSource;
  sourceLayer: string;
  featureKey: string;
  layerIds: string[];
  color: string;
  fillOpacity: number;
  lineWidth: number;
}) {
  const {
    color,
    featureKey,
    fillOpacity,
    layerIds,
    lineWidth,
    map,
    source,
    sourceLayer,
  } = params;
  const [fillLayerId, lineLayerId, circleLayerId] = layerIds;
  const sourceId = mapLibreSourceId(source.id);
  const filter: maplibregl.FilterSpecification = [
    '==',
    ['get', '_geopanel_row_key'],
    featureKey,
  ];

  if (/polygon/i.test(source.geometryType) && !map.getLayer(fillLayerId)) {
    map.addLayer({
      id: fillLayerId,
      type: 'fill',
      source: sourceId,
      'source-layer': sourceLayer,
      filter,
      paint: {
        'fill-color': color,
        'fill-opacity': fillOpacity,
      },
    });
  }

  if (
    (/polygon|line/i.test(source.geometryType) || source.geometryType === '') &&
    !map.getLayer(lineLayerId)
  ) {
    map.addLayer({
      id: lineLayerId,
      type: 'line',
      source: sourceId,
      'source-layer': sourceLayer,
      filter,
      paint: {
        'line-color': color,
        'line-opacity': 1,
        'line-width': /line/i.test(source.geometryType)
          ? lineWidth + 2
          : lineWidth,
      },
    });
  }

  if (
    (/point/i.test(source.geometryType) || source.geometryType === '') &&
    !map.getLayer(circleLayerId)
  ) {
    map.addLayer({
      id: circleLayerId,
      type: 'circle',
      source: sourceId,
      'source-layer': sourceLayer,
      filter,
      paint: {
        'circle-color': color,
        'circle-opacity': 0.95,
        'circle-radius': 9,
        'circle-stroke-color': '#212529',
        'circle-stroke-width': 2,
      },
    });
  }
}
