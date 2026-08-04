import { Split } from '@gfazioli/mantine-split-pane';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  Collapse,
  Flex,
  Group,
  Loader,
  Menu,
  Modal,
  NumberInput,
  Paper,
  PasswordInput,
  ScrollArea,
  Select,
  Slider,
  Stack,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconChartBar,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconDatabasePlus,
  IconDatabaseSearch,
  IconDeviceFloppy,
  IconDotsVertical,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconInfoCircle,
  IconLayersIntersect,
  IconMapPin,
  IconPencil,
  IconPlug,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconRestore,
  IconRoute,
  IconSearch,
  IconSettings,
  IconTable,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import {
  MantineReactTable,
  type MRT_ColumnDef,
  useMantineReactTable,
} from 'mantine-react-table';
import maplibregl, { LngLatBounds } from 'maplibre-gl';
import 'mantine-react-table/styles.css';
import {
  type ChangeEvent,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  createEmptyInsertRow,
  createFlowLayerDefaults,
  createSavedViewSelectionKey,
  type DraftInsertRow,
  type FlowLayerFormState,
  findLayerSource,
  formatFlowmapSourceColumns,
  formatMapSelectionCount,
  formatMapSelectionObjectType,
  formatRowCount,
  getMapSelectionBadgeColor,
  parseTableSelectionKey,
  serializeRowKey,
  validateFlowLayerForm,
} from './features/app/app-utils';
import {
  ColorSchemeToggle,
  EmptyState,
  LayerGlyph,
  PanelFrame,
} from './features/app/chrome';
import {
  type ArcMapLayer,
  type DatabaseConnection,
  type FlowmapMapLayer,
  type FlowmapTableSource,
  type GeoJsonMapLayer,
  type GeoJsonTableSource,
  type LayerGlyphIcon,
  type MapLayer,
  type MapSource,
  type SpatialFilterPredicate,
  type TableDisplayConfig,
  useConnectionStore,
} from './features/connections/store';
import { SavedViewModal } from './features/filters/SavedViewModal';
import type {
  SavedTableView,
  TableFilterDefinition,
} from './features/filters/types';
import { LanguageSwitcher } from './features/i18n/i18n';
import {
  commitInspectorRows,
  fetchInspectableSchemas,
  fetchInspectableSchemaTables,
  fetchInspectorRows,
  fetchInspectorRowsByKey,
  fetchRelationLabels,
  fetchRelationOptions,
  fetchTableDisplayConfigs,
  fetchTableMetadata,
  type InspectableSchema,
  type InspectableTable,
  type InspectableTableSummary,
  type InspectorColumn,
  type InspectorForeignKey,
  type InspectorLookupRowsResponse,
  type InspectorRow,
  type InspectorRowsResponse,
  type RelationOption,
  saveTableDisplayConfig,
  type TableChangeOperation,
} from './features/inspector/api';
import {
  areEditorValuesEqual,
  formatCellValue,
  getCellFontFamily,
  getCellTextAlign,
  isEditableColumnType,
  isNumericColumnType,
  normalizeEditorValue,
  renderEditableCell,
} from './features/inspector/table-editing';
import {
  type GeoBounds,
  type LocateFeatureResponse,
  locateGeoJsonFeature,
} from './features/map/api';
import {
  type BasemapId,
  basemapOptions,
  defaultBasemapId,
  getBasemapStyle,
} from './features/map/basemaps';
import { MapPane } from './features/map/MapPane';
import type { MapSelection } from './features/map/selection';

const pageSize = 100;

type SchemaTablesByName = Record<string, InspectableTableSummary[]>;
type LoadingSchemaTablesByName = Record<string, boolean>;

interface CatalogState {
  schemas: InspectableSchema[];
  schemaTablesByName: SchemaTablesByName;
  selectedSchemaNames: string[];
  expandedSchemaNames: string[];
  isLoadingSchemas: boolean;
  loadingSchemaTablesByName: LoadingSchemaTablesByName;
  error: string;
}

type RightPaneTab = 'layer' | 'data' | 'analysis';
type MovementLayerKind = 'flowmap' | 'arc';

type InspectorGridRow =
  | {
      id: string;
      kind: 'draft';
      draftRow: DraftInsertRow;
      row: null;
      rowPatch: undefined;
      rowToken: null;
      values: Record<string, unknown>;
      isDeleted: false;
    }
  | {
      id: string;
      kind: 'record';
      draftRow: null;
      row: InspectorRow;
      rowPatch: Record<string, unknown> | undefined;
      rowToken: string | null;
      values: Record<string, unknown>;
      isDeleted: boolean;
    };

interface GeoJsonSpatialFilterTarget {
  layer: GeoJsonMapLayer | FlowmapMapLayer | ArcMapLayer;
  source: GeoJsonTableSource | FlowmapTableSource;
}

interface GeoJsonLocateTarget {
  kind: 'geojson';
  layer: GeoJsonMapLayer;
  source: GeoJsonTableSource;
}

interface FlowmapLocateTarget {
  kind: 'flowmap';
  layer: FlowmapMapLayer | ArcMapLayer;
  source: FlowmapTableSource;
}

type LocateTarget = GeoJsonLocateTarget | FlowmapLocateTarget;

interface LocateFeatureBoundsState {
  token: number;
  bounds: GeoBounds;
}

interface ConnectionFormState {
  name: string;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
}

interface ServerConnectionResponse {
  connections: Array<Pick<DatabaseConnection, 'id' | 'name'>>;
}

const initialConnectionForm: ConnectionFormState = {
  name: '',
  host: '127.0.0.1',
  port: '5432',
  database: '',
  user: '',
  password: '',
};

function connectionRequestPayload(connection: DatabaseConnection) {
  if (connection.isServerManaged) {
    return {
      id: connection.id,
    };
  }

  return {
    id: connection.id,
    name: connection.name,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    password: connection.password,
  };
}

