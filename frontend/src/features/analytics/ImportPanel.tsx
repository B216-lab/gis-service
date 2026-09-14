import {
  Alert,
  Button,
  Group,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
} from '@mantine/core';
import { useState } from 'react';
import { analyticsRequest } from './api';
import type { Connection } from './types';

type ImportReport = {
  dashboardId: string;
  datasetIds: string[];
  chartIds: string[];
  created: number;
  updated: number;
  unchanged: number;
  warnings: { objectId: string; setting: string; message: string }[];
};

export function ImportPanel({
  connections,
  onImported,
}: {
  connections: Connection[];
  onImported: (dashboardId: string) => void | Promise<void>;
}) {
  const [connectionId, setConnectionId] = useState<string | null>(
    connections[0]?.id ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const selected = connectionId || connections[0]?.id || '';

  async function importReference() {
    setBusy(true);
    setError('');
    try {
      const result = await analyticsRequest<ImportReport>('/import-reference', {
        method: 'POST',
        body: JSON.stringify({ connectionId: selected }),
      });
      setReport(result);
      await onImported(result.dashboardId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Text fw={600}>Import movements dashboard</Text>
        <Text size="sm" c="dimmed">
          Create two datasets, twenty charts and the dashboard from the saved
          Superset reference. Reimport restores these imported definitions;
          other dashboards stay separate.
        </Text>
        <Group align="end">
          <Select
            label="Source connection"
            value={selected || null}
            onChange={setConnectionId}
            data={connections.map((connection) => ({
              value: connection.id,
              label: connection.name,
            }))}
            searchable
          />
          <Button loading={busy} disabled={!selected} onClick={importReference}>
            Import reference dashboard
          </Button>
        </Group>
        {error && <Alert color="red">{error}</Alert>}
        {report && (
          <>
            <Alert color="green">
              {report.created} created, {report.updated} updated,{' '}
              {report.unchanged} unchanged. Charts remain editable.
            </Alert>
            <Text size="sm" fw={600}>
              {report.warnings.length} migration notes
            </Text>
            <ScrollArea h={220}>
              <Stack gap="xs">
                {report.warnings.map((warning) => (
                  <Text
                    size="xs"
                    key={`${warning.objectId}:${warning.setting}`}
                  >
                    <strong>{warning.setting}</strong>: {warning.message} (
                    {warning.objectId})
                  </Text>
                ))}
              </Stack>
            </ScrollArea>
          </>
        )}
      </Stack>
    </Paper>
  );
}
