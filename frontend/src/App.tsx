import { Split } from '@gfazioli/mantine-split-pane';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  Flex,
  Group,
  Loader,
  Modal,
  Paper,
  PasswordInput,
  ScrollArea,
  Select,
  Slider,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCheck,
  IconDatabasePlus,
  IconDeviceFloppy,
  IconEye,
  IconEyeOff,
  IconPlug,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconRestore,
  IconTrash,
} from '@tabler/icons-react';
import {
  type ChangeEvent,
  type ReactNode,
  startTransition,
  useEffect,
  useState,
} from 'react';

import {
  type DatabaseConnection,
  type FlowmapMapLayer,
  type GeoJsonMapLayer,
  type LayerGlyphIcon,
  type MapLayer,
  type MapSource,
  useConnectionStore,
} from './features/connections/store';
import {
  commitInspectorRows,
  fetchInspectableTables,
  fetchInspectorRows,
  type InspectableTable,
  type InspectorColumn,
  type InspectorRow,
  type InspectorRowsResponse,
  type TableChangeOperation,
} from './features/inspector/api';
import { MapPane } from './features/map/MapPane';

const pageSize = 100;
const emptyCellLabel = 'NULL';

interface DraftInsertRow {
  id: string;
  values: Record<string, unknown>;
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

function guessColumnName(columns: InspectorColumn[], patterns: RegExp[]) {
  return (
    columns.find((column) =>
      patterns.some((pattern) => pattern.test(column.name)),
    )?.name ?? null
  );
}

function createFlowLayerDefaults(table: InspectableTable | null) {
  const columns = table?.columns ?? [];

  return {
    name: table ? `${table.name} flows` : 'Flow layer',
    startLon: guessColumnName(columns, [
      /(start|origin|from).*(lon|lng|long|x)/i,
      /^src_?(lon|lng|long|x)$/i,
    ]),
    startLat: guessColumnName(columns, [
      /(start|origin|from).*(lat|y)/i,
      /^src_?(lat|y)$/i,
    ]),
    endLon: guessColumnName(columns, [
      /(end|dest|to).*(lon|lng|long|x)/i,
      /^dst_?(lon|lng|long|x)$/i,
    ]),
    endLat: guessColumnName(columns, [
      /(end|dest|to).*(lat|y)/i,
      /^dst_?(lat|y)$/i,
    ]),
    magnitude: guessColumnName(columns, [
      /magnitude|count|weight|value|volume|amount|total/i,
    ]),
  };
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
        <Title c="dark.7" order={5} tt="uppercase">
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

function EmptyState({
  label,
  detail,
  background,
}: {
  label: string;
  detail: string;
  background?: string;
}) {
  return (
    <Center
      h="100%"
      style={{
        background:
          background ??
          'linear-gradient(180deg, rgba(248,249,250,0.92) 0%, rgba(241,243,245,0.92) 100%)',
        border: '1px dashed var(--mantine-color-gray-4)',
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
  mapLayers,
  mapSources,
  onImportSelectedTable,
  onCreateFlowLayer,
  selectedInspectableTable,
  tables,
}: {
  mapLayers: MapLayer[];
  mapSources: MapSource[];
  onImportSelectedTable: () => void;
  onCreateFlowLayer: (payload: {
    name: string;
    startLon: string;
    startLat: string;
    endLon: string;
    endLat: string;
    magnitude: string;
  }) => void;
  selectedInspectableTable: InspectableTable | null;
  tables: InspectableTable[];
}) {
  const [connectionOpened, connectionModal] = useDisclosure(false);
  const [flowLayerOpened, flowLayerModal] = useDisclosure(false);
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null);
  const [form, setForm] = useState<ConnectionFormState>(initialConnectionForm);
  const [flowLayerForm, setFlowLayerForm] = useState(() =>
    createFlowLayerDefaults(selectedInspectableTable),
  );
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
  const updateFlowmapLayer = useConnectionStore(
    (state) => state.updateFlowmapLayer,
  );

  const activeConnections = connections.filter(
    (connection) => connection.isActive,
  );
  const canImportSelectedTable = Boolean(
    selectedInspectableTable &&
      selectedInspectableTable.geometryColumns.length > 0,
  );
  const flowColumnOptions = (selectedInspectableTable?.columns ?? []).map(
    (column) => ({
      label: `${column.name} (${column.type})`,
      value: column.name,
    }),
  );
  const canCreateFlowLayer = Boolean(selectedInspectableTable);

  useEffect(() => {
    setFlowLayerForm(createFlowLayerDefaults(selectedInspectableTable));
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
    flowLayerModal.open();
  }

  function handleCloseFlowLayerModal() {
    flowLayerModal.close();
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
    if (
      !flowLayerForm.name.trim() ||
      !flowLayerForm.startLon ||
      !flowLayerForm.startLat ||
      !flowLayerForm.endLon ||
      !flowLayerForm.endLat ||
      !flowLayerForm.magnitude
    ) {
      return;
    }

    onCreateFlowLayer({
      name: flowLayerForm.name.trim(),
      startLon: flowLayerForm.startLon,
      startLat: flowLayerForm.startLat,
      endLon: flowLayerForm.endLon,
      endLat: flowLayerForm.endLat,
      magnitude: flowLayerForm.magnitude,
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
          <Select
            data={flowColumnOptions}
            label="Start longitude"
            onChange={(value) =>
              setFlowLayerForm((current) => ({
                ...current,
                startLon: value,
              }))
            }
            value={flowLayerForm.startLon}
          />
          <Select
            data={flowColumnOptions}
            label="Start latitude"
            onChange={(value) =>
              setFlowLayerForm((current) => ({
                ...current,
                startLat: value,
              }))
            }
            value={flowLayerForm.startLat}
          />
          <Select
            data={flowColumnOptions}
            label="End longitude"
            onChange={(value) =>
              setFlowLayerForm((current) => ({
                ...current,
                endLon: value,
              }))
            }
            value={flowLayerForm.endLon}
          />
          <Select
            data={flowColumnOptions}
            label="End latitude"
            onChange={(value) =>
              setFlowLayerForm((current) => ({
                ...current,
                endLat: value,
              }))
            }
            value={flowLayerForm.endLat}
          />
          <Select
            data={flowColumnOptions}
            label="Magnitude"
            onChange={(value) =>
              setFlowLayerForm((current) => ({
                ...current,
                magnitude: value,
              }))
            }
            value={flowLayerForm.magnitude}
          />
          <Group justify="space-between" pt="xs">
            <Text c="dimmed" size="xs">
              One table. Static read-only flows from coordinate columns.
            </Text>
            <Button onClick={handleCreateFlowLayer}>Create layer</Button>
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

              if (!source) {
                return null;
              }

              return (
                <Paper
                  key={layer.id}
                  p="xs"
                  radius="md"
                  shadow="xs"
                  style={{
                    border: '1px solid var(--mantine-color-gray-3)',
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
                              : `${source.columns.startLat}/${source.columns.startLon} → ${source.columns.endLat}/${source.columns.endLon}`}
                          </Text>
                        </Stack>
                      </Group>

                      <Group gap={4} wrap="nowrap">
                        <Button
                          onClick={() =>
                            setExpandedLayerId((current) =>
                              current === layer.id ? null : layer.id,
                            )
                          }
                          size="compact-xs"
                          variant="subtle"
                        >
                          {isExpanded ? 'Close' : 'Style'}
                        </Button>
                        <ActionIcon
                          aria-label={
                            layer.visible ? 'Hide layer' : 'Show layer'
                          }
                          onClick={() => toggleMapLayerVisibility(layer.id)}
                          size="sm"
                          variant="subtle"
                        >
                          {layer.visible ? (
                            <IconEye size={16} />
                          ) : (
                            <IconEyeOff size={16} />
                          )}
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

function MapLayerEditor({
  layer,
  source,
  sourceTable,
  onUpdateFlowmapLayer,
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
  tables,
  selectedTableKey,
  onSelectTable,
  tablesError,
}: {
  connection: DatabaseConnection | null;
  isLoadingTables: boolean;
  tables: InspectableTable[];
  selectedTableKey: string | null;
  onSelectTable: (tableKey: string | null) => void;
  tablesError: string;
}) {
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

  const selectedTable =
    tables.find((table) => table.fullName === selectedTableKey) ?? null;
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

  function resetDraftState() {
    setDraftUpdates({});
    setDraftDeletes({});
    setDraftInserts([]);
    setSaveError('');
  }

  function confirmDraftReset(actionLabel: string) {
    if (!hasDirtyChanges) {
      return true;
    }

    return window.confirm(
      `Discard unsaved table changes before ${actionLabel}?`,
    );
  }

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
  }, [connection, rowsRefreshToken, selectedTable]);

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
    <Stack h="100%" gap="sm">
      <Group justify="space-between" wrap="nowrap">
        <Group grow>
          <Select
            data={tables.map((table) => ({
              label: table.fullName,
              value: table.fullName,
            }))}
            disabled={isLoadingTables}
            leftSection={isLoadingTables ? <Loader size={14} /> : null}
            onChange={handleSelectTableChange}
            placeholder={
              isLoadingTables ? 'Loading database tables...' : 'Select table'
            }
            value={selectedTableKey}
          />
        </Group>
        <Group gap="xs" wrap="nowrap">
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

      {!selectedTable && isLoadingTables ? (
        <Center
          style={{
            flex: 1,
            minHeight: 0,
          }}
        >
          <Stack align="center" gap="xs">
            <Loader size="sm" />
            <Text c="dimmed" size="sm">
              Reading table catalog...
            </Text>
          </Stack>
        </Center>
      ) : null}

      {!selectedTable && !isLoadingTables ? (
        <EmptyState
          detail="Choose one table from loaded database objects."
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
              insert/update/delete privileges. Geometry cells stay read-only in
              this first pass.
            </Alert>
          ) : null}

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
                              onClick={() => handleToggleDeleteExistingRow(row)}
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

          <Group justify="space-between">
            <Button
              disabled={isLoadingRows || rowsState.offset === 0}
              onClick={() =>
                void handlePageChange(Math.max(rowsState.offset - pageSize, 0))
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
              onClick={() => void handlePageChange(rowsState.offset + pageSize)}
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

export function App() {
  const connections = useConnectionStore((state) => state.connections);
  const mapSources = useConnectionStore((state) => state.mapSources);
  const mapLayers = useConnectionStore((state) => state.mapLayers);
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
  const [tables, setTables] = useState<InspectableTable[]>([]);
  const [isLoadingTables, setIsLoadingTables] = useState(false);
  const [tablesError, setTablesError] = useState('');

  const selectedConnection =
    connections.find((connection) => connection.id === selectedConnectionId) ??
    null;
  const selectedTableKey = selectedConnectionId
    ? (selectedTableByConnectionId[selectedConnectionId] ?? null)
    : null;
  const selectedInspectableTable =
    tables.find((table) => table.fullName === selectedTableKey) ?? null;

  function handleSelectTable(tableKey: string | null) {
    if (!selectedConnectionId) {
      return;
    }

    setSelectedTable(selectedConnectionId, tableKey);
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

    addGeoJsonLayer({
      connectionId: selectedConnectionId,
      schema: selectedInspectableTable.schema,
      table: selectedInspectableTable.name,
      fullName: selectedInspectableTable.fullName,
      kind: selectedInspectableTable.kind,
      name: selectedInspectableTable.name,
      geometryColumn: selectedInspectableTable.geometryColumns[0].name,
      geometryType: selectedInspectableTable.geometryColumns[0].geometryType,
    });
  }

  function handleCreateFlowLayer(payload: {
    name: string;
    startLon: string;
    startLat: string;
    endLon: string;
    endLat: string;
    magnitude: string;
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
        startLon: payload.startLon,
        startLat: payload.startLat,
        endLon: payload.endLon,
        endLat: payload.endLat,
        magnitude: payload.magnitude,
      },
    });
  }

  const selectedConnectionMapLayers = mapLayers.filter(
    (layer) => layer.connectionId === selectedConnectionId,
  );
  const selectedVisibleMapLayers = selectedConnectionMapLayers.filter(
    (layer) => layer.visible,
  );

  useEffect(() => {
    if (!selectedConnection || selectedConnection.testStatus !== 'success') {
      setTables([]);
      setIsLoadingTables(false);
      setTablesError('');
      return;
    }

    const activeConnection = selectedConnection;
    let isActive = true;

    async function loadTables() {
      try {
        setIsLoadingTables(true);
        setTablesError('');
        const nextTables = await fetchInspectableTables(activeConnection);
        if (!isActive) {
          return;
        }
        setTables(nextTables);
        const nextSelectedTableKey =
          selectedTableKey &&
          nextTables.some((table) => table.fullName === selectedTableKey)
            ? selectedTableKey
            : (nextTables[0]?.fullName ?? null);
        if (selectedConnectionId) {
          setSelectedTable(selectedConnectionId, nextSelectedTableKey);
        }
      } catch (error) {
        if (!isActive) {
          return;
        }
        setTables([]);
        setTablesError(
          error instanceof Error
            ? error.message
            : 'Failed to load inspectable tables.',
        );
        if (selectedConnectionId) {
          setSelectedTable(selectedConnectionId, null);
        }
      } finally {
        if (isActive) {
          setIsLoadingTables(false);
        }
      }
    }

    void loadTables();

    return () => {
      isActive = false;
    };
  }, [
    selectedConnection,
    selectedConnectionId,
    selectedTableKey,
    setSelectedTable,
  ]);

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
          borderBottom: '1px solid var(--mantine-color-gray-3)',
        }}
      >
        <Flex align="center" justify="space-between">
          <div>
            <Title order={3}>Geopanel</Title>
            <Text c="dimmed" size="sm">
              Phase 1 layout base
            </Text>
          </div>
          <Text c="dimmed" fw={500} size="sm">
            Resizable workspace shell
          </Text>
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
                mapLayers={selectedConnectionMapLayers}
                mapSources={mapSources}
                onImportSelectedTable={handleImportSelectedTable}
                onCreateFlowLayer={handleCreateFlowLayer}
                selectedInspectableTable={selectedInspectableTable}
                tables={tables}
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
                    connection={selectedConnection}
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
                    isLoadingTables={isLoadingTables}
                    onSelectTable={handleSelectTable}
                    selectedTableKey={selectedTableKey}
                    tablesError={tablesError}
                    tables={tables}
                  />
                </PanelFrame>
              </Split.Pane>
            </Split>
          </Split.Pane>

          <Split.Resizer />

          <Split.Pane initialWidth={340} maxWidth={520} minWidth={0}>
            <PanelFrame hint="Resizable" title="Analytics">
              <EmptyState detail="Right workspace pane" label="Insights" />
            </PanelFrame>
          </Split.Pane>
        </Split>
      </Box>
    </Flex>
  );
}
