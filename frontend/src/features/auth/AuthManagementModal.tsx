import {
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCheck,
  IconCopy,
  IconKey,
  IconRefresh,
  IconTrash,
  IconUsers,
} from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import type { RevealedApiToken, WorkspaceRole } from './management-api';
import { useAuthManagementStore } from './management-store';
import type { AuthUser } from './store';

const roles: WorkspaceRole[] = ['viewer', 'editor', 'publisher', 'admin'];

export const tokenScopePresets = {
  'read-only': {
    label: 'Read-only analytics',
    scopes: ['analytics:read', 'dashboards:read', 'datasets:read'],
  },
  author: {
    label: 'Dashboard author',
    scopes: [
      'analytics:read',
      'analytics:write',
      'dashboards:read',
      'dashboards:write',
      'datasets:read',
    ],
  },
  publisher: {
    label: 'Publisher',
    scopes: [
      'analytics:read',
      'analytics:write',
      'dashboards:read',
      'dashboards:write',
      'datasets:read',
      'publish:write',
      'shares:write',
    ],
  },
  automation: {
    label: 'Automation admin',
    scopes: [
      'analytics:read',
      'analytics:write',
      'dashboards:read',
      'dashboards:write',
      'datasets:read',
      'datasets:write',
      'publish:write',
      'shares:write',
      'auth:tokens:read',
      'auth:tokens:write',
      'auth:workspaces:read',
      'auth:workspaces:write',
      'auth:members:read',
      'auth:members:write',
    ],
  },
} as const;

type ScopePreset = keyof typeof tokenScopePresets;