function ConnectionManager({
  activeLayerId,
  catalog,
  mapLayers,
  mapSources,
  onLoadSchemas,
  onImportSelectedTable,
  onCreateFlowLayer,
  onSelectLayer,
  onSelectCatalogTable,
  onSelectSavedView,
  onToggleCatalogSchema,
  onToggleCatalogSchemaExpanded,
  onRemoveSavedView,
  savedViews,
  selectedInspectableTable,
  selectedTableKey,
  tables,
}: {
  activeLayerId: string | null;
  catalog: CatalogState;
  mapLayers: MapLayer[];
  mapSources: MapSource[];
  onLoadSchemas: () => void;
  onImportSelectedTable: () => void;
  onCreateFlowLayer: (payload: {
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
  }) => void;
  onSelectLayer: (layerId: string) => void;
  onSelectCatalogTable: (tableKey: string) => void;
  onSelectSavedView: (viewId: string) => void;
  onToggleCatalogSchema: (schemaName: string) => void;
  onToggleCatalogSchemaExpanded: (schemaName: string) => void;
  onRemoveSavedView: (viewId: string, viewName: string) => void;
  savedViews: SavedTableView[];
  selectedInspectableTable: InspectableTable | null;
  selectedTableKey: string | null;
  tables: InspectableTable[];
}) {
  const [connectionOpened, connectionModal] = useDisclosure(false);
  const [flowLayerOpened, flowLayerModal] = useDisclosure(false);
  const [catalogOpened, catalogDisclosure] = useDisclosure(false);
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null);
  const [form, setForm] = useState<ConnectionFormState>(initialConnectionForm);
  const [flowLayerForm, setFlowLayerForm] = useState<FlowLayerFormState>(() =>
    createFlowLayerDefaults(selectedInspectableTable),
  );
  const [movementLayerKind, setMovementLayerKind] =
    useState<MovementLayerKind>('flowmap');
  const [flowLayerError, setFlowLayerError] = useState('');
  const connections = useConnectionStore((state) => state.connections);
  const selectedConnectionId = useConnectionStore(
    (state) => state.selectedConnectionId,
  );
  const addConnection = useConnectionStore((state) => state.addConnection);
  const removeConnection = useConnectionStore(
    (state) => state.removeConnection,
  );
  const selectConnection = useConnectionStore(
    (state) => state.selectConnection,
  );
  const toggleConnectionActive = useConnectionStore(
    (state) => state.toggleConnectionActive,
  );
  const setConnectionTestPending = useConnectionStore(
    (state) => state.setConnectionTestPending,
  );
  const setConnectionTestSuccess = useConnectionStore(
    (state) => state.setConnectionTestSuccess,
  );
  const setConnectionTestError = useConnectionStore(
    (state) => state.setConnectionTestError,
  );
  const toggleMapLayerVisibility = useConnectionStore(
    (state) => state.toggleMapLayerVisibility,
  );
  const updateGeoJsonLayer = useConnectionStore(
    (state) => state.updateGeoJsonLayer,
  );
  const updateGeoJsonSource = useConnectionStore(
    (state) => state.updateGeoJsonSource,
  );
  const updateFlowmapSource = useConnectionStore(
    (state) => state.updateFlowmapSource,
  );
  const updateFlowmapLayer = useConnectionStore(
    (state) => state.updateFlowmapLayer,
  );
  const updateArcLayer = useConnectionStore((state) => state.updateArcLayer);
  const removeMapLayer = useConnectionStore((state) => state.removeMapLayer);
  const tableDisplayByKey = useConnectionStore(
    (state) => state.tableDisplayByKey,
  );

  const canImportSelectedTable = Boolean(
    selectedInspectableTable &&
      selectedInspectableTable.geometryColumns.length > 0,
  );
  const numericColumnOptions = (selectedInspectableTable?.columns ?? [])
    .filter((column) => isNumericColumnType(column.type))
    .map((column) => ({
      label: `${column.name} (${column.type})`,
      value: column.name,
    }));
  const canCreateFlowLayer = Boolean(selectedInspectableTable);
  const canSubmitFlowLayer = Boolean(
    flowLayerForm.name.trim() &&
      (flowLayerForm.startMode === 'geometry'
        ? flowLayerForm.startGeometry
        : flowLayerForm.startLon && flowLayerForm.startLat) &&
      (flowLayerForm.endMode === 'geometry'
        ? flowLayerForm.endGeometry
        : flowLayerForm.endLon && flowLayerForm.endLat) &&
      (flowLayerForm.magnitude || flowLayerForm.defaultMagnitude > 0),
  );
  const geometryColumnOptions = (
    selectedInspectableTable?.geometryColumns ?? []
  ).map((column) => ({
    label: `${column.name} (${column.geometryType})`,
    value: column.name,
  }));
  const selectedTableAlias =
    selectedConnectionId && selectedInspectableTable
      ? tableDisplayByKey[
          tableDisplayKey(selectedConnectionId, selectedInspectableTable)
        ]?.tableAlias?.trim()
      : '';
  const flowValidationMessages = validateFlowLayerForm(
    flowLayerForm,
    selectedInspectableTable,
  );
  const currentFlowLayerDefaults = useMemo(() => {
    const defaults = createFlowLayerDefaults(selectedInspectableTable);
    if (!selectedInspectableTable || !selectedTableAlias) {
      return defaults;
    }

    return {
      ...defaults,
      name: `${selectedTableAlias} flows`,
    };
  }, [selectedInspectableTable, selectedTableAlias]);

  useEffect(() => {
    setFlowLayerForm(currentFlowLayerDefaults);
    setFlowLayerError('');
  }, [currentFlowLayerDefaults]);

  function handleFieldChange(event: ChangeEvent<HTMLInputElement>) {
    const { name, value } = event.currentTarget;
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleClose() {
    setForm(initialConnectionForm);
    connectionModal.close();
  }

  function handleOpenMovementLayerModal(layerKind: MovementLayerKind) {
    setMovementLayerKind(layerKind);
    setFlowLayerForm(currentFlowLayerDefaults);
    setFlowLayerError('');
    flowLayerModal.open();
  }

  function handleCloseFlowLayerModal() {
    flowLayerModal.close();
  }

  function handleToggleCatalog() {
    if (!catalogOpened && catalog.schemas.length === 0) {
      onLoadSchemas();
    }

    catalogDisclosure.toggle();
  }

  function handleSubmit() {
    if (
      !form.name.trim() ||
      !form.host.trim() ||
      !form.port.trim() ||
      !form.database.trim() ||
      !form.user.trim()
    ) {
      return;
    }

    addConnection({
      ...form,
      name: form.name.trim(),
      host: form.host.trim(),
      port: form.port.trim(),
      database: form.database.trim(),
      user: form.user.trim(),
      isActive: true,
    });
    handleClose();
  }

  function handleCreateFlowLayer() {
    const validationMessages = validateFlowLayerForm(
      flowLayerForm,
      selectedInspectableTable,
    );
    if (validationMessages.length > 0) {
      setFlowLayerError(validationMessages[0]);
      return;
    }

    if (!canSubmitFlowLayer) {
      return;
    }

    onCreateFlowLayer({
      layerKind: movementLayerKind,
      name: flowLayerForm.name.trim(),
      startMode: flowLayerForm.startMode,
      startLon: flowLayerForm.startLon ?? '',
      startLat: flowLayerForm.startLat ?? '',
      startGeometry: flowLayerForm.startGeometry ?? '',
      endMode: flowLayerForm.endMode,
      endLon: flowLayerForm.endLon ?? '',
      endLat: flowLayerForm.endLat ?? '',
      endGeometry: flowLayerForm.endGeometry ?? '',
      magnitude: flowLayerForm.magnitude ?? '',
      defaultMagnitude: flowLayerForm.defaultMagnitude,
    });
    handleCloseFlowLayerModal();
  }

  async function handleTestConnection(connection: DatabaseConnection) {
    setConnectionTestPending(connection.id);

    try {
      const response = await fetch('/api/v1/database-connections/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(connectionRequestPayload(connection)),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            success: boolean;
            message: string;
            postgresVersion: string;
            postgisVersion: string;
          }
        | {
            error: {
              code: string;
              message: string;
            };
          }
        | null;

      if (!response.ok || !payload || 'error' in payload) {
        const message =
          payload && 'error' in payload
            ? payload.error.message
            : 'Database connection test failed.';
        setConnectionTestError(connection.id, message);
        return;
      }

      setConnectionTestSuccess(connection.id, {
        message: payload.message,
        postgresVersion: payload.postgresVersion,
        postgisVersion: payload.postgisVersion,
      });
    } catch {
      setConnectionTestError(
        connection.id,
        'API unavailable. Start backend on :18080 first.',
      );
    }
  }

  return (
    <>
      <Modal
        centered
        onClose={handleClose}
        opened={connectionOpened}
        title="Add PostGIS connection"
      >
        <Stack gap="sm">
          <TextInput
            label="Display name"
            name="name"
            onChange={handleFieldChange}
            placeholder="City DB"
            value={form.name}
          />
          <TextInput
            label="Host"
            name="host"
            onChange={handleFieldChange}
            placeholder="127.0.0.1"
            value={form.host}
          />
          <Group grow>
            <TextInput
              label="Port"
              name="port"
              onChange={handleFieldChange}
              placeholder="5432"
              value={form.port}
            />
            <TextInput
              label="Database"
              name="database"
              onChange={handleFieldChange}
              placeholder="geopanel_test"
              value={form.database}
            />
          </Group>
          <TextInput
            label="User"
            name="user"
            onChange={handleFieldChange}
            placeholder="geopanel"
            value={form.user}
          />
          <PasswordInput
            label="Password"
            name="password"
            onChange={handleFieldChange}
            placeholder="Optional for now"
            value={form.password}
          />
          <Group justify="space-between" pt="xs">
            <Text c="dimmed" size="xs">
              Browser connections are local. Server connections keep password on
              backend.
            </Text>
            <Button onClick={handleSubmit}>Save connection</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        centered
        onClose={handleCloseFlowLayerModal}
        opened={flowLayerOpened}
        title={`Create ${movementLayerKind === 'arc' ? 'arc' : 'flowmap'} layer`}
      >
        <Stack gap="sm">
          <TextInput
            label="Layer name"
            onChange={(event) =>
              setFlowLayerForm((current) => ({
                ...current,
                name: event.currentTarget.value,
              }))
            }
            value={flowLayerForm.name}
          />

          <Stack gap="xs">
            <Group grow>
              <Select
                data={[
                  { label: 'Lon/lat columns', value: 'coordinates' },
                  { label: 'Geometry column', value: 'geometry' },
                ]}
                label="Departure point"
                onChange={(value) =>
                  setFlowLayerForm((current) => ({
                    ...current,
                    startMode:
                      value === 'geometry' ? 'geometry' : 'coordinates',
                  }))
                }
                value={flowLayerForm.startMode}
              />
              <Select
                data={[
                  { label: 'Lon/lat columns', value: 'coordinates' },
                  { label: 'Geometry column', value: 'geometry' },
                ]}
                label="Destination point"
                onChange={(value) =>
                  setFlowLayerForm((current) => ({
                    ...current,
                    endMode: value === 'geometry' ? 'geometry' : 'coordinates',
                  }))
                }
                value={flowLayerForm.endMode}
              />
            </Group>

            {flowLayerForm.startMode === 'geometry' ? (
              <Select
                data={geometryColumnOptions}
                error={flowValidationMessages.some((message) =>
                  message.includes('Departure geometry'),
                )}
                label="Departure geometry"
                onChange={(value) =>
                  setFlowLayerForm((current) => ({
                    ...current,
                    startGeometry: value,
                  }))
                }
                placeholder="Geometry point column"
                searchable
                value={flowLayerForm.startGeometry}
              />
            ) : (
              <Group grow>
                <Select
                  data={numericColumnOptions}
                  error={flowValidationMessages.some((message) =>
                    message.includes('Departure longitude'),
                  )}
                  label="Departure longitude"
                  onChange={(value) =>
                    setFlowLayerForm((current) => ({
                      ...current,
                      startLon: value,
                    }))
                  }
                  placeholder="Numeric lon/x column"
                  searchable
                  value={flowLayerForm.startLon}
                />
                <Select
                  data={numericColumnOptions}
                  error={flowValidationMessages.some((message) =>
                    message.includes('Departure latitude'),
                  )}
                  label="Departure latitude"
                  onChange={(value) =>
                    setFlowLayerForm((current) => ({
                      ...current,
                      startLat: value,
                    }))
                  }
                  placeholder="Numeric lat/y column"
                  searchable
                  value={flowLayerForm.startLat}
                />
              </Group>
            )}

            {flowLayerForm.endMode === 'geometry' ? (
              <Select
                data={geometryColumnOptions}
                error={flowValidationMessages.some((message) =>
                  message.includes('Destination geometry'),
                )}
                label="Destination geometry"
                onChange={(value) =>
                  setFlowLayerForm((current) => ({
                    ...current,
                    endGeometry: value,
                  }))
                }
                placeholder="Geometry point column"
                searchable
                value={flowLayerForm.endGeometry}
              />
            ) : (
              <Group grow>
                <Select
                  data={numericColumnOptions}
                  error={flowValidationMessages.some((message) =>
                    message.includes('Destination longitude'),
                  )}
                  label="Destination longitude"
                  onChange={(value) =>
                    setFlowLayerForm((current) => ({
                      ...current,
                      endLon: value,
                    }))
                  }
                  placeholder="Numeric lon/x column"
                  searchable
                  value={flowLayerForm.endLon}
                />
                <Select
                  data={numericColumnOptions}
                  error={flowValidationMessages.some((message) =>
                    message.includes('Destination latitude'),
                  )}
                  label="Destination latitude"
                  onChange={(value) =>
                    setFlowLayerForm((current) => ({
                      ...current,
                      endLat: value,
                    }))
                  }
                  placeholder="Numeric lat/y column"
                  searchable
                  value={flowLayerForm.endLat}
                />
              </Group>
            )}
          </Stack>

          <Select
            data={numericColumnOptions}
            error={flowValidationMessages.some((message) =>
              message.includes('Density'),
            )}
            label="Density column"
            onChange={(value) =>
              setFlowLayerForm((current) => ({
                ...current,
                magnitude: value,
              }))
            }
            placeholder="Optional numeric weight/count column"
            clearable
            searchable
            value={flowLayerForm.magnitude}
          />
          <NumberInput
            decimalScale={3}
            disabled={Boolean(flowLayerForm.magnitude)}
            error={flowValidationMessages.some((message) =>
              message.includes('Default density'),
            )}
            label="Default density"
            min={0.001}
            onChange={(value) =>
              setFlowLayerForm((current) => ({
                ...current,
                defaultMagnitude: typeof value === 'number' ? value : 1,
              }))
            }
            value={flowLayerForm.defaultMagnitude}
          />

          {flowLayerError ? (
            <Alert color="red" title="Flow setup incomplete" variant="light">
              {flowLayerError}
            </Alert>
          ) : null}
          <Group justify="space-between" pt="xs">
            <Text c="dimmed" size="xs">
              One table. Static read-only flows from selected point columns.
            </Text>
            <Button
              disabled={!canSubmitFlowLayer}
              onClick={handleCreateFlowLayer}
            >
              Create layer
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Stack h="100%" gap="md">
        <Group justify="space-between" wrap="nowrap">
          <div>
            <Text fw={700} size="sm">
              Connected Sources
            </Text>
          </div>
          <ActionIcon
            aria-label="Add connection"
            color="blue"
            onClick={connectionModal.open}
            radius="xl"
            size="lg"
            variant="light"
          >
            <IconDatabasePlus size={18} />
          </ActionIcon>
        </Group>

        <ScrollArea
          offsetScrollbars
          scrollbarSize={6}
          style={{
            flex: 1,
            minHeight: 0,
          }}
        >
          <Stack gap="sm" pr="xs">
            {connections.map((connection) => {
              const isSelected = connection.id === selectedConnectionId;

              return (
                <Paper
                  key={connection.id}
                  onClick={() => selectConnection(connection.id)}
                  p="sm"
                  radius="md"
                  shadow={isSelected ? 'sm' : 'xs'}
                  style={{
                    border: isSelected
                      ? '1px solid var(--mantine-color-blue-4)'
                      : '1px solid var(--mantine-color-gray-3)',
                    cursor: 'pointer',
                  }}
                >
                  <Stack gap={8}>
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap="xs" wrap="nowrap">
                        {connection.isActive ? (
                          <IconPlugConnected
                            color="var(--mantine-color-green-6)"
                            size={16}
                          />
                        ) : (
                          <IconPlug
                            color="var(--mantine-color-gray-6)"
                            size={16}
                          />
                        )}
                        <Text fw={600} size="sm" truncate="end">
                          {connection.name}
                        </Text>
                      </Group>

                      <Menu position="bottom-end" shadow="md" width={260}>
                        <Menu.Target>
                          <ActionIcon
                            aria-label={`${connection.name} options`}
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                            size="sm"
                            variant="subtle"
                          >
                            <IconDotsVertical size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                        >
                          <Menu.Label>Connection</Menu.Label>
                          <Menu.Item
                            leftSection={<IconInfoCircle size={14} />}
                            closeMenuOnClick={false}
                          >
                            <Stack gap={2}>
                              <Text size="xs">
                                {connection.isServerManaged
                                  ? 'Configured on backend'
                                  : `${connection.host}:${connection.port} / ${connection.database}`}
                              </Text>
                              <Text c="dimmed" size="xs">
                                {connection.testMessage || 'Not tested'}
                              </Text>
                              {connection.testStatus === 'success' ? (
                                <Text c="dimmed" size="xs">
                                  PostGIS {connection.postgisVersion}
                                </Text>
                              ) : null}
                            </Stack>
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Item
                            color="red"
                            disabled={connection.isServerManaged}
                            leftSection={<IconTrash size={14} />}
                            onClick={() => {
                              if (connection.isServerManaged) {
                                return;
                              }
                              removeConnection(connection.id);
                            }}
                          >
                            Delete
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Group>

                    <Group gap="xs" justify="flex-end" wrap="nowrap">
                      <Button
                        color="blue"
                        leftSection={
                          connection.testStatus === 'testing' ? (
                            <Loader size={14} />
                          ) : (
                            <IconPlugConnected size={14} />
                          )
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleTestConnection(connection);
                        }}
                        size="compact-xs"
                        variant={
                          connection.testStatus === 'success'
                            ? 'light'
                            : 'filled'
                        }
                      >
                        {connection.testStatus === 'testing'
                          ? 'Testing'
                          : 'Test'}
                      </Button>
                    </Group>

                    {connection.testStatus === 'error' ? (
                      <Text c="red" size="xs">
                        {connection.testMessage}
                      </Text>
                    ) : null}

                    {isSelected && connection.testStatus === 'success' ? (
                      <ConnectionCatalog
                        catalog={catalog}
                        connectionId={selectedConnectionId}
                        opened={catalogOpened}
                        selectedTableKey={selectedTableKey}
                        tableDisplayByKey={tableDisplayByKey}
                        savedViews={savedViews}
                        onLoadSchemas={onLoadSchemas}
                        onRemoveSavedView={onRemoveSavedView}
                        onSelectSavedView={onSelectSavedView}
                        onSelectTable={onSelectCatalogTable}
                        onToggle={handleToggleCatalog}
                        onToggleSchema={onToggleCatalogSchema}
                        onToggleSchemaExpanded={onToggleCatalogSchemaExpanded}
                      />
                    ) : null}

                    <Group justify="flex-end">
                      <Button
                        color={connection.isActive ? 'gray' : 'teal'}
                        leftSection={
                          connection.isActive ? (
                            <IconCheck size={14} />
                          ) : (
                            <IconPlug size={14} />
                          )
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleConnectionActive(connection.id);
                        }}
                        size="compact-xs"
                        variant="subtle"
                      >
                        {connection.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </Group>
                  </Stack>
                </Paper>
              );
            })}

            {connections.length === 0 ? (
              <EmptyState
                detail="Save first PostGIS connection to start building data sources."
                label="No Connections"
              />
            ) : null}
          </Stack>
        </ScrollArea>

        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Text fw={700} size="sm">
                Map Layers
              </Text>
            </div>
            <Menu position="bottom-end" shadow="md" width={220}>
              <Menu.Target>
                <Button
                  rightSection={<IconChevronDown size={14} />}
                  size="compact-sm"
                  variant="light"
                >
                  Layer Actions
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  disabled={!canImportSelectedTable}
                  leftSection={<IconDatabasePlus size={14} />}
                  onClick={onImportSelectedTable}
                >
                  Import Layer
                </Menu.Item>
                <Menu.Item
                  disabled={!canCreateFlowLayer}
                  leftSection={<IconRoute size={14} />}
                  onClick={() => handleOpenMovementLayerModal('flowmap')}
                >
                  Create Flowmap
                </Menu.Item>
                <Menu.Item
                  disabled={!canCreateFlowLayer}
                  leftSection={<IconLayersIntersect size={14} />}
                  onClick={() => handleOpenMovementLayerModal('arc')}
                >
                  Create Arc
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>

          <Stack gap={4}>
            {mapLayers.map((layer) => {
              const source = findLayerSource(mapSources, layer);
              const sourceTable = source
                ? (tables.find((table) => table.fullName === source.fullName) ??
                  null)
                : null;
              const isExpanded = expandedLayerId === layer.id;
              const isSelected = activeLayerId === layer.id;

              if (!source) {
                return null;
              }

              return (
                <Paper
                  key={layer.id}
                  onClick={() => onSelectLayer(layer.id)}
                  p="xs"
                  radius="md"
                  shadow="xs"
                  style={{
                    border: isSelected
                      ? '1px solid var(--mantine-color-blue-4)'
                      : '1px solid var(--mantine-color-gray-3)',
                    cursor: 'pointer',
                    opacity: layer.visible ? 1 : 0.55,
                  }}
                >
                  <Stack gap="xs">
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap="xs" wrap="nowrap">
                        <LayerGlyph
                          color={
                            layer.type === 'geojson' || layer.type === 'arc'
                              ? layer.color
                              : '#0c8599'
                          }
                          icon={layer.icon}
                          visible={layer.visible}
                        />
                        <Stack gap={0}>
                          <Text fw={600} size="sm">
                            {layer.name}
                          </Text>
                          <Text c="dimmed" size="xs">
                            {source.type === 'geojson-table'
                              ? `${source.geometryColumn} • ${source.kind}`
                              : formatFlowmapSourceColumns(source.columns)}
                          </Text>
                        </Stack>
                      </Group>

                      <Group gap={4} wrap="nowrap">
                        <Button
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpandedLayerId((current) =>
                              current === layer.id ? null : layer.id,
                            );
                          }}
                          size="compact-xs"
                          variant="subtle"
                        >
                          {isExpanded ? 'Close' : 'Style'}
                        </Button>
                        <ActionIcon
                          aria-label={
                            layer.visible ? 'Hide layer' : 'Show layer'
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleMapLayerVisibility(layer.id);
                          }}
                          size="sm"
                          variant="subtle"
                        >
                          {layer.visible ? (
                            <IconEye size={16} />
                          ) : (
                            <IconEyeOff size={16} />
                          )}
                        </ActionIcon>
                        <ActionIcon
                          aria-label={`Delete ${layer.name}`}
                          color="red"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (
                              window.confirm(
                                `Delete layer "${layer.name}" from map?`,
                              )
                            ) {
                              removeMapLayer(layer.id);
                            }
                          }}
                          size="sm"
                          variant="subtle"
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Group>

                    <Text c="dimmed" size="xs">
                      {source.schema}.{source.table}
                    </Text>

                    {isExpanded ? (
                      <MapLayerEditor
                        layer={layer}
                        source={source}
                        sourceTable={sourceTable}
                        onUpdateFlowmapLayer={updateFlowmapLayer}
                        onUpdateFlowmapSource={updateFlowmapSource}
                        onUpdateArcLayer={updateArcLayer}
                        onUpdateGeoJsonLayer={updateGeoJsonLayer}
                        onUpdateGeoJsonSource={updateGeoJsonSource}
                      />
                    ) : null}
                  </Stack>
                </Paper>
              );
            })}

            {mapLayers.length === 0 ? (
              <Text c="dimmed" size="xs">
                Select table below, then import geometry or create flow layer.
              </Text>
            ) : null}
          </Stack>
        </Stack>
      </Stack>
    </>
  );
}

