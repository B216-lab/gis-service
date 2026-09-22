import {
  Alert,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/i18n';
import { deleteObject, listConnections, listObjects, saveObject } from './api';
import { DatasetEditor, emptyDataset } from './DatasetEditor';
import type { Connection, Dataset } from './types';

const ImportPanel = lazy(() =>
  import('./ImportPanel').then((m) => ({ default: m.ImportPanel })),
);
const TransferPanel = lazy(() =>
  import('./TransferPanel').then((m) => ({ default: m.TransferPanel })),
);
const ChartBuilder = lazy(() =>
  import('./ChartBuilder').then((m) => ({ default: m.ChartBuilder })),
);
const DashboardBuilder = lazy(() =>
  import('./DashboardBuilder').then((m) => ({ default: m.DashboardBuilder })),
);

export function AnalyticsWorkspace() {
  const { language } = useI18n();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState<Dataset | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const [tab, setTab] = useState<string | null>('datasets');
  const reload = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [items, sources] = await Promise.all([
        listObjects<Dataset>('datasets'),
        listConnections(),
      ]);
      setDatasets(items);
      setSelected((current) => current ?? items[0] ?? null);
      setConnections(sources);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load analytics.',
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function save(dataset: Dataset) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await saveObject('datasets', dataset, dataset.revision > 0);
      setSelected(saved);
      setDatasets((items) => [
        ...items.filter((item) => item.id !== saved.id),
        saved,
      ]);
      setNotice('Dataset saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }
  async function remove(dataset: Dataset) {
    setBusy(true);
    setError('');
    try {
      await deleteObject('datasets', dataset);
      setDatasets((items) => items.filter((item) => item.id !== dataset.id));
      setSelected(null);
      setNotice('Dataset deleted.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack p="md" maw={1300} mx="auto">
      <Group justify="space-between">
        <Title order={2}>Analytics</Title>
      </Group>
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="datasets">Datasets</Tabs.Tab>
          <Tabs.Tab value="charts">Charts</Tabs.Tab>
          <Tabs.Tab value="dashboards">Dashboards</Tabs.Tab>
          <Tabs.Tab value="transfer">Export / import</Tabs.Tab>
          <Tabs.Tab value="import">Import reference</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="datasets" pt="md">
          <Group align="end">
            <Select
              label={`Dataset catalog (${datasets.length})`}
              searchable
              placeholder="Choose a saved dataset"
              renderOption={({ option }) => (
                <span translate="no">{option.label}</span>
              )}
              data={datasets.map((d) => ({ value: d.id, label: d.name }))}
              value={selected?.revision ? selected.id : null}
              onChange={(id) => {
                setSelected(datasets.find((d) => d.id === id) || null);
                setNotice('');
              }}
              miw={280}
            />
            <Button
              onClick={() => {
                setSelected(emptyDataset(connections[0]?.id, language));
                setNotice('');
              }}
            >
              New dataset
            </Button>
            <Button
              variant="default"
              loading={busy}
              onClick={() => void reload()}
            >
              Refresh catalog
            </Button>
            {selected?.revision ? (
              <Button
                variant="default"
                onClick={() => {
                  const latest = datasets.find((d) => d.id === selected.id);
                  if (latest) {
                    setSelected({ ...latest });
                    setEditorVersion((v) => v + 1);
                  }
                }}
              >
                Reload selected
              </Button>
            ) : null}
          </Group>
          {error && (
            <Alert color="red" title="Analytics request failed">
              {error}
            </Alert>
          )}
          {notice && <Alert color="green">{notice}</Alert>}
          {selected ? (
            <DatasetEditor
              key={`${selected.id}:${selected.revision}:${selected.updatedAt || ''}:${editorVersion}`}
              dataset={selected}
              datasets={datasets}
              connections={connections}
              onSave={save}
              onDelete={remove}
              saving={busy}
            />
          ) : (
            <Text c="dimmed">
              Choose a dataset or create one from a server connection.
            </Text>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="import" pt="md">
          <Suspense fallback={<Loader />}>
            <ImportPanel
              connections={connections}
              onImported={async () => {
                await reload();
              }}
            />
          </Suspense>
        </Tabs.Panel>
        <Tabs.Panel value="transfer" pt="md">
          <Suspense fallback={<Loader />}>
            <TransferPanel
              connections={connections}
              onImported={async () => {
                await reload();
              }}
            />
          </Suspense>
        </Tabs.Panel>
        <Tabs.Panel value="charts" pt="md">
          <Suspense fallback={<Loader />}>
            <ChartBuilder datasets={datasets} />
          </Suspense>
        </Tabs.Panel>
        <Tabs.Panel value="dashboards" pt="md">
          <Suspense fallback={<Loader />}>
            <DashboardBuilder datasets={datasets} />
          </Suspense>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
