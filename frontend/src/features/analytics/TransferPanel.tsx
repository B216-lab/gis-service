import {
  Alert,
  Button,
  Checkbox,
  Divider,
  FileInput,
  Group,
  Paper,
  Select,
  Stack,
  Text,
} from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';
import { analyticsRequest, listObjects } from './api';
import type {
  Connection,
  Dashboard,
  DashboardBundle,
  DashboardImportReport,
} from './types';

function isDashboardBundle(value: unknown): value is DashboardBundle {
  if (!value || typeof value !== 'object') return false;
  const bundle = value as Partial<DashboardBundle>;
  return (
    bundle.format === 'geopanel-dashboard' &&
    bundle.version === 1 &&
    Boolean(bundle.dashboard?.id) &&
    Array.isArray(bundle.charts) &&
    Array.isArray(bundle.datasets)
  );
}

function downloadName(dashboard: Dashboard) {
  const safe = dashboard.name
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${safe || dashboard.id}.geopanel.json`;
}

export function TransferPanel({
  connections,
  onImported,
}: {
  connections: Connection[];
  onImported: (dashboardId: string) => void | Promise<void>;
}) {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [dashboardId, setDashboardId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [bundle, setBundle] = useState<DashboardBundle | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setDashboards(await listObjects<Dashboard>('dashboards'));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Dashboard catalog unavailable.',
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function exportDashboard() {
    if (!dashboardId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await analyticsRequest<DashboardBundle>(
        `/dashboards/${encodeURIComponent(dashboardId)}/export`,
      );
      const blob = new Blob([JSON.stringify(result, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = downloadName(result.dashboard);
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(
        `Exported ${result.charts.length} charts and ${result.datasets.length} datasets.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile(value: File | null) {
    setFile(value);
    setBundle(null);
    setMapping({});
    setNotice('');
    setError('');
    if (!value) return;
    try {
      const parsed: unknown = JSON.parse(await value.text());
      if (!isDashboardBundle(parsed))
        throw new Error(
          'Choose a GeoPanel dashboard bundle (format version 1).',
        );
      const sources = [...new Set(parsed.datasets.map((d) => d.connectionId))];
      const defaults: Record<string, string> = {};
      for (const source of sources) {
        const exact = connections.find(
          (connection) => connection.id === source,
        );
        defaults[source] =
          exact?.id || (connections.length === 1 ? connections[0].id : '');
      }
      setBundle(parsed);
      setMapping(defaults);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not read dashboard bundle.',
      );
    }
  }

  async function importDashboard() {
    if (!bundle) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await analyticsRequest<DashboardImportReport>(
        '/import-dashboard',
        {
          method: 'POST',
          body: JSON.stringify({ bundle, connectionMapping: mapping, replace }),
        },
      );
      setNotice(
        `Imported dashboard: ${result.created} created, ${result.updated} updated.`,
      );
      await onImported(result.dashboardId);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  const sourceConnections = bundle
    ? [...new Set(bundle.datasets.map((dataset) => dataset.connectionId))]
    : [];
  const mappingComplete = sourceConnections.every((source) => mapping[source]);

  return (
    <Stack gap="md">
      <Paper withBorder p="md">
        <Stack gap="sm">
          <Text fw={600}>Export dashboard</Text>
          <Text size="sm" c="dimmed">
            Download one JSON bundle containing the saved dashboard and all
            dependent charts and datasets. Data rows and database credentials
            are not included.
          </Text>
          <Group align="end">
            <Select
              label="Dashboard"
              searchable
              data={dashboards.map((dashboard) => ({
                value: dashboard.id,
                label: dashboard.name,
              }))}
              value={dashboardId}
              onChange={setDashboardId}
              miw={320}
            />
            <Button
              loading={busy}
              disabled={!dashboardId}
              onClick={() => void exportDashboard()}
            >
              Export JSON
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Paper withBorder p="md">
        <Stack gap="sm">
          <Text fw={600}>Import dashboard</Text>
          <Text size="sm" c="dimmed">
            Select an exported bundle, map each source database connection to a
            connection registered on this server, then import all definitions
            atomically.
          </Text>
          <FileInput
            label="Dashboard bundle"
            accept="application/json,.json"
            clearable
            value={file}
            onChange={(value) => void chooseFile(value)}
          />
          {bundle ? (
            <>
              <Alert color="blue">
                <span translate="no">{bundle.dashboard.name}</span>:{' '}
                {bundle.charts.length} charts, {bundle.datasets.length} datasets
              </Alert>
              <Divider label="Database connection mapping" />
              {sourceConnections.map((source) => (
                <Select
                  key={source}
                  label={`Source: ${source}`}
                  placeholder="Choose production connection"
                  searchable
                  data={connections.map((connection) => ({
                    value: connection.id,
                    label: connection.name,
                  }))}
                  value={mapping[source] || null}
                  onChange={(value) =>
                    setMapping((current) => ({
                      ...current,
                      [source]: value || '',
                    }))
                  }
                />
              ))}
              <Checkbox
                label="Replace analytics objects with matching IDs"
                description="Leave off for first import. Enable only when deploying an updated bundle."
                checked={replace}
                onChange={(event) => setReplace(event.currentTarget.checked)}
              />
              <Button
                loading={busy}
                disabled={!mappingComplete}
                onClick={() => void importDashboard()}
              >
                Import dashboard
              </Button>
            </>
          ) : null}
        </Stack>
      </Paper>
      {error && <Alert color="red">{error}</Alert>}
      {notice && <Alert color="green">{notice}</Alert>}
    </Stack>
  );
}