function ConnectionCatalog({
  catalog,
  connectionId,
  opened,
  savedViews,
  selectedTableKey,
  tableDisplayByKey,
  onLoadSchemas,
  onRemoveSavedView,
  onSelectSavedView,
  onSelectTable,
  onToggle,
  onToggleSchema,
  onToggleSchemaExpanded,
}: {
  catalog: CatalogState;
  connectionId: string | null;
  opened: boolean;
  savedViews: SavedTableView[];
  selectedTableKey: string | null;
  tableDisplayByKey: Record<string, TableDisplayConfig>;
  onLoadSchemas: () => void;
  onRemoveSavedView: (viewId: string, viewName: string) => void;
  onSelectSavedView: (viewId: string) => void;
  onSelectTable: (tableKey: string) => void;
  onToggle: () => void;
  onToggleSchema: (schemaName: string) => void;
  onToggleSchemaExpanded: (schemaName: string) => void;
}) {
  const selectedSchemaNames = new Set(catalog.selectedSchemaNames);
  const expandedSchemaNames = new Set(catalog.expandedSchemaNames);

  return (
    <Paper p="xs" radius="sm" withBorder>
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Group gap={6} wrap="nowrap">
            <IconFolder size={15} />
            <Text fw={600} size="xs">
              Catalog
            </Text>
          </Group>
          <Group gap={4} wrap="nowrap">
            <ActionIcon
              aria-label="Refresh catalog schemas"
              disabled={catalog.isLoadingSchemas}
              onClick={(event) => {
                event.stopPropagation();
                onLoadSchemas();
              }}
              size="sm"
              variant="subtle"
            >
              {catalog.isLoadingSchemas ? (
                <Loader size={14} />
              ) : (
                <IconRefresh size={14} />
              )}
            </ActionIcon>
            <Button
              onClick={(event) => {
                event.stopPropagation();
                onToggle();
              }}
              rightSection={
                opened ? (
                  <IconChevronDown size={14} />
                ) : (
                  <IconChevronRight size={14} />
                )
              }
              size="compact-xs"
              variant="subtle"
            >
              {opened ? 'Hide' : 'Open'}
            </Button>
          </Group>
        </Group>

        <Collapse expanded={opened}>
          <Stack gap="xs">
            {catalog.error ? (
              <Alert color="red" title="Catalog failed" variant="light">
                {catalog.error}
              </Alert>
            ) : null}

            {catalog.isLoadingSchemas ? (
              <Group gap="xs">
                <Loader size={14} />
                <Text c="dimmed" size="xs">
                  Loading schemas...
                </Text>
              </Group>
            ) : null}

            {!catalog.isLoadingSchemas && catalog.schemas.length === 0 ? (
              <Text c="dimmed" size="xs">
                Open catalog to load schemas.
              </Text>
            ) : null}

            {catalog.schemas.map((schema) => {
              const isSelected = selectedSchemaNames.has(schema.name);
              const isExpanded = expandedSchemaNames.has(schema.name);
              const tables = catalog.schemaTablesByName[schema.name] ?? [];
              const schemaViews = savedViews.filter(
                (view) => view.sourceSchema === schema.name,
              );
              const isLoadingTables =
                catalog.loadingSchemaTablesByName[schema.name] ?? false;

              return (
                <Stack key={schema.name} gap={4}>
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${schema.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleSchemaExpanded(schema.name);
                      }}
                      size="sm"
                      variant="subtle"
                    >
                      {isExpanded ? (
                        <IconChevronDown size={14} />
                      ) : (
                        <IconChevronRight size={14} />
                      )}
                    </ActionIcon>
                    <Checkbox
                      checked={isSelected}
                      label={
                        <Text fw={500} size="xs">
                          {schema.name}
                        </Text>
                      }
                      onChange={() => onToggleSchema(schema.name)}
                      size="xs"
                    />
                    {isLoadingTables ? <Loader size={12} /> : null}
                  </Group>

                  <Collapse expanded={isExpanded}>
                    <Stack gap={2} pl="lg">
                      {isLoadingTables ? (
                        <Text c="dimmed" size="xs">
                          Loading tables...
                        </Text>
                      ) : null}

                      {!isLoadingTables &&
                      tables.length === 0 &&
                      schemaViews.length === 0 ? (
                        <Text c="dimmed" size="xs">
                          No loaded tables.
                        </Text>
                      ) : null}

                      {tables.map((table) => {
                        const tableAlias = connectionId
                          ? tableDisplayByKey[
                              tableDisplayKeyFromParts(
                                connectionId,
                                table.schema,
                                table.name,
                              )
                            ]?.tableAlias?.trim()
                          : '';

                        return (
                          <Button
                            key={table.fullName}
                            aria-label={
                              tableAlias
                                ? `${tableAlias} (${table.fullName})`
                                : table.fullName
                            }
                            color={
                              selectedTableKey === table.fullName
                                ? 'blue'
                                : 'gray'
                            }
                            justify="flex-start"
                            leftSection={<IconTable size={14} />}
                            onClick={() => onSelectTable(table.fullName)}
                            size="compact-xs"
                            title={table.fullName}
                            variant={
                              selectedTableKey === table.fullName
                                ? 'light'
                                : 'subtle'
                            }
                          >
                            <Text size="xs" truncate="end">
                              {tableAlias || table.name}
                            </Text>
                          </Button>
                        );
                      })}

                      {schemaViews.map((view) => {
                        const viewKey = createSavedViewSelectionKey(view.id);

                        return (
                          <Group gap={4} key={view.id} wrap="nowrap">
                            <Button
                              color={
                                selectedTableKey === viewKey ? 'grape' : 'gray'
                              }
                              justify="flex-start"
                              leftSection={<IconDatabaseSearch size={14} />}
                              onClick={() => onSelectSavedView(view.id)}
                              size="compact-xs"
                              style={{
                                flex: 1,
                                minWidth: 0,
                              }}
                              variant={
                                selectedTableKey === viewKey
                                  ? 'light'
                                  : 'subtle'
                              }
                            >
                              <Text size="xs" truncate="end">
                                {view.name}
                              </Text>
                            </Button>
                            <ActionIcon
                              aria-label={`Delete saved view ${view.name}`}
                              color="red"
                              onClick={(event) => {
                                event.stopPropagation();
                                onRemoveSavedView(view.id, view.name);
                              }}
                              size="sm"
                              variant="subtle"
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Group>
                        );
                      })}
                    </Stack>
                  </Collapse>
                </Stack>
              );
            })}
          </Stack>
        </Collapse>
      </Stack>
    </Paper>
  );
}

function FlowmapSetupFields({
  columns,
  table,
  onChange,
}: {
  columns: FlowmapTableSource['columns'];
  table: InspectableTable | null;
  onChange: (patch: Partial<FlowmapTableSource['columns']>) => void;
}) {
  const numericColumnOptions = (table?.columns ?? [])
    .filter((column) => isNumericColumnType(column.type))
    .map((column) => ({
      label: `${column.name} (${column.type})`,
      value: column.name,
    }));
  const geometryColumnOptions = (table?.geometryColumns ?? []).map(
    (column) => ({
      label: `${column.name} (${column.geometryType})`,
      value: column.name,
    }),
  );

  return (
    <Stack gap="xs">
      <Group grow>
        <Select
          data={[
            { label: 'Lon/lat columns', value: 'coordinates' },
            { label: 'Geometry column', value: 'geometry' },
          ]}
          label="Departure point"
          onChange={(value) =>
            onChange({
              startMode: value === 'geometry' ? 'geometry' : 'coordinates',
            })
          }
          size="xs"
          value={columns.startMode}
        />
        <Select
          data={[
            { label: 'Lon/lat columns', value: 'coordinates' },
            { label: 'Geometry column', value: 'geometry' },
          ]}
          label="Destination point"
          onChange={(value) =>
            onChange({
              endMode: value === 'geometry' ? 'geometry' : 'coordinates',
            })
          }
          size="xs"
          value={columns.endMode}
        />
      </Group>

      {columns.startMode === 'geometry' ? (
        <Select
          data={geometryColumnOptions}
          label="Departure geometry"
          onChange={(value) => onChange({ startGeometry: value ?? '' })}
          searchable
          size="xs"
          value={columns.startGeometry}
        />
      ) : (
        <Group grow>
          <Select
            data={numericColumnOptions}
            label="Departure longitude"
            onChange={(value) => onChange({ startLon: value ?? '' })}
            searchable
            size="xs"
            value={columns.startLon}
          />
          <Select
            data={numericColumnOptions}
            label="Departure latitude"
            onChange={(value) => onChange({ startLat: value ?? '' })}
            searchable
            size="xs"
            value={columns.startLat}
          />
        </Group>
      )}

      {columns.endMode === 'geometry' ? (
        <Select
          data={geometryColumnOptions}
          label="Destination geometry"
          onChange={(value) => onChange({ endGeometry: value ?? '' })}
          searchable
          size="xs"
          value={columns.endGeometry}
        />
      ) : (
        <Group grow>
          <Select
            data={numericColumnOptions}
            label="Destination longitude"
            onChange={(value) => onChange({ endLon: value ?? '' })}
            searchable
            size="xs"
            value={columns.endLon}
          />
          <Select
            data={numericColumnOptions}
            label="Destination latitude"
            onChange={(value) => onChange({ endLat: value ?? '' })}
            searchable
            size="xs"
            value={columns.endLat}
          />
        </Group>
      )}

      <Group grow>
        <Select
          data={numericColumnOptions}
          label="Density column"
          onChange={(value) => onChange({ magnitude: value ?? '' })}
          placeholder="Optional"
          clearable
          searchable
          size="xs"
          value={columns.magnitude}
        />
        <NumberInput
          decimalScale={3}
          disabled={Boolean(columns.magnitude)}
          label="Default density"
          min={0.001}
          onChange={(value) =>
            onChange({
              defaultMagnitude: typeof value === 'number' ? value : 1,
            })
          }
          size="xs"
          value={columns.defaultMagnitude}
        />
      </Group>
    </Stack>
  );
}

