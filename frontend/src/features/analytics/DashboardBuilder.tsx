import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Grid,
  Group,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { analyticsRequest, deleteObject, listObjects, saveObject } from './api';
import { DashboardViewer } from './DashboardViewer';
import { filtersForWidget, placeWidgets } from './dashboard-filters';
import type {
  Chart,
  Dashboard,
  Dataset,
  Filter,
  Metadata,
  Publication,
  Share,
  Widget,
} from './types';

function emptyDashboard(): Dashboard {
  return {
    id: crypto.randomUUID(),
    revision: 0,
    name: '',
    description: '',
    widgets: [],
    filters: [],
  };
}
export function DashboardBuilder({ datasets }: { datasets: Dataset[] }) {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [charts, setCharts] = useState<Chart[]>([]);
  const [draft, setDraft] = useState<Dashboard | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [chartId, setChartId] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>('layout');
  const [dragged, setDragged] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [publication, setPublication] = useState<Publication | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [shareURL, setShareURL] = useState('');
  const [expiry, setExpiry] = useState('');
  const [includeFilters, setIncludeFilters] = useState(true);
  const [saveCurrentFilters, setSaveCurrentFilters] = useState(true);
  const [publications, setPublications] = useState<Metadata[]>([]);
  const initialCatalogLoaded = useRef(false);
  async function loadPublications() {
    if (!draft?.revision) return;
    try {
      setPublications(
        await listObjects<Metadata>(`dashboards/${draft.id}/publications`),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Publication list unavailable.',
      );
    }
  }
  async function choosePublication(id: string | null) {
    if (!id) return;
    try {
      const [value, links] = await Promise.all([
        analyticsRequest<Publication>(`/publications/${id}`),
        listObjects<Share>(`publications/${id}/shares`),
      ]);
      setPublication(value);
      setShares(links);
      setShareURL('');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Publication unavailable.',
      );
    }
  }
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const reload = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [items, savedCharts] = await Promise.all([
        listObjects<Dashboard>('dashboards'),
        listObjects<Chart>('charts'),
      ]);
      setDashboards(items);
      setCharts(savedCharts);
      if (!initialCatalogLoaded.current) {
        initialCatalogLoaded.current = true;
        if (items[0]) {
          const first = structuredClone(items[0]);
          setDraft(first);
          setFilters(first.filters || []);
        }
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Dashboard catalog unavailable.',
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  function choose(value: Dashboard | null) {
    setDraft(value ? structuredClone(value) : null);
    setFilters(value?.filters || []);
    setPublication(null);
    setPublications([]);
    setShareURL('');
    setShares([]);
    setError('');
    setNotice('');
    setDeleteConfirm(false);
  }
  function patch(update: Partial<Dashboard>) {
    setDraft((old) => (old ? { ...old, ...update } : old));
  }
  function widgets(next: Widget[]) {
    patch({ widgets: placeWidgets(next) });
  }
  function add(kind: 'chart' | 'text' | 'heading') {
    if (!draft || (kind === 'chart' && !chartId)) return;
    widgets([
      ...draft.widgets,
      {
        id: crypto.randomUUID(),
        chartId: kind === 'chart' ? chartId || undefined : undefined,
        text:
          kind === 'heading'
            ? '# New section'
            : kind === 'text'
              ? 'Dashboard notes'
              : undefined,
        x: 0,
        y: 0,
        w: kind === 'chart' ? 6 : 12,
        h: kind === 'chart' ? 4 : 1,
      },
    ]);
  }
  function move(source: string, target: string) {
    if (!draft || source === target) return;
    const items = [...draft.widgets];
    const from = items.findIndex((w) => w.id === source);
    const to = items.findIndex((w) => w.id === target);
    if (from < 0 || to < 0) return;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    widgets(items);
  }
  // Pin explicit compatible scopes before defaults/shares become immutable restrictions.
  function scopedFilters(active: Filter[]) {
    if (!draft) return [];
    const scoped = active.map((filter) => ({
      ...filter,
      targetWidgetIds: draft.widgets
        .filter((widget) => {
          const chart = charts.find((c) => c.id === widget.chartId);
          if (!chart) return false;
          const queries =
            chart.type === 'compositeMap'
              ? charts.filter((c) => chart.layerChartIds?.includes(c.id))
              : [chart];
          return queries.every(
            (c) => filtersForWidget([filter], widget, c, datasets).length > 0,
          );
        })
        .map((widget) => widget.id),
    }));
    if (scoped.some((filter) => filter.targetWidgetIds.length === 0))
      throw new Error(
        'A filter has no compatible target charts. Clear it or change its scope before saving.',
      );
    return scoped;
  }
  async function save() {
    if (!draft) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await saveObject(
        'dashboards',
        {
          ...draft,
          filters: saveCurrentFilters ? scopedFilters(filters) : draft.filters,
        },
        draft.revision > 0,
      );
      setDraft(saved);
      setDashboards((all) => [...all.filter((d) => d.id !== saved.id), saved]);
      setNotice('Dashboard and current filters saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!draft?.revision) return;
    setBusy(true);
    setError('');
    try {
      const snapshot = await analyticsRequest<Publication>(
        `/dashboards/${encodeURIComponent(draft.id)}/publish`,
        { method: 'POST', body: JSON.stringify({ revision: draft.revision }) },
      );
      setPublication(snapshot);
      setPublications((items) => [...items, snapshot]);
      setShares([]);
      setShareURL('');
      setNotice(
        'Published saved revision. Draft changes require saving and publishing again.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Publish failed.');
    } finally {
      setBusy(false);
    }
  }
  async function createShare() {
    if (!publication) return;
    setBusy(true);
    setError('');
    try {
      const expiresAt = expiry ? new Date(expiry).toISOString() : '';
      const result = await analyticsRequest<{ share: Share; token: string }>(
        `/publications/${publication.id}/shares`,
        {
          method: 'POST',
          body: JSON.stringify({
            expiresAt,
            filters: includeFilters ? scopedFilters(filters) : [],
          }),
        },
      );
      setShares((all) => [...all, result.share]);
      const url = new URL(window.location.href);
      url.search = '';
      url.searchParams.set('dashboardShare', result.token);
      setShareURL(url.toString());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Share creation failed.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function revoke(share: Share) {
    setError('');
    try {
      await deleteObject('shares', share);
      setShares((all) =>
        all.map((item) =>
          item.id === share.id ? { ...item, revoked: true } : item,
        ),
      );
      setShareURL('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Revocation failed.');
    }
  }
  return (
    <Stack>
      <Group align="end">
        <Select
          label={`Dashboard catalog (${dashboards.length})`}
          searchable
          renderOption={({ option }) => (
            <span translate="no">{option.label}</span>
          )}
          data={dashboards.map((d) => ({ value: d.id, label: d.name }))}
          value={draft?.revision ? draft.id : null}
          onChange={(id) => choose(dashboards.find((d) => d.id === id) || null)}
          miw={260}
        />
        <Button onClick={() => choose(emptyDashboard())}>New dashboard</Button>
        <Button variant="default" loading={busy} onClick={() => void reload()}>
          Refresh dashboards and charts
        </Button>
        {draft?.revision ? (
          <Button
            variant="default"
            onClick={() =>
              choose(dashboards.find((d) => d.id === draft.id) || null)
            }
          >
            Reload dashboard
          </Button>
        ) : null}
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      {notice && <Alert color="green">{notice}</Alert>}
      {draft && (
        <>
          <Group grow>
            <TextInput
              label="Dashboard name"
              required
              value={draft.name}
              onChange={(e) => patch({ name: e.currentTarget.value })}
            />
            <TextInput
              label="Description"
              value={draft.description || ''}
              onChange={(e) => patch({ description: e.currentTarget.value })}
            />
          </Group>
          <Group>
            <Badge>Revision {draft.revision}</Badge>
            <Checkbox
              label="Save current selections as default filters"
              checked={saveCurrentFilters}
              onChange={(e) => setSaveCurrentFilters(e.currentTarget.checked)}
            />
            <NumberInput
              label="Auto refresh (seconds; 0 = off, minimum 30)"
              min={0}
              max={604800}
              allowDecimal={false}
              value={draft.refreshIntervalSeconds || 0}
              onChange={(value) =>
                patch({ refreshIntervalSeconds: Number(value) || 0 })
              }
            />
            <Button
              loading={busy}
              disabled={!draft.name || !draft.widgets.length}
              onClick={() => void save()}
            >
              Save dashboard and filters
            </Button>
            {draft.revision > 0 && (
              <Button
                variant="subtle"
                color="red"
                onClick={() => setDeleteConfirm(!deleteConfirm)}
              >
                Delete dashboard
              </Button>
            )}
          </Group>
          {deleteConfirm && (
            <Alert color="red" title="Delete dashboard definition?">
              <Group>
                <Button
                  color="red"
                  onClick={() => {
                    setBusy(true);
                    deleteObject('dashboards', draft)
                      .then(() => {
                        setDashboards((all) =>
                          all.filter((d) => d.id !== draft.id),
                        );
                        choose(null);
                      })
                      .catch((cause) => setError(cause.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  Confirm dashboard deletion
                </Button>
                <Button
                  variant="default"
                  onClick={() => setDeleteConfirm(false)}
                >
                  Cancel
                </Button>
              </Group>
            </Alert>
          )}
          <Tabs value={mode} onChange={setMode} keepMounted={false}>
            <Tabs.List>
              <Tabs.Tab value="layout">Layout</Tabs.Tab>
              <Tabs.Tab value="view">Interactive preview</Tabs.Tab>
              <Tabs.Tab value="share">Publish and share</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="layout" pt="md">
              <Stack>
                <Group align="end">
                  <Select
                    label="Saved chart"
                    searchable
                    renderOption={({ option }) => (
                      <span translate="no">{option.label}</span>
                    )}
                    data={charts.map((chart) => ({
                      value: chart.id,
                      label: chart.name,
                    }))}
                    value={chartId}
                    onChange={setChartId}
                    miw={280}
                  />
                  <Button disabled={!chartId} onClick={() => add('chart')}>
                    Add chart
                  </Button>
                  <Button variant="light" onClick={() => add('heading')}>
                    Add section heading
                  </Button>
                  <Button variant="light" onClick={() => add('text')}>
                    Add text
                  </Button>
                </Group>
                <Paper withBorder p="sm">
                  <Stack>
                    <Title order={4}>Dashboard filter controls</Title>
                    {(draft.nativeFilters || []).map((binding) => (
                      <Group key={binding.id} align="end">
                        <TextInput
                          label="Filter title"
                          value={binding.name}
                          onChange={(e) =>
                            patch({
                              nativeFilters: draft.nativeFilters?.map((item) =>
                                item.id === binding.id
                                  ? { ...item, name: e.currentTarget.value }
                                  : item,
                              ),
                            })
                          }
                        />
                        <Select
                          label="Filter dataset"
                          renderOption={({ option }) => (
                            <span translate="no">{option.label}</span>
                          )}
                          data={datasets.map((d) => ({
                            value: d.id,
                            label: d.name,
                          }))}
                          value={binding.datasetId}
                          onChange={(value) =>
                            patch({
                              nativeFilters: draft.nativeFilters?.map((item) =>
                                item.id === binding.id
                                  ? {
                                      ...item,
                                      datasetId: value || '',
                                      fieldId: '',
                                    }
                                  : item,
                              ),
                            })
                          }
                        />
                        <Select
                          label="Filter column"
                          data={(
                            datasets.find((d) => d.id === binding.datasetId)
                              ?.fields || []
                          ).map((f) => ({ value: f.id, label: f.name }))}
                          value={binding.fieldId}
                          onChange={(value) =>
                            patch({
                              nativeFilters: draft.nativeFilters?.map((item) =>
                                item.id === binding.id
                                  ? { ...item, fieldId: value || '' }
                                  : item,
                              ),
                            })
                          }
                        />
                        <MultiSelect
                          label="Filter target charts"
                          renderOption={({ option }) => (
                            <span translate="no">{option.label}</span>
                          )}
                          data={draft.widgets
                            .filter((w) => w.chartId)
                            .map((w) => ({
                              value: w.id,
                              label:
                                charts.find((c) => c.id === w.chartId)?.name ||
                                w.id,
                            }))}
                          value={binding.targetWidgetIds || []}
                          onChange={(value) =>
                            patch({
                              nativeFilters: draft.nativeFilters?.map((item) =>
                                item.id === binding.id
                                  ? { ...item, targetWidgetIds: value }
                                  : item,
                              ),
                            })
                          }
                        />
                        <Button
                          color="red"
                          variant="subtle"
                          onClick={() =>
                            patch({
                              nativeFilters: draft.nativeFilters?.filter(
                                (item) => item.id !== binding.id,
                              ),
                            })
                          }
                        >
                          Remove filter control
                        </Button>
                      </Group>
                    ))}
                    <Button
                      variant="light"
                      onClick={() =>
                        patch({
                          nativeFilters: [
                            ...(draft.nativeFilters || []),
                            {
                              id: crypto.randomUUID(),
                              name: 'Filter',
                              datasetId: datasets[0]?.id || '',
                              fieldId: datasets[0]?.fields[0]?.id || '',
                            },
                          ],
                        })
                      }
                    >
                      Add filter control
                    </Button>
                  </Stack>
                </Paper>
                <Text c="dimmed" size="sm">
                  Drag cards to reorder. Width uses 12 columns; mobile stacks
                  cards. Height controls chart area.
                </Text>
                <Grid>
                  {draft.widgets.map((widget, index) => (
                    <Grid.Col key={widget.id} span={{ base: 12, sm: widget.w }}>
                      <Paper
                        withBorder
                        p="sm"
                        draggable
                        onDragStart={(event) => {
                          setDragged(widget.id);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', widget.id);
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          move(
                            dragged || event.dataTransfer.getData('text/plain'),
                            widget.id,
                          );
                          setDragged(null);
                        }}
                        style={{ cursor: 'grab' }}
                      >
                        <Stack gap="xs">
                          <Group justify="space-between">
                            <Text
                              fw={600}
                              translate={widget.chartId ? 'no' : undefined}
                            >
                              {widget.chartId
                                ? charts.find(
                                    (chart) => chart.id === widget.chartId,
                                  )?.name || 'Missing chart'
                                : widget.text?.startsWith('# ')
                                  ? 'Section heading'
                                  : 'Text block'}
                            </Text>
                            <Button
                              size="compact-xs"
                              color="red"
                              variant="subtle"
                              onClick={() =>
                                widgets(
                                  draft.widgets.filter(
                                    (item) => item.id !== widget.id,
                                  ),
                                )
                              }
                            >
                              Remove widget
                            </Button>
                          </Group>
                          {!widget.chartId && (
                            <Textarea
                              label="Text"
                              value={widget.text || ''}
                              onChange={(event) =>
                                widgets(
                                  draft.widgets.map((item) =>
                                    item.id === widget.id
                                      ? {
                                          ...item,
                                          text: event.currentTarget.value,
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                          )}
                          <Group grow>
                            <NumberInput
                              label="Width (columns)"
                              min={1}
                              max={12}
                              allowDecimal={false}
                              value={widget.w}
                              onChange={(value) =>
                                widgets(
                                  draft.widgets.map((item) =>
                                    item.id === widget.id
                                      ? { ...item, w: Number(value) || 1 }
                                      : item,
                                  ),
                                )
                              }
                            />
                            <NumberInput
                              label="Height (units)"
                              min={1}
                              max={12}
                              allowDecimal={false}
                              value={widget.h}
                              onChange={(value) =>
                                widgets(
                                  draft.widgets.map((item) =>
                                    item.id === widget.id
                                      ? { ...item, h: Number(value) || 1 }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </Group>
                          {widget.chartId && (
                            <MultiSelect
                              label="Selection targets (empty = compatible charts)"
                              renderOption={({ option }) => (
                                <span translate="no">{option.label}</span>
                              )}
                              data={draft.widgets
                                .filter(
                                  (item) =>
                                    item.chartId && item.id !== widget.id,
                                )
                                .map((item) => ({
                                  value: item.id,
                                  label:
                                    charts.find((c) => c.id === item.chartId)
                                      ?.name || item.id,
                                }))}
                              value={widget.filterTargetWidgetIds || []}
                              onChange={(value) =>
                                widgets(
                                  draft.widgets.map((item) =>
                                    item.id === widget.id
                                      ? {
                                          ...item,
                                          filterTargetWidgetIds: value,
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                          )}
                          <Group>
                            <Button
                              size="compact-xs"
                              variant="default"
                              disabled={index === 0}
                              onClick={() =>
                                move(widget.id, draft.widgets[index - 1].id)
                              }
                            >
                              Move earlier
                            </Button>
                            <Button
                              size="compact-xs"
                              variant="default"
                              disabled={index === draft.widgets.length - 1}
                              onClick={() =>
                                move(widget.id, draft.widgets[index + 1].id)
                              }
                            >
                              Move later
                            </Button>
                          </Group>
                        </Stack>
                      </Paper>
                    </Grid.Col>
                  ))}
                </Grid>
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="view" pt="md">
              <DashboardViewer
                dashboard={draft}
                charts={charts}
                datasets={datasets}
                filters={filters}
                onFiltersChange={setFilters}
              />
            </Tabs.Panel>
            <Tabs.Panel value="share" pt="md">
              <Stack>
                <Group align="end">
                  <Select
                    label="Saved publications"
                    data={publications.map((p) => ({
                      value: p.id,
                      label: `${p.name} · ${p.updatedAt ? new Date(p.updatedAt).toLocaleString() : p.id.slice(0, 8)}`,
                    }))}
                    value={publication?.id || null}
                    onChange={(id) => void choosePublication(id)}
                    miw={280}
                  />
                  <Button
                    variant="default"
                    disabled={!draft.revision}
                    onClick={() => void loadPublications()}
                  >
                    Load publications
                  </Button>
                </Group>
                <Text>
                  Publish the saved revision to freeze chart and dataset
                  definitions. Source data stays live.
                </Text>
                <Button
                  disabled={!draft.revision}
                  loading={busy}
                  onClick={() => void publish()}
                >
                  Publish saved dashboard
                </Button>
                {publication && (
                  <Paper withBorder p="md">
                    <Stack>
                      <Title order={4}>Published revision</Title>
                      <TextInput
                        label="Authenticated viewer link"
                        readOnly
                        value={`${window.location.origin}${window.location.pathname}?analyticsPublication=${publication.id}`}
                      />
                      <TextInput
                        label="Public link expiry (optional)"
                        type="datetime-local"
                        value={expiry}
                        onChange={(e) => setExpiry(e.currentTarget.value)}
                      />
                      <Checkbox
                        label="Lock current filters into public link"
                        checked={includeFilters}
                        onChange={(e) =>
                          setIncludeFilters(e.currentTarget.checked)
                        }
                      />
                      <Button loading={busy} onClick={() => void createShare()}>
                        Create public link
                      </Button>
                      {shareURL && (
                        <TextInput
                          label="Public dashboard link (copy now)"
                          readOnly
                          value={shareURL}
                          onFocus={(e) => e.currentTarget.select()}
                        />
                      )}
                      <Button
                        variant="default"
                        onClick={() => {
                          listObjects<Share>(
                            `publications/${publication.id}/shares`,
                          )
                            .then(setShares)
                            .catch((cause) => setError(cause.message));
                        }}
                      >
                        Refresh shares
                      </Button>
                      {shares.map((share) => (
                        <Group justify="space-between" key={share.id}>
                          <Text size="sm">
                            {share.id.slice(0, 12)} ·{' '}
                            {share.expiresAt
                              ? new Date(share.expiresAt).toLocaleString()
                              : 'No expiry'}
                          </Text>
                          <Button
                            size="xs"
                            color="red"
                            variant="light"
                            disabled={share.revoked}
                            onClick={() => void revoke(share)}
                          >
                            {share.revoked ? 'Revoked' : 'Revoke link'}
                          </Button>
                        </Group>
                      ))}
                    </Stack>
                  </Paper>
                )}
              </Stack>
            </Tabs.Panel>
          </Tabs>
        </>
      )}
    </Stack>
  );
}
