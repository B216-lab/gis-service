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
  Modal,
  NumberInput,
  Paper,
  PasswordInput,
  ScrollArea,
  Select,
  Slider,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  useComputedColorScheme,
  useMantineColorScheme,
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
  IconEye,
  IconEyeOff,
  IconFolder,
  IconInfoCircle,
  IconLayersIntersect,
  IconMoonStars,
  IconPlug,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconRestore,
  IconRoute,
  IconSearch,
  IconSettings,
  IconSun,
  IconTable,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import {
  type ChangeEvent,
  type ReactNode,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useState,
} from 'react';

import {
  type DatabaseConnection,
  type FlowmapMapLayer,
  type FlowmapTableSource,
  type GeoJsonMapLayer,
  type LayerGlyphIcon,
  type MapLayer,
  type MapSource,
  useConnectionStore,
} from './features/connections/store';
import type {
  TableFilterCondition,
  TableFilterDefinition,
  TableFilterOperator,
} from './features/filters/types';
import {
  commitInspectorRows,
  fetchInspectableSchemas,
  fetchInspectableSchemaTables,
  fetchInspectorRows,
  fetchInspectorRowsByKey,
  fetchTableMetadata,
  type InspectableSchema,
  type InspectableTable,
  type InspectableTableSummary,
  type InspectorColumn,
  type InspectorLookupRowsResponse,
  type InspectorRow,
  type InspectorRowsResponse,
  type TableChangeOperation,
} from './features/inspector/api';
import {
  type BasemapId,
  basemapOptions,
  defaultBasemapId,
} from './features/map/basemaps';
import { MapPane } from './features/map/MapPane';
import type { MapSelection } from './features/map/selection';

const pageSize = 100;
const emptyCellLabel = 'NULL';

interface DraftInsertRow {
  id: string;
  values: Record<string, unknown>;
}

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

function getMapSelectionBadgeColor(objectType: MapSelection['objectType']) {
  switch (objectType) {
    case 'feature':
      return 'blue';
    case 'flow':
      return 'grape';
    case 'location':
      return 'teal';
    default:
      return 'gray';
  }
}

function formatMapSelectionObjectType(objectType: MapSelection['objectType']) {
  switch (objectType) {
    case 'feature':
      return 'Feature';
    case 'flow':
      return 'Flow';
    case 'location':
      return 'Location';
    default:
      return objectType;
  }
}

function formatMapSelectionCount(count: number) {
  return `${count} row${count === 1 ? '' : 's'}`;
}

function ColorSchemeToggle() {
  const computedColorScheme = useComputedColorScheme('light');
  const { setColorScheme } = useMantineColorScheme();

  const isDark = computedColorScheme === 'dark';

  return (
    <ActionIcon
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
      size="lg"
      variant="default"
    >
      {isDark ? <IconSun size={18} /> : <IconMoonStars size={18} />}
    </ActionIcon>
  );
}

function createDraftInsertId() {
  return `draft-${crypto.randomUUID()}`;
}

function serializeRowKey(
  rowKey: Record<string, unknown> | null,
  primaryKey: string[],
) {
  if (!rowKey || primaryKey.length === 0) {
    return null;
  }

  return JSON.stringify(
    primaryKey.map((columnName) => [columnName, rowKey[columnName]]),
  );
}

function createEmptyInsertRow(columns: InspectorColumn[]) {
  const values: Record<string, unknown> = {};

  for (const column of columns) {
    if (isBooleanColumnType(column.type)) {
      values[column.name] = false;
      continue;
    }

    values[column.name] = '';
  }

  return {
    id: createDraftInsertId(),
    values,
  } satisfies DraftInsertRow;
}

function findLayerSource(sources: MapSource[], layer: MapLayer) {
  return sources.find((source) => source.id === layer.sourceId) ?? null;
}

function formatFlowmapSourceColumns(columns: FlowmapTableSource['columns']) {
  const departure =
    columns.startMode === 'geometry'
      ? columns.startGeometry
      : `${columns.startLat}/${columns.startLon}`;
  const destination =
    columns.endMode === 'geometry'
      ? columns.endGeometry
      : `${columns.endLat}/${columns.endLon}`;
  const density = columns.magnitude || columns.defaultMagnitude;

  return `${departure} -> ${destination} • density ${density}`;
}

function findNumericColumnName(columns: InspectorColumn[], patterns: RegExp[]) {
  return (
    columns.find(
      (column) =>
        isNumericColumnType(column.type) &&
        patterns.some((pattern) => pattern.test(column.name)),
    )?.name ?? null
  );
}

function createFlowLayerDefaults(table: InspectableTable | null) {
  const columns = table?.columns ?? [];

  return {
    name: table ? `${table.name} flows` : 'Flow layer',
    startMode: 'coordinates',
    startLon: findNumericColumnName(columns, [
      /(start|origin|from).*(lon|lng|long|x)/i,
      /^src_?(lon|lng|long|x)$/i,
    ]),
    startLat: findNumericColumnName(columns, [
      /(start|origin|from).*(lat|y)/i,
      /^src_?(lat|y)$/i,
    ]),
    startGeometry: table?.geometryColumns[0]?.name ?? null,
    endMode: 'coordinates',
    endLon: findNumericColumnName(columns, [
      /(end|dest|to).*(lon|lng|long|x)/i,
      /^dst_?(lon|lng|long|x)$/i,
    ]),
    endLat: findNumericColumnName(columns, [
      /(end|dest|to).*(lat|y)/i,
      /^dst_?(lat|y)$/i,
    ]),
    endGeometry: table?.geometryColumns[0]?.name ?? null,
    magnitude: null,
    defaultMagnitude: 1,
  } satisfies FlowLayerFormState;
}