function MapLayerEditor({
  layer,
  source,
  sourceTable,
  onUpdateFlowmapLayer,
  onUpdateFlowmapSource,
  onUpdateArcLayer,
  onUpdateGeoJsonLayer,
  onUpdateGeoJsonSource,
}: {
  layer: MapLayer;
  source: MapSource;
  sourceTable: InspectableTable | null;
  onUpdateFlowmapLayer: (
    layerId: string,
    patch: {
      name?: string;
      icon?: LayerGlyphIcon;
      style?: Partial<FlowmapMapLayer['style']>;
    },
  ) => void;
  onUpdateFlowmapSource: (
    sourceId: string,
    patch: Partial<FlowmapTableSource['columns']>,
  ) => void;
  onUpdateArcLayer: (
    layerId: string,
    patch: Partial<Pick<ArcMapLayer, 'name' | 'icon' | 'color' | 'width'>>,
  ) => void;
  onUpdateGeoJsonLayer: (
    layerId: string,
    patch: Partial<
      Pick<GeoJsonMapLayer, 'name' | 'icon' | 'color' | 'opacity'>
    >,
  ) => void;
  onUpdateGeoJsonSource: (
    sourceId: string,
    patch: Partial<Pick<MapSource & { type: 'geojson-table' }, never>> &
      Partial<{ geometryColumn: string; geometryType: string }>,
  ) => void;
}) {
  const [draftName, setDraftName] = useState(layer.name);
  const [draftColor, setDraftColor] = useState(
    layer.type === 'geojson' || layer.type === 'arc' ? layer.color : '#0c8599',
  );
  const [draftOpacity, setDraftOpacity] = useState(
    layer.type === 'geojson' ? layer.opacity : 80,
  );
  const [draftArcWidth, setDraftArcWidth] = useState(
    layer.type === 'arc' ? layer.width : 3,
  );
  const [draftThicknessScale, setDraftThicknessScale] = useState(
    layer.type === 'flowmap' ? layer.style.flowLineThicknessScale : 2,
  );
  const [draftTopFlows, setDraftTopFlows] = useState(
    layer.type === 'flowmap' ? layer.style.maxTopFlowsDisplayNum : 500,
  );

  useEffect(() => {
    setDraftName(layer.name);
    if (layer.type === 'geojson') {
      setDraftColor(layer.color);
      setDraftOpacity(layer.opacity);
      return;
    }

    if (layer.type === 'arc') {
      setDraftColor(layer.color);
      setDraftArcWidth(layer.width);
      return;
    }

    setDraftThicknessScale(layer.style.flowLineThicknessScale);
    setDraftTopFlows(layer.style.maxTopFlowsDisplayNum);
  }, [layer]);

  function commitLayerName() {
    if (draftName === layer.name) {
      return;
    }

    startTransition(() => {
      if (layer.type === 'geojson') {
        onUpdateGeoJsonLayer(layer.id, {
          name: draftName,
        });
        return;
      }

      if (layer.type === 'arc') {
        onUpdateArcLayer(layer.id, {
          name: draftName,
        });
        return;
      }

      onUpdateFlowmapLayer(layer.id, {
        name: draftName,
      });
    });
  }

  return (
    <Stack
      gap="xs"
      pt="xs"
      style={{
        borderTop: '1px solid var(--mantine-color-gray-2)',
      }}
    >
      <TextInput
        label="Layer name"
        onBlur={commitLayerName}
        onChange={(event) => setDraftName(event.currentTarget.value)}
        size="xs"
        value={draftName}
      />

      {layer.type === 'geojson' && source.type === 'geojson-table' ? (
        <>
          <Select
            data={(sourceTable?.geometryColumns ?? []).map((column) => ({
              label: `${column.name} (${column.geometryType})`,
              value: column.name,
            }))}
            label="Geographic column"
            onChange={(value) => {
              const nextGeometryColumn =
                sourceTable?.geometryColumns.find(
                  (column) => column.name === value,
                ) ?? null;

              startTransition(() => {
                onUpdateGeoJsonSource(source.id, {
                  geometryColumn: value ?? source.geometryColumn,
                  geometryType:
                    nextGeometryColumn?.geometryType ?? source.geometryType,
                });
              });
            }}
            size="xs"
            value={source.geometryColumn}
          />

          <Group align="end" grow>
            <Box>
              <Text c="dimmed" fw={500} mb={4} size="xs">
                Color
              </Text>
              <input
                aria-label={`Choose color for ${layer.name}`}
                onBlur={() => {
                  if (draftColor === layer.color) {
                    return;
                  }

                  startTransition(() => {
                    onUpdateGeoJsonLayer(layer.id, {
                      color: draftColor,
                    });
                  });
                }}
                onChange={(event) => setDraftColor(event.currentTarget.value)}
                style={{
                  width: '100%',
                  height: 36,
                  border: '1px solid var(--mantine-color-gray-4)',
                  borderRadius: 8,
                  background: 'transparent',
                  padding: 4,
                }}
                type="color"
                value={draftColor}
              />
            </Box>

            <Select
              data={[
                { label: 'Circle', value: 'circle' },
                { label: 'Square', value: 'square' },
                { label: 'Diamond', value: 'diamond' },
                { label: 'Line', value: 'line' },
              ]}
              label="List icon"
              onChange={(value) => {
                if (!value) {
                  return;
                }

                startTransition(() => {
                  onUpdateGeoJsonLayer(layer.id, {
                    icon: value as LayerGlyphIcon,
                  });
                });
              }}
              size="xs"
              value={layer.icon}
            />
          </Group>

          <Stack gap={4}>
            <Group justify="space-between">
              <Text c="dimmed" fw={500} size="xs">
                Opacity
              </Text>
              <Text c="dimmed" size="xs">
                {draftOpacity}%
              </Text>
            </Group>
            <Slider
              max={100}
              min={0}
              onChange={setDraftOpacity}
              onChangeEnd={(value) =>
                startTransition(() => {
                  onUpdateGeoJsonLayer(layer.id, {
                    opacity: value,
                  });
                })
              }
              size="sm"
              value={draftOpacity}
            />
          </Stack>
        </>
      ) : null}

      {(layer.type === 'flowmap' || layer.type === 'arc') &&
      source.type === 'flowmap-table' ? (
        <>
          <Text c="dimmed" fw={700} size="xs" tt="uppercase">
            Data setup
          </Text>
          <FlowmapSetupFields
            columns={source.columns}
            onChange={(patch) =>
              startTransition(() => {
                onUpdateFlowmapSource(source.id, patch);
              })
            }
            table={sourceTable}
          />
        </>
      ) : null}

      {layer.type === 'arc' ? (
        <>
          <Text c="dimmed" fw={700} size="xs" tt="uppercase">
            Visuals
          </Text>
          <Group align="end" grow>
            <Box>
              <Text c="dimmed" fw={500} mb={4} size="xs">
                Color
              </Text>
              <input
                aria-label={`Choose color for ${layer.name}`}
                onBlur={() => {
                  if (draftColor === layer.color) {
                    return;
                  }

                  startTransition(() => {
                    onUpdateArcLayer(layer.id, {
                      color: draftColor,
                    });
                  });
                }}
                onChange={(event) => setDraftColor(event.currentTarget.value)}
                style={{
                  width: '100%',
                  height: 36,
                  border: '1px solid var(--mantine-color-gray-4)',
                  borderRadius: 8,
                  background: 'transparent',
                  padding: 4,
                }}
                type="color"
                value={draftColor}
              />
            </Box>

            <Select
              data={[
                { label: 'Flow', value: 'flow' },
                { label: 'Line', value: 'line' },
              ]}
              label="List icon"
              onChange={(value) => {
                if (!value) {
                  return;
                }

                startTransition(() => {
                  onUpdateArcLayer(layer.id, {
                    icon: value as LayerGlyphIcon,
                  });
                });
              }}
              size="xs"
              value={layer.icon}
            />
          </Group>

          <Stack gap={4}>
            <Group justify="space-between">
              <Text c="dimmed" fw={500} size="xs">
                Width
              </Text>
              <Text c="dimmed" size="xs">
                {draftArcWidth}px
              </Text>
            </Group>
            <Slider
              max={12}
              min={1}
              onChange={setDraftArcWidth}
              onChangeEnd={(value) =>
                startTransition(() => {
                  onUpdateArcLayer(layer.id, {
                    width: value,
                  });
                })
              }
              size="sm"
              value={draftArcWidth}
            />
          </Stack>
        </>
      ) : null}

      {layer.type === 'flowmap' ? (
        <>
          <Text c="dimmed" fw={700} size="xs" tt="uppercase">
            Visuals
          </Text>
          <Select
            data={[
              { label: 'Curved', value: 'curved' },
              { label: 'Straight', value: 'straight' },
              {
                label: 'Animated straight',
                value: 'animated-straight',
              },
            ]}
            label="Render mode"
            onChange={(value) => {
              if (!value) {
                return;
              }

              startTransition(() => {
                onUpdateFlowmapLayer(layer.id, {
                  style: {
                    flowLinesRenderingMode:
                      value as FlowmapMapLayer['style']['flowLinesRenderingMode'],
                  },
                });
              });
            }}
            size="xs"
            value={layer.style.flowLinesRenderingMode}
          />

          <Stack gap={4}>
            <Group justify="space-between">
              <Text c="dimmed" fw={500} size="xs">
                Thickness scale
              </Text>
              <Text c="dimmed" size="xs">
                {draftThicknessScale.toFixed(1)}
              </Text>
            </Group>
            <Slider
              max={10}
              min={1}
              onChange={setDraftThicknessScale}
              onChangeEnd={(value) =>
                startTransition(() => {
                  onUpdateFlowmapLayer(layer.id, {
                    style: {
                      flowLineThicknessScale: value,
                    },
                  });
                })
              }
              step={0.5}
              value={draftThicknessScale}
            />
          </Stack>

          <Group grow>
            <Select
              data={[
                { label: 'Teal', value: 'Teal' },
                { label: 'Blue', value: 'Blue' },
                { label: 'Red', value: 'Red' },
                { label: 'Purp', value: 'Purp' },
              ]}
              label="Color scheme"
              onChange={(value) => {
                if (!value) {
                  return;
                }

                startTransition(() => {
                  onUpdateFlowmapLayer(layer.id, {
                    style: {
                      colorScheme: value,
                    },
                  });
                });
              }}
              size="xs"
              value={layer.style.colorScheme}
            />
            <Select
              data={[
                { label: 'Flow', value: 'flow' },
                { label: 'Line', value: 'line' },
                { label: 'Diamond', value: 'diamond' },
              ]}
              label="List icon"
              onChange={(value) => {
                if (!value) {
                  return;
                }

                startTransition(() => {
                  onUpdateFlowmapLayer(layer.id, {
                    icon: value as LayerGlyphIcon,
                  });
                });
              }}
              size="xs"
              value={layer.icon}
            />
          </Group>

          <Checkbox
            checked={layer.style.locationsEnabled}
            label="Show locations"
            onChange={(event) =>
              startTransition(() => {
                onUpdateFlowmapLayer(layer.id, {
                  style: {
                    locationsEnabled: event.currentTarget.checked,
                  },
                });
              })
            }
          />
          <Checkbox
            checked={layer.style.locationTotalsEnabled}
            label="Show totals"
            onChange={(event) =>
              startTransition(() => {
                onUpdateFlowmapLayer(layer.id, {
                  style: {
                    locationTotalsEnabled: event.currentTarget.checked,
                  },
                });
              })
            }
          />
          <Checkbox
            checked={layer.style.locationLabelsEnabled}
            label="Show labels"
            onChange={(event) =>
              startTransition(() => {
                onUpdateFlowmapLayer(layer.id, {
                  style: {
                    locationLabelsEnabled: event.currentTarget.checked,
                  },
                });
              })
            }
          />
          <Checkbox
            checked={layer.style.clusteringEnabled}
            label="Enable clustering"
            onChange={(event) =>
              startTransition(() => {
                onUpdateFlowmapLayer(layer.id, {
                  style: {
                    clusteringEnabled: event.currentTarget.checked,
                  },
                });
              })
            }
          />
          <Checkbox
            checked={layer.style.darkMode}
            label="Dark mode palette"
            onChange={(event) =>
              startTransition(() => {
                onUpdateFlowmapLayer(layer.id, {
                  style: {
                    darkMode: event.currentTarget.checked,
                  },
                });
              })
            }
          />
          <Stack gap={4}>
            <Group justify="space-between">
              <Text c="dimmed" fw={500} size="xs">
                Top flows
              </Text>
              <Text c="dimmed" size="xs">
                {draftTopFlows}
              </Text>
            </Group>
            <Slider
              max={2000}
              min={50}
              onChange={setDraftTopFlows}
              onChangeEnd={(value) =>
                startTransition(() => {
                  onUpdateFlowmapLayer(layer.id, {
                    style: {
                      maxTopFlowsDisplayNum: value,
                    },
                  });
                })
              }
              step={50}
              value={draftTopFlows}
            />
          </Stack>
        </>
      ) : null}
    </Stack>
  );
}

