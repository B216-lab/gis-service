import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Menu,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Tabs,
  Text,
  ThemeIcon,
} from '@mantine/core';
import {
  IconChartBar,
  IconDatabaseSearch,
  IconInfoCircle,
  IconLayersIntersect,
  IconRoute,
  IconSettings,
} from '@tabler/icons-react';
import 'mantine-react-table/styles.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createSavedViewSelectionKey,
  findLayerSource,
  formatFlowmapSourceColumns,
  formatMapSelectionCount,
  formatMapSelectionObjectType,
  getMapSelectionBadgeColor,
  parseTableSelectionKey,
} from './features/app/app-utils';
import {
  ColorSchemeToggle,
  EmptyState,
  PanelFrame,
} from './features/app/chrome';
import { WorkspaceLayout } from './features/app/WorkspaceLayout';
import { ConnectionManager } from './features/connections/ConnectionManager';
import {
  type ArcMapLayer,
  type DatabaseConnection,
  type FlowmapMapLayer,
  type FlowmapTableSource,
  type GeoJsonMapLayer,
  type GeoJsonTableSource,
  type MapLayer,
  type MapSource,
  type SpatialFilterPredicate,
  useConnectionStore,
} from './features/connections/store';
import type {
  CatalogState,
  LoadingSchemaTablesByName,
  MovementLayerKind,
  SchemaTablesByName,
  ServerConnectionResponse,
} from './features/connections/types';
import { LanguageSwitcher } from './features/i18n/i18n';
import {
  fetchInspectableSchemas,
  fetchInspectableSchemaTables,
  fetchInspectorRowsByKey,
  fetchTableDisplayConfigs,
  fetchTableMetadata,
  type InspectableSchema,
  type InspectableTable,
  type InspectorColumn,
  type InspectorLookupRowsResponse,
  type InspectorRow,
  type RelatedRowsGroup,
} from './features/inspector/api';
import { DataInspector } from './features/inspector/DataInspector';
import { GeometryMapPreviewList } from './features/inspector/GeometryPreview';
import { tableDisplayKeyFromParts } from './features/inspector/keys';
import { formatCellValue } from './features/inspector/table-editing';
import type {
  FlowmapLocateTarget,
  GeoJsonLocateTarget,
  LocateTarget,
} from './features/inspector/types';
import {
  fetchFlowmapSourceData,
  fetchGeoJsonSourceExtent,
  type GeoBounds,
  type LocateFeatureResponse,
  locateGeoJsonFeature,
} from './features/map/api';
import {
  type BasemapId,
  basemapOptions,
  defaultBasemapId,
} from './features/map/basemaps';
import {
  formatFlowmapPoint,
  getFlowmapRowPoint,
} from './features/map/flowmap-geometry';
import { MapPane } from './features/map/MapPane';
import type { MapSelection } from './features/map/selection';
import { OnboardingTour } from './features/onboarding/OnboardingTour';

type RightPaneTab = 'layer' | 'data' | 'analysis';

interface GeoJsonSpatialFilterTarget {
  layer: GeoJsonMapLayer | FlowmapMapLayer | ArcMapLayer;
  source: GeoJsonTableSource | FlowmapTableSource;
}

interface LocateFeatureBoundsState {
  token: number;
  bounds: GeoBounds;
}

function RightPaneTabs({
  activeLayer,
  activeSource,
  connection,
  geoJsonSpatialFilterTargets,
  mapSelection,
  onApplySpatialFilter,
  onChangeTab,
  onClearSpatialFilter,
  onOpenTable,
  selectedTab,
}: {
  activeLayer: MapLayer | null;
  activeSource: MapSource | null;
  connection: DatabaseConnection | null;
  geoJsonSpatialFilterTargets: GeoJsonSpatialFilterTarget[];
  mapSelection: MapSelection | null;
  onApplySpatialFilter: (
    targetSourceId: string,
    predicate: SpatialFilterPredicate,
  ) => void;
  onChangeTab: (value: RightPaneTab) => void;
  onClearSpatialFilter: (sourceId: string) => void;
  onOpenTable: (tableKey: string) => void | Promise<void>;
  selectedTab: RightPaneTab;
}) {
  const selectedRowCount = mapSelection?.rowRefs.length ?? 0;

  return (
    <Tabs
      h="100%"
      keepMounted={false}
      onChange={(value) => {
        if (value === 'layer' || value === 'data' || value === 'analysis') {
          onChangeTab(value);
        }
      }}
      styles={{
        root: {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
        },
        panel: {
          flex: 1,
          minHeight: 0,
          paddingTop: 'var(--mantine-spacing-md)',
        },
      }}
      value={selectedTab}
    >
      <Tabs.List grow>
        <Tabs.Tab leftSection={<IconSettings size={14} />} value="layer">
          Layer
        </Tabs.Tab>
        <Tabs.Tab
          leftSection={<IconDatabaseSearch size={14} />}
          rightSection={
            selectedRowCount > 0 ? (
              <Badge color="blue" size="xs" variant="light">
                {selectedRowCount}
              </Badge>
            ) : null
          }
          value="data"
        >
          Data
        </Tabs.Tab>
        <Tabs.Tab leftSection={<IconChartBar size={14} />} value="analysis">
          Analysis
        </Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="layer">
        <LayerWorkspacePanel
          activeLayer={activeLayer}
          activeSource={activeSource}
          mapSelection={mapSelection}
          onClearSpatialFilter={onClearSpatialFilter}
        />
      </Tabs.Panel>

      <Tabs.Panel value="data">
        <DataWorkspacePanel
          connection={connection}
          geoJsonSpatialFilterTargets={geoJsonSpatialFilterTargets}
          mapSelection={mapSelection}
          onApplySpatialFilter={onApplySpatialFilter}
          onOpenTable={onOpenTable}
        />
      </Tabs.Panel>

      <Tabs.Panel value="analysis">
        <AnalysisWorkspacePanel
          activeLayer={activeLayer}
          activeSource={activeSource}
          mapSelection={mapSelection}
        />
      </Tabs.Panel>
    </Tabs>
  );
}

function LayerWorkspacePanel({
  activeLayer,
  activeSource,
  mapSelection,
  onClearSpatialFilter,
}: {
  activeLayer: MapLayer | null;
  activeSource: MapSource | null;
  mapSelection: MapSelection | null;
  onClearSpatialFilter: (sourceId: string) => void;
}) {
  if (!activeLayer || !activeSource) {
    return (
      <EmptyState
        detail="Select layer from left panel or click map object to set active layer."
        label="No Active Layer"
      />
    );
  }

  return (
    <Stack h="100%" gap="md">
      <Paper p="md" radius="md" withBorder>
        <Stack gap="sm">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon color="blue" radius="xl" size="lg" variant="light">
                <IconLayersIntersect size={16} />
              </ThemeIcon>
              <div>
                <Text fw={700} size="sm">
                  {activeLayer.name}
                </Text>
                <Text c="dimmed" size="xs">
                  {activeSource.schema}.{activeSource.table}
                </Text>
              </div>
            </Group>
            <Badge
              color={activeLayer.visible ? 'teal' : 'gray'}
              variant="light"
            >
              {activeLayer.visible ? 'Visible' : 'Hidden'}
            </Badge>
          </Group>

          <Group gap="xs">
            <Badge color="gray" variant="outline">
              {activeLayer.type}
            </Badge>
            <Badge color="gray" variant="outline">
              {activeSource.type}
            </Badge>
            {mapSelection?.layerId === activeLayer.id ? (
              <Badge color="blue" variant="light">
                Current map selection
              </Badge>
            ) : null}
          </Group>
        </Stack>
      </Paper>

      <Alert
        color="blue"
        icon={<IconInfoCircle size={16} />}
        title="Layer controls next"
        variant="light"
      >
        Right pane owns layer settings next. Existing style editor stays in left
        pane for now so data inspection can land without blocking that move.
      </Alert>

      <Paper
        p="md"
        radius="md"
        style={{
          flex: 1,
          minHeight: 0,
        }}
        withBorder
      >
        <Stack gap="xs">
          <Text fw={600} size="sm">
            Source summary
          </Text>
          <Text c="dimmed" size="sm">
            Table: {activeSource.fullName}
          </Text>
          {activeSource.type === 'geojson-table' ? (
            <Text c="dimmed" size="sm">
              Geometry: {activeSource.geometryColumn} (
              {activeSource.geometryType})
            </Text>
          ) : (
            <Text c="dimmed" size="sm">
              Flow columns: {formatFlowmapSourceColumns(activeSource.columns)}
            </Text>
          )}
          {activeSource.spatialFilter ? (
            <Alert color="grape" title="Spatial filter active" variant="light">
              <Stack gap="xs">
                <Text size="sm">
                  {formatSpatialFilterPredicate(
                    activeSource.spatialFilter.predicate,
                    activeSource.type,
                  )}{' '}
                  {activeSource.spatialFilter.sourceLayerName}
                </Text>
                <Button
                  onClick={() => onClearSpatialFilter(activeSource.id)}
                  size="compact-sm"
                  variant="light"
                >
                  Clear Spatial Filter
                </Button>
              </Stack>
            </Alert>
          ) : null}
        </Stack>
      </Paper>
    </Stack>
  );
}