type FlowPointMode = 'coordinates' | 'geometry';

interface FlowLayerFormState {
  name: string;
  startMode: FlowPointMode;
  startLon: string | null;
  startLat: string | null;
  startGeometry: string | null;
  endMode: FlowPointMode;
  endLon: string | null;
  endLat: string | null;
  endGeometry: string | null;
  magnitude: string | null;
  defaultMagnitude: number;
}

function validateFlowLayerForm(
  form: FlowLayerFormState,
  table: InspectableTable | null,
) {
  const messages: string[] = [];
  const columnByName = new Map(
    (table?.columns ?? []).map((column) => [column.name, column]),
  );
  const numericFields: Array<[string, string | null]> = [];

  if (!table) {
    messages.push('Select a table with numeric coordinate columns first.');
    return messages;
  }

  if (!form.name.trim()) {
    messages.push('Layer name is required.');
  }

  if (!form.magnitude && form.defaultMagnitude <= 0) {
    messages.push('Default density must be greater than zero.');
  }

  if (form.startMode === 'geometry') {
    if (!form.startGeometry) {
      messages.push('Departure geometry column is required.');
    }
  } else {
    numericFields.push(
      ['Departure longitude', form.startLon],
      ['Departure latitude', form.startLat],
    );
  }

  if (form.endMode === 'geometry') {
    if (!form.endGeometry) {
      messages.push('Destination geometry column is required.');
    }
  } else {
    numericFields.push(
      ['Destination longitude', form.endLon],
      ['Destination latitude', form.endLat],
    );
  }

  for (const [label, columnName] of numericFields) {
    if (!columnName) {
      messages.push(`${label} column is required.`);
      continue;
    }

    const column = columnByName.get(columnName);
    if (!column || !isNumericColumnType(column.type)) {
      messages.push(`${label} must use a numeric column.`);
    }
  }

  return messages;
}

function PanelFrame({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <Paper
      h="100%"
      p="md"
      radius={0}
      shadow="xs"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <Flex align="center" justify="space-between" mb="md">
        <Title c="text" order={5} tt="uppercase">
          {title}
        </Title>
        <Text c="dimmed" fw={500} size="xs">
          {hint}
        </Text>
      </Flex>

      <Box
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {children}
      </Box>
    </Paper>
  );
}

function EmptyState({ label, detail }: { label: string; detail: string }) {
  return (
    <Center
      h="100%"
      style={{
        background: 'var(--mantine-color-default)',
        border: '1px dashed var(--mantine-color-default-border)',
        borderRadius: 'var(--mantine-radius-md)',
      }}
    >
      <Stack align="center" gap={6}>
        <Text fw={700} size="lg">
          {label}
        </Text>
        <Text c="dimmed" size="sm">
          {detail}
        </Text>
      </Stack>
    </Center>
  );
}

interface ConnectionFormState {
  name: string;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
}