function DataInspector({
  connection,
  featureCreateRefreshToken,
  isLoadingTables,
  isLoadingTableMetadata,
  mapLayers = [],
  mapSources = [],
  onLocateFeature,
  selectedView,
  selectedTable,
  tablesError,
}: {
  connection: DatabaseConnection | null;
  featureCreateRefreshToken: number;
  isLoadingTables: boolean;
  isLoadingTableMetadata: boolean;
  mapLayers: MapLayer[];
  mapSources: MapSource[];
  onLocateFeature: (
    target: LocateTarget,
    row: InspectorRow,
    primaryKey: string[],
  ) => Promise<void>;
  selectedView: SavedTableView | null;
  selectedTable: InspectableTable | null;
  tablesError: string;
}) {
  const [savedViewOpened, savedViewModal] = useDisclosure(false);
  const [rowsState, setRowsState] = useState<InspectorRowsResponse | null>(
    null,
  );
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [rowsError, setRowsError] = useState('');
  const [rowsRefreshToken, setRowsRefreshToken] = useState(0);
  const [draftUpdates, setDraftUpdates] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [draftDeletes, setDraftDeletes] = useState<Record<string, true>>({});
  const [draftInserts, setDraftInserts] = useState<DraftInsertRow[]>([]);
  const [isSavingChanges, setIsSavingChanges] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [locatingRowToken, setLocatingRowToken] = useState<string | null>(null);
  const [locateError, setLocateError] = useState('');
  const [selectedGridRowId, setSelectedGridRowId] = useState<string | null>(
    null,
  );
  const [relationLabels, setRelationLabels] = useState<
    Record<string, Record<string, RelationOption>>
  >({});
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [activeSavedViewId, setActiveSavedViewId] = useState<string | null>(
    null,
  );
  const [editingSavedView, setEditingSavedView] =
    useState<SavedTableView | null>(null);
  const deferredSearchInput = useDeferredValue(searchInput);
  const savedTableViews = useConnectionStore((state) => state.savedTableViews);
  const addSavedTableView = useConnectionStore(
    (state) => state.addSavedTableView,
  );
  const updateSavedTableView = useConnectionStore(
    (state) => state.updateSavedTableView,
  );
  const removeSavedTableView = useConnectionStore(
    (state) => state.removeSavedTableView,
  );
  const refreshGeoJsonSourcesForTable = useConnectionStore(
    (state) => state.refreshGeoJsonSourcesForTable,
  );
  const relationDisplayByKey = useConnectionStore(
    (state) => state.relationDisplayByKey,
  );
  const setRelationDisplayConfig = useConnectionStore(
    (state) => state.setRelationDisplayConfig,
  );
  const tableDisplayByKey = useConnectionStore(
    (state) => state.tableDisplayByKey,
  );
  const setTableDisplayConfig = useConnectionStore(
    (state) => state.setTableDisplayConfig,
  );

  const matchingSavedViews = useMemo(
    () =>
      savedTableViews.filter(
        (view) =>
          view.connectionId === connection?.id &&
          view.sourceSchema === selectedTable?.schema &&
          view.sourceTable === selectedTable?.name,
      ),
    [
      connection?.id,
      savedTableViews,
      selectedTable?.name,
      selectedTable?.schema,
    ],
  );
  const selectedViewFromList =
    matchingSavedViews.find((view) => view.id === selectedView?.id) ?? null;
  const activeSavedView =
    selectedViewFromList ??
    matchingSavedViews.find((view) => view.id === activeSavedViewId) ??
    null;
  const locateTargets = useMemo(() => {
    if (!selectedTable) {
      return [];
    }

    const targets = mapLayers.flatMap<LocateTarget>((layer) => {
      if (!layer.visible) {
        return [];
      }

      if (layer.type === 'geojson') {
        const source = mapSources.find(
          (candidate): candidate is GeoJsonTableSource =>
            candidate.id === layer.sourceId &&
            candidate.type === 'geojson-table' &&
            (candidate.sourceViewId === activeSavedView?.id ||
              (candidate.schema === selectedTable.schema &&
                candidate.table === selectedTable.name)),
        );

        return source ? [{ kind: 'geojson', layer, source }] : [];
      }

      if (layer.type === 'flowmap' || layer.type === 'arc') {
        const source = mapSources.find(
          (candidate): candidate is FlowmapTableSource =>
            candidate.id === layer.sourceId &&
            candidate.type === 'flowmap-table' &&
            candidate.schema === selectedTable.schema &&
            candidate.table === selectedTable.name,
        );

        return source ? [{ kind: 'flowmap', layer, source }] : [];
      }

      return [];
    });

    return targets.sort((left, right) => {
      if (left.kind !== 'geojson' || right.kind !== 'geojson') {
        return left.kind === right.kind ? 0 : left.kind === 'flowmap' ? -1 : 1;
      }

      const leftMatchesView = left.source.sourceViewId === activeSavedView?.id;
      const rightMatchesView =
        right.source.sourceViewId === activeSavedView?.id;
      if (leftMatchesView === rightMatchesView) {
        return 0;
      }

      return leftMatchesView ? -1 : 1;
    });
  }, [activeSavedView?.id, mapLayers, mapSources, selectedTable]);
  const activeTableFilter = activeSavedView?.filter ?? null;
  const canCreateSavedView = Boolean(
    selectedTable?.columns.some((column) => isEditableColumnType(column.type)),
  );
  const activePrimaryKey =
    rowsState?.primaryKey ?? selectedTable?.primaryKey ?? [];
  const foreignKeyByColumn = useMemo(
    () =>
      new Map(
        (selectedTable?.foreignKeys ?? []).map((foreignKey) => [
          foreignKey.columnName,
          foreignKey,
        ]),
      ),
    [selectedTable?.foreignKeys],
  );
  const relationConfigByColumn = useMemo(() => {
    if (!connection || !selectedTable) {
      return new Map<string, string[]>();
    }

    return new Map(
      (selectedTable.foreignKeys ?? []).map((foreignKey) => {
        const key = relationDisplayKey(
          connection.id,
          selectedTable,
          foreignKey,
        );
        const configuredColumns = relationDisplayByKey[key]?.labelColumns;
        return [
          foreignKey.columnName,
          configuredColumns && configuredColumns.length > 0
            ? configuredColumns
            : foreignKey.defaultLabelColumn
              ? [foreignKey.defaultLabelColumn]
              : [],
        ] as const;
      }),
    );
  }, [connection, relationDisplayByKey, selectedTable]);
  const tableDisplayKeyValue =
    connection && selectedTable
      ? tableDisplayKey(connection.id, selectedTable)
      : null;
  const tableDisplayConfig: TableDisplayConfig = tableDisplayKeyValue
    ? (tableDisplayByKey[tableDisplayKeyValue] ?? {
        tableAlias: '',
        columnLabels: {},
        hiddenColumns: [],
      })
    : {
        tableAlias: '',
        columnLabels: {},
        hiddenColumns: [],
      };
  const selectedTableAlias = tableDisplayConfig.tableAlias?.trim() || null;
  const columnVisibility = useMemo(
    () =>
      Object.fromEntries(
        (rowsState?.columns ?? []).map((column) => [
          column.name,
          !tableDisplayConfig.hiddenColumns.includes(column.name),
        ]),
      ),
    [rowsState?.columns, tableDisplayConfig.hiddenColumns],
  );
  const hasDirtyChanges =
    draftInserts.length > 0 ||
    Object.keys(draftUpdates).length > 0 ||
    Object.keys(draftDeletes).length > 0;
  const touchedRowCount =
    draftInserts.length +
    Object.keys(draftUpdates).length +
    Object.keys(draftDeletes).length;

  const resetDraftState = useCallback(() => {
    setDraftUpdates({});
    setDraftDeletes({});
    setDraftInserts([]);
    setSaveError('');
  }, []);

  const confirmDraftReset = useCallback(
    (actionLabel: string) => {
      if (!hasDirtyChanges) {
        return true;
      }

      return window.confirm(
        `Discard unsaved table changes before ${actionLabel}?`,
      );
    },
    [hasDirtyChanges],
  );

  useEffect(() => {
    const nextSearch = deferredSearchInput.trim();
    if (nextSearch === appliedSearch) {
      return;
    }

    if (!confirmDraftReset('changing search filter')) {
      setSearchInput(appliedSearch);
      return;
    }

    resetDraftState();
    setSaveMessage('');
    setAppliedSearch(nextSearch);
  }, [appliedSearch, confirmDraftReset, deferredSearchInput, resetDraftState]);

  useEffect(() => {
    if (
      activeSavedViewId &&
      !matchingSavedViews.some((view) => view.id === activeSavedViewId)
    ) {
      setActiveSavedViewId(null);
    }
  }, [activeSavedViewId, matchingSavedViews]);

  useEffect(() => {
    setActiveSavedViewId(selectedView?.id ?? null);
    setEditingSavedView(null);
  }, [selectedView?.id]);

  useEffect(() => {
    if (!connection || !selectedTable) {
      setRowsState(null);
      setRowsError('');
      setDraftUpdates({});
      setDraftDeletes({});
      setDraftInserts([]);
      setSaveError('');
      setSaveMessage('');
      return;
    }

    const activeConnection = connection;
    const activeTable = selectedTable;
    const featureRefreshVersion = featureCreateRefreshToken;
    const refreshVersion = rowsRefreshToken;
    let isActive = true;

    void featureRefreshVersion;
    void refreshVersion;

    async function loadRows(offset: number) {
      setIsLoadingRows(true);
      setRowsError('');

      try {
        const payload = await fetchInspectorRows(
          activeConnection,
          activeTable,
          offset,
          pageSize,
          appliedSearch,
          activeTableFilter,
        );

        if (!isActive) {
          return;
        }

        setRowsState(payload);
        setSaveError('');
      } catch (error) {
        if (!isActive) {
          return;
        }

        setRowsError(
          error instanceof Error ? error.message : 'Failed to load table rows.',
        );
      } finally {
        if (isActive) {
          setIsLoadingRows(false);
        }
      }
    }

    void loadRows(0);

    return () => {
      isActive = false;
    };
  }, [
    activeTableFilter,
    appliedSearch,
    connection,
    featureCreateRefreshToken,
    rowsRefreshToken,
    selectedTable,
  ]);

  useEffect(() => {
    if (!connection || !selectedTable || !rowsState) {
      setRelationLabels({});
      return;
    }

    const activeConnection = connection;
    const activeTable = selectedTable;
    const activeRowsState = rowsState;
    const foreignKeys = selectedTable.foreignKeys ?? [];
    if (foreignKeys.length === 0) {
      setRelationLabels({});
      return;
    }

    let isActive = true;

    async function loadRelationLabels() {
      const entries = await Promise.all(
        foreignKeys.map(async (foreignKey) => {
          const values = Array.from(
            new Set(
              activeRowsState.rows
                .map((row) => row.values[foreignKey.columnName])
                .filter((value) => value !== null && value !== undefined)
                .map((value) => JSON.stringify(value)),
            ),
          ).map((value) => JSON.parse(value) as unknown);
          if (values.length === 0) {
            return [foreignKey.columnName, {}] as const;
          }

          const options = await fetchRelationLabels(activeConnection, {
            schema: activeTable.schema,
            table: activeTable.name,
            column: foreignKey.columnName,
            labelColumns:
              relationConfigByColumn.get(foreignKey.columnName) ?? [],
            values,
          });

          return [
            foreignKey.columnName,
            Object.fromEntries(
              options.map((option) => [String(option.value), option]),
            ),
          ] as const;
        }),
      );

      if (!isActive) {
        return;
      }

      setRelationLabels(Object.fromEntries(entries));
    }

    void loadRelationLabels().catch(() => {
      if (isActive) {
        setRelationLabels({});
      }
    });

    return () => {
      isActive = false;
    };
  }, [connection, relationConfigByColumn, rowsState, selectedTable]);

  async function handlePageChange(nextOffset: number) {
    if (!connection || !selectedTable) {
      return;
    }

    if (!confirmDraftReset(`changing to offset ${nextOffset}`)) {
      return;
    }

    resetDraftState();
    setSaveMessage('');

    setIsLoadingRows(true);
    setRowsError('');

    try {
      const payload = await fetchInspectorRows(
        connection,
        selectedTable,
        nextOffset,
        pageSize,
        appliedSearch,
        activeTableFilter,
      );
      setRowsState(payload);
    } catch (error) {
      setRowsError(
        error instanceof Error ? error.message : 'Failed to load table rows.',
      );
    } finally {
      setIsLoadingRows(false);
    }
  }

  function handleRefreshRows() {
    if (!confirmDraftReset('refreshing rows')) {
      return;
    }

    resetDraftState();
    setSaveMessage('');
    startTransition(() => {
      setRowsRefreshToken((value) => value + 1);
    });
  }

  function handleAddDraftRow() {
    if (!rowsState) {
      return;
    }

    setDraftInserts((current) => [
      createEmptyInsertRow(
        rowsState.columns.filter((column) => isEditableColumnType(column.type)),
      ),
      ...current,
    ]);
    setSaveMessage('');
  }

  const handleDraftInsertChange = useCallback(
    (draftId: string, column: InspectorColumn, nextValue: unknown) => {
      setDraftInserts((current) =>
        current.map((draftRow) =>
          draftRow.id === draftId
            ? {
                ...draftRow,
                values: {
                  ...draftRow.values,
                  [column.name]: normalizeEditorValue(column.type, nextValue),
                },
              }
            : draftRow,
        ),
      );
      setSaveMessage('');
    },
    [],
  );

  const handleExistingCellChange = useCallback(
    (row: InspectorRow, column: InspectorColumn, nextValue: unknown) => {
      const rowToken = serializeRowKey(row.rowKey, activePrimaryKey);
      if (!rowToken || draftDeletes[rowToken]) {
        return;
      }

      const baseValue = row.values[column.name];
      const normalizedValue = normalizeEditorValue(column.type, nextValue);

      setDraftUpdates((current) => {
        const currentRowPatch = current[rowToken] ?? {};
        const nextRowPatch = {
          ...currentRowPatch,
        };

        if (areEditorValuesEqual(baseValue, normalizedValue)) {
          delete nextRowPatch[column.name];
        } else {
          nextRowPatch[column.name] = normalizedValue;
        }

        if (Object.keys(nextRowPatch).length === 0) {
          const { [rowToken]: _removed, ...rest } = current;
          return rest;
        }

        return {
          ...current,
          [rowToken]: nextRowPatch,
        };
      });
      setSaveMessage('');
    },
    [activePrimaryKey, draftDeletes],
  );

  function handleToggleDeleteExistingRow(row: InspectorRow) {
    const rowToken = serializeRowKey(row.rowKey, activePrimaryKey);
    if (!rowToken) {
      return;
    }

    setDraftDeletes((current) => {
      if (current[rowToken]) {
        const { [rowToken]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [rowToken]: true,
      };
    });
    setDraftUpdates((current) => {
      const { [rowToken]: _removed, ...rest } = current;
      return rest;
    });
    setSaveMessage('');
  }

  function handleRemoveDraftInsertRow(draftId: string) {
    setDraftInserts((current) =>
      current.filter((draftRow) => draftRow.id !== draftId),
    );
    setSaveMessage('');
  }

  async function handleSaveChanges() {
    if (!connection || !selectedTable || !rowsState || !hasDirtyChanges) {
      return;
    }

    const operations: TableChangeOperation[] = [];

    for (const draftRow of draftInserts) {
      operations.push({
        type: 'insert',
        values: draftRow.values,
      });
    }

    for (const row of rowsState.rows) {
      const rowToken = serializeRowKey(row.rowKey, rowsState.primaryKey);
      if (!rowToken) {
        continue;
      }

      if (draftDeletes[rowToken]) {
        operations.push({
          type: 'delete',
          rowKey: row.rowKey ?? undefined,
        });
        continue;
      }

      if (draftUpdates[rowToken]) {
        operations.push({
          type: 'update',
          rowKey: row.rowKey ?? undefined,
          changes: draftUpdates[rowToken],
        });
      }
    }

    if (operations.length === 0) {
      return;
    }

    setIsSavingChanges(true);
    setSaveError('');
    setSaveMessage('');

    try {
      const payload = await commitInspectorRows(connection, {
        schema: selectedTable.schema,
        table: selectedTable.name,
        operations,
      });

      resetDraftState();
      setSaveMessage(
        `Saved ${payload.applied} change${payload.applied === 1 ? '' : 's'}.`,
      );
      refreshGeoJsonSourcesForTable({
        connectionId: connection.id,
        schema: selectedTable.schema,
        table: selectedTable.name,
      });
      startTransition(() => {
        setRowsRefreshToken((value) => value + 1);
      });
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Failed to save table changes.',
      );
    } finally {
      setIsSavingChanges(false);
    }
  }

  function handleDiscardChanges() {
    if (!hasDirtyChanges) {
      return;
    }

    if (!window.confirm('Discard all unsaved table changes?')) {
      return;
    }

    resetDraftState();
    setSaveMessage('');
  }

  function handleTableDisplayConfigChange(nextConfig: TableDisplayConfig) {
    if (!connection || !selectedTable || !tableDisplayKeyValue) {
      return;
    }

    setTableDisplayConfig(tableDisplayKeyValue, nextConfig);
    void saveTableDisplayConfig(connection, {
      schema: selectedTable.schema,
      table: selectedTable.name,
      config: nextConfig,
    }).catch((error) => {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Failed to save table display settings.',
      );
    });
  }

  async function handleLocateRow(row: InspectorRow) {
    if (!row.rowKey || locateTargets.length === 0) {
      return;
    }

    const rowToken = serializeRowKey(row.rowKey, activePrimaryKey);
    setLocatingRowToken(rowToken);
    setLocateError('');

    try {
      await onLocateFeature(locateTargets[0], row, activePrimaryKey);
    } catch (error) {
      setLocateError(
        error instanceof Error ? error.message : 'Failed to locate row.',
      );
    } finally {
      setLocatingRowToken(null);
    }
  }

  function handleOpenSavedViewModal() {
    setEditingSavedView(null);
    savedViewModal.open();
  }

  function handleOpenEditSavedViewModal(view: SavedTableView) {
    setEditingSavedView(view);
    savedViewModal.open();
  }

  function handleCloseSavedViewModal() {
    setEditingSavedView(null);
    savedViewModal.close();
  }

  function handleSaveView(payload: {
    viewId: string | null;
    name: string;
    filter: TableFilterDefinition;
  }) {
    if (!connection || !selectedTable) {
      return;
    }

    if (payload.viewId) {
      updateSavedTableView(payload.viewId, {
        name: payload.name,
        filter: payload.filter,
      });
    } else {
      addSavedTableView({
        name: payload.name,
        connectionId: connection.id,
        sourceSchema: selectedTable.schema,
        sourceTable: selectedTable.name,
        filter: payload.filter,
      });
    }

    setEditingSavedView(null);
    savedViewModal.close();
  }

  function handleRemoveActiveSavedView() {
    if (!activeSavedView) {
      return;
    }

    if (!window.confirm(`Delete saved view "${activeSavedView.name}"?`)) {
      return;
    }

    if (activeSavedView.id === activeSavedViewId) {
      setActiveSavedViewId(null);
    }

    removeSavedTableView(activeSavedView.id);
  }

  const inspectorGridRows = useMemo<InspectorGridRow[]>(() => {
    if (!rowsState) {
      return [];
    }

    const draftRows: InspectorGridRow[] = draftInserts.map((draftRow) => ({
      id: `draft:${draftRow.id}`,
      kind: 'draft',
      draftRow,
      row: null,
      rowPatch: undefined,
      rowToken: null,
      values: draftRow.values,
      isDeleted: false,
    }));

    const recordRows = rowsState.rows.map<InspectorGridRow>((row) => {
      const rowToken = serializeRowKey(row.rowKey, rowsState.primaryKey);
      const rowPatch = rowToken ? draftUpdates[rowToken] : undefined;

      return {
        id:
          rowToken ??
          JSON.stringify([rowsState.offset, rowsState.primaryKey, row.values]),
        kind: 'record',
        draftRow: null,
        row,
        rowPatch,
        rowToken,
        values: {
          ...row.values,
          ...(rowPatch ?? {}),
        },
        isDeleted: rowToken ? Boolean(draftDeletes[rowToken]) : false,
      };
    });

    return [...draftRows, ...recordRows];
  }, [draftDeletes, draftInserts, draftUpdates, rowsState]);
  const selectedGridRow =
    inspectorGridRows.find((gridRow) => gridRow.id === selectedGridRowId) ??
    null;

  const inspectorColumns = useMemo<MRT_ColumnDef<InspectorGridRow>[]>(
    () =>
      (rowsState?.columns ?? []).map((column) => {
        const foreignKey = foreignKeyByColumn.get(column.name);
        const isPrimaryKey = activePrimaryKey.includes(column.name);
        const columnLabel =
          tableDisplayConfig.columnLabels[column.name]?.trim() || column.name;

        return {
          id: column.name,
          accessorFn: (gridRow) => gridRow.values[column.name],
          header: columnLabel,
          Header: () => (
            <Stack gap={4}>
              <Group gap={4} wrap="nowrap">
                <Text fw={600} size="sm">
                  {columnLabel}
                </Text>
                {isPrimaryKey ? (
                  <Badge color="blue" size="xs" variant="light">
                    PK
                  </Badge>
                ) : null}
                {foreignKey ? (
                  <Badge color="grape" size="xs" variant="light">
                    FK
                  </Badge>
                ) : null}
              </Group>
              <Text c="dimmed" size="xs">
                {column.type}
              </Text>
            </Stack>
          ),
          Cell: ({ row }) => {
            const gridRow = row.original;
            const displayValue = gridRow.values[column.name];
            const relationOption =
              foreignKey && displayValue !== null && displayValue !== undefined
                ? relationLabels[column.name]?.[relationValueKey(displayValue)]
                : undefined;

            return (
              <RelationCellValue
                isDeleted={gridRow.isDeleted}
                option={relationOption}
                value={displayValue}
              />
            );
          },
          enableEditing: false,
          mantineTableBodyCellProps: {
            style: {
              fontFamily: getCellFontFamily(column.name, column.type),
              textAlign: getCellTextAlign(column.type),
              verticalAlign: 'top',
            },
          },
          mantineTableHeadCellProps: {
            style: {
              minHeight: 54,
              overflow: 'hidden',
            },
          },
          size: foreignKey ? 240 : 180,
        } satisfies MRT_ColumnDef<InspectorGridRow>;
      }),
    [
      activePrimaryKey,
      foreignKeyByColumn,
      relationLabels,
      rowsState?.columns,
      tableDisplayConfig.columnLabels,
    ],
  );

  const inspectorTable = useMantineReactTable<InspectorGridRow>({
    columns: inspectorColumns,
    data: inspectorGridRows,
    enableBottomToolbar: false,
    enableColumnActions: false,
    enableColumnOrdering: true,
    enableColumnPinning: true,
    enableColumnResizing: true,
    enableColumnVirtualization: false,
    enableDensityToggle: true,
    enableEditing: false,
    enableGlobalFilter: true,
    enablePagination: false,
    enableRowActions: true,
    enableRowVirtualization: true,
    enableStickyHeader: true,
    getRowId: (row) => row.id,
    initialState: {
      columnPinning: {
        left: ['mrt-row-actions'],
      },
      density: 'xs',
    },
    layoutMode: 'grid',
    mantinePaperProps: {
      style: {
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        minHeight: 0,
      },
    },
    mantineTableBodyRowProps: ({ row }) => ({
      onClick: () => setSelectedGridRowId(row.original.id),
      style: {
        background:
          row.original.id === selectedGridRowId
            ? 'rgba(34, 139, 230, 0.12)'
            : row.original.kind === 'draft'
              ? 'rgba(18, 184, 134, 0.08)'
              : row.original.isDeleted
                ? 'rgba(224, 49, 49, 0.08)'
                : row.original.rowPatch
                  ? 'rgba(250, 176, 5, 0.08)'
                  : undefined,
        cursor: 'pointer',
      },
    }),
    mantineTableContainerProps: {
      style: {
        flex: 1,
        height: '100%',
        minHeight: 0,
        overflow: 'auto',
      },
    },
    positionActionsColumn: 'first',
    renderRowActions: ({ row }) => {
      const gridRow = row.original;
      if (gridRow.kind === 'draft') {
        return (
          <Group gap={6} wrap="nowrap">
            <Badge color="teal" size="xs" variant="light">
              New
            </Badge>
            <ActionIcon
              aria-label="Remove new row"
              color="red"
              onClick={() => handleRemoveDraftInsertRow(gridRow.draftRow.id)}
              size="sm"
              variant="subtle"
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
        );
      }

      const canLocateRow =
        Boolean(gridRow.row.rowKey) && locateTargets.length > 0;

      return (
        <Group gap={6} wrap="nowrap">
          {gridRow.isDeleted ? (
            <Badge color="red" size="xs" variant="light">
              Delete
            </Badge>
          ) : gridRow.rowPatch ? (
            <Badge color="orange" size="xs" variant="light">
              Edit
            </Badge>
          ) : null}
          {rowsState?.isEditable && gridRow.row.rowKey ? (
            <ActionIcon
              aria-label={
                gridRow.isDeleted ? 'Restore row' : 'Mark row for delete'
              }
              color={gridRow.isDeleted ? 'gray' : 'red'}
              onClick={() => handleToggleDeleteExistingRow(gridRow.row)}
              size="sm"
              variant="subtle"
            >
              {gridRow.isDeleted ? (
                <IconRestore size={14} />
              ) : (
                <IconTrash size={14} />
              )}
            </ActionIcon>
          ) : null}
          {gridRow.row.rowKey ? (
            <ActionIcon
              aria-label="Locate row on map"
              color="blue"
              disabled={!canLocateRow}
              loading={
                Boolean(gridRow.rowToken) &&
                locatingRowToken === gridRow.rowToken
              }
              onClick={() => void handleLocateRow(gridRow.row)}
              size="sm"
              title={
                canLocateRow
                  ? `Locate in ${locateTargets[0].layer.name}`
                  : 'No visible geometry layer for this row'
              }
              variant="subtle"
            >
              <IconMapPin size={14} />
            </ActionIcon>
          ) : null}
        </Group>
      );
    },
    state: {
      columnVisibility,
      isLoading: isLoadingRows,
      showAlertBanner: Boolean(rowsError),
      showProgressBars: isLoadingRows,
    },
  });

  if (!connection) {
    return (
      <EmptyState
        detail="Select a connection to inspect table data."
        label="No Connection"
      />
    );
  }

  if (connection.testStatus !== 'success') {
    return (
      <EmptyState
        detail="Test selected connection first to load table data safely."
        label="Connection Not Ready"
      />
    );
  }

  return (
    <>
      <SavedViewModal
        onClose={handleCloseSavedViewModal}
        onSave={handleSaveView}
        opened={savedViewOpened}
        selectedTable={selectedTable}
        view={editingSavedView}
      />

      <Stack h="100%" gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" grow wrap="nowrap">
            <TextInput
              leftSection={<IconSearch size={14} />}
              onChange={(event) => setSearchInput(event.currentTarget.value)}
              placeholder="Search rows"
              disabled={!selectedTable}
              rightSection={
                searchInput ? (
                  <ActionIcon
                    aria-label="Clear search"
                    color="gray"
                    onClick={() => setSearchInput('')}
                    size="sm"
                    variant="subtle"
                  >
                    <IconX size={14} />
                  </ActionIcon>
                ) : null
              }
              value={searchInput}
            />
            {isLoadingTables || isLoadingTableMetadata ? (
              <Group gap={6} wrap="nowrap">
                <Loader size={14} />
                <Text c="dimmed" size="xs">
                  Loading catalog
                </Text>
              </Group>
            ) : null}
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Button
              disabled={!canCreateSavedView}
              leftSection={<IconPlus size={14} />}
              onClick={handleOpenSavedViewModal}
              size="compact-sm"
              variant="default"
            >
              View
            </Button>
            {selectedTable?.isEditable ? (
              <Button
                leftSection={<IconPlus size={14} />}
                onClick={handleAddDraftRow}
                size="compact-sm"
                variant="light"
              >
                Row
              </Button>
            ) : null}
            <Button
              disabled={!hasDirtyChanges || isSavingChanges}
              leftSection={<IconRestore size={14} />}
              onClick={handleDiscardChanges}
              size="compact-sm"
              variant="default"
            >
              Discard
            </Button>
            <Button
              disabled={!hasDirtyChanges || isSavingChanges}
              leftSection={
                isSavingChanges ? (
                  <Loader size={14} />
                ) : (
                  <IconDeviceFloppy size={14} />
                )
              }
              onClick={() => void handleSaveChanges()}
              size="compact-sm"
            >
              Save
            </Button>
            <ActionIcon
              aria-label="Refresh rows"
              onClick={handleRefreshRows}
              size="md"
              variant="subtle"
            >
              {isLoadingRows ? <Loader size={16} /> : <IconRefresh size={16} />}
            </ActionIcon>
          </Group>
        </Group>

        {activeSavedView ? (
          <Group justify="space-between" wrap="nowrap">
            <Badge color="grape" size="sm" variant="light">
              View: {activeSavedView.name}
            </Badge>
            <Group gap={4} wrap="nowrap">
              <ActionIcon
                aria-label="Edit active saved view"
                color="grape"
                onClick={() => handleOpenEditSavedViewModal(activeSavedView)}
                size="sm"
                variant="subtle"
              >
                <IconPencil size={14} />
              </ActionIcon>
              <ActionIcon
                aria-label="Delete active saved view"
                color="red"
                onClick={handleRemoveActiveSavedView}
                size="sm"
                variant="subtle"
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Group>
          </Group>
        ) : null}

        {tablesError ? (
          <Alert color="red" title="Table discovery failed" variant="light">
            {tablesError}
          </Alert>
        ) : null}

        {isLoadingTables ? (
          <Alert
            color="blue"
            icon={<Loader size={16} />}
            title="Discovering database tables"
            variant="light"
          >
            Remote databases can take a while while columns, primary keys,
            privileges, and geometry metadata are inspected.
          </Alert>
        ) : null}

        {isLoadingTableMetadata ? (
          <Alert
            color="blue"
            icon={<Loader size={16} />}
            title="Loading table metadata"
            variant="light"
          >
            Reading selected table columns, primary key, privileges, and
            geometry.
          </Alert>
        ) : null}

        {rowsError ? (
          <Text c="red" size="sm">
            {rowsError}
          </Text>
        ) : null}

        {saveError ? (
          <Alert color="red" title="Save failed" variant="light">
            {saveError}
          </Alert>
        ) : null}

        {saveMessage ? (
          <Alert color="teal" title="Draft committed" variant="light">
            {saveMessage}
          </Alert>
        ) : null}

        {locateError ? (
          <Alert color="orange" title="Locate failed" variant="light">
            {locateError}
          </Alert>
        ) : null}

        {!selectedTable && (isLoadingTables || isLoadingTableMetadata) ? (
          <Center
            style={{
              flex: 1,
              minHeight: 0,
            }}
          >
            <Stack align="center" gap="xs">
              <Loader size="sm" />
              <Text c="dimmed" size="sm">
                {isLoadingTableMetadata
                  ? 'Reading table metadata...'
                  : 'Reading table catalog...'}
              </Text>
            </Stack>
          </Center>
        ) : null}

        {!selectedTable && !isLoadingTables && !isLoadingTableMetadata ? (
          <EmptyState
            detail="Choose schemas from the selected connection catalog first."
            label="No Table Selected"
          />
        ) : null}

        {selectedTable && rowsState ? (
          <>
            <Group justify="space-between">
              <Group gap="xs">
                <Text c="dimmed" size="xs">
                  {selectedTableAlias ?? selectedTable.fullName}
                  {selectedTableAlias ? ` • ${selectedTable.fullName}` : ''} •{' '}
                  {selectedTable.kind} • rows{' '}
                  {rowsState.rows.length === 0 ? 0 : rowsState.offset + 1}-
                  {rowsState.offset + rowsState.rows.length} of{' '}
                  {formatRowCount(rowsState.totalRows)}
                </Text>
                {rowsState.primaryKey.length === 0 ? (
                  <Badge color="gray" size="sm" variant="outline">
                    No primary key
                  </Badge>
                ) : null}
                <Badge
                  color={rowsState.isEditable ? 'teal' : 'gray'}
                  size="sm"
                  variant="light"
                >
                  {rowsState.isEditable ? 'Editable draft' : 'Read only'}
                </Badge>
                {appliedSearch ? (
                  <Badge color="blue" size="sm" variant="light">
                    Search: {appliedSearch}
                  </Badge>
                ) : null}
                {activeSavedView ? (
                  <Badge color="grape" size="sm" variant="light">
                    View: {activeSavedView.name}
                  </Badge>
                ) : null}
              </Group>
              <Group gap="xs">
                {hasDirtyChanges ? (
                  <Badge color="orange" size="sm" variant="light">
                    {touchedRowCount} pending
                  </Badge>
                ) : null}
                <Text c="dimmed" size="xs">
                  page size {rowsState.limit}
                </Text>
                {isLoadingRows ? (
                  <Badge color="blue" size="sm" variant="light">
                    Loading rows
                  </Badge>
                ) : null}
              </Group>
            </Group>

            {!rowsState.isEditable ? (
              <Alert color="gray" variant="light">
                Editing enabled only for base tables with primary key and
                insert/update/delete privileges. Geometry cells stay read-only
                in this first pass.
              </Alert>
            ) : null}

            {tableDisplayKeyValue && rowsState.columns.length > 0 ? (
              <Menu
                closeOnItemClick={false}
                position="bottom-start"
                shadow="md"
              >
                <Menu.Target>
                  <Button size="compact-sm" variant="default">
                    Display
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <ScrollArea h={360} type="auto">
                    <Stack gap="xs" p="xs" w={360}>
                      <TextInput
                        label="Table alias"
                        onChange={(event) => {
                          handleTableDisplayConfigChange({
                            ...tableDisplayConfig,
                            tableAlias: event.currentTarget.value,
                          });
                        }}
                        placeholder={selectedTable.name}
                        size="xs"
                        value={tableDisplayConfig.tableAlias ?? ''}
                      />
                      {rowsState.columns.map((column) => {
                        const isHidden =
                          tableDisplayConfig.hiddenColumns.includes(
                            column.name,
                          );
                        const currentLabel =
                          tableDisplayConfig.columnLabels[column.name] ?? '';

                        return (
                          <Stack gap={4} key={column.name}>
                            <Checkbox
                              checked={!isHidden}
                              label={column.name}
                              onChange={(event) => {
                                if (!tableDisplayKeyValue) {
                                  return;
                                }

                                const nextHidden = event.currentTarget.checked
                                  ? tableDisplayConfig.hiddenColumns.filter(
                                      (columnName) =>
                                        columnName !== column.name,
                                    )
                                  : Array.from(
                                      new Set([
                                        ...tableDisplayConfig.hiddenColumns,
                                        column.name,
                                      ]),
                                    );
                                handleTableDisplayConfigChange({
                                  ...tableDisplayConfig,
                                  hiddenColumns: nextHidden,
                                });
                              }}
                              size="xs"
                            />
                            <TextInput
                              onChange={(event) => {
                                if (!tableDisplayKeyValue) {
                                  return;
                                }

                                const nextLabels = {
                                  ...tableDisplayConfig.columnLabels,
                                };
                                const nextValue = event.currentTarget.value;
                                if (nextValue.trim() === '') {
                                  delete nextLabels[column.name];
                                } else {
                                  nextLabels[column.name] = nextValue;
                                }

                                handleTableDisplayConfigChange({
                                  ...tableDisplayConfig,
                                  columnLabels: nextLabels,
                                });
                              }}
                              placeholder="Readable label"
                              size="xs"
                              value={currentLabel}
                            />
                          </Stack>
                        );
                      })}
                    </Stack>
                  </ScrollArea>
                </Menu.Dropdown>
              </Menu>
            ) : null}

            {connection &&
            selectedTable &&
            selectedTable.foreignKeys.length > 0 ? (
              <Group gap="xs">
                {selectedTable.foreignKeys.map((foreignKey) => {
                  const relationColumns =
                    relationConfigByColumn.get(foreignKey.columnName) ?? [];

                  return (
                    <Select
                      allowDeselect={false}
                      aria-label={`Relation label for ${foreignKey.columnName}`}
                      data={foreignKey.labelColumns.map((labelColumn) => ({
                        label: `${foreignKey.columnName}: ${labelColumn}`,
                        value: labelColumn,
                      }))}
                      disabled={foreignKey.labelColumns.length === 0}
                      key={foreignKey.columnName}
                      onChange={(value) => {
                        if (!value) {
                          return;
                        }

                        setRelationLabels((currentLabels) => {
                          const nextLabels = { ...currentLabels };
                          delete nextLabels[foreignKey.columnName];
                          return nextLabels;
                        });
                        setRelationDisplayConfig(
                          relationDisplayKey(
                            connection.id,
                            selectedTable,
                            foreignKey,
                          ),
                          { labelColumns: [value] },
                        );
                      }}
                      placeholder={`${foreignKey.columnName}: raw id`}
                      size="xs"
                      value={relationColumns[0] ?? null}
                      w={220}
                    />
                  );
                })}
              </Group>
            ) : null}

            {rowsState.rows.length === 0 && draftInserts.length === 0 ? (
              <EmptyState
                detail={
                  appliedSearch || activeSavedView
                    ? 'No rows match current search/view.'
                    : 'Selected page has no rows.'
                }
                label={
                  appliedSearch || activeSavedView ? 'No Matches' : 'No Rows'
                }
              />
            ) : (
              <Flex gap="sm" style={{ flex: 1, minHeight: 0 }}>
                <Box
                  style={{
                    flex: 1,
                    minHeight: 0,
                    minWidth: 0,
                  }}
                >
                  <MantineReactTable table={inspectorTable} />
                </Box>
                {connection && selectedTable && selectedGridRow ? (
                  <RecordEditorPanel
                    activePrimaryKey={activePrimaryKey}
                    connection={connection}
                    disabled={isSavingChanges}
                    foreignKeyByColumn={foreignKeyByColumn}
                    onChangeDraft={handleDraftInsertChange}
                    onChangeExisting={handleExistingCellChange}
                    onClose={() => setSelectedGridRowId(null)}
                    relationConfigByColumn={relationConfigByColumn}
                    relationLabels={relationLabels}
                    row={selectedGridRow}
                    selectedTable={selectedTable}
                    tableColumns={rowsState.columns}
                    tableIsEditable={rowsState.isEditable}
                  />
                ) : null}
              </Flex>
            )}

            <Group justify="space-between">
              <Button
                disabled={isLoadingRows || rowsState.offset === 0}
                onClick={() =>
                  void handlePageChange(
                    Math.max(rowsState.offset - pageSize, 0),
                  )
                }
                size="compact-sm"
                variant="light"
              >
                Previous
              </Button>
              <Text c="dimmed" size="xs">
                offset {rowsState.offset}
              </Text>
              <Button
                disabled={isLoadingRows || !rowsState.hasMore}
                onClick={() =>
                  void handlePageChange(rowsState.offset + pageSize)
                }
                size="compact-sm"
              >
                Next
              </Button>
            </Group>
          </>
        ) : null}

        {selectedTable && !rowsState && isLoadingRows ? (
          <Center
            style={{
              flex: 1,
              minHeight: 0,
            }}
          >
            <Stack align="center" gap="xs">
              <Loader size="sm" />
              <Text c="dimmed" size="sm">
                Loading first page from {selectedTable.fullName}...
              </Text>
            </Stack>
          </Center>
        ) : null}
      </Stack>
    </>
  );
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

