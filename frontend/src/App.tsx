import { Split } from '@gfazioli/mantine-split-pane';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
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
  IconEye,
  IconEyeOff,
  IconPlug,
  IconPlugConnected,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';

import {
  type DatabaseConnection,
  type ImportedLayer,
  useConnectionStore,
} from './features/connections/store';
import {
  fetchInspectableTables,
  fetchInspectorRows,
  type InspectableTable,
  type InspectorRowsResponse,
} from './features/inspector/api';
import { MapPane } from './features/map/MapPane';

const pageSize = 100;

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
  importedLayers,
  onImportSelectedTable,
  selectedInspectableTable,
  tables,
}: {
  importedLayers: ImportedLayer[];
  onImportSelectedTable: () => void;
  selectedInspectableTable: InspectableTable | null;
  tables: InspectableTable[];
}) {
  const [opened, { open, close }] = useDisclosure(false);
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null);
  const [form, setForm] = useState<ConnectionFormState>(initialConnectionForm);
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
  const toggleImportedLayerVisibility = useConnectionStore(
    (state) => state.toggleImportedLayerVisibility,
  );
  const updateImportedLayer = useConnectionStore(
    (state) => state.updateImportedLayer,
  );

  const activeConnections = connections.filter(
    (connection) => connection.isActive,
  );
  const canImportSelectedTable = Boolean(
    selectedInspectableTable &&
      selectedInspectableTable.geometryColumns.length > 0,
  );

  function handleFieldChange(event: ChangeEvent<HTMLInputElement>) {
    const { name, value } = event.currentTarget;
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleClose() {
    setForm(initialConnectionForm);
    close();
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
        opened={opened}
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
            onClick={open}
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
                Imported Layers
              </Text>
              <Text c="dimmed" size="xs">
                {importedLayers.length} layer
                {importedLayers.length === 1 ? '' : 's'}
              </Text>
            </div>
            <Button
              disabled={!canImportSelectedTable}
              onClick={onImportSelectedTable}
              size="compact-sm"
            >
              Import Layer
            </Button>
          </Group>

          <Stack gap={4}>
            {importedLayers.map((layer) => {
              const sourceTable =
                tables.find((table) => table.fullName === layer.fullName) ??
                null;
              const isExpanded = expandedLayerId === layer.id;

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
                          color={layer.color}
                          icon={layer.icon}
                          visible={layer.visible}
                        />
                        <Stack gap={0}>
                          <Text fw={600} size="sm">
                            {layer.name}
                          </Text>
                          <Text c="dimmed" size="xs">
                            {layer.geometryColumn} • {layer.kind}
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
                          onClick={() =>
                            toggleImportedLayerVisibility(layer.id)
                          }
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
                      {layer.schema}.{layer.table}
                    </Text>

                    {isExpanded ? (
                      <Stack
                        gap="xs"
                        pt="xs"
                        style={{
                          borderTop: '1px solid var(--mantine-color-gray-2)',
                        }}
                      >
                        <TextInput
                          label="Layer name"
                          onChange={(event) =>
                            updateImportedLayer(layer.id, {
                              name: event.currentTarget.value,
                            })
                          }
                          size="xs"
                          value={layer.name}
                        />

                        <Select
                          data={(sourceTable?.geometryColumns ?? []).map(
                            (column) => ({
                              label: `${column.name} (${column.geometryType})`,
                              value: column.name,
                            }),
                          )}
                          label="Geographic column"
                          onChange={(value) => {
                            const nextGeometryColumn =
                              sourceTable?.geometryColumns.find(
                                (column) => column.name === value,
                              ) ?? null;

                            updateImportedLayer(layer.id, {
                              geometryColumn: value ?? layer.geometryColumn,
                            });

                            if (nextGeometryColumn) {
                              updateImportedLayer(layer.id, {
                                geometryType: nextGeometryColumn.geometryType,
                              });
                            }
                          }}
                          size="xs"
                          value={layer.geometryColumn}
                        />

                        <Group align="end" grow>
                          <Box>
                            <Text c="dimmed" fw={500} mb={4} size="xs">
                              Color
                            </Text>
                            <input
                              aria-label={`Choose color for ${layer.name}`}
                              onChange={(event) =>
                                updateImportedLayer(layer.id, {
                                  color: event.currentTarget.value,
                                })
                              }
                              style={{
                                width: '100%',
                                height: 36,
                                border: '1px solid var(--mantine-color-gray-4)',
                                borderRadius: 8,
                                background: 'transparent',
                                padding: 4,
                              }}
                              type="color"
                              value={layer.color}
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

                              updateImportedLayer(layer.id, {
                                icon: value as ImportedLayer['icon'],
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
                              {layer.opacity}%
                            </Text>
                          </Group>
                          <Slider
                            max={100}
                            min={0}
                            onChange={(value) =>
                              updateImportedLayer(layer.id, {
                                opacity: value,
                              })
                            }
                            size="sm"
                            value={layer.opacity}
                          />
                        </Stack>
                      </Stack>
                    ) : null}
                  </Stack>
                </Paper>
              );
            })}

            {importedLayers.length === 0 ? (
              <Text c="dimmed" size="xs">
                Select geometry table below, then import it as layer.
              </Text>
            ) : null}
          </Stack>
        </Stack>
      </Stack>
    </>
  );
}

function DataInspector({
  connection,
  tables,
  selectedTableKey,
  onSelectTable,
  tablesError,
}: {
  connection: DatabaseConnection | null;
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

  const selectedTable =
    tables.find((table) => table.fullName === selectedTableKey) ?? null;

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
      return;
    }

    const activeConnection = connection;
    const activeTable = selectedTable;
    let isActive = true;

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
            onChange={onSelectTable}
            placeholder="Select table"
            value={selectedTableKey}
          />
        </Group>
        <ActionIcon
          aria-label="Refresh rows"
          onClick={() => setRowsRefreshToken((value) => value + 1)}
          size="md"
          variant="subtle"
        >
          {isLoadingRows ? <Loader size={16} /> : <IconRefresh size={16} />}
        </ActionIcon>
      </Group>

      {tablesError ? (
        <Text c="red" size="sm">
          {tablesError}
        </Text>
      ) : null}

      {rowsError ? (
        <Text c="red" size="sm">
          {rowsError}
        </Text>
      ) : null}

      {!selectedTable ? (
        <EmptyState
          detail="Choose one table from loaded database objects."
          label="No Table Selected"
        />
      ) : null}

      {selectedTable && rowsState ? (
        <>
          <Group justify="space-between">
            <Text c="dimmed" size="xs">
              {selectedTable.fullName} • {selectedTable.kind} • showing rows{' '}
              {rowsState.offset + 1}-{rowsState.offset + rowsState.rows.length}
            </Text>
            <Text c="dimmed" size="xs">
              page size {rowsState.limit}
            </Text>
          </Group>

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
                {rowsState.rows.map((row, rowIndex) => (
                  <Table.Tr key={`${rowsState.offset}-${rowIndex}`}>
                    {rowsState.columns.map((column) => (
                      <Table.Td
                        key={`${rowIndex}-${column.name}`}
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
                        <Text
                          lineClamp={3}
                          size="sm"
                          style={{
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {formatCellValue(row[column.name])}
                        </Text>
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
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
    </Stack>
  );
}

function formatCellValue(value: unknown) {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
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
}: Pick<ImportedLayer, 'color' | 'icon' | 'visible'>) {
  const sharedStyle = {
    flexShrink: 0,
    opacity: visible ? 1 : 0.5,
  } as const;

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

export function App() {
  const connections = useConnectionStore((state) => state.connections);
  const importedLayers = useConnectionStore((state) => state.importedLayers);
  const selectedConnectionId = useConnectionStore(
    (state) => state.selectedConnectionId,
  );
  const selectedTableByConnectionId = useConnectionStore(
    (state) => state.selectedTableByConnectionId,
  );
  const setSelectedTable = useConnectionStore(
    (state) => state.setSelectedTable,
  );
  const addImportedLayer = useConnectionStore(
    (state) => state.addImportedLayer,
  );
  const [tables, setTables] = useState<InspectableTable[]>([]);
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

    addImportedLayer({
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

  const selectedConnectionImportedLayers = importedLayers.filter(
    (layer) => layer.connectionId === selectedConnectionId,
  );

  useEffect(() => {
    if (!selectedConnection || selectedConnection.testStatus !== 'success') {
      setTables([]);
      setTablesError('');
      return;
    }

    const activeConnection = selectedConnection;
    let isActive = true;

    async function loadTables() {
      try {
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
        handleSelectTable(nextSelectedTableKey);
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
        handleSelectTable(null);
      }
    }

    void loadTables();

    return () => {
      isActive = false;
    };
  }, [selectedConnection, selectedTableKey]);

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
                importedLayers={selectedConnectionImportedLayers}
                onImportSelectedTable={handleImportSelectedTable}
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
                  <MapPane />
                </PanelFrame>
              </Split.Pane>

              <Split.Resizer />

              <Split.Pane initialHeight={260} maxHeight={420} minHeight={0}>
                <PanelFrame hint="Resizable" title="Table">
                  <DataInspector
                    connection={selectedConnection}
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
