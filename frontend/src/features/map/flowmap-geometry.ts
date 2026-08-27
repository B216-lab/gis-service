import {
  collectPreviewPositions,
  parsePreviewGeometry,
} from '../inspector/GeometryPreview';

export function getFlowmapRowPoint(
  values: Record<string, unknown>,
  mode: 'coordinates' | 'geometry',
  lonColumn: string,
  latColumn: string,
  geometryColumn: string,
): [number, number] | null {
  if (mode === 'coordinates') {
    const lon = toFiniteNumber(values[lonColumn]);
    const lat = toFiniteNumber(values[latColumn]);

    return lon === null || lat === null ? null : [lon, lat];
  }

  const geometry = parsePreviewGeometry(values[geometryColumn]);
  if (!geometry) {
    return null;
  }

  return collectPreviewPositions(geometry)[0] ?? null;
}

function toFiniteNumber(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(numberValue) ? numberValue : null;
}

export function formatFlowmapPoint(point: [number, number]) {
  return `${point[1]}, ${point[0]}`;
}