interface GeometryPreviewEntry {
  label: string;
  type?: string;
  value: unknown;
}

type PreviewGeometry = {
  type: string;
  coordinates?: unknown;
  geometries?: PreviewGeometry[];
};

function GeometryMapPreviewList({
  basemapId,
  entries,
}: {
  basemapId: BasemapId;
  entries: GeometryPreviewEntry[];
}) {
  return (
    <Stack gap="xs">
      {entries.map((entry) => (
        <GeometryMapPreview
          basemapId={basemapId}
          entry={entry}
          key={entry.label}
        />
      ))}
    </Stack>
  );
}

function GeometryMapPreview({
  basemapId,
  entry,
}: {
  basemapId: BasemapId;
  entry: GeometryPreviewEntry;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const geometry = parsePreviewGeometry(entry.value);

  useEffect(() => {
    if (!containerRef.current || !geometry) {
      return;
    }

    const map = new maplibregl.Map({
      attributionControl: false,
      center: [0, 0],
      container: containerRef.current,
      cooperativeGestures: false,
      interactive: false,
      style: getBasemapStyle(basemapId),
      zoom: 1,
    });

    map.on('load', () => {
      const featureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry,
            properties: {},
          },
        ],
      } as GeoJSON.FeatureCollection;

      map.addSource('preview-geometry', {
        type: 'geojson',
        data: featureCollection,
      });
      map.addLayer({
        id: 'preview-fill',
        type: 'fill',
        source: 'preview-geometry',
        paint: {
          'fill-color': '#2f9e44',
          'fill-opacity': 0.26,
        },
      });
      map.addLayer({
        id: 'preview-line',
        type: 'line',
        source: 'preview-geometry',
        paint: {
          'line-color': '#2b8a3e',
          'line-width': 3,
        },
      });
      map.addLayer({
        id: 'preview-point',
        type: 'circle',
        source: 'preview-geometry',
        paint: {
          'circle-color': '#2f9e44',
          'circle-radius': 5,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });

      fitPreviewGeometry(map, geometry);
      map.resize();
    });

    return () => {
      map.remove();
    };
  }, [basemapId, geometry]);

  return (
    <Stack gap={4}>
      <Group gap="xs" wrap="nowrap">
        <Text fw={600} size="xs">
          {entry.label}
        </Text>
        {entry.type ? (
          <Badge color="gray" size="xs" variant="outline">
            {entry.type}
          </Badge>
        ) : null}
      </Group>
      {geometry ? (
        <Box
          ref={containerRef}
          style={{
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 6,
            height: 180,
            overflow: 'hidden',
          }}
        />
      ) : (
        <Center
          h={92}
          style={{
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 6,
          }}
        >
          <Text c="dimmed" size="xs">
            Geometry preview unavailable
          </Text>
        </Center>
      )}
    </Stack>
  );
}