const initialConnectionForm: ConnectionFormState = {
  name: '',
  host: '127.0.0.1',
  port: '5432',
  database: '',
  user: '',
  password: '',
};

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
  onToggleCatalogSchema,
  onToggleCatalogSchemaExpanded,
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
  onToggleCatalogSchema: (schemaName: string) => void;
  onToggleCatalogSchemaExpanded: (schemaName: string) => void;
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
  const selectedBasemapId = useConnectionStore(
    (state) => state.selectedBasemapId,
  );
  const setSelectedBasemap = useConnectionStore(
    (state) => state.setSelectedBasemap,
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
  const removeMapLayer = useConnectionStore((state) => state.removeMapLayer);

  const activeConnections = connections.filter(
    (connection) => connection.isActive,
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
  const flowValidationMessages = validateFlowLayerForm(
    flowLayerForm,
    selectedInspectableTable,
  );

  useEffect(() => {
    setFlowLayerForm(createFlowLayerDefaults(selectedInspectableTable));
    setFlowLayerError('');
  }, [selectedInspectableTable]);

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

  function handleOpenFlowLayerModal() {
    setFlowLayerForm(createFlowLayerDefaults(selectedInspectableTable));
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
        body: JSON.stringify({
          name: connection.name,
          host: connection.host,
          port: connection.port,
          database: connection.database,
          user: connection.user,
          password: connection.password,
        }),
      });

      const payload = (await response.json()) as
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
          };

      if (!response.ok || 'error' in payload) {
        const message =
          'error' in payload
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
              Saved locally. Real test runs through backend API.
            </Text>
            <Button onClick={handleSubmit}>Save connection</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        centered
        onClose={handleCloseFlowLayerModal}
        opened={flowLayerOpened}
        title="Create flow layer"
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
            <Text c="dimmed" size="xs">
              {activeConnections.length} active / {connections.length} saved
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

                      <ActionIcon
                        aria-label={`Delete ${connection.name}`}
                        color="red"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeConnection(connection.id);
                        }}
                        size="sm"
                        variant="subtle"
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>

                    <Text c="dimmed" size="xs">
                      {connection.host}:{connection.port} /{' '}
                      {connection.database}
                    </Text>

                    <Text c="dimmed" size="xs">
                      {connection.testMessage}
                    </Text>

                    {connection.testStatus === 'success' ? (
                      <Text c="dimmed" size="xs">
                        PostGIS {connection.postgisVersion}
                      </Text>
                    ) : null}

                    <Group gap="xs" justify="space-between" wrap="nowrap">
                      <Group gap={6}>
                        <Badge
                          color={
                            connection.testStatus === 'success'
                              ? 'green'
                              : connection.testStatus === 'error'
                                ? 'red'
                                : connection.testStatus === 'testing'
                                  ? 'yellow'
                                  : connection.isActive
                                    ? 'green'
                                    : 'gray'
                          }
                          radius="sm"
                          variant="light"
                        >
                          {connection.testStatus === 'success'
                            ? 'Connected'
                            : connection.testStatus === 'error'
                              ? 'Failed'
                              : connection.testStatus === 'testing'
                                ? 'Testing'
                                : connection.isActive
                                  ? 'Active'
                                  : 'Saved'}
                        </Badge>
                        {isSelected ? (
                          <Badge color="blue" radius="sm" variant="light">
                            Selected
                          </Badge>
                        ) : null}
                      </Group>

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

                    {isSelected && connection.testStatus === 'success' ? (
                      <ConnectionCatalog
                        catalog={catalog}
                        opened={catalogOpened}
                        selectedTableKey={selectedTableKey}
                        onLoadSchemas={onLoadSchemas}
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
          <Paper p="xs" radius="md" withBorder>
            <Stack gap={6}>
              <Text fw={700} size="sm">
                Basemap
              </Text>
              <Select
                allowDeselect={false}
                data={basemapOptions}
                onChange={(value) => {
                  if (!value) {
                    return;
                  }

                  setSelectedBasemap(value as BasemapId);
                }}
                size="xs"
                value={selectedBasemapId ?? defaultBasemapId}
              />
            </Stack>
          </Paper>

          <Group justify="space-between" wrap="nowrap">
            <div>
              <Text fw={700} size="sm">
                Map Layers
              </Text>
              <Text c="dimmed" size="xs">
                {mapLayers.length} layer
                {mapLayers.length === 1 ? '' : 's'}
              </Text>
            </div>
            <Group gap="xs" wrap="nowrap">
              <Button
                disabled={!canImportSelectedTable}
                onClick={onImportSelectedTable}
                size="compact-sm"
              >
                Import Layer
              </Button>
              <Button
                disabled={!canCreateFlowLayer}
                onClick={handleOpenFlowLayerModal}
                size="compact-sm"
                variant="light"
              >
                Create Flow
              </Button>
            </Group>
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
                            layer.type === 'geojson' ? layer.color : '#0c8599'
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
  opened,
  selectedTableKey,
  onLoadSchemas,
  onSelectTable,
  onToggle,
  onToggleSchema,
  onToggleSchemaExpanded,
}: {
  catalog: CatalogState;
  opened: boolean;
  selectedTableKey: string | null;
  onLoadSchemas: () => void;
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

                      {!isLoadingTables && tables.length === 0 ? (
                        <Text c="dimmed" size="xs">
                          No loaded tables.
                        </Text>
                      ) : null}

                      {tables.map((table) => (
                        <Button
                          key={table.fullName}
                          color={
                            selectedTableKey === table.fullName
                              ? 'blue'
                              : 'gray'
                          }
                          justify="flex-start"
                          leftSection={<IconTable size={14} />}
                          onClick={() => onSelectTable(table.fullName)}
                          size="compact-xs"
                          variant={
                            selectedTableKey === table.fullName
                              ? 'light'
                              : 'subtle'
                          }
                        >
                          {table.name}
                        </Button>
                      ))}
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
    layer.type === 'geojson' ? layer.color : '#0c8599',
  );
  const [draftOpacity, setDraftOpacity] = useState(
    layer.type === 'geojson' ? layer.opacity : 80,
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

      {layer.type === 'flowmap' ? (
        <>
          {source.type === 'flowmap-table' ? (
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
  isLoadingTables,
  isLoadingTableMetadata,
  selectedTable,
  tables,
  selectedTableKey,
  onSelectTable,
  tablesError,
}: {
  connection: DatabaseConnection | null;
  isLoadingTables: boolean;
  isLoadingTableMetadata: boolean;
  selectedTable: InspectableTable | null;
  tables: InspectableTableSummary[];
  selectedTableKey: string | null;
  onSelectTable: (tableKey: string | null) => void;
  tablesError: string;
}) {
  const [savedFilterOpened, savedFilterModal] = useDisclosure(false);
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
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [activeSavedFilterId, setActiveSavedFilterId] = useState<string | null>(
    null,
  );
  const [draftFilterName, setDraftFilterName] = useState('');
  const [draftFilterCondition, setDraftFilterCondition] =
    useState<TableFilterCondition>(() =>
      createDefaultTableFilterCondition(selectedTable),
    );
  const deferredSearchInput = useDeferredValue(searchInput);
  const savedTableFilters = useConnectionStore(
    (state) => state.savedTableFilters,
  );
  const addSavedTableFilter = useConnectionStore(
    (state) => state.addSavedTableFilter,
  );
  const removeSavedTableFilter = useConnectionStore(
    (state) => state.removeSavedTableFilter,
  );

  const matchingSavedFilters = savedTableFilters.filter(
    (filter) =>
      filter.connectionId === connection?.id &&
      filter.schema === selectedTable?.schema &&
      filter.table === selectedTable?.name,
  );
  const activeSavedFilter =
    matchingSavedFilters.find((filter) => filter.id === activeSavedFilterId) ??
    null;
  const activeTableFilter = activeSavedFilter?.filter ?? null;
  const filterableColumnOptions = (selectedTable?.columns ?? [])
    .filter((column) => isEditableColumnType(column.type))
    .map((column) => ({
      label: `${column.name} (${column.type})`,
      value: column.name,
    }));

  const activePrimaryKey =
    rowsState?.primaryKey ?? selectedTable?.primaryKey ?? [];
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

  const resetSavedFilterDraft = useCallback(() => {
    setDraftFilterName('');
    setDraftFilterCondition(createDefaultTableFilterCondition(selectedTable));
  }, [selectedTable]);

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
      activeSavedFilterId &&
      !matchingSavedFilters.some((filter) => filter.id === activeSavedFilterId)
    ) {
      setActiveSavedFilterId(null);
    }
  }, [activeSavedFilterId, matchingSavedFilters]);

  useEffect(() => {
    setActiveSavedFilterId(null);
    resetSavedFilterDraft();
  }, [resetSavedFilterDraft]);

  useEffect(() => {
    if (!selectedTableKey && tables.length > 0) {
      onSelectTable(tables[0].fullName);
      return;
    }

    if (
      selectedTableKey &&
      !tables.some((table) => table.fullName === selectedTableKey)
    ) {
      onSelectTable(tables[0]?.fullName ?? null);
    }
  }, [onSelectTable, selectedTableKey, tables]);

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
    const refreshVersion = rowsRefreshToken;
    let isActive = true;

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
    rowsRefreshToken,
    selectedTable,
  ]);

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

  function handleSelectTableChange(nextTableKey: string | null) {
    if (nextTableKey === selectedTableKey) {
      return;
    }

    if (!confirmDraftReset('switching table')) {
      return;
    }

    resetDraftState();
    setSaveMessage('');
    onSelectTable(nextTableKey);
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

  function handleDraftInsertChange(
    draftId: string,
    column: InspectorColumn,
    nextValue: unknown,
  ) {
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
  }

  function handleExistingCellChange(
    row: InspectorRow,
    column: InspectorColumn,
    nextValue: unknown,
  ) {
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
  }

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

  function handleOpenSavedFilterModal() {
    resetSavedFilterDraft();
    savedFilterModal.open();
  }

  function handleCreateSavedFilter() {
    if (!connection || !selectedTable) {
      return;
    }

    const nextName = draftFilterName.trim();
    const nextColumn = draftFilterCondition.column.trim();
    const nextOperator = draftFilterCondition.operator;
    const nextRawValue = (draftFilterCondition.value ?? '').trim();
    const nextValues =
      nextOperator === 'in'
        ? (draftFilterCondition.values ?? []).filter(Boolean)
        : [];

    if (!nextName || !nextColumn) {
      return;
    }

    if (nextOperator === 'eq' && !nextRawValue) {
      return;
    }

    if (nextOperator === 'in' && nextValues.length === 0) {
      return;
    }

    addSavedTableFilter({
      name: nextName,
      connectionId: connection.id,
      schema: selectedTable.schema,
      table: selectedTable.name,
      filter: buildTableFilterDefinition({
        column: nextColumn,
        operator: nextOperator,
        value: nextRawValue,
        values: nextValues,
      }),
    });

    resetSavedFilterDraft();
    savedFilterModal.close();
  }

  function handleSelectSavedFilter(nextFilterId: string | null) {
    if (nextFilterId === activeSavedFilterId) {
      return;
    }

    if (
      nextFilterId !== activeSavedFilterId &&
      !confirmDraftReset('changing saved filter')
    ) {
      return;
    }

    resetDraftState();
    setSaveMessage('');
    setActiveSavedFilterId(nextFilterId);
  }

  function handleRemoveActiveSavedFilter() {
    if (!activeSavedFilter) {
      return;
    }

    if (!window.confirm(`Delete saved filter "${activeSavedFilter.name}"?`)) {
      return;
    }

    if (activeSavedFilter.id === activeSavedFilterId) {
      setActiveSavedFilterId(null);
    }

    removeSavedTableFilter(activeSavedFilter.id);
  }

  function handleRemoveSavedFilter(filterId: string, filterName: string) {
    if (!window.confirm(`Delete saved filter "${filterName}"?`)) {
      return;
    }

    if (filterId === activeSavedFilterId) {
      setActiveSavedFilterId(null);
    }

    removeSavedTableFilter(filterId);
  }

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
      <Modal
        centered
        onClose={savedFilterModal.close}
        opened={savedFilterOpened}
        title="Save table filter"
      >
        <Stack gap="sm">
          <TextInput
            label="Filter name"
            onChange={(event) => setDraftFilterName(event.currentTarget.value)}
            placeholder="Cities"
            value={draftFilterName}
          />
          <Select
            data={filterableColumnOptions}
            label="Column"
            onChange={(value) =>
              setDraftFilterCondition((current) => ({
                ...current,
                column: value ?? '',
              }))
            }
            searchable
            value={draftFilterCondition.column}
          />
          <Select
            allowDeselect={false}
            data={[
              { label: 'Equals', value: 'eq' },
              { label: 'In list', value: 'in' },
            ]}
            label="Operator"
            onChange={(value) =>
              setDraftFilterCondition((current) => ({
                ...current,
                operator: (value ?? 'eq') as TableFilterOperator,
                value: value === 'in' ? '' : current.value,
                values: value === 'in' ? current.values : [],
              }))
            }
            value={draftFilterCondition.operator}
          />
          <TextInput
            description={
              draftFilterCondition.operator === 'in'
                ? 'Comma-separated values. Example: 7, 8'
                : 'Single value. Example: 8'
            }
            label={draftFilterCondition.operator === 'in' ? 'Values' : 'Value'}
            onChange={(event) => {
              const nextRawValue = event.currentTarget.value;
              setDraftFilterCondition((current) => ({
                ...current,
                value: current.operator === 'eq' ? nextRawValue : current.value,
                values:
                  current.operator === 'in'
                    ? nextRawValue
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean)
                    : current.values,
              }));
            }}
            placeholder={draftFilterCondition.operator === 'in' ? '7, 8' : '8'}
            value={
              draftFilterCondition.operator === 'in'
                ? (draftFilterCondition.values ?? []).join(', ')
                : (draftFilterCondition.value ?? '')
            }
          />
          <Group justify="space-between" pt="xs">
            <Text c="dimmed" size="xs">
              First slice: one condition, operators `=` and `in`.
            </Text>
            <Button
              disabled={
                !draftFilterName.trim() ||
                !draftFilterCondition.column ||
                (draftFilterCondition.operator === 'eq'
                  ? !(draftFilterCondition.value ?? '').trim()
                  : (draftFilterCondition.values ?? []).length === 0)
              }
              onClick={handleCreateSavedFilter}
            >
              Save filter
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Stack h="100%" gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Group grow wrap="nowrap">
            <Select
              data={tables.map((table) => ({
                label: table.fullName,
                value: table.fullName,
              }))}
              disabled={isLoadingTables}
              leftSection={
                isLoadingTables || isLoadingTableMetadata ? (
                  <Loader size={14} />
                ) : null
              }
              onChange={handleSelectTableChange}
              placeholder={
                isLoadingTables ? 'Loading database tables...' : 'Select table'
              }
              value={selectedTableKey}
            />
            <TextInput
              leftSection={<IconSearch size={14} />}
              onChange={(event) => setSearchInput(event.currentTarget.value)}
              placeholder="Search rows"
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
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Button
              disabled={!selectedTable || filterableColumnOptions.length === 0}
              leftSection={<IconPlus size={14} />}
              onClick={handleOpenSavedFilterModal}
              size="compact-sm"
              variant="default"
            >
              Filter
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

        <Group justify="space-between" wrap="nowrap">
          <Group grow wrap="nowrap">
            <Select
              clearable
              data={matchingSavedFilters.map((filter) => ({
                label: filter.name,
                value: filter.id,
              }))}
              disabled={!selectedTable}
              onChange={handleSelectSavedFilter}
              placeholder="Saved filter"
              size="xs"
              value={activeSavedFilterId}
            />
            {activeSavedFilter ? (
              <Badge color="grape" size="sm" variant="light">
                {activeSavedFilter.name}
              </Badge>
            ) : (
              <Text c="dimmed" size="xs">
                No saved filter applied
              </Text>
            )}
          </Group>
          {activeSavedFilter ? (
            <ActionIcon
              aria-label="Delete active saved filter"
              color="red"
              onClick={handleRemoveActiveSavedFilter}
              size="sm"
              variant="subtle"
            >
              <IconTrash size={14} />
            </ActionIcon>
          ) : null}
        </Group>

        {matchingSavedFilters.length > 0 ? (
          <Group gap="xs">
            {matchingSavedFilters.map((filter) => (
              <Group gap={4} key={filter.id} wrap="nowrap">
                <Button
                  color={filter.id === activeSavedFilterId ? 'grape' : 'gray'}
                  onClick={() => handleSelectSavedFilter(filter.id)}
                  size="compact-xs"
                  variant={
                    filter.id === activeSavedFilterId ? 'light' : 'subtle'
                  }
                >
                  {filter.name}
                </Button>
                <ActionIcon
                  aria-label={`Delete saved filter ${filter.name}`}
                  color="red"
                  onClick={() =>
                    handleRemoveSavedFilter(filter.id, filter.name)
                  }
                  size="sm"
                  variant="subtle"
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            ))}
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
                  {selectedTable.fullName} • {selectedTable.kind} • showing rows{' '}
                  {rowsState.offset + 1}-
                  {rowsState.offset + rowsState.rows.length}
                </Text>
                {rowsState.primaryKey.length > 0 ? (
                  <Badge color="gray" size="sm" variant="light">
                    PK {rowsState.primaryKey.join(', ')}
                  </Badge>
                ) : (
                  <Badge color="gray" size="sm" variant="outline">
                    No primary key
                  </Badge>
                )}
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
                {activeSavedFilter ? (
                  <Badge color="grape" size="sm" variant="light">
                    Filter: {activeSavedFilter.name}
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

            {rowsState.rows.length === 0 && draftInserts.length === 0 ? (
              <EmptyState
                detail={
                  appliedSearch || activeSavedFilter
                    ? 'No rows match current search/filter.'
                    : 'Selected page has no rows.'
                }
                label={
                  appliedSearch || activeSavedFilter ? 'No Matches' : 'No Rows'
                }
              />
            ) : (
              <ScrollArea
                offsetScrollbars
                scrollbarSize={8}
                style={{
                  flex: 1,
                  minHeight: 0,
                }}
              >
                <Table
                  highlightOnHover
                  stickyHeader
                  stickyHeaderOffset={0}
                  striped
                  withColumnBorders
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th
                        style={{
                          minWidth: 120,
                        }}
                      >
                        Row
                      </Table.Th>
                      {rowsState.columns.map((column) => (
                        <Table.Th
                          key={column.name}
                          style={{
                            minWidth: 160,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <Stack gap={0}>
                            <Text fw={600} size="sm">
                              {column.name}
                            </Text>
                            <Text c="dimmed" size="xs">
                              {column.type}
                            </Text>
                          </Stack>
                        </Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {draftInserts.map((draftRow) => (
                      <Table.Tr
                        key={draftRow.id}
                        style={{
                          background: 'rgba(18, 184, 134, 0.08)',
                        }}
                      >
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Badge color="teal" size="xs" variant="light">
                              New
                            </Badge>
                            <ActionIcon
                              aria-label="Remove new row"
                              color="red"
                              onClick={() =>
                                handleRemoveDraftInsertRow(draftRow.id)
                              }
                              size="sm"
                              variant="subtle"
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Group>
                        </Table.Td>
                        {rowsState.columns.map((column) => (
                          <Table.Td
                            key={`${draftRow.id}-${column.name}`}
                            style={{
                              fontFamily: getCellFontFamily(
                                column.name,
                                column.type,
                              ),
                              maxWidth: 320,
                              textAlign: getCellTextAlign(column.type),
                              verticalAlign: 'top',
                            }}
                          >
                            {isEditableColumnType(column.type) ? (
                              renderEditableCell({
                                column,
                                onChange: (nextValue) =>
                                  handleDraftInsertChange(
                                    draftRow.id,
                                    column,
                                    nextValue,
                                  ),
                                value: draftRow.values[column.name],
                              })
                            ) : (
                              <Text c="dimmed" size="sm">
                                Auto / read only
                              </Text>
                            )}
                          </Table.Td>
                        ))}
                      </Table.Tr>
                    ))}

                    {rowsState.rows.map((row) => {
                      const rowToken = serializeRowKey(
                        row.rowKey,
                        rowsState.primaryKey,
                      );
                      const rowPatch = rowToken
                        ? draftUpdates[rowToken]
                        : undefined;
                      const isDeleted = rowToken
                        ? Boolean(draftDeletes[rowToken])
                        : false;
                      const rowRenderKey =
                        rowToken ??
                        JSON.stringify([
                          rowsState.offset,
                          rowsState.primaryKey,
                          row.values,
                        ]);

                      return (
                        <Table.Tr
                          key={rowRenderKey}
                          style={{
                            background: isDeleted
                              ? 'rgba(224, 49, 49, 0.08)'
                              : rowPatch
                                ? 'rgba(250, 176, 5, 0.08)'
                                : undefined,
                          }}
                        >
                          <Table.Td>
                            <Group gap={6} wrap="nowrap">
                              {isDeleted ? (
                                <Badge color="red" size="xs" variant="light">
                                  Delete
                                </Badge>
                              ) : rowPatch ? (
                                <Badge color="orange" size="xs" variant="light">
                                  Edit
                                </Badge>
                              ) : (
                                <Badge color="gray" size="xs" variant="light">
                                  Live
                                </Badge>
                              )}
                              {rowsState.isEditable && row.rowKey ? (
                                <ActionIcon
                                  aria-label={
                                    isDeleted
                                      ? 'Restore row'
                                      : 'Mark row for delete'
                                  }
                                  color={isDeleted ? 'gray' : 'red'}
                                  onClick={() =>
                                    handleToggleDeleteExistingRow(row)
                                  }
                                  size="sm"
                                  variant="subtle"
                                >
                                  {isDeleted ? (
                                    <IconRestore size={14} />
                                  ) : (
                                    <IconTrash size={14} />
                                  )}
                                </ActionIcon>
                              ) : null}
                            </Group>
                          </Table.Td>
                          {rowsState.columns.map((column) => {
                            const displayValue =
                              rowPatch && column.name in rowPatch
                                ? rowPatch[column.name]
                                : row.values[column.name];
                            const isEditableCell =
                              rowsState.isEditable &&
                              Boolean(row.rowKey) &&
                              isEditableColumnType(column.type) &&
                              !rowsState.primaryKey.includes(column.name);

                            return (
                              <Table.Td
                                key={`${rowRenderKey}-${column.name}`}
                                style={{
                                  fontFamily: getCellFontFamily(
                                    column.name,
                                    column.type,
                                  ),
                                  maxWidth: 320,
                                  textAlign: getCellTextAlign(column.type),
                                  verticalAlign: 'top',
                                }}
                              >
                                {isEditableCell ? (
                                  renderEditableCell({
                                    column,
                                    disabled: isDeleted || isSavingChanges,
                                    onChange: (nextValue) =>
                                      handleExistingCellChange(
                                        row,
                                        column,
                                        nextValue,
                                      ),
                                    value: displayValue,
                                  })
                                ) : (
                                  <Text
                                    lineClamp={3}
                                    size="sm"
                                    style={{
                                      opacity: isDeleted ? 0.55 : 1,
                                      textDecoration: isDeleted
                                        ? 'line-through'
                                        : undefined,
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word',
                                    }}
                                  >
                                    {formatCellValue(displayValue)}
                                  </Text>
                                )}
                              </Table.Td>
                            );
                          })}
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
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
  mapSelection,
  onChangeTab,
  onOpenTable,
  selectedTab,
}: {
  activeLayer: MapLayer | null;
  activeSource: MapSource | null;
  connection: DatabaseConnection | null;
  mapSelection: MapSelection | null;
  onChangeTab: (value: RightPaneTab) => void;
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
        />
      </Tabs.Panel>

      <Tabs.Panel value="data">
        <DataWorkspacePanel
          connection={connection}
          mapSelection={mapSelection}
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
}: {
  activeLayer: MapLayer | null;
  activeSource: MapSource | null;
  mapSelection: MapSelection | null;
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
        </Stack>
      </Paper>
    </Stack>
  );
}

function DataWorkspacePanel({
  connection,
  mapSelection,
  onOpenTable,
}: {
  connection: DatabaseConnection | null;
  mapSelection: MapSelection | null;
  onOpenTable: (tableKey: string) => void | Promise<void>;
}) {
  const [lookupState, setLookupState] =
    useState<InspectorLookupRowsResponse | null>(null);
  const [isLoadingLookup, setIsLoadingLookup] = useState(false);
  const [lookupError, setLookupError] = useState('');

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
              {fallbackEntries.map(([key, value]) => (
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
              {(lookupState?.columns ?? []).map((column) => (
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
                  {lookupState.columns.slice(0, 4).map((column) => (
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

function formatCellValue(value: unknown) {
  if (value === null || value === undefined) {
    return emptyCellLabel;
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function renderEditableCell({
  column,
  disabled,
  onChange,
  value,
}: {
  column: InspectorColumn;
  disabled?: boolean;
  onChange: (value: unknown) => void;
  value: unknown;
}) {
  if (isBooleanColumnType(column.type)) {
    return (
      <Checkbox
        checked={Boolean(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    );
  }

  return (
    <TextInput
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
      size="xs"
      styles={{
        input: {
          textAlign: getCellTextAlign(column.type),
        },
      }}
      value={formatEditorValue(value)}
    />
  );
}

function formatEditorValue(value: unknown) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

function normalizeEditorValue(columnType: string, value: unknown) {
  if (isBooleanColumnType(columnType)) {
    return Boolean(value);
  }

  if (typeof value !== 'string') {
    return value;
  }

  if (isNumericColumnType(columnType)) {
    if (value.trim() === '') {
      return value;
    }

    const numericValue = Number(value);
    return Number.isNaN(numericValue) ? value : numericValue;
  }

  return value;
}

function areEditorValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getCellTextAlign(columnType: string) {
  return isNumericColumnType(columnType) ? 'right' : 'left';
}

function getCellFontFamily(columnName: string, columnType: string) {
  if (
    isNumericColumnType(columnType) ||
    /(^id$|_id$|uuid|geom|geo)/i.test(`${columnName} ${columnType}`)
  ) {
    return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  }

  return 'var(--mantine-font-family)';
}

function LayerGlyph({
  color,
  icon,
  visible,
}: {
  color: string;
  icon: LayerGlyphIcon;
  visible: boolean;
}) {
  const sharedStyle = {
    flexShrink: 0,
    opacity: visible ? 1 : 0.5,
  } as const;

  if (icon === 'flow') {
    return (
      <Group gap={2} wrap="nowrap">
        <Box
          style={{
            ...sharedStyle,
            width: 6,
            height: 6,
            borderRadius: 999,
            background: color,
          }}
        />
        <Box
          style={{
            ...sharedStyle,
            width: 12,
            height: 2,
            borderRadius: 999,
            background: color,
          }}
        />
        <Box
          style={{
            ...sharedStyle,
            width: 6,
            height: 6,
            borderRadius: 999,
            background: color,
          }}
        />
      </Group>
    );
  }

  if (icon === 'line') {
    return (
      <Box
        style={{
          ...sharedStyle,
          width: 14,
          height: 4,
          borderRadius: 999,
          background: color,
        }}
      />
    );
  }

  if (icon === 'diamond') {
    return (
      <Box
        style={{
          ...sharedStyle,
          width: 10,
          height: 10,
          background: color,
          transform: 'rotate(45deg)',
        }}
      />
    );
  }

  return (
    <Box
      style={{
        ...sharedStyle,
        width: 10,
        height: 10,
        borderRadius: icon === 'circle' ? 999 : 2,
        background: color,
      }}
    />
  );
}

function isNumericColumnType(columnType: string) {
  return /int|numeric|double|real|decimal|serial/i.test(columnType);
}

function isBooleanColumnType(columnType: string) {
  return /bool/i.test(columnType);
}

function isEditableColumnType(columnType: string) {
  return (
    isNumericColumnType(columnType) ||
    isBooleanColumnType(columnType) ||
    /text|character|uuid|date|timestamp/i.test(columnType)
  );
}

function createDefaultTableFilterCondition(
  table: InspectableTable | null,
): TableFilterCondition {
  const firstFilterableColumn =
    table?.columns.find((column) => isEditableColumnType(column.type))?.name ??
    '';

  return {
    column: firstFilterableColumn,
    operator: 'eq',
    value: '',
    values: [],
  };
}

function buildTableFilterDefinition(
  condition: TableFilterCondition,
): TableFilterDefinition {
  if (condition.operator === 'in') {
    return {
      conditions: [
        {
          column: condition.column,
          operator: condition.operator,
          values: condition.values ?? [],
        },
      ],
    };
  }

  return {
    conditions: [
      {
        column: condition.column,
        operator: condition.operator,
        value: condition.value ?? '',
      },
    ],
  };
}

export function App() {
  const connections = useConnectionStore((state) => state.connections);
  const mapSources = useConnectionStore((state) => state.mapSources);
  const mapLayers = useConnectionStore((state) => state.mapLayers);
  const selectedBasemapId = useConnectionStore(
    (state) => state.selectedBasemapId,
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
  const [rightPaneTab, setRightPaneTab] = useState<RightPaneTab>('layer');

  const selectedConnection =
    connections.find((connection) => connection.id === selectedConnectionId) ??
    null;
  const selectedTableKey = selectedConnectionId
    ? (selectedTableByConnectionId[selectedConnectionId] ?? null)
    : null;
  const selectedInspectableTable = selectedTableKey
    ? (tableMetadataByKey[selectedTableKey] ?? null)
    : null;
  const visibleTableOptions = selectedSchemaNames.flatMap(
    (schemaName) => schemaTablesByName[schemaName] ?? [],
  );
  const metadataTables = Object.values(tableMetadataByKey);
  const catalog: CatalogState = {
    schemas,
    schemaTablesByName,
    selectedSchemaNames,
    expandedSchemaNames,
    isLoadingSchemas,
    loadingSchemaTablesByName,
    error: catalogError,
  };

  function handleSelectTable(tableKey: string | null) {
    if (!selectedConnectionId) {
      return;
    }

    setSelectedTable(selectedConnectionId, tableKey);
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
        if (selectedTableKey?.startsWith(`${schemaName}.`)) {
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
      name: selectedInspectableTable.name,
      geometryColumn: geometryColumn.name,
      geometryType: geometryColumn.geometryType,
    });
  }

  function handleCreateFlowLayer(payload: {
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

    addFlowmapLayer({
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
    });
  }

  const selectedConnectionMapLayers = mapLayers.filter(
    (layer) => layer.connectionId === selectedConnectionId,
  );
  const selectedVisibleMapLayers = selectedConnectionMapLayers.filter(
    (layer) => layer.visible,
  );
  const activeLayer =
    selectedConnectionMapLayers.find((layer) => layer.id === activeLayerId) ??
    null;
  const activeLayerSource = activeLayer
    ? (findLayerSource(mapSources, activeLayer) ?? null)
    : null;

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
    if (!selectedConnection || !selectedTableKey) {
      setIsLoadingTableMetadata(false);
      return;
    }

    const tableSummary = visibleTableOptions.find(
      (table) => table.fullName === selectedTableKey,
    );
    if (!tableSummary || tableMetadataByKey[selectedTableKey]) {
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
    selectedTableKey,
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
            <Text c="dimmed" size="sm">
              Phase 1 layout base
            </Text>
          </div>
          <Group gap="sm">
            <Text c="dimmed" fw={500} size="sm">
              Resizable workspace shell
            </Text>
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
            <PanelFrame hint="Resizable" title="Data & Layers">
              <ConnectionManager
                activeLayerId={activeLayerId}
                catalog={catalog}
                mapLayers={selectedConnectionMapLayers}
                mapSources={mapSources}
                onLoadSchemas={() => void loadCatalogSchemas()}
                onImportSelectedTable={handleImportSelectedTable}
                onCreateFlowLayer={handleCreateFlowLayer}
                onSelectLayer={handleSelectLayer}
                onSelectCatalogTable={handleSelectTable}
                onToggleCatalogSchema={handleToggleCatalogSchema}
                onToggleCatalogSchemaExpanded={
                  handleToggleCatalogSchemaExpanded
                }
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
                <PanelFrame hint="Resizable" title="Map">
                  <MapPane
                    basemapId={selectedBasemapId ?? defaultBasemapId}
                    connection={selectedConnection}
                    onSelectMapObject={handleSelectMapObject}
                    sources={mapSources}
                    visibleLayers={selectedVisibleMapLayers}
                  />
                </PanelFrame>
              </Split.Pane>

              <Split.Resizer />

              <Split.Pane initialHeight={260} minHeight={0}>
                <PanelFrame hint="Resizable" title="Table">
                  <DataInspector
                    connection={selectedConnection}
                    isLoadingTableMetadata={isLoadingTableMetadata}
                    isLoadingTables={
                      isLoadingSchemas ||
                      Object.values(loadingSchemaTablesByName).some(Boolean)
                    }
                    key={`${selectedConnectionId ?? 'none'}:${selectedTableKey ?? 'none'}`}
                    onSelectTable={handleSelectTable}
                    selectedTable={selectedInspectableTable}
                    selectedTableKey={selectedTableKey}
                    tablesError={catalogError}
                    tables={visibleTableOptions}
                  />
                </PanelFrame>
              </Split.Pane>
            </Split>
          </Split.Pane>

          <Split.Resizer />

          <Split.Pane initialWidth={340} maxWidth={520} minWidth={0}>
            <PanelFrame hint="Tabs" title="Workspace">
              <RightPaneTabs
                activeLayer={activeLayer}
                activeSource={activeLayerSource}
                connection={selectedConnection}
                mapSelection={mapSelection}
                onChangeTab={setRightPaneTab}
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