function DataWorkspacePanel({
  connection,
  geoJsonSpatialFilterTargets,
  mapSelection,
  onApplySpatialFilter,
  onOpenTable,
}: {
  connection: DatabaseConnection | null;
  geoJsonSpatialFilterTargets: GeoJsonSpatialFilterTarget[];
  mapSelection: MapSelection | null;
  onApplySpatialFilter: (
    targetSourceId: string,
    predicate: SpatialFilterPredicate,
  ) => void;
  onOpenTable: (tableKey: string) => void | Promise<void>;
}) {
  const [lookupState, setLookupState] =
    useState<InspectorLookupRowsResponse | null>(null);
  const [isLoadingLookup, setIsLoadingLookup] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [spatialFilterTargetSourceId, setSpatialFilterTargetSourceId] =
    useState<string | null>(null);
  const [spatialFilterPredicate, setSpatialFilterPredicate] =
    useState<SpatialFilterPredicate>('intersects');
  const selectedBasemapId = useConnectionStore(
    (state) => state.selectedBasemapId,
  );

  const spatialFilterTargets = useMemo(
    () =>
      mapSelection?.sourceType === 'geojson-table' &&
      mapSelection.rowRefs.length > 0
        ? geoJsonSpatialFilterTargets.filter(
            (target) => target.source.id !== mapSelection.sourceId,
          )
        : [],
    [geoJsonSpatialFilterTargets, mapSelection],
  );
  const selectedSpatialFilterTarget =
    spatialFilterTargets.find(
      (target) => target.source.id === spatialFilterTargetSourceId,
    ) ?? null;
  const spatialFilterPredicateOptions =
    selectedSpatialFilterTarget?.source.type === 'flowmap-table'
      ? [
          { label: 'One endpoint inside selection', value: 'intersects' },
          { label: 'Entire flow inside selection', value: 'within' },
        ]
      : [
          { label: 'Partially intersects selection', value: 'intersects' },
          { label: 'Fully inside selection', value: 'within' },
        ];

  useEffect(() => {
    if (
      spatialFilterTargetSourceId &&
      spatialFilterTargets.some(
        (target) => target.source.id === spatialFilterTargetSourceId,
      )
    ) {
      return;
    }

    setSpatialFilterTargetSourceId(spatialFilterTargets[0]?.source.id ?? null);
  }, [spatialFilterTargetSourceId, spatialFilterTargets]);

  useEffect(() => {
    if (!connection || !mapSelection || mapSelection.rowRefs.length === 0) {
      setLookupState(null);
      setLookupError('');
      setIsLoadingLookup(false);
      return;
    }

    const activeConnection = connection;
    const activeSelection = mapSelection;
    let isActive = true;
    const requestedRowRefs = activeSelection.rowRefs.slice(0, 25);

    async function loadSelectedRows() {
      setIsLoadingLookup(true);
      setLookupError('');

      try {
        const payload = await fetchInspectorRowsByKey(activeConnection, {
          schema: activeSelection.schema,
          table: activeSelection.table,
          rowRefs: requestedRowRefs,
        });

        if (!isActive) {
          return;
        }

        setLookupState(payload);
      } catch (error) {
        if (!isActive) {
          return;
        }

        setLookupError(
          error instanceof Error
            ? error.message
            : 'Failed to load selected rows.',
        );
      } finally {
        if (isActive) {
          setIsLoadingLookup(false);
        }
      }
    }

    void loadSelectedRows();

    return () => {
      isActive = false;
    };
  }, [connection, mapSelection]);

  if (!mapSelection) {
    return (
      <EmptyState
        detail="Click map object to inspect source rows from its backing table."
        label="No Map Selection"
      />
    );
  }

  const effectiveRowCount = mapSelection.rowRefs.length;
  const singleLookupRow =
    lookupState?.rows.length === 1 ? lookupState.rows[0] : null;
  const fallbackEntries = Object.entries(mapSelection.inlineProperties ?? {});
  const lookupColumns = lookupState?.columns ?? [];
  const visibleLookupColumns = lookupColumns.filter(
    (column) => !isGeometryInspectorColumn(column),
  );
  const geometryLookupColumns = lookupColumns.filter(isGeometryInspectorColumn);
  const visibleFallbackEntries = fallbackEntries.filter(
    ([key, value]) => !isGeometryDetailEntry(key, value),
  );
  const geometryFallbackEntries = fallbackEntries.filter(([key, value]) =>
    isGeometryDetailEntry(key, value),
  );

  return (
    <Stack h="100%" gap="md">
      <Paper p="md" radius="md" withBorder>
        <Stack gap="sm">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon
                color={getMapSelectionBadgeColor(mapSelection.objectType)}
                radius="xl"
                size="lg"
                variant="light"
              >
                {mapSelection.objectType === 'flow' ? (
                  <IconRoute size={16} />
                ) : (
                  <IconDatabaseSearch size={16} />
                )}
              </ThemeIcon>
              <div>
                <Text fw={700} size="sm">
                  {mapSelection.title}
                </Text>
                <Text c="dimmed" size="xs">
                  {mapSelection.sourceFullName}
                </Text>
              </div>
            </Group>
            <Badge
              color={getMapSelectionBadgeColor(mapSelection.objectType)}
              variant="light"
            >
              {formatMapSelectionObjectType(mapSelection.objectType)}
            </Badge>
          </Group>

          <Group gap="xs">
            <Badge color="gray" variant="outline">
              {formatMapSelectionCount(effectiveRowCount)}
            </Badge>
            <Badge color="gray" variant="outline">
              {mapSelection.layerName}
            </Badge>
          </Group>
        </Stack>
      </Paper>

      <Group justify="space-between" wrap="nowrap">
        <Text c="dimmed" size="xs">
          Clicked object mapped to {mapSelection.sourceFullName}
        </Text>
        <Button
          onClick={() => void onOpenTable(mapSelection.sourceFullName)}
          size="compact-sm"
          variant="light"
        >
          Open Table
        </Button>
      </Group>

      {spatialFilterTargets.length > 0 ? (
        <Paper p="sm" radius="md" withBorder>
          <Stack gap="xs">
            <Text fw={600} size="sm">
              Use selection as spatial filter
            </Text>
            <Select
              data={spatialFilterTargets.map((target) => ({
                label: target.layer.name,
                value: target.source.id,
              }))}
              label="Target layer"
              onChange={setSpatialFilterTargetSourceId}
              value={spatialFilterTargetSourceId}
            />
            <Select
              allowDeselect={false}
              data={spatialFilterPredicateOptions}
              label="Predicate"
              onChange={(value) =>
                setSpatialFilterPredicate(
                  (value ?? 'intersects') as SpatialFilterPredicate,
                )
              }
              value={spatialFilterPredicate}
            />
            <Button
              disabled={!spatialFilterTargetSourceId}
              onClick={() => {
                if (!spatialFilterTargetSourceId) {
                  return;
                }

                onApplySpatialFilter(
                  spatialFilterTargetSourceId,
                  spatialFilterPredicate,
                );
              }}
              size="compact-sm"
              variant="light"
            >
              Apply Spatial Filter
            </Button>
          </Stack>
        </Paper>
      ) : null}

      {mapSelection.rowRefs.length > 25 ? (
        <Alert color="yellow" title="Selection truncated" variant="light">
          Showing first 25 matched rows in right pane. Full selection still
          available through table view.
        </Alert>
      ) : null}

      {lookupError ? (
        <Alert color="red" title="Row lookup failed" variant="light">
          {lookupError}
        </Alert>
      ) : null}

      {isLoadingLookup ? (
        <Alert
          color="blue"
          icon={<Loader size={16} />}
          title="Loading selected rows"
          variant="light"
        >
          Resolving primary keys back to database rows.
        </Alert>
      ) : null}

      {!isLoadingLookup &&
      !lookupState &&
      mapSelection.rowRefs.length === 0 &&
      fallbackEntries.length > 0 ? (
        <ScrollArea
          offsetScrollbars
          scrollbarSize={8}
          style={{
            flex: 1,
            minHeight: 0,
          }}
        >
          <Paper p="md" radius="md" withBorder>
            <Stack gap="xs">
              <Alert color="yellow" title="Snapshot only" variant="light">
                Source table has no stable primary key metadata for exact row
                lookup. Showing attributes carried by rendered object.
              </Alert>
              {geometryFallbackEntries.length > 0 ? (
                <GeometryMapPreviewList
                  basemapId={selectedBasemapId}
                  entries={geometryFallbackEntries.map(([key, value]) => ({
                    label: key,
                    value,
                  }))}
                />
              ) : null}
              {visibleFallbackEntries.map(([key, value]) => (
                <Group align="flex-start" justify="space-between" key={key}>
                  <Text c="dimmed" size="xs">
                    {key}
                  </Text>
                  <Text
                    size="sm"
                    style={{
                      maxWidth: '65%',
                      textAlign: 'right',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {formatCellValue(value)}
                  </Text>
                </Group>
              ))}
            </Stack>
          </Paper>
        </ScrollArea>
      ) : null}

      {!isLoadingLookup &&
      !lookupError &&
      mapSelection.rowRefs.length > 0 &&
      lookupState?.rows.length === 0 ? (
        <EmptyState
          detail="No matching rows came back for selected primary keys."
          label="Rows Not Found"
        />
      ) : null}

      {!isLoadingLookup && singleLookupRow ? (
        <ScrollArea
          offsetScrollbars
          scrollbarSize={8}
          style={{
            flex: 1,
            minHeight: 0,
          }}
        >
          <Paper p="md" radius="md" withBorder>
            <Stack gap="xs">
              {geometryLookupColumns.length > 0 ? (
                <GeometryMapPreviewList
                  basemapId={selectedBasemapId}
                  entries={geometryLookupColumns.map((column) => ({
                    label: column.name,
                    type: column.type,
                    value: singleLookupRow.values[column.name],
                  }))}
                />
              ) : null}
              {visibleLookupColumns.map((column) => (
                <Group
                  align="flex-start"
                  justify="space-between"
                  key={column.name}
                >
                  <div>
                    <Text size="sm">{column.name}</Text>
                    <Text c="dimmed" size="xs">
                      {column.type}
                    </Text>
                  </div>
                  <Text
                    size="sm"
                    style={{
                      maxWidth: '60%',
                      textAlign: 'right',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {formatCellValue(singleLookupRow.values[column.name])}
                  </Text>
                </Group>
              ))}
            </Stack>
          </Paper>
        </ScrollArea>
      ) : null}

      {!isLoadingLookup && lookupState && lookupState.rows.length > 1 ? (
        <ScrollArea
          offsetScrollbars
          scrollbarSize={8}
          style={{
            flex: 1,
            minHeight: 0,
          }}
        >
          <Stack gap="sm">
            <Text c="dimmed" size="xs">
              Loaded {lookupState.matchedRowCount} of{' '}
              {lookupState.requestedRowCount} requested rows.
            </Text>
            {lookupState.rows.map((row) => (
              <Paper
                key={JSON.stringify(row.rowKey)}
                p="md"
                radius="md"
                withBorder
              >
                <Stack gap="xs">
                  <Badge color="gray" variant="light">
                    {lookupState.primaryKey
                      .map(
                        (columnName) =>
                          `${columnName}=${formatCellValue(
                            row.rowKey?.[columnName],
                          )}`,
                      )
                      .join(' • ')}
                  </Badge>
                  {geometryLookupColumns.length > 0 ? (
                    <GeometryMapPreviewList
                      basemapId={selectedBasemapId}
                      entries={geometryLookupColumns.map((column) => ({
                        label: column.name,
                        type: column.type,
                        value: row.values[column.name],
                      }))}
                    />
                  ) : null}
                  {visibleLookupColumns.slice(0, 4).map((column) => (
                    <Group
                      align="flex-start"
                      justify="space-between"
                      key={`${JSON.stringify(row.rowKey)}-${column.name}`}
                    >
                      <Text c="dimmed" size="xs">
                        {column.name}
                      </Text>
                      <Text
                        size="sm"
                        style={{
                          maxWidth: '62%',
                          textAlign: 'right',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {formatCellValue(row.values[column.name])}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              </Paper>
            ))}
          </Stack>
        </ScrollArea>
      ) : null}
    </Stack>
  );
}

function isGeometryInspectorColumn(column: InspectorColumn) {
  return /^(geometry|geography)$/i.test(column.type);
}

function isGeometryDetailEntry(key: string, value: unknown) {
  if (!/geom|geometry|geography/i.test(key)) {
    return false;
  }

  if (typeof value === 'string') {
    return /^(srid=\d+;)?(point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection)\s*\(/i.test(
      value,
    );
  }

  return (
    value !== null &&
    typeof value === 'object' &&
    ('coordinates' in value || 'geometries' in value)
  );
}

function formatSpatialFilterPredicate(
  predicate: SpatialFilterPredicate,
  sourceType?: MapSource['type'],
) {
  if (sourceType === 'flowmap-table') {
    return predicate === 'within' ? 'Entire flow inside' : 'Endpoint inside';
  }

  switch (predicate) {
    case 'within':
      return 'Fully inside';
    case 'intersects':
      return 'Intersects';
  }
}

function isGeoJsonLayer(layer: MapLayer): layer is GeoJsonMapLayer {
  return layer.type === 'geojson';
}

function isMovementLayer(
  layer: MapLayer,
): layer is FlowmapMapLayer | ArcMapLayer {
  return layer.type === 'flowmap' || layer.type === 'arc';
}

function buildLocatedFeatureSelection(
  result: LocateFeatureResponse,
  target: GeoJsonLocateTarget,
): MapSelection {
  return {
    layerId: target.layer.id,
    layerName: target.layer.name,
    sourceId: target.source.id,
    sourceType: target.source.type,
    sourceFullName: target.source.fullName,
    schema: target.source.schema,
    table: target.source.table,
    objectType: 'feature',
    rowRefs: [result.rowRef],
    inlineProperties: result.feature.properties,
    featureKey: result.featureKey,
    title: target.layer.name,
  };
}

function buildLocatedFlowmapSelection(
  row: InspectorRow,
  primaryKey: string[],
  target: FlowmapLocateTarget,
): MapSelection | null {
  if (!row.rowKey) {
    return null;
  }

  const start = getFlowmapRowPoint(
    row.values,
    target.source.columns.startMode,
    target.source.columns.startLon,
    target.source.columns.startLat,
    target.source.columns.startGeometry,
  );
  const end = getFlowmapRowPoint(
    row.values,
    target.source.columns.endMode,
    target.source.columns.endLon,
    target.source.columns.endLat,
    target.source.columns.endGeometry,
  );
  if (!start || !end) {
    return null;
  }

  const magnitude = target.source.columns.magnitude
    ? row.values[target.source.columns.magnitude]
    : target.source.columns.defaultMagnitude;

  return {
    layerId: target.layer.id,
    layerName: target.layer.name,
    sourceId: target.source.id,
    sourceType: target.source.type,
    sourceFullName: target.source.fullName,
    schema: target.source.schema,
    table: target.source.table,
    objectType: 'flow',
    rowRefs: [
      {
        primaryKey,
        rowKey: row.rowKey,
      },
    ],
    inlineProperties: {
      origin: formatFlowmapPoint(start),
      destination: formatFlowmapPoint(end),
      magnitude,
    },
    title: `${target.layer.name} flow`,
  };
}

function boundsFromPoints(points: [number, number][]): GeoBounds {
  const west = Math.min(...points.map((point) => point[0]));
  const east = Math.max(...points.map((point) => point[0]));
  const south = Math.min(...points.map((point) => point[1]));
  const north = Math.max(...points.map((point) => point[1]));
  const lonPad = Math.max((east - west) * 0.12, 0.002);
  const latPad = Math.max((north - south) * 0.12, 0.002);

  return {
    west: west - lonPad,
    south: south - latPad,
    east: east + lonPad,
    north: north + latPad,
  };
}

function AnalysisWorkspacePanel({
  activeLayer,
  activeSource,
  mapSelection,
}: {
  activeLayer: MapLayer | null;
  activeSource: MapSource | null;
  mapSelection: MapSelection | null;
}) {
  if (!activeLayer || !activeSource) {
    return (
      <EmptyState
        detail="Analytics widgets will react to active layer and map selection."
        label="No Analysis Context"
      />
    );
  }

  return (
    <Stack h="100%" gap="md">
      <Group grow>
        <Paper p="md" radius="md" withBorder>
          <Text c="dimmed" size="xs">
            Active layer
          </Text>
          <Text fw={700} size="lg">
            {activeLayer.name}
          </Text>
        </Paper>
        <Paper p="md" radius="md" withBorder>
          <Text c="dimmed" size="xs">
            Source
          </Text>
          <Text fw={700} size="lg">
            {activeSource.type === 'flowmap-table' ? 'Flowmap' : 'Geometry'}
          </Text>
        </Paper>
      </Group>

      <Paper p="md" radius="md" withBorder>
        <Stack gap="xs">
          <Text fw={600} size="sm">
            Analytics workspace
          </Text>
          <Text c="dimmed" size="sm">
            Use this tab for widgets, charts, and infographics bound to current
            layer or map selection.
          </Text>
          {mapSelection ? (
            <Badge
              color={getMapSelectionBadgeColor(mapSelection.objectType)}
              variant="light"
            >
              Focused on{' '}
              {formatMapSelectionObjectType(
                mapSelection.objectType,
              ).toLowerCase()}{' '}
              with {formatMapSelectionCount(mapSelection.rowRefs.length)}
            </Badge>
          ) : (
            <Badge color="gray" variant="outline">
              No object selected
            </Badge>
          )}
        </Stack>
      </Paper>

      <EmptyState
        detail="Charts and analysis widgets plug in here next without changing map/data selection model."
        label="Widgets Next"
      />
    </Stack>
  );
}

function AppSettings({
  basemapId,
  onBasemapChange,
}: {
  basemapId: BasemapId;
  onBasemapChange: (basemapId: BasemapId) => void;
}) {
  return (
    <Menu
      closeOnItemClick={false}
      position="bottom-end"
      shadow="md"
      width={190}
    >
      <Menu.Target>
        <ActionIcon aria-label="Application settings" variant="default">
          <IconSettings size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Map settings</Menu.Label>
        <Box px="xs" pb="xs">
          <Select
            allowDeselect={false}
            aria-label="Basemap"
            data={basemapOptions}
            onChange={(value) => {
              if (value) {
                onBasemapChange(value as BasemapId);
              }
            }}
            size="xs"
            value={basemapId}
          />
        </Box>
        <Menu.Divider />
        <Menu.Label>Display</Menu.Label>
        <Group justify="space-between" px="xs" pb="xs" wrap="nowrap">
          <LanguageSwitcher />
          <ColorSchemeToggle />
        </Group>
      </Menu.Dropdown>
    </Menu>
  );
}

export function App() {
  const connections = useConnectionStore((state) => state.connections);
  const mapSources = useConnectionStore((state) => state.mapSources);
  const mapLayers = useConnectionStore((state) => state.mapLayers);
  const savedTableViews = useConnectionStore((state) => state.savedTableViews);
  const selectedBasemapId = useConnectionStore(
    (state) => state.selectedBasemapId,
  );
  const setSelectedBasemap = useConnectionStore(
    (state) => state.setSelectedBasemap,
  );
  const selectedConnectionId = useConnectionStore(
    (state) => state.selectedConnectionId,
  );
  const selectedSchemaNamesByConnectionId = useConnectionStore(
    (state) => state.selectedSchemaNamesByConnectionId,
  );
  const setSelectedSchemaNames = useConnectionStore(
    (state) => state.setSelectedSchemaNames,
  );
  const selectedTableByConnectionId = useConnectionStore(
    (state) => state.selectedTableByConnectionId,
  );
  const setSelectedTable = useConnectionStore(
    (state) => state.setSelectedTable,
  );
  const addGeoJsonLayer = useConnectionStore((state) => state.addGeoJsonLayer);
  const addFlowmapLayer = useConnectionStore((state) => state.addFlowmapLayer);
  const addArcLayer = useConnectionStore((state) => state.addArcLayer);
  const toggleMapLayerVisibility = useConnectionStore(
    (state) => state.toggleMapLayerVisibility,
  );
  const tableDisplayByKey = useConnectionStore(
    (state) => state.tableDisplayByKey,
  );
  const setTableDisplayConfigs = useConnectionStore(
    (state) => state.setTableDisplayConfigs,
  );
  const updateGeoJsonSource = useConnectionStore(
    (state) => state.updateGeoJsonSource,
  );
  const updateFlowmapSpatialFilter = useConnectionStore(
    (state) => state.updateFlowmapSpatialFilter,
  );
  const refreshMapSourcesForConnection = useConnectionStore(
    (state) => state.refreshMapSourcesForConnection,
  );
  const removeSavedTableView = useConnectionStore(
    (state) => state.removeSavedTableView,
  );
  const upsertServerConnections = useConnectionStore(
    (state) => state.upsertServerConnections,
  );
  const [schemas, setSchemas] = useState<InspectableSchema[]>([]);
  const [schemaTablesByName, setSchemaTablesByName] =
    useState<SchemaTablesByName>({});
  const [tableMetadataByKey, setTableMetadataByKey] = useState<
    Record<string, InspectableTable>
  >({});
  const [expandedSchemaNames, setExpandedSchemaNames] = useState<string[]>([]);
  const [isLoadingSchemas, setIsLoadingSchemas] = useState(false);
  const [loadingSchemaTablesByName, setLoadingSchemaTablesByName] =
    useState<LoadingSchemaTablesByName>({});
  const [isLoadingTableMetadata, setIsLoadingTableMetadata] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [mapSelection, setMapSelection] = useState<MapSelection | null>(null);
  const [locateFeatureBounds, setLocateFeatureBounds] =
    useState<LocateFeatureBoundsState | null>(null);
  const [rightPaneTab, setRightPaneTab] = useState<RightPaneTab>('layer');
  const [featureCreateRefreshToken, setFeatureCreateRefreshToken] = useState(0);
  const restoredCatalogSelectionRef = useRef<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function loadServerConnections() {
      try {
        const response = await fetch('/api/v1/database-connections');
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as ServerConnectionResponse;
        if (isActive) {
          upsertServerConnections(payload.connections);
        }
      } catch {
        // Local dev can run without server-managed connections.
      }
    }

    void loadServerConnections();

    return () => {
      isActive = false;
    };
  }, [upsertServerConnections]);

  const selectedConnection =
    connections.find((connection) => connection.id === selectedConnectionId) ??
    null;
  const selectedSchemaNames = selectedConnectionId
    ? (selectedSchemaNamesByConnectionId[selectedConnectionId] ?? [])
    : [];
  const selectedTableKey = selectedConnectionId
    ? (selectedTableByConnectionId[selectedConnectionId] ?? null)
    : null;
  const selectedTableSelection = useMemo(
    () => parseTableSelectionKey(selectedTableKey),
    [selectedTableKey],
  );
  const selectedSavedView =
    selectedTableSelection?.kind === 'view'
      ? (savedTableViews.find(
          (view) =>
            view.connectionId === selectedConnectionId &&
            view.id === selectedTableSelection.value,
        ) ?? null)
      : null;
  const selectedSourceTableKey = selectedSavedView
    ? `${selectedSavedView.sourceSchema}.${selectedSavedView.sourceTable}`
    : selectedTableSelection?.kind === 'table'
      ? selectedTableSelection.value
      : null;
  const selectedInspectableTable = selectedSourceTableKey
    ? (tableMetadataByKey[selectedSourceTableKey] ?? null)
    : null;
  const visibleTableOptions = useMemo(
    () =>
      selectedSchemaNames.flatMap(
        (schemaName) => schemaTablesByName[schemaName] ?? [],
      ),
    [schemaTablesByName, selectedSchemaNames],
  );
  const metadataTables = useMemo(
    () => Object.values(tableMetadataByKey),
    [tableMetadataByKey],
  );
  const selectedConnectionSavedViews = useMemo(
    () =>
      savedTableViews.filter(
        (view) => view.connectionId === selectedConnectionId,
      ),
    [savedTableViews, selectedConnectionId],
  );
  const catalog: CatalogState = {
    schemas,
    schemaTablesByName,
    selectedSchemaNames,
    expandedSchemaNames,
    isLoadingSchemas,
    loadingSchemaTablesByName,
    error: catalogError,
  };

  const handleSelectTable = useCallback(
    (tableKey: string | null) => {
      if (!selectedConnectionId) {
        return;
      }

      setSelectedTable(selectedConnectionId, tableKey);
    },
    [selectedConnectionId, setSelectedTable],
  );
  const updateSelectedSchemaNames = useCallback(
    (update: (current: string[]) => string[]) => {
      if (!selectedConnectionId) {
        return;
      }

      const current =
        useConnectionStore.getState().selectedSchemaNamesByConnectionId[
          selectedConnectionId
        ] ?? [];
      setSelectedSchemaNames(selectedConnectionId, update(current));
    },
    [selectedConnectionId, setSelectedSchemaNames],
  );

  function handleSelectSavedView(viewId: string) {
    handleSelectTable(createSavedViewSelectionKey(viewId));
  }

  function handleRemoveSavedView(viewId: string, viewName: string) {
    if (!window.confirm(`Delete saved view "${viewName}"?`)) {
      return;
    }

    if (selectedTableKey === createSavedViewSelectionKey(viewId)) {
      handleSelectTable(null);
    }

    removeSavedTableView(viewId);
  }

  const loadSchemaTables = useCallback(
    async (schemaName: string, force = false) => {
      if (!selectedConnection || (!force && schemaTablesByName[schemaName])) {
        return;
      }

      setLoadingSchemaTablesByName((current) => ({
        ...current,
        [schemaName]: true,
      }));
      setCatalogError('');

      try {
        const nextTables = await fetchInspectableSchemaTables(
          selectedConnection,
          schemaName,
        );
        setSchemaTablesByName((current) => ({
          ...current,
          [schemaName]: nextTables,
        }));
      } catch (error) {
        setCatalogError(
          error instanceof Error
            ? error.message
            : `Failed to load tables for ${schemaName}.`,
        );
      } finally {
        setLoadingSchemaTablesByName((current) => ({
          ...current,
          [schemaName]: false,
        }));
      }
    },
    [schemaTablesByName, selectedConnection],
  );

  const loadCatalogSchemas = useCallback(
    async (loadAllTables = false) => {
      if (!selectedConnection || selectedConnection.testStatus !== 'success') {
        return;
      }

      setIsLoadingSchemas(true);
      setCatalogError('');

      try {
        const nextSchemas = await fetchInspectableSchemas(selectedConnection);
        setSchemas(nextSchemas);
        const visibleSchemaNames = new Set(
          nextSchemas
            .filter((schema) => schema.visible)
            .map((schema) => schema.name),
        );
        if (loadAllTables) {
          const visibleSchemas = nextSchemas.filter((schema) => schema.visible);
          const loadedTables = await Promise.all(
            visibleSchemas.map(
              async (schema) =>
                [
                  schema.name,
                  await fetchInspectableSchemaTables(
                    selectedConnection,
                    schema.name,
                  ),
                ] as const,
            ),
          );
          setSchemaTablesByName((current) => ({
            ...current,
            ...Object.fromEntries(loadedTables),
          }));
        }
        const selectedTableSchema =
          selectedSourceTableKey?.split('.')[0] ?? null;
        updateSelectedSchemaNames((current) => {
          const next = current.filter((name) => visibleSchemaNames.has(name));
          if (
            selectedTableSchema &&
            visibleSchemaNames.has(selectedTableSchema) &&
            !next.includes(selectedTableSchema)
          ) {
            next.push(selectedTableSchema);
          }
          return next;
        });
        setExpandedSchemaNames((current) =>
          Array.from(
            new Set([
              ...current.filter((name) => visibleSchemaNames.has(name)),
              ...(selectedTableSchema &&
              visibleSchemaNames.has(selectedTableSchema)
                ? [selectedTableSchema]
                : []),
            ]),
          ),
        );
        if (
          selectedSourceTableKey &&
          !visibleSchemaNames.has(selectedSourceTableKey.split('.')[0])
        ) {
          handleSelectTable(null);
        } else if (selectedTableSchema) {
          await loadSchemaTables(selectedTableSchema, true);
        }
      } catch (error) {
        setCatalogError(
          error instanceof Error ? error.message : 'Failed to load schemas.',
        );
      } finally {
        setIsLoadingSchemas(false);
      }
    },
    [
      handleSelectTable,
      loadSchemaTables,
      selectedConnection,
      selectedSourceTableKey,
      updateSelectedSchemaNames,
    ],
  );

  function handleToggleCatalogSchema(schemaName: string) {
    updateSelectedSchemaNames((current) => {
      if (current.includes(schemaName)) {
        if (
          selectedSourceTableKey?.startsWith(`${schemaName}.`) ||
          selectedSavedView?.sourceSchema === schemaName
        ) {
          handleSelectTable(null);
        }

        return current.filter((name) => name !== schemaName);
      }

      void loadSchemaTables(schemaName);
      return [...current, schemaName];
    });

    setExpandedSchemaNames((current) =>
      current.includes(schemaName) ? current : [...current, schemaName],
    );
  }

  function handleToggleCatalogSchemaExpanded(schemaName: string) {
    setExpandedSchemaNames((current) => {
      if (current.includes(schemaName)) {
        return current.filter((name) => name !== schemaName);
      }

      void loadSchemaTables(schemaName);
      return [...current, schemaName];
    });
  }

  function handleCreateGeometryLayer(payload: {
    table: InspectableTable;
    name: string;
    geometryColumn: string;
  }) {
    if (!selectedConnectionId) {
      return;
    }

    const geometryColumn = payload.table.geometryColumns.find(
      (column) => column.name === payload.geometryColumn,
    );
    if (!geometryColumn) {
      return;
    }

    addGeoJsonLayer({
      connectionId: selectedConnectionId,
      schema: payload.table.schema,
      table: payload.table.name,
      fullName: payload.table.fullName,
      kind: payload.table.kind,
      name: payload.name,
      geometryColumn: geometryColumn.name,
      geometryType: geometryColumn.geometryType,
      filter: null,
      sourceViewId: null,
    });
  }

  function handleCreateFlowLayer(payload: {
    table: InspectableTable;
    layerKind: MovementLayerKind;
    name: string;
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
  }) {
    if (!selectedConnectionId) {
      return;
    }

    const layerPayload = {
      connectionId: selectedConnectionId,
      schema: payload.table.schema,
      table: payload.table.name,
      fullName: payload.table.fullName,
      kind: payload.table.kind,
      name: payload.name,
      columns: {
        startMode: payload.startMode,
        startLon: payload.startLon,
        startLat: payload.startLat,
        startGeometry: payload.startGeometry,
        endMode: payload.endMode,
        endLon: payload.endLon,
        endLat: payload.endLat,
        endGeometry: payload.endGeometry,
        magnitude: payload.magnitude,
        defaultMagnitude: payload.defaultMagnitude,
      },
    };

    if (payload.layerKind === 'arc') {
      addArcLayer(layerPayload);
      return;
    }

    addFlowmapLayer(layerPayload);
  }

  const selectedConnectionMapLayers = useMemo(
    () =>
      mapLayers.filter((layer) => layer.connectionId === selectedConnectionId),
    [mapLayers, selectedConnectionId],
  );
  const recordPreviewSourceValidationKey = useMemo(() => {
    const sourceIds = new Set(
      selectedConnectionMapLayers
        .filter((layer) => layer.purpose === 'record-preview')
        .map((layer) => layer.sourceId),
    );

    return JSON.stringify(
      mapSources
        .filter(
          (source): source is FlowmapTableSource =>
            source.type === 'flowmap-table' &&
            Boolean(source.rowRef) &&
            sourceIds.has(source.id),
        )
        .sort((left, right) => left.id.localeCompare(right.id)),
    );
  }, [mapSources, selectedConnectionMapLayers]);
  const selectedVisibleMapLayers = useMemo(
    () => selectedConnectionMapLayers.filter((layer) => layer.visible),
    [selectedConnectionMapLayers],
  );

  useEffect(() => {
    if (
      !selectedConnection ||
      selectedConnection.testStatus !== 'success' ||
      recordPreviewSourceValidationKey === '[]'
    ) {
      return;
    }

    const previewSources = JSON.parse(
      recordPreviewSourceValidationKey,
    ) as FlowmapTableSource[];
    const activeConnection = selectedConnection;
    const abortController = new AbortController();

    async function removeEmptyRecordPreviews() {
      await Promise.all(
        previewSources.map(async (source) => {
          try {
            const data = await fetchFlowmapSourceData(
              activeConnection,
              source,
              abortController.signal,
            );
            if (data.flowCount > 0 || abortController.signal.aborted) {
              return;
            }

            const state = useConnectionStore.getState();
            const emptyPreviewLayers = state.mapLayers.filter(
              (layer) =>
                layer.sourceId === source.id &&
                layer.purpose === 'record-preview',
            );
            for (const layer of emptyPreviewLayers) {
              state.removeMapLayer(layer.id);
            }
          } catch {
            // Keep previews on transient errors; only a successful empty query removes them.
          }
        }),
      );
    }

    void removeEmptyRecordPreviews();

    return () => abortController.abort();
  }, [recordPreviewSourceValidationKey, selectedConnection]);
  const activeLayer =
    selectedConnectionMapLayers.find((layer) => layer.id === activeLayerId) ??
    null;
  const activeLayerSource = activeLayer
    ? (findLayerSource(mapSources, activeLayer) ?? null)
    : null;
  const geoJsonSpatialFilterTargets = useMemo(
    () =>
      selectedConnectionMapLayers.flatMap((layer) => {
        if (!isGeoJsonLayer(layer) && !isMovementLayer(layer)) {
          return [];
        }

        const source = mapSources.find(
          (candidate): candidate is GeoJsonTableSource | FlowmapTableSource =>
            candidate.id === layer.sourceId &&
            (candidate.type === 'geojson-table' ||
              candidate.type === 'flowmap-table'),
        );

        return source ? [{ layer, source }] : [];
      }),
    [mapSources, selectedConnectionMapLayers],
  );

  function handleApplySpatialFilter(
    targetSourceId: string,
    predicate: SpatialFilterPredicate,
  ) {
    if (
      !mapSelection ||
      mapSelection.sourceType !== 'geojson-table' ||
      mapSelection.rowRefs.length === 0
    ) {
      return;
    }

    const source = mapSources.find(
      (candidate): candidate is GeoJsonTableSource =>
        candidate.id === mapSelection.sourceId &&
        candidate.type === 'geojson-table',
    );
    if (!source) {
      return;
    }

    const spatialFilter = {
      sourceLayerId: mapSelection.layerId,
      sourceLayerName: mapSelection.layerName,
      sourceSchema: source.schema,
      sourceTable: source.table,
      sourceGeometryColumn: source.geometryColumn,
      rowRefs: mapSelection.rowRefs,
      predicate,
    };
    const targetSource = mapSources.find(
      (candidate) => candidate.id === targetSourceId,
    );

    if (targetSource?.type === 'flowmap-table') {
      updateFlowmapSpatialFilter(targetSourceId, spatialFilter);
      return;
    }

    updateGeoJsonSource(targetSourceId, { spatialFilter });
  }

  function handleClearSpatialFilter(sourceId: string) {
    const source = mapSources.find((candidate) => candidate.id === sourceId);
    if (source?.type === 'flowmap-table') {
      updateFlowmapSpatialFilter(sourceId, null);
      return;
    }

    updateGeoJsonSource(sourceId, { spatialFilter: null });
  }

  useEffect(() => {
    void selectedConnectionId;
    setSchemas([]);
    setSchemaTablesByName({});
    setTableMetadataByKey({});
    setExpandedSchemaNames([]);
    setIsLoadingSchemas(false);
    setLoadingSchemaTablesByName({});
    setIsLoadingTableMetadata(false);
    setCatalogError('');
    setActiveLayerId(null);
    setMapSelection(null);
    setRightPaneTab('layer');
  }, [selectedConnectionId]);

  useEffect(() => {
    if (
      !selectedConnection ||
      selectedConnection.testStatus !== 'success' ||
      !selectedSourceTableKey
    ) {
      restoredCatalogSelectionRef.current = null;
      return;
    }

    const restoreKey = `${selectedConnection.id}:${selectedSourceTableKey}`;
    if (restoredCatalogSelectionRef.current === restoreKey) {
      return;
    }

    restoredCatalogSelectionRef.current = restoreKey;
    void loadCatalogSchemas();
  }, [loadCatalogSchemas, selectedConnection, selectedSourceTableKey]);

  useEffect(() => {
    if (!activeLayerId && selectedConnectionMapLayers.length > 0) {
      setActiveLayerId(selectedConnectionMapLayers[0].id);
      return;
    }

    if (
      activeLayerId &&
      !selectedConnectionMapLayers.some((layer) => layer.id === activeLayerId)
    ) {
      setActiveLayerId(selectedConnectionMapLayers[0]?.id ?? null);
    }
  }, [activeLayerId, selectedConnectionMapLayers]);

  useEffect(() => {
    if (selectedTableSelection?.kind === 'view' && !selectedSavedView) {
      handleSelectTable(null);
    }
  }, [handleSelectTable, selectedSavedView, selectedTableSelection]);

  useEffect(() => {
    if (
      mapSelection &&
      !selectedConnectionMapLayers.some(
        (layer) => layer.id === mapSelection.layerId,
      )
    ) {
      setMapSelection(null);
    }
  }, [mapSelection, selectedConnectionMapLayers]);

  useEffect(() => {
    if (!selectedConnection || selectedConnection.testStatus !== 'success') {
      setSchemas([]);
      setSchemaTablesByName({});
      setTableMetadataByKey({});
      setExpandedSchemaNames([]);
      setIsLoadingSchemas(false);
      setLoadingSchemaTablesByName({});
      setIsLoadingTableMetadata(false);
      setCatalogError('');
      return;
    }

    setCatalogError('');
  }, [selectedConnection]);

  useEffect(() => {
    if (!selectedConnection || selectedConnection.testStatus !== 'success') {
      return;
    }

    let isActive = true;
    const activeConnection = selectedConnection;

    async function loadTableDisplayConfigs() {
      try {
        const configs = await fetchTableDisplayConfigs(activeConnection);
        if (!isActive) {
          return;
        }

        setTableDisplayConfigs(
          Object.fromEntries(
            configs.map((config) => [
              tableDisplayKeyFromParts(
                activeConnection.id,
                config.schema,
                config.table,
              ),
              {
                tableAlias: config.tableAlias,
                columnLabels: config.columnLabels ?? {},
                hiddenColumns: config.hiddenColumns ?? [],
              },
            ]),
          ),
        );
      } catch (error) {
        if (isActive) {
          setCatalogError(
            error instanceof Error
              ? error.message
              : 'Failed to load table display settings.',
          );
        }
      }
    }

    void loadTableDisplayConfigs();

    return () => {
      isActive = false;
    };
  }, [selectedConnection, setTableDisplayConfigs]);

  useEffect(() => {
    if (!selectedConnection || !selectedSourceTableKey) {
      setIsLoadingTableMetadata(false);
      return;
    }

    const tableSummary = visibleTableOptions.find(
      (table) => table.fullName === selectedSourceTableKey,
    );
    if (!tableSummary || tableMetadataByKey[selectedSourceTableKey]) {
      return;
    }

    const activeConnection = selectedConnection;
    const activeTableSummary = tableSummary;
    let isActive = true;

    async function loadMetadata() {
      setIsLoadingTableMetadata(true);
      setCatalogError('');

      try {
        const metadata = await fetchTableMetadata(
          activeConnection,
          activeTableSummary.schema,
          activeTableSummary.name,
        );
        if (!isActive) {
          return;
        }
        setTableMetadataByKey((current) => ({
          ...current,
          [metadata.fullName]: {
            ...metadata,
            rowEstimate: activeTableSummary.rowEstimate,
          },
        }));
      } catch (error) {
        if (!isActive) {
          return;
        }
        setCatalogError(
          error instanceof Error
            ? error.message
            : 'Failed to load table metadata.',
        );
      } finally {
        if (isActive) {
          setIsLoadingTableMetadata(false);
        }
      }
    }

    void loadMetadata();

    return () => {
      isActive = false;
    };
  }, [
    selectedConnection,
    selectedSourceTableKey,
    tableMetadataByKey,
    visibleTableOptions,
  ]);

  function handleSelectLayer(layerId: string) {
    setActiveLayerId(layerId);
    setRightPaneTab('layer');
  }

  async function handleLocateLayer(layerId: string) {
    const layer = mapLayers.find((candidate) => candidate.id === layerId);
    const source = layer
      ? mapSources.find((candidate) => candidate.id === layer.sourceId)
      : null;
    const connection = layer
      ? connections.find((candidate) => candidate.id === layer.connectionId)
      : null;

    if (!layer || !source || !connection) {
      throw new Error('Layer source is unavailable.');
    }

    setActiveLayerId(layer.id);
    setRightPaneTab('layer');

    if (!layer.visible) {
      toggleMapLayerVisibility(layer.id);
    }

    let bounds: GeoBounds | null;
    if (source.type === 'geojson-table') {
      const response = await fetchGeoJsonSourceExtent(connection, source);
      bounds = response.bounds;
    } else {
      const response = await fetchFlowmapSourceData(connection, source);
      const points: [number, number][] = response.locations
        .filter(
          (location) =>
            Number.isFinite(location.lon) && Number.isFinite(location.lat),
        )
        .map((location) => [location.lon, location.lat]);
      bounds = points.length > 0 ? boundsFromPoints(points) : null;
    }

    if (!bounds) {
      throw new Error('Layer has no mappable features.');
    }

    setLocateFeatureBounds({ token: Date.now(), bounds });
  }

  function handleSelectMapObject(selection: MapSelection | null) {
    setMapSelection(selection);

    if (!selection) {
      return;
    }

    setActiveLayerId(selection.layerId);
    setRightPaneTab('data');
  }

  async function handleLocateFeature(
    target: LocateTarget,
    row: InspectorRow,
    primaryKey: string[],
  ) {
    if (!selectedConnection) {
      return;
    }

    if (target.kind === 'flowmap') {
      const selection = buildLocatedFlowmapSelection(row, primaryKey, target);
      if (!selection) {
        throw new Error('Selected row does not have usable flow coordinates.');
      }

      const start = getFlowmapRowPoint(
        row.values,
        target.source.columns.startMode,
        target.source.columns.startLon,
        target.source.columns.startLat,
        target.source.columns.startGeometry,
      );
      const end = getFlowmapRowPoint(
        row.values,
        target.source.columns.endMode,
        target.source.columns.endLon,
        target.source.columns.endLat,
        target.source.columns.endGeometry,
      );
      if (!start || !end) {
        throw new Error('Selected row does not have usable flow coordinates.');
      }

      setMapSelection(selection);
      setActiveLayerId(target.layer.id);
      setRightPaneTab('data');
      setLocateFeatureBounds({
        token: Date.now(),
        bounds: boundsFromPoints([start, end]),
      });
      return;
    }

    const result = await locateGeoJsonFeature(selectedConnection, {
      schema: target.source.schema,
      table: target.source.table,
      geometryColumn: target.source.geometryColumn,
      rowKey: row.rowKey ?? {},
    });

    setMapSelection(buildLocatedFeatureSelection(result, target));
    setActiveLayerId(target.layer.id);
    setRightPaneTab('data');

    if (result.bounds) {
      setLocateFeatureBounds({
        token: Date.now(),
        bounds: result.bounds,
      });
    }
  }

  async function handleLocateRelatedFeature(
    group: RelatedRowsGroup,
    row: InspectorRow,
    geometryColumnName: string,
  ) {
    if (
      !selectedConnection ||
      group.geometryColumns.length === 0 ||
      !row.rowKey
    ) {
      return;
    }

    const geometryColumn = group.geometryColumns.find(
      (column) => column.name === geometryColumnName,
    );
    if (!geometryColumn || !selectedConnectionId) {
      return;
    }

    const tableLabel =
      tableDisplayByKey[
        tableDisplayKeyFromParts(
          selectedConnectionId,
          group.schema,
          group.table,
        )
      ]?.tableAlias?.trim() || group.label;

    addGeoJsonLayer({
      connectionId: selectedConnectionId,
      schema: group.schema,
      table: group.table,
      fullName: `${group.schema}.${group.table}`,
      kind: 'table',
      name: `${tableLabel}: ${geometryColumn.name}`,
      geometryColumn: geometryColumn.name,
      geometryType: geometryColumn.geometryType,
      purpose: 'record-preview',
    });

    const currentMapState = useConnectionStore.getState();
    const source = currentMapState.mapSources.find(
      (candidate): candidate is GeoJsonTableSource =>
        candidate.type === 'geojson-table' &&
        candidate.connectionId === selectedConnectionId &&
        candidate.schema === group.schema &&
        candidate.table === group.table &&
        candidate.geometryColumn === geometryColumn.name &&
        !candidate.sourceViewId &&
        !candidate.filter,
    );
    const layer = source
      ? currentMapState.mapLayers.find(
          (candidate): candidate is GeoJsonMapLayer =>
            candidate.type === 'geojson' && candidate.sourceId === source.id,
        )
      : null;

    const result = await locateGeoJsonFeature(selectedConnection, {
      schema: group.schema,
      table: group.table,
      geometryColumn: geometryColumn.name,
      rowKey: row.rowKey,
    });

    if (source && layer) {
      setMapSelection(
        buildLocatedFeatureSelection(result, {
          kind: 'geojson',
          layer,
          source,
        }),
      );
      setActiveLayerId(layer.id);
    }

    setRightPaneTab('layer');
    if (result.bounds) {
      setLocateFeatureBounds({
        token: Date.now(),
        bounds: result.bounds,
      });
    }
  }

  function handleCreateRelatedArc(
    group: RelatedRowsGroup,
    row: InspectorRow,
    startGeometryColumn: string,
    endGeometryColumn: string,
  ) {
    if (!selectedConnectionId || !row.rowKey) {
      return;
    }

    const start = getFlowmapRowPoint(
      row.values,
      'geometry',
      '',
      '',
      startGeometryColumn,
    );
    const end = getFlowmapRowPoint(
      row.values,
      'geometry',
      '',
      '',
      endGeometryColumn,
    );
    if (!start || !end) {
      return;
    }

    const rowRef = {
      primaryKey: group.primaryKey,
      rowKey: row.rowKey,
    };
    const columns: FlowmapTableSource['columns'] = {
      startMode: 'geometry',
      startLon: '',
      startLat: '',
      startGeometry: startGeometryColumn,
      endMode: 'geometry',
      endLon: '',
      endLat: '',
      endGeometry: endGeometryColumn,
      magnitude: '',
      defaultMagnitude: 1,
    };
    const tableLabel =
      tableDisplayByKey[
        tableDisplayKeyFromParts(
          selectedConnectionId,
          group.schema,
          group.table,
        )
      ]?.tableAlias?.trim() || group.label;
    const recordKey = group.primaryKey
      .map((columnName) => formatCellValue(row.values[columnName]))
      .join(', ');

    addArcLayer({
      connectionId: selectedConnectionId,
      schema: group.schema,
      table: group.table,
      fullName: `${group.schema}.${group.table}`,
      kind: 'table',
      name: `${tableLabel}${recordKey ? ` #${recordKey}` : ''}: ${startGeometryColumn} → ${endGeometryColumn}`,
      columns,
      rowRef,
      purpose: 'record-preview',
    });

    const currentMapState = useConnectionStore.getState();
    const source = currentMapState.mapSources.find(
      (candidate): candidate is FlowmapTableSource =>
        candidate.type === 'flowmap-table' &&
        candidate.connectionId === selectedConnectionId &&
        candidate.schema === group.schema &&
        candidate.table === group.table &&
        JSON.stringify(candidate.columns) === JSON.stringify(columns) &&
        JSON.stringify(candidate.rowRef) === JSON.stringify(rowRef),
    );
    const layer = source
      ? currentMapState.mapLayers.find(
          (candidate): candidate is ArcMapLayer =>
            candidate.type === 'arc' && candidate.sourceId === source.id,
        )
      : null;
    if (!source || !layer) {
      return;
    }

    const selection = buildLocatedFlowmapSelection(row, group.primaryKey, {
      kind: 'flowmap',
      layer,
      source,
    });
    setMapSelection(selection);
    setActiveLayerId(layer.id);
    setRightPaneTab('layer');
    setLocateFeatureBounds({
      token: Date.now(),
      bounds: boundsFromPoints([start, end]),
    });
  }

  function handleFeatureCreated(source: GeoJsonTableSource) {
    refreshMapSourcesForConnection(source.connectionId);

    setFeatureCreateRefreshToken((value) => value + 1);
  }

  async function handleOpenTable(tableKey: string) {
    const [schemaName] = tableKey.split('.');
    if (!schemaName) {
      handleSelectTable(tableKey);
      return;
    }

    if (!selectedSchemaNames.includes(schemaName)) {
      updateSelectedSchemaNames((current) =>
        current.includes(schemaName) ? current : [...current, schemaName],
      );
    }

    setExpandedSchemaNames((current) =>
      current.includes(schemaName) ? current : [...current, schemaName],
    );

    if (!schemaTablesByName[schemaName]) {
      await loadSchemaTables(schemaName);
    }

    handleSelectTable(tableKey);
  }

  const connectionManagerProps = {
    activeLayerId,
    catalog,
    mapLayers: selectedConnectionMapLayers,
    mapSources,
    onLoadSchemas: () => void loadCatalogSchemas(),
    onLoadLayerSources: () => void loadCatalogSchemas(true),
    onCreateGeometryLayer: handleCreateGeometryLayer,
    onCreateFlowLayer: handleCreateFlowLayer,
    onLocateLayer: handleLocateLayer,
    onRemoveSavedView: handleRemoveSavedView,
    onSelectLayer: handleSelectLayer,
    onSelectCatalogTable: handleSelectTable,
    onSelectSavedView: handleSelectSavedView,
    onToggleCatalogSchema: handleToggleCatalogSchema,
    onToggleCatalogSchemaExpanded: handleToggleCatalogSchemaExpanded,
    savedViews: selectedConnectionSavedViews,
    selectedInspectableTable,
    selectedTableKey,
    tables: metadataTables,
  };

  return (
    <WorkspaceLayout
      panels={{
        sources: (
          <PanelFrame tourId="sources-panel">
            <ConnectionManager {...connectionManagerProps} view="sources" />
          </PanelFrame>
        ),
        layers: (
          <PanelFrame tourId="layers-panel">
            <ConnectionManager {...connectionManagerProps} view="layers" />
          </PanelFrame>
        ),
        map: (
          <PanelFrame padding={0} tourId="map-panel">
            <MapPane
              activeLayerId={activeLayerId}
              basemapId={selectedBasemapId ?? defaultBasemapId}
              connection={selectedConnection}
              locateFeatureBounds={locateFeatureBounds}
              mapSelection={mapSelection}
              onFeatureCreated={handleFeatureCreated}
              onSelectMapObject={handleSelectMapObject}
              sources={mapSources}
              tables={metadataTables}
              visibleLayers={selectedVisibleMapLayers}
            />
          </PanelFrame>
        ),
        table: (
          <PanelFrame tourId="table-panel">
            <DataInspector
              connection={selectedConnection}
              featureCreateRefreshToken={featureCreateRefreshToken}
              isLoadingTableMetadata={isLoadingTableMetadata}
              isLoadingTables={
                isLoadingSchemas ||
                Object.values(loadingSchemaTablesByName).some(Boolean)
              }
              key={`${selectedConnectionId ?? 'none'}:${selectedTableKey ?? 'none'}`}
              mapLayers={selectedVisibleMapLayers}
              mapSources={mapSources}
              onCreateRelatedArc={handleCreateRelatedArc}
              onLocateFeature={handleLocateFeature}
              onLocateRelatedFeature={handleLocateRelatedFeature}
              selectedView={selectedSavedView}
              selectedTable={selectedInspectableTable}
              tablesError={catalogError}
            />
          </PanelFrame>
        ),
        workspace: (
          <PanelFrame tourId="workspace-panel">
            <RightPaneTabs
              activeLayer={activeLayer}
              activeSource={activeLayerSource}
              connection={selectedConnection}
              geoJsonSpatialFilterTargets={geoJsonSpatialFilterTargets}
              mapSelection={mapSelection}
              onApplySpatialFilter={handleApplySpatialFilter}
              onChangeTab={setRightPaneTab}
              onClearSpatialFilter={handleClearSpatialFilter}
              onOpenTable={handleOpenTable}
              selectedTab={rightPaneTab}
            />
          </PanelFrame>
        ),
      }}
      toolbar={
        <Group gap={4} wrap="nowrap">
          <OnboardingTour />
          <AppSettings
            basemapId={selectedBasemapId ?? defaultBasemapId}
            onBasemapChange={setSelectedBasemap}
          />
        </Group>
      }
    />
  );
}