function parsePreviewGeometry(value: unknown): PreviewGeometry | null {
  if (typeof value === 'string') {
    try {
      return parsePreviewGeometry(JSON.parse(value));
    } catch {
      return null;
    }
  }

  if (
    value === null ||
    typeof value !== 'object' ||
    !('type' in value) ||
    typeof value.type !== 'string'
  ) {
    return null;
  }

  if ('coordinates' in value || 'geometries' in value) {
    return value as PreviewGeometry;
  }

  return null;
}

function fitPreviewGeometry(map: maplibregl.Map, geometry: PreviewGeometry) {
  const positions = collectPreviewPositions(geometry);

  if (positions.length === 0) {
    return;
  }

  if (positions.length === 1) {
    map.setCenter(positions[0]);
    map.setZoom(14);
    return;
  }

  const bounds = positions.reduce(
    (nextBounds, position) => nextBounds.extend(position),
    new LngLatBounds(positions[0], positions[0]),
  );

  map.fitBounds(bounds, {
    duration: 0,
    maxZoom: 15,
    padding: 28,
  });
}

function collectPreviewPositions(
  geometry: PreviewGeometry,
): [number, number][] {
  if (geometry.type === 'GeometryCollection') {
    return (geometry.geometries ?? []).flatMap(collectPreviewPositions);
  }

  return collectPositionsFromCoordinates(geometry.coordinates);
}

function collectPositionsFromCoordinates(value: unknown): [number, number][] {
  if (!Array.isArray(value)) {
    return [];
  }

  if (
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  ) {
    return [[value[0], value[1]]];
  }

  return value.flatMap(collectPositionsFromCoordinates);
}

function relationDisplayKey(
  connectionId: string,
  table: InspectableTable,
  foreignKey: InspectorForeignKey,
) {
  return `${connectionId}:${table.schema}.${table.name}:${foreignKey.columnName}`;
}

function tableDisplayKey(connectionId: string, table: InspectableTable) {
  return tableDisplayKeyFromParts(connectionId, table.schema, table.name);
}

function tableDisplayKeyFromParts(
  connectionId: string,
  schema: string,
  table: string,
) {
  return `${connectionId}:${schema}.${table}`;
}

function relationValueKey(value: unknown) {
  return String(value);
}

