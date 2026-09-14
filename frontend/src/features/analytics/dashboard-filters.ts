import { operatorLabel } from './display-labels';
import type { Chart, Dataset, Filter, Widget } from './types';

// A semantic ID is an explicit mapping; coincidentally equal names are not.
export function mapFilter(
  filter: Filter,
  target: Dataset,
  datasets: Dataset[],
): Filter | null {
  const candidateSource = filter.datasetId
    ? datasets.find((dataset) => dataset.id === filter.datasetId)
    : target;
  if (!candidateSource) return null;
  const source: Dataset = candidateSource;
  if (source.id === target.id) return { ...filter, datasetId: target.id };
  function mapped(item: Filter): Filter | null {
    if (item.anyOf?.length) {
      const groups = item.anyOf.map((group) => group.map(mapped));
      if (groups.some((group) => group.some((child) => !child))) return null;
      return { ...item, datasetId: target.id, anyOf: groups as Filter[][] };
    }
    const field = source.fields.find(
      (candidate) => candidate.id === item.fieldId,
    );
    const match =
      field?.semanticId &&
      target.fields.find(
        (candidate) => candidate.semanticId === field.semanticId,
      );
    return match ? { ...item, fieldId: match.id, datasetId: target.id } : null;
  }
  const translated = mapped(filter);
  if (translated) return translated;
  return target.relationships?.some(
    (relation) =>
      relation.targetDatasetId === source.id && relation.allowFiltering,
  )
    ? { ...filter, datasetId: source.id }
    : null;
}
export function filtersForWidget(
  filters: Filter[],
  widget: Widget,
  chart: Chart,
  datasets: Dataset[],
  excludeSource = true,
): Filter[] {
  const target = datasets.find((dataset) => dataset.id === chart.datasetId);
  if (!target) return [];
  return filters.flatMap((filter) => {
    if (excludeSource && filter.sourceWidgetId === widget.id) return [];
    if (
      filter.targetWidgetIds?.length &&
      !filter.targetWidgetIds.includes(widget.id)
    )
      return [];
    const translated = mapFilter(filter, target, datasets);
    return translated ? [translated] : [];
  });
}
export function filterLabel(
  filter: Filter,
  datasets: Dataset[],
  language: 'en' | 'ru' = 'en',
): string {
  const source = datasets.find((dataset) => dataset.id === filter.datasetId);
  if (filter.anyOf?.length)
    return filter.anyOf
      .map((group) =>
        group
          .map((child) =>
            filterLabel(
              { ...child, datasetId: child.datasetId || filter.datasetId },
              datasets,
              language,
            ),
          )
          .join(' ∧ '),
      )
      .map((group) => `(${group})`)
      .join(' ∨ ');
  const field = source?.fields.find((field) => field.id === filter.fieldId);
  const name = field?.label || field?.name || filter.fieldId;
  return `${name} ${operatorLabel(filter.operator, language)} ${(filter.values || []).map(String).join(', ')}`.trim();
}
export function placeWidgets(widgets: Widget[]): Widget[] {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  return widgets.map((widget) => {
    const w = Math.max(1, Math.min(12, widget.w));
    const h = Math.max(1, Math.min(12, widget.h));
    if (x + w > 12) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    const placed = { ...widget, x, y, w, h };
    x += w;
    rowHeight = Math.max(rowHeight, h);
    return placed;
  });
}