export function tokenLifecycleStatus(token: {
  expires_at: string;
  revoked_at?: string;
}) {
  if (token.revoked_at) return 'revoked';
  if (new Date(token.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}

function formatDate(value?: string) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function SecretReveal({
  revealed,
  onClose,
}: {
  revealed: RevealedApiToken | null;
  onClose: () => void;
}) {
  return (
    <Modal
      centered
      closeOnClickOutside={false}
      onClose={onClose}
      opened={revealed !== null}
      title="Copy API token now"
    >
      {revealed ? (
        <Stack>
          <Alert color="yellow" icon={<IconAlertCircle size={18} />}>
            This secret is shown once. Store it securely before closing.
          </Alert>
          <Code block style={{ overflowWrap: 'anywhere' }}>
            {revealed.token}
          </Code>
          <CopyButton timeout={2000} value={revealed.token}>
            {({ copied, copy }) => (
              <Button
                color={copied ? 'teal' : 'blue'}
                leftSection={
                  copied ? <IconCheck size={16} /> : <IconCopy size={16} />
                }
                onClick={copy}
              >
                {copied ? 'Copied' : 'Copy token'}
              </Button>
            )}
          </CopyButton>
          <Button onClick={onClose} variant="default">
            I saved it
          </Button>
        </Stack>
      ) : null}
    </Modal>
  );
}

function CurrentUserPanel({ user }: { user: AuthUser }) {
  return (
    <Paper p="md" withBorder>
      <Stack gap="xs">
        <Title order={4}>Current user</Title>
        <Text fw={600}>{user.subject}</Text>
        <Group gap="xs">
          {user.groups.map((group) => (
            <Badge key={group} variant="light">
              {group}
            </Badge>
          ))}
          {user.groups.length === 0 ? (
            <Text c="dimmed" size="sm">
              No identity groups
            </Text>
          ) : null}
        </Group>
      </Stack>
    </Paper>
  );
}

function MembersPanel() {
  const members = useAuthManagementStore((state) => state.members);
  const busy = useAuthManagementStore((state) => state.busy);
  const saveMember = useAuthManagementStore((state) => state.saveMember);
  const removeMember = useAuthManagementStore((state) => state.removeMember);
  const [subject, setSubject] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('viewer');

  async function submitMember() {
    const normalizedSubject = subject.trim();
    if (!normalizedSubject) return;
    try {
      await saveMember(normalizedSubject, role);
      setSubject('');
      setRole('viewer');
    } catch {
      // Store exposes a user-safe error alert.
    }
  }

  return (
    <Stack>
      <Paper p="md" withBorder>
        <Stack gap="sm">
          <Text fw={600}>Add or update member</Text>
          <Group align="end" grow>
            <TextInput
              label="OIDC subject"
              onChange={(event) => setSubject(event.currentTarget.value)}
              placeholder="user subject ID"
              value={subject}
            />
            <Select
              allowDeselect={false}
              data={roles}
              label="Role"
              onChange={(value) => setRole(value as WorkspaceRole)}
              value={role}
            />
            <Button
              loading={busy === `member:${subject.trim()}`}
              onClick={() => void submitMember()}
            >
              Save member
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Table.ScrollContainer minWidth={620}>
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Subject</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Groups</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {members.map((member) => (
              <Table.Tr key={member.subject}>
                <Table.Td>{member.subject}</Table.Td>
                <Table.Td>
                  <Select
                    allowDeselect={false}
                    data={roles}
                    disabled={busy === `member:${member.subject}`}
                    onChange={(value) => {
                      if (value)
                        void saveMember(
                          member.subject,
                          value as WorkspaceRole,
                        ).catch(() => undefined);
                    }}
                    size="xs"
                    value={member.role}
                  />
                </Table.Td>
                <Table.Td>{member.groups?.join(', ') || '—'}</Table.Td>
                <Table.Td>
                  <Button
                    color="red"
                    disabled={busy === `member:${member.subject}`}
                    leftSection={<IconTrash size={14} />}
                    onClick={() => {
                      if (window.confirm(`Remove ${member.subject}?`))
                        void removeMember(member.subject).catch(
                          () => undefined,
                        );
                    }}
                    size="xs"
                    variant="subtle"
                  >
                    Remove
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {members.length === 0 ? (
        <Text c="dimmed" ta="center">
          No members returned for this workspace.
        </Text>
      ) : null}
    </Stack>
  );
}

function TokensPanel({
  onReveal,
}: {
  onReveal: (token: RevealedApiToken) => void;
}) {
  const tokens = useAuthManagementStore((state) => state.tokens);
  const busy = useAuthManagementStore((state) => state.busy);
  const createToken = useAuthManagementStore((state) => state.createToken);
  const revokeToken = useAuthManagementStore((state) => state.revokeToken);
  const rotateToken = useAuthManagementStore((state) => state.rotateToken);
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<ScopePreset>('read-only');
  const [expiryDays, setExpiryDays] = useState('30');

  async function submitToken() {
    try {
      const expiresAt = new Date();
      expiresAt.setUTCDate(expiresAt.getUTCDate() + Number(expiryDays));
      const scopes = Object.fromEntries(
        tokenScopePresets[preset].scopes.map((scope) => [scope, true]),
      );
      const created = await createToken({
        name: name.trim(),
        scopes,
        expires_at: expiresAt.toISOString(),
      });
      setName('');
      onReveal(created);
    } catch {
      // Store exposes a user-safe error alert.
    }
  }

  return (
    <Stack>
      <Paper p="md" withBorder>
        <Stack gap="sm">
          <Text fw={600}>Create scoped token</Text>
          <Group align="end" grow>
            <TextInput
              label="Name"
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="CI analytics"
              value={name}
            />
            <Select
              allowDeselect={false}
              data={Object.entries(tokenScopePresets).map(([value, item]) => ({
                value,
                label: item.label,
              }))}
              label="Scope preset"
              onChange={(value) => setPreset(value as ScopePreset)}
              value={preset}
            />
            <Select
              allowDeselect={false}
              data={[
                { value: '7', label: '7 days' },
                { value: '30', label: '30 days' },
                { value: '90', label: '90 days' },
              ]}
              label="Expires in"
              onChange={(value) => value && setExpiryDays(value)}
              value={expiryDays}
            />
            <Button
              leftSection={<IconKey size={16} />}
              loading={busy === 'token:create'}
              onClick={() => void submitToken()}
            >
              Create token
            </Button>
          </Group>
          <Text c="dimmed" size="xs">
            Scopes: {tokenScopePresets[preset].scopes.join(', ')}
          </Text>
        </Stack>
      </Paper>

      <Table.ScrollContainer minWidth={880}>
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Token</Table.Th>
              <Table.Th>Scopes</Table.Th>
              <Table.Th>Expires</Table.Th>
              <Table.Th>Last used</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {tokens.map((token) => {
              const status = tokenLifecycleStatus(token);
              const active = status === 'active';
              return (
                <Table.Tr key={token.id}>
                  <Table.Td>
                    <Text fw={600} size="sm">
                      {token.name || token.prefix}
                    </Text>
                    {token.name ? (
                      <Text c="dimmed" size="xs">
                        {token.prefix}…
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td>
                    {Object.entries(token.scopes)
                      .filter(([, enabled]) => enabled)
                      .map(([scope]) => scope)
                      .join(', ') || '—'}
                  </Table.Td>
                  <Table.Td>{formatDate(token.expires_at)}</Table.Td>
                  <Table.Td>{formatDate(token.last_used_at)}</Table.Td>
                  <Table.Td>
                    <Badge
                      color={
                        status === 'active'
                          ? 'teal'
                          : status === 'expired'
                            ? 'yellow'
                            : 'red'
                      }
                    >
                      {status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Button
                        disabled={!active || busy === `token:${token.id}`}
                        leftSection={<IconRefresh size={14} />}
                        onClick={() => {
                          if (
                            window.confirm(
                              'Rotate this token? The current secret will stop working immediately.',
                            )
                          )
                            void rotateToken(token.id)
                              .then(onReveal)
                              .catch(() => undefined);
                        }}
                        size="xs"
                        variant="subtle"
                      >
                        Rotate
                      </Button>
                      <Button
                        color="red"
                        disabled={!active || busy === `token:${token.id}`}
                        leftSection={<IconTrash size={14} />}
                        onClick={() => {
                          if (
                            window.confirm(
                              'Revoke this token? This cannot be undone.',
                            )
                          )
                            void revokeToken(token.id).catch(() => undefined);
                        }}
                        size="xs"
                        variant="subtle"
                      >
                        Revoke
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {tokens.length === 0 ? (
        <Text c="dimmed" ta="center">
          No API tokens in this workspace.
        </Text>
      ) : null}
    </Stack>
  );
}

export function AuthManagementModal({
  opened,
  onClose,
  user,
}: {
  opened: boolean;
  onClose: () => void;
  user: AuthUser;
}) {
  const workspaces = useAuthManagementStore((state) => state.workspaces);
  const selectedWorkspaceId = useAuthManagementStore(
    (state) => state.selectedWorkspaceId,
  );
  const loading = useAuthManagementStore((state) => state.loading);
  const error = useAuthManagementStore((state) => state.error);
  const initialize = useAuthManagementStore((state) => state.initialize);
  const selectWorkspace = useAuthManagementStore(
    (state) => state.selectWorkspace,
  );
  const clearError = useAuthManagementStore((state) => state.clearError);
  const [revealedToken, setRevealedToken] = useState<RevealedApiToken | null>(
    null,
  );

  useEffect(() => {
    if (opened) void initialize(user.workspace);
  }, [initialize, opened, user.workspace]);

  const workspaceOptions = useMemo(
    () =>
      workspaces.map((workspace) => ({
        value: workspace.id,
        label: workspace.name || workspace.id,
      })),
    [workspaces],
  );

  function close() {
    setRevealedToken(null);
    clearError();
    onClose();
  }

  return (
    <>
      <Modal
        onClose={close}
        opened={opened}
        size="min(1100px, 95vw)"
        title="Workspace access"
      >
        <Stack>
          <Group align="end" justify="space-between">
            <Select
              allowDeselect={false}
              data={workspaceOptions}
              disabled={workspaceOptions.length === 0}
              label="Workspace"
              onChange={(value) => value && void selectWorkspace(value)}
              placeholder="No workspace available"
              value={selectedWorkspaceId}
              w={320}
            />
            {loading ? <Loader size="sm" /> : null}
          </Group>

          {error ? (
            <Alert
              color="red"
              icon={<IconAlertCircle size={18} />}
              title="Workspace management unavailable"
              withCloseButton
              onClose={clearError}
            >
              {error}
            </Alert>
          ) : null}

          <CurrentUserPanel user={user} />
          <Divider />

          <Tabs defaultValue="members">
            <Tabs.List>
              <Tabs.Tab leftSection={<IconUsers size={15} />} value="members">
                Members
              </Tabs.Tab>
              <Tabs.Tab leftSection={<IconKey size={15} />} value="tokens">
                API tokens
              </Tabs.Tab>
            </Tabs.List>
            <ScrollArea.Autosize mah="60vh" mt="md" offsetScrollbars>
              <Tabs.Panel value="members">
                <MembersPanel />
              </Tabs.Panel>
              <Tabs.Panel value="tokens">
                <TokensPanel onReveal={setRevealedToken} />
              </Tabs.Panel>
            </ScrollArea.Autosize>
          </Tabs>
        </Stack>
      </Modal>
      <SecretReveal
        onClose={() => setRevealedToken(null)}
        revealed={revealedToken}
      />
    </>
  );
}
