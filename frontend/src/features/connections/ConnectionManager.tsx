import {
  ActionIcon,
  Alert,
  Button,
  Center,
  Group,
  Loader,
  Menu,
  Modal,
  NumberInput,
  Paper,
  PasswordInput,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCheck,
  IconChevronDown,
  IconDatabasePlus,
  IconDotsVertical,
  IconEye,
  IconEyeOff,
  IconFocusCentered,
  IconInfoCircle,
  IconLayersIntersect,
  IconPlug,
  IconPlugConnected,
  IconRoute,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react';
import { type ChangeEvent, useEffect, useMemo, useState } from 'react';

import {
  createFlowLayerDefaults,
  type FlowLayerFormState,
  findLayerSource,
  formatFlowmapSourceColumns,
  validateFlowLayerForm,
} from '../app/app-utils';
import { EmptyState, LayerGlyph } from '../app/chrome';
import type { SavedTableView } from '../filters/types';
import {
  fetchInspectableSchemas,
  type InspectableSchema,
  type InspectableTable,
  saveSchemaDisplayConfigs,
} from '../inspector/api';
import { isNumericColumnType } from '../inspector/table-editing';
import { ConnectionCatalog } from './ConnectionCatalog';
import { MapLayerEditor } from './MapLayerEditor';
import {
  type DatabaseConnection,
  type MapLayer,
  type MapLayerPurpose,
  type MapSource,
  useConnectionStore,
} from './store';
import type { CatalogState, MovementLayerKind } from './types';

function tableDisplayKey(connectionId: string, table: InspectableTable) {
  return tableDisplayKeyFromParts(connectionId, table.schema, table.name);
}

function tableDisplayKeyFromParts(
  connectionId: string,
  schema: string,
  table: string,
) {
  return [connectionId, schema, table].map(encodeURIComponent).join(':');
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

type ConnectionManagerView = 'sources' | 'layers';

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

export function ConnectionManager({
  activeLayerId,
  catalog,
  mapLayers,
  mapSources,
  onLoadSchemas,
  onImportSelectedTable,
  onCreateFlowLayer,
  onLocateLayer,
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
  view,
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
  onLocateLayer: (layerId: string) => Promise<void>;
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
  view: ConnectionManagerView;
}) {
  const [connectionOpened, connectionModal] = useDisclosure(false);
  const [flowLayerOpened, flowLayerModal] = useDisclosure(false);
  const [catalogOpened, catalogDisclosure] = useDisclosure(false);
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null);
  const [layerPurposeFilter, setLayerPurposeFilter] = useState<
    'all' | MapLayerPurpose
  >('all');
  const [form, setForm] = useState<ConnectionFormState>(initialConnectionForm);
  const [flowLayerForm, setFlowLayerForm] = useState<FlowLayerFormState>(() =>
    createFlowLayerDefaults(selectedInspectableTable),
  );
  const [movementLayerKind, setMovementLayerKind] =
    useState<MovementLayerKind>('flowmap');
  const [flowLayerError, setFlowLayerError] = useState('');
  const [locatingLayerId, setLocatingLayerId] = useState<string | null>(null);
  const [layerLocateError, setLayerLocateError] = useState('');
  const [schemaConfigConnection, setSchemaConfigConnection] =
    useState<DatabaseConnection | null>(null);
  const [schemaConfigs, setSchemaConfigs] = useState<InspectableSchema[]>([]);
  const [schemaConfigError, setSchemaConfigError] = useState('');
  const [isLoadingSchemaConfigs, setIsLoadingSchemaConfigs] = useState(false);
  const [isSavingSchemaConfigs, setIsSavingSchemaConfigs] = useState(false);
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
  const filteredMapLayers =
    layerPurposeFilter === 'all'
      ? mapLayers
      : mapLayers.filter((layer) => layer.purpose === layerPurposeFilter);

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

  async function handleLocateLayer(layerId: string) {
    setLocatingLayerId(layerId);
    setLayerLocateError('');
    try {
      await onLocateLayer(layerId);
    } catch (error) {
      setLayerLocateError(
        error instanceof Error ? error.message : 'Failed to locate layer.',
      );
    } finally {
      setLocatingLayerId(null);
    }
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

  async function handleOpenSchemaConfig(connection: DatabaseConnection) {
    setSchemaConfigConnection(connection);
    setSchemaConfigs([]);
    setSchemaConfigError('');
    setIsLoadingSchemaConfigs(true);

    try {
      setSchemaConfigs(await fetchInspectableSchemas(connection));
    } catch (error) {
      setSchemaConfigError(
        error instanceof Error
          ? error.message
          : 'Failed to load schema display settings.',
      );
    } finally {
      setIsLoadingSchemaConfigs(false);
    }
  }

  async function handleSaveSchemaConfigs() {
    if (!schemaConfigConnection) {
      return;
    }

    setIsSavingSchemaConfigs(true);
    setSchemaConfigError('');
    try {
      await saveSchemaDisplayConfigs(schemaConfigConnection, schemaConfigs);
      if (schemaConfigConnection.id === selectedConnectionId) {
        onLoadSchemas();
      }
      setSchemaConfigConnection(null);
    } catch (error) {
      setSchemaConfigError(
        error instanceof Error
          ? error.message
          : 'Failed to save schema display settings.',
      );
    } finally {
      setIsSavingSchemaConfigs(false);
    }
  }

  return (
    <>
      <Modal
        centered
        onClose={() => setSchemaConfigConnection(null)}
        opened={schemaConfigConnection !== null}
        title={`Visible schemas${schemaConfigConnection ? ` · ${schemaConfigConnection.name}` : ''}`}
      >
        <Stack gap="sm">
          <Text c="dimmed" size="sm">
            Choose schemas shown in catalog and give technical names readable
            aliases. Settings are stored in database.
          </Text>

          {schemaConfigError ? (
            <Alert color="red" title="Schema settings failed" variant="light">
              {schemaConfigError}
            </Alert>
          ) : null}

          {isLoadingSchemaConfigs ? (
            <Center py="lg">
              <Loader size="sm" />
            </Center>
          ) : (
            <ScrollArea.Autosize mah={420} offsetScrollbars>
              <Stack gap="xs" pr="xs">
                {schemaConfigs.map((schema, index) => (
                  <Group key={schema.name} align="flex-end" wrap="nowrap">
                    <TextInput
                      aria-label={`Alias for ${schema.name}`}
                      description={schema.name}
                      label="Alias"
                      onChange={(event) => {
                        const alias = event.currentTarget.value;
                        setSchemaConfigs((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, alias } : item,
                          ),
                        );
                      }}
                      placeholder={schema.name}
                      style={{ flex: 1 }}
                      value={schema.alias}
                    />
                    <Switch
                      checked={schema.visible}
                      label="Show"
                      onChange={(event) => {
                        const visible = event.currentTarget.checked;
                        setSchemaConfigs((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, visible } : item,
                          ),
                        );
                      }}
                      pb={7}
                    />
                  </Group>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          )}

          <Group justify="flex-end">
            <Button
              onClick={() => setSchemaConfigConnection(null)}
              variant="default"
            >
              Cancel
            </Button>
            <Button
              disabled={isLoadingSchemaConfigs || schemaConfigs.length === 0}
              loading={isSavingSchemaConfigs}
              onClick={() => void handleSaveSchemaConfigs()}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

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

      <Stack h="100%" gap="md" style={{ minHeight: 0, minWidth: 0 }}>
        {view === 'sources' ? (
          <>
            <Group justify="space-between" wrap="nowrap">
              <div>
                <Text fw={700} size="sm">
                  Connected Sources
                </Text>
              </div>
              <ActionIcon
                aria-label="Add connection"
                color="blue"
                data-tour="add-connection"
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
                                leftSection={<IconSettings size={14} />}
                                onClick={() =>
                                  void handleOpenSchemaConfig(connection)
                                }
                              >
                                Configure schemas
                              </Menu.Item>
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
                            onToggleSchemaExpanded={
                              onToggleCatalogSchemaExpanded
                            }
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
          </>
        ) : null}

        {view === 'layers' ? (
          <Stack gap="xs" style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
            <Group justify="space-between" wrap="nowrap">
              <div>
                <Text fw={700} size="sm">
                  Map Layers
                </Text>
              </div>
              <Menu position="bottom-end" shadow="md" width={220}>
                <Menu.Target>
                  <Button
                    data-tour="layer-actions"
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

            <SegmentedControl
              data={[
                { label: 'All', value: 'all' },
                { label: 'Configured', value: 'configured' },
                { label: 'Previews', value: 'record-preview' },
              ]}
              fullWidth
              onChange={(value) =>
                setLayerPurposeFilter(value as 'all' | MapLayerPurpose)
              }
              size="xs"
              value={layerPurposeFilter}
            />

            {layerLocateError ? (
              <Alert color="orange" variant="light">
                {layerLocateError}
              </Alert>
            ) : null}

            <ScrollArea
              offsetScrollbars
              scrollbarSize={6}
              style={{ flex: 1, minHeight: 0, width: '100%' }}
            >
              <Stack gap={4} pr="xs" style={{ minWidth: 0 }}>
                {filteredMapLayers.map((layer) => {
                  const source = findLayerSource(mapSources, layer);
                  const sourceTable = source
                    ? (tables.find(
                        (table) => table.fullName === source.fullName,
                      ) ?? null)
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
                        minWidth: 0,
                        opacity: layer.visible ? 1 : 0.55,
                        width: '100%',
                      }}
                    >
                      <Stack gap="xs" style={{ minWidth: 0 }}>
                        <Group justify="space-between" wrap="nowrap">
                          <Group
                            gap="xs"
                            style={{ flex: 1, minWidth: 0 }}
                            wrap="nowrap"
                          >
                            <LayerGlyph
                              color={
                                layer.type === 'geojson'
                                  ? layer.icon === 'line'
                                    ? layer.strokeColor
                                    : layer.fillColor
                                  : layer.type === 'arc'
                                    ? layer.color
                                    : '#0c8599'
                              }
                              icon={layer.icon}
                              visible={layer.visible}
                            />
                            <Stack gap={0} style={{ minWidth: 0 }}>
                              <Text fw={600} size="sm" truncate="end">
                                {layer.name}
                              </Text>
                              <Text c="dimmed" size="xs" truncate="end">
                                {source.type === 'geojson-table'
                                  ? `${source.geometryColumn} • ${source.kind}`
                                  : formatFlowmapSourceColumns(source.columns)}
                              </Text>
                            </Stack>
                          </Group>

                          <Group
                            gap={4}
                            style={{ flexShrink: 0 }}
                            wrap="nowrap"
                          >
                            <ActionIcon
                              aria-label={`Zoom to ${layer.name}`}
                              disabled={
                                locatingLayerId !== null &&
                                locatingLayerId !== layer.id
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleLocateLayer(layer.id);
                              }}
                              size="sm"
                              title="Zoom to layer"
                              variant="subtle"
                            >
                              {locatingLayerId === layer.id ? (
                                <Loader size={14} />
                              ) : (
                                <IconFocusCentered size={16} />
                              )}
                            </ActionIcon>
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
                              {isExpanded ? 'Close' : 'Settings'}
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

                        <Text c="dimmed" size="xs" truncate="end">
                          {layer.purpose === 'record-preview'
                            ? 'Record preview'
                            : 'Configured'}{' '}
                          • {source.schema}.{source.table}
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
                    Select table below, then import geometry or create flow
                    layer.
                  </Text>
                ) : filteredMapLayers.length === 0 ? (
                  <Text c="dimmed" size="xs">
                    No layers match this filter.
                  </Text>
                ) : null}
              </Stack>
            </ScrollArea>
          </Stack>
        ) : null}
      </Stack>
    </>
  );
}