function RecordEditorPanel({
  activePrimaryKey,
  connection,
  disabled,
  foreignKeyByColumn,
  onChangeDraft,
  onChangeExisting,
  onClose,
  relationConfigByColumn,
  relationLabels,
  row,
  selectedTable,
  tableColumns,
  tableIsEditable,
}: {
  activePrimaryKey: string[];
  connection: DatabaseConnection;
  disabled: boolean;
  foreignKeyByColumn: Map<string, InspectorForeignKey>;
  onChangeDraft: (
    draftId: string,
    column: InspectorColumn,
    nextValue: unknown,
  ) => void;
  onChangeExisting: (
    row: InspectorRow,
    column: InspectorColumn,
    nextValue: unknown,
  ) => void;
  onClose: () => void;
  relationConfigByColumn: Map<string, string[]>;
  relationLabels: Record<string, Record<string, RelationOption>>;
  row: InspectorGridRow;
  selectedTable: InspectableTable;
  tableColumns: InspectorColumn[];
  tableIsEditable: boolean;
}) {
  return (
    <Paper
      p="sm"
      radius="md"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        width: 340,
      }}
      withBorder
    >
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <div>
          <Text fw={700} size="sm">
            Record
          </Text>
          <Text c="dimmed" size="xs">
            {row.kind === 'draft' ? 'New row' : 'Selected row'}
          </Text>
        </div>
        <ActionIcon
          aria-label="Close record editor"
          onClick={onClose}
          size="sm"
          variant="subtle"
        >
          <IconX size={14} />
        </ActionIcon>
      </Group>

      {row.isDeleted ? (
        <Alert color="red" mb="xs" variant="light">
          Row is marked for delete.
        </Alert>
      ) : null}

      <ScrollArea
        offsetScrollbars
        scrollbarSize={8}
        style={{ flex: 1, minHeight: 0 }}
      >
        <Stack gap="xs">
          {tableColumns.map((column) => {
            const foreignKey = foreignKeyByColumn.get(column.name);
            const value = row.values[column.name];
            const relationOption =
              foreignKey && value !== null && value !== undefined
                ? relationLabels[column.name]?.[relationValueKey(value)]
                : undefined;
            const isPrimaryKey = activePrimaryKey.includes(column.name);
            const canEdit =
              row.kind === 'draft'
                ? isEditableColumnType(column.type)
                : tableIsEditable &&
                  Boolean(row.row?.rowKey) &&
                  isEditableColumnType(column.type) &&
                  !isPrimaryKey &&
                  !row.isDeleted;

            return (
              <Stack gap={4} key={column.name}>
                <Group gap={4} wrap="nowrap">
                  <Text fw={600} size="xs">
                    {column.name}
                  </Text>
                  {isPrimaryKey ? (
                    <Badge color="blue" size="xs" variant="light">
                      PK
                    </Badge>
                  ) : null}
                  {foreignKey ? (
                    <Badge color="grape" size="xs" variant="light">
                      FK
                    </Badge>
                  ) : null}
                </Group>
                {canEdit ? (
                  foreignKey ? (
                    <RelationCellEditor
                      connection={connection}
                      disabled={disabled}
                      foreignKey={foreignKey}
                      initialOption={relationOption}
                      labelColumns={
                        relationConfigByColumn.get(column.name) ?? []
                      }
                      onChange={(nextValue) => {
                        if (row.kind === 'draft') {
                          onChangeDraft(row.draftRow.id, column, nextValue);
                          return;
                        }

                        onChangeExisting(row.row, column, nextValue);
                      }}
                      selectedTable={selectedTable}
                      value={value}
                    />
                  ) : (
                    renderEditableCell({
                      column,
                      disabled,
                      onChange: (nextValue) => {
                        if (row.kind === 'draft') {
                          onChangeDraft(row.draftRow.id, column, nextValue);
                          return;
                        }

                        onChangeExisting(row.row, column, nextValue);
                      },
                      value,
                    })
                  )
                ) : (
                  <Box
                    style={{
                      border: '1px solid var(--mantine-color-default-border)',
                      borderRadius: 4,
                      padding: '5px 8px',
                    }}
                  >
                    <RelationCellValue
                      isDeleted={row.isDeleted}
                      option={relationOption}
                      value={value}
                    />
                  </Box>
                )}
              </Stack>
            );
          })}
        </Stack>
      </ScrollArea>
    </Paper>
  );
}

function RelationCellValue({
  isDeleted,
  option,
  value,
}: {
  isDeleted: boolean;
  option?: RelationOption;
  value: unknown;
}) {
  if (option) {
    return (
      <Stack
        gap={0}
        style={{
          opacity: isDeleted ? 0.55 : 1,
          textAlign: 'left',
          textDecoration: isDeleted ? 'line-through' : undefined,
        }}
      >
        <Text lineClamp={2} size="sm">
          {option.label}
        </Text>
        <Text c="dimmed" lineClamp={1} size="xs">
          {formatCellValue(value)}
        </Text>
      </Stack>
    );
  }

  return (
    <Text
      lineClamp={3}
      size="sm"
      style={{
        opacity: isDeleted ? 0.55 : 1,
        textDecoration: isDeleted ? 'line-through' : undefined,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {formatCellValue(value)}
    </Text>
  );
}

function RelationCellEditor({
  connection,
  disabled,
  foreignKey,
  initialOption,
  labelColumns,
  onChange,
  selectedTable,
  value,
}: {
  connection: DatabaseConnection;
  disabled?: boolean;
  foreignKey: InspectorForeignKey;
  initialOption?: RelationOption;
  labelColumns: string[];
  onChange: (value: unknown) => void;
  selectedTable: InspectableTable;
  value: unknown;
}) {
  const [search, setSearch] = useState('');
  const [shouldLoadOptions, setShouldLoadOptions] = useState(false);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [options, setOptions] = useState<RelationOption[]>(
    initialOption ? [initialOption] : [],
  );
  const currentValue =
    value === null || value === undefined ? null : relationValueKey(value);

  useEffect(() => {
    if (!shouldLoadOptions) {
      return;
    }

    let isActive = true;

    async function loadOptions() {
      setIsLoadingOptions(true);
      const nextOptions = await fetchRelationOptions(connection, {
        schema: selectedTable.schema,
        table: selectedTable.name,
        column: foreignKey.columnName,
        labelColumns,
        limit: 30,
        search,
      });

      if (!isActive) {
        return;
      }

      setOptions((currentOptions) => {
        const byValue = new Map<string, RelationOption>();
        for (const option of currentOptions) {
          byValue.set(relationValueKey(option.value), option);
        }
        for (const option of nextOptions) {
          byValue.set(relationValueKey(option.value), option);
        }
        if (initialOption) {
          byValue.set(relationValueKey(initialOption.value), initialOption);
        }
        return Array.from(byValue.values());
      });
    }

    void loadOptions()
      .catch(() => {
        if (isActive && initialOption) {
          setOptions([initialOption]);
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoadingOptions(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [
    connection,
    foreignKey.columnName,
    initialOption,
    labelColumns,
    search,
    selectedTable.name,
    selectedTable.schema,
    shouldLoadOptions,
  ]);

  const optionByValue = useMemo(() => {
    const byValue = new Map<string, RelationOption>();
    for (const option of options) {
      byValue.set(relationValueKey(option.value), option);
    }
    return byValue;
  }, [options]);
  const selectedOptionLabel = currentValue
    ? (optionByValue.get(currentValue)?.label ?? '')
    : '';

  const data = useMemo(
    () =>
      options.map((option) => ({
        label: option.label,
        value: relationValueKey(option.value),
      })),
    [options],
  );

  return (
    <Select
      clearable
      data={data}
      disabled={disabled}
      nothingFoundMessage={isLoadingOptions ? 'Loading...' : 'No records'}
      onChange={(nextValue) => {
        if (nextValue === null) {
          onChange(null);
          return;
        }

        onChange(optionByValue.get(nextValue)?.value ?? nextValue);
      }}
      onDropdownOpen={() => {
        setSearch('');
        setShouldLoadOptions(true);
      }}
      onFocus={() => {
        setSearch('');
        setShouldLoadOptions(true);
      }}
      onSearchChange={(nextSearch) => {
        if (nextSearch === selectedOptionLabel) {
          setSearch('');
          setShouldLoadOptions(true);
          return;
        }

        setSearch(nextSearch);
        setShouldLoadOptions(true);
      }}
      placeholder="Select related record"
      searchable
      searchValue={search}
      size="xs"
      styles={{
        input: {
          textAlign: 'left',
        },
      }}
      value={currentValue}
    />
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

function getFlowmapRowPoint(
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

function formatFlowmapPoint(point: [number, number]) {
  return `${point[1]}, ${point[0]}`;
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
  const selectedTableByConnectionId = useConnectionStore(
    (state) => state.selectedTableByConnectionId,
  );
  const setSelectedTable = useConnectionStore(
    (state) => state.setSelectedTable,
  );
  const addGeoJsonLayer = useConnectionStore((state) => state.addGeoJsonLayer);
  const addFlowmapLayer = useConnectionStore((state) => state.addFlowmapLayer);
  const addArcLayer = useConnectionStore((state) => state.addArcLayer);
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
  const refreshGeoJsonSourcesForTable = useConnectionStore(
    (state) => state.refreshGeoJsonSourcesForTable,
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
  const [selectedSchemaNames, setSelectedSchemaNames] = useState<string[]>([]);
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
  const selectedTableAlias =
    selectedConnectionId && selectedInspectableTable
      ? tableDisplayByKey[
          tableDisplayKey(selectedConnectionId, selectedInspectableTable)
        ]?.tableAlias?.trim()
      : '';
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

  async function loadCatalogSchemas() {
    if (!selectedConnection || selectedConnection.testStatus !== 'success') {
      return;
    }

    setIsLoadingSchemas(true);
    setCatalogError('');

    try {
      const nextSchemas = await fetchInspectableSchemas(selectedConnection);
      setSchemas(nextSchemas);
    } catch (error) {
      setCatalogError(
        error instanceof Error ? error.message : 'Failed to load schemas.',
      );
    } finally {
      setIsLoadingSchemas(false);
    }
  }

  async function loadSchemaTables(schemaName: string) {
    if (!selectedConnection || schemaTablesByName[schemaName]) {
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
  }

  function handleToggleCatalogSchema(schemaName: string) {
    setSelectedSchemaNames((current) => {
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

  function handleImportSelectedTable() {
    if (!selectedConnectionId || !selectedTableKey) {
      return;
    }

    if (
      !selectedInspectableTable ||
      selectedInspectableTable.geometryColumns.length === 0
    ) {
      return;
    }

    const geometryColumn = selectedInspectableTable.geometryColumns[0];

    addGeoJsonLayer({
      connectionId: selectedConnectionId,
      schema: selectedInspectableTable.schema,
      table: selectedInspectableTable.name,
      fullName: selectedInspectableTable.fullName,
      kind: selectedInspectableTable.kind,
      name:
        selectedSavedView?.name ??
        (selectedTableAlias || selectedInspectableTable.name),
      geometryColumn: geometryColumn.name,
      geometryType: geometryColumn.geometryType,
      filter: selectedSavedView?.filter ?? null,
      sourceViewId: selectedSavedView?.id ?? null,
    });
  }

  function handleCreateFlowLayer(payload: {
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
    if (!selectedConnectionId || !selectedInspectableTable) {
      return;
    }

    const layerPayload = {
      connectionId: selectedConnectionId,
      schema: selectedInspectableTable.schema,
      table: selectedInspectableTable.name,
      fullName: selectedInspectableTable.fullName,
      kind: selectedInspectableTable.kind,
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
  const selectedVisibleMapLayers = useMemo(
    () => selectedConnectionMapLayers.filter((layer) => layer.visible),
    [selectedConnectionMapLayers],
  );
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
    setSelectedSchemaNames([]);
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
      setSelectedSchemaNames([]);
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

  function handleFeatureCreated(source: GeoJsonTableSource) {
    refreshGeoJsonSourcesForTable({
      connectionId: source.connectionId,
      schema: source.schema,
      table: source.table,
    });

    setFeatureCreateRefreshToken((value) => value + 1);
  }

  async function handleOpenTable(tableKey: string) {
    const [schemaName] = tableKey.split('.');
    if (!schemaName) {
      handleSelectTable(tableKey);
      return;
    }

    if (!selectedSchemaNames.includes(schemaName)) {
      setSelectedSchemaNames((current) =>
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

  return (
    <Flex
      direction="column"
      h="100dvh"
      style={{
        overflow: 'hidden',
      }}
    >
      <Paper
        px="lg"
        py="sm"
        radius={0}
        shadow="xs"
        style={{
          borderBottom: '1px solid var(--mantine-color-default-border)',
        }}
      >
        <Flex align="center" justify="space-between">
          <div>
            <Title order={3}>Geopanel</Title>
          </div>
          <Group gap="sm" wrap="nowrap">
            <Select
              allowDeselect={false}
              aria-label="Basemap"
              data={basemapOptions}
              onChange={(value) => {
                if (!value) {
                  return;
                }

                setSelectedBasemap(value as BasemapId);
              }}
              size="xs"
              style={{ width: 132 }}
              value={selectedBasemapId ?? defaultBasemapId}
            />
            <LanguageSwitcher />
            <ColorSchemeToggle />
          </Group>
        </Flex>
      </Paper>

      <Box
        style={{
          flex: 1,
          minHeight: 0,
        }}
      >
        <Split
          style={{
            height: '100%',
            width: '100%',
          }}
        >
          <Split.Pane initialWidth={280} maxWidth={480} minWidth={0}>
            <PanelFrame title="Data & Layers">
              <ConnectionManager
                activeLayerId={activeLayerId}
                catalog={catalog}
                mapLayers={selectedConnectionMapLayers}
                mapSources={mapSources}
                onLoadSchemas={() => void loadCatalogSchemas()}
                onImportSelectedTable={handleImportSelectedTable}
                onCreateFlowLayer={handleCreateFlowLayer}
                onRemoveSavedView={handleRemoveSavedView}
                onSelectLayer={handleSelectLayer}
                onSelectCatalogTable={handleSelectTable}
                onSelectSavedView={handleSelectSavedView}
                onToggleCatalogSchema={handleToggleCatalogSchema}
                onToggleCatalogSchemaExpanded={
                  handleToggleCatalogSchemaExpanded
                }
                savedViews={selectedConnectionSavedViews}
                selectedInspectableTable={selectedInspectableTable}
                selectedTableKey={selectedTableKey}
                tables={metadataTables}
              />
            </PanelFrame>
          </Split.Pane>

          <Split.Resizer />

          <Split.Pane grow minWidth={0}>
            <Split
              orientation="horizontal"
              style={{
                height: '100%',
              }}
            >
              <Split.Pane grow minHeight={0}>
                <PanelFrame>
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
              </Split.Pane>

              <Split.Resizer />

              <Split.Pane initialHeight={260} minHeight={0}>
                <PanelFrame>
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
                    onLocateFeature={handleLocateFeature}
                    selectedView={selectedSavedView}
                    selectedTable={selectedInspectableTable}
                    tablesError={catalogError}
                  />
                </PanelFrame>
              </Split.Pane>
            </Split>
          </Split.Pane>

          <Split.Resizer />

          <Split.Pane initialWidth={340} maxWidth={520} minWidth={0}>
            <PanelFrame title="Workspace">
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
          </Split.Pane>
        </Split>
      </Box>
    </Flex>
  );
}
