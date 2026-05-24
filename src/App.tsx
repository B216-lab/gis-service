import { Split } from '@gfazioli/mantine-split-pane';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Flex,
  Group,
  Modal,
  Paper,
  PasswordInput,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCheck,
  IconDatabasePlus,
  IconPlug,
  IconPlugConnected,
  IconTrash,
} from '@tabler/icons-react';
import { useState, type ChangeEvent, type ReactNode } from 'react';

import { useConnectionStore } from './features/connections/store';

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
        minHeight: 0,
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
          minHeight: 0,
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

function ConnectionManager() {
  const [opened, { open, close }] = useDisclosure(false);
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

  const activeConnections = connections.filter(
    (connection) => connection.isActive,
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

  return (
    <>
      <Modal
        opened={opened}
        onClose={handleClose}
        title="Add PostGIS connection"
        centered
      >
        <Stack gap="sm">
          <TextInput
            label="Display name"
            name="name"
            placeholder="City DB"
            value={form.name}
            onChange={handleFieldChange}
          />
          <TextInput
            label="Host"
            name="host"
            placeholder="127.0.0.1"
            value={form.host}
            onChange={handleFieldChange}
          />
          <Group grow>
            <TextInput
              label="Port"
              name="port"
              placeholder="5432"
              value={form.port}
              onChange={handleFieldChange}
            />
            <TextInput
              label="Database"
              name="database"
              placeholder="geopanel_test"
              value={form.database}
              onChange={handleFieldChange}
            />
          </Group>
          <TextInput
            label="User"
            name="user"
            placeholder="geopanel"
            value={form.user}
            onChange={handleFieldChange}
          />
          <PasswordInput
            label="Password"
            name="password"
            placeholder="Optional for now"
            value={form.password}
            onChange={handleFieldChange}
          />
          <Group justify="space-between" pt="xs">
            <Text c="dimmed" size="xs">
              UI only. No real connection test yet.
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
                  p="sm"
                  radius="md"
                  shadow={isSelected ? 'sm' : 'xs'}
                  style={{
                    border: isSelected
                      ? '1px solid var(--mantine-color-blue-4)'
                      : '1px solid var(--mantine-color-gray-3)',
                    cursor: 'pointer',
                  }}
                  onClick={() => selectConnection(connection.id)}
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

                    <Group gap="xs" justify="space-between" wrap="nowrap">
                      <Group gap={6}>
                        <Badge
                          color={connection.isActive ? 'green' : 'gray'}
                          radius="sm"
                          variant="light"
                        >
                          {connection.isActive ? 'Active' : 'Saved'}
                        </Badge>
                        {isSelected ? (
                          <Badge color="blue" radius="sm" variant="light">
                            Selected
                          </Badge>
                        ) : null}
                      </Group>

                      <Button
                        color={connection.isActive ? 'gray' : 'blue'}
                        leftSection={
                          connection.isActive ? (
                            <IconCheck size={14} />
                          ) : (
                            <IconPlugConnected size={14} />
                          )
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleConnectionActive(connection.id);
                        }}
                        size="compact-xs"
                        variant={connection.isActive ? 'light' : 'filled'}
                      >
                        {connection.isActive ? 'Active' : 'Activate'}
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

        <Divider />

        <Stack gap={6}>
          <Text fw={700} size="sm">
            Imported Layers
          </Text>
          <Text c="dimmed" size="xs">
            Placeholder for connected spatial tables and derived layers.
          </Text>
        </Stack>
      </Stack>
    </>
  );
}

export function App() {
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
          <Split.Pane initialWidth={280} minWidth={180} maxWidth={480}>
            <PanelFrame hint="Resizable" title="Data & Layers">
              <ConnectionManager />
            </PanelFrame>
          </Split.Pane>

          <Split.Resizer />

          <Split.Pane grow minWidth={420}>
            <Split
              orientation="horizontal"
              style={{
                height: '100%',
              }}
            >
              <Split.Pane grow minHeight={220}>
                <PanelFrame hint="Resizable" title="Map">
                  <EmptyState
                    background="linear-gradient(135deg, rgba(228,240,255,0.9) 0%, rgba(231,245,255,0.9) 35%, rgba(255,249,219,0.85) 100%)"
                    detail="Center top pane"
                    label="Map Canvas"
                  />
                </PanelFrame>
              </Split.Pane>

              <Split.Resizer />

              <Split.Pane initialHeight={260} minHeight={160} maxHeight={420}>
                <PanelFrame hint="Resizable" title="Table">
                  <EmptyState
                    detail="Center bottom pane"
                    label="Tabular View"
                  />
                </PanelFrame>
              </Split.Pane>
            </Split>
          </Split.Pane>

          <Split.Resizer />

          <Split.Pane initialWidth={340} minWidth={220} maxWidth={520}>
            <PanelFrame hint="Resizable" title="Analytics">
              <EmptyState detail="Right workspace pane" label="Insights" />
            </PanelFrame>
          </Split.Pane>
        </Split>
      </Box>
    </Flex>
  );
}
