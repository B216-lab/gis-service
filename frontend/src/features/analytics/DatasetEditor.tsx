import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { translateLabel, useI18n } from '../i18n/i18n';
import { previewDataset } from './api';
import { enumLabel, enumOptions } from './display-labels';
import type { Connection, Dataset, Field, QueryResult } from './types';

const types = ['string', 'number', 'integer', 'boolean', 'date', 'timestamp'];
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
interface Join {
  id: string;
  schema: string;
  table: string;
  alias: string;
  left: string;
  right: string;
  kind: string;
}
export function emptyDataset(
  connectionId = '',
  language: 'en' | 'ru' = 'en',
): Dataset {
  return {
    id: crypto.randomUUID(),
    name: '',
    revision: 0,
    connectionId,
    schema: 'public',
    table: '',
    fields: [],
    metrics: [
      {
        id: 'count',
        name: translateLabel('Count', language),
        expression: 'COUNT(*)',
      },
    ],
    relationships: [],
  };
}
export function DatasetEditor({
  dataset,
  datasets,
  connections,
  onSave,
  onDelete,
  saving,
}: {
  dataset: Dataset;
  datasets: Dataset[];
  connections: Connection[];
  onSave: (value: Dataset) => Promise<void>;
  onDelete: (value: Dataset) => Promise<void>;
  saving: boolean;
}) {
  const { language } = useI18n();
  const [value, setValue] = useState(dataset);
  const [mode, setMode] = useState<string | null>(
    dataset.sql ? 'sql' : 'table',
  );
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [joins, setJoins] = useState<Join[]>([]);
  const [projection, setProjection] = useState('base.*');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const patch = (update: Partial<Dataset>) => {
    setValue((old) => ({ ...old, ...update }));
    setResult(null);
  };
  const patchField = (index: number, update: Partial<Field>) =>
    patch({
      fields: value.fields.map((field, i) =>
        i === index ? { ...field, ...update } : field,
      ),
    });
  const materialize = (): Dataset =>
    mode === 'table'
      ? { ...value, sql: '' }
      : { ...value, schema: '', table: '' };
  async function preview() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError('');
    try {
      const response = await previewDataset(materialize(), current.signal);
      if (!current.signal.aborted) setResult(response);
    } catch (cause) {
      if (!current.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Preview failed.');
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }
  function generateSQL() {
    if (
      !value.table ||
      joins.some(
        (join) => !join.table || !join.alias || !join.left || !join.right,
      )
    ) {
      setError('Base table and every join table, alias and key are required.');
      return;
    }
    const sql = `SELECT ${projection}\nFROM ${quote(value.schema || 'public')}.${quote(value.table)} AS base${joins.map((join) => `\n${join.kind} JOIN ${quote(join.schema || 'public')}.${quote(join.table)} AS ${quote(join.alias)} ON base.${quote(join.left)} = ${quote(join.alias)}.${quote(join.right)}`).join('')}`;
    patch({ sql });
    setMode('sql');
    setError('');
  }
  function adoptColumns() {
    if (!result) return;
    patch({
      fields: [
        ...value.fields,
        ...result.columns
          .filter(
            (column) =>
              !value.fields.some((field) => field.name === column.name),
          )
          .map((column) => ({
            id: column.name,
            name: column.name,
            type: normalizeType(column.type),
          })),
      ],
    });
  }
  return (
    <Stack>
      <Group justify="space-between">
        <Text fw={700}>
          {dataset.revision ? 'Edit dataset' : 'New dataset'}
        </Text>
        <Badge>Revision {value.revision}</Badge>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput
          label="Dataset name"
          required
          value={value.name}
          onChange={(e) => patch({ name: e.currentTarget.value })}
        />
        <Select
          label="Server connection"
          required
          searchable
          renderOption={({ option }) => (
            <span translate="no">{option.label}</span>
          )}
          data={connections.map((c) => ({ value: c.id, label: c.name }))}
          value={value.connectionId}
          onChange={(v) => patch({ connectionId: v || '' })}
        />
        <TextInput
          label="Row grain"
          placeholder="One row per submission_id"
          value={value.grain || ''}
          onChange={(e) => patch({ grain: e.currentTarget.value })}
        />
        <Select
          label="Default date field"
          clearable
          renderOption={({ option }) => (
            <span translate="no">{option.label}</span>
          )}
          data={value.fields
            .filter((f) => f.id)
            .map((f) => ({ value: f.id, label: f.name || f.id }))}
          value={value.defaultTimeFieldId || null}
          onChange={(v) => patch({ defaultTimeFieldId: v || '' })}
        />
      </SimpleGrid>
      <Tabs value={mode} onChange={setMode}>
        <Tabs.List>
          <Tabs.Tab value="table">Physical table</Tabs.Tab>
          <Tabs.Tab value="sql">SQL / virtual table</Tabs.Tab>
          <Tabs.Tab value="visual">Visual joins</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="table" pt="sm">
          <Group grow>
            <TextInput
              label="Schema"
              value={value.schema || ''}
              onChange={(e) => patch({ schema: e.currentTarget.value })}
            />
            <TextInput
              label="Table"
              value={value.table || ''}
              onChange={(e) => patch({ table: e.currentTarget.value })}
            />
          </Group>
        </Tabs.Panel>
        <Tabs.Panel value="sql" pt="sm">
          <Textarea
            label="Read-only SQL"
            description="Use table names within this connection. Preview inspects output columns."
            autosize
            minRows={7}
            maxRows={25}
            value={value.sql || ''}
            onChange={(e) => patch({ sql: e.currentTarget.value })}
          />
        </Tabs.Panel>
        <Tabs.Panel value="visual" pt="sm">
          <Stack>
            <Group grow>
              <TextInput
                label="Base schema"
                value={value.schema || ''}
                onChange={(e) => patch({ schema: e.currentTarget.value })}
              />
              <TextInput
                label="Base table (alias: base)"
                value={value.table || ''}
                onChange={(e) => patch({ table: e.currentTarget.value })}
              />
            </Group>
            <Textarea
              label="Projected columns / expressions"
              description="Example: base.id AS submission_id, status.description_ru AS social_status"
              value={projection}
              onChange={(e) => setProjection(e.currentTarget.value)}
            />
            {joins.map((join) => (
              <Paper withBorder p="sm" key={join.id}>
                <Group align="end">
                  {(['schema', 'table', 'alias', 'left', 'right'] as const).map(
                    (key) => (
                      <TextInput
                        key={key}
                        label={
                          {
                            schema: 'Join schema',
                            table: 'Join table',
                            alias: 'Alias',
                            left: 'Base key',
                            right: 'Joined key',
                          }[key]
                        }
                        value={join[key]}
                        onChange={(e) => {
                          const v = e.currentTarget.value;
                          setJoins((all) =>
                            all.map((item) =>
                              item.id === join.id
                                ? { ...item, [key]: v }
                                : item,
                            ),
                          );
                        }}
                      />
                    ),
                  )}
                  <Select
                    label="Join"
                    data={enumOptions(['LEFT', 'INNER'], language)}
                    value={join.kind}
                    onChange={(v) =>
                      setJoins((all) =>
                        all.map((item) =>
                          item.id === join.id
                            ? { ...item, kind: v || 'LEFT' }
                            : item,
                        ),
                      )
                    }
                  />
                  <Button
                    color="red"
                    variant="subtle"
                    onClick={() =>
                      setJoins((all) =>
                        all.filter((item) => item.id !== join.id),
                      )
                    }
                  >
                    Remove join
                  </Button>
                </Group>
              </Paper>
            ))}
            <Text size="sm" c="dimmed">
              Joins may multiply rows. Use unique joined keys to preserve the
              declared grain; preview before saving.
            </Text>
            <Group>
              <Button
                variant="light"
                onClick={() =>
                  setJoins((all) => [
                    ...all,
                    {
                      id: crypto.randomUUID(),
                      schema: 'public',
                      table: '',
                      alias: `joined${all.length + 1}`,
                      left: '',
                      right: '',
                      kind: 'LEFT',
                    },
                  ])
                }
              >
                Add join
              </Button>
              <Button onClick={generateSQL}>Generate SQL</Button>
            </Group>
          </Stack>
        </Tabs.Panel>
      </Tabs>
      <Divider label="Fields and calculated columns" />
      {value.fields.map((field, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Controlled rows have no local state; IDs are editable.
        <Paper key={`${dataset.id}-field-${index}`} withBorder p="sm">
          <Stack gap="xs">
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput
                label="Field ID"
                value={field.id}
                onChange={(e) =>
                  patchField(index, { id: e.currentTarget.value })
                }
              />
              <TextInput
                label="Column name"
                value={field.name}
                onChange={(e) =>
                  patchField(index, { name: e.currentTarget.value })
                }
              />
              <TextInput
                label="Display label"
                value={field.label || ''}
                onChange={(e) =>
                  patchField(index, { label: e.currentTarget.value })
                }
              />
              <Select
                label="Type"
                data={enumOptions(
                  types.includes(field.type) ? types : [...types, field.type],
                  language,
                )}
                value={field.type}
                onChange={(v) => patchField(index, { type: v || 'string' })}
              />
              <TextInput
                label="Shared semantic ID"
                placeholder="city"
                value={field.semanticId || ''}
                onChange={(e) =>
                  patchField(index, { semanticId: e.currentTarget.value })
                }
              />
              <Select
                label="Role"
                clearable
                data={enumOptions(
                  ['dimension', 'time', 'latitude', 'longitude', 'identifier'],
                  language,
                )}
                value={field.role || null}
                onChange={(v) => patchField(index, { role: v || '' })}
              />
              <TextInput
                label="Format"
                value={field.format || ''}
                onChange={(e) =>
                  patchField(index, { format: e.currentTarget.value })
                }
              />
            </SimpleGrid>
            <Textarea
              label="Calculated SQL expression (optional)"
              value={field.expression || ''}
              onChange={(e) =>
                patchField(index, { expression: e.currentTarget.value })
              }
            />
            <Button
              variant="subtle"
              color="red"
              size="xs"
              onClick={() =>
                patch({ fields: value.fields.filter((_, i) => i !== index) })
              }
            >
              Remove field
            </Button>
          </Stack>
        </Paper>
      ))}
      <Button
        variant="light"
        onClick={() =>
          patch({
            fields: [
              ...value.fields,
              {
                id: `field_${value.fields.length + 1}`,
                name: '',
                type: 'string',
              },
            ],
          })
        }
      >
        Add field
      </Button>
      <Divider label="Reusable metrics" />
      {value.metrics.map((metric, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Controlled rows have no local state; IDs are editable.
        <Paper key={`${dataset.id}-metric-${index}`} withBorder p="sm">
          <Group grow>
            <TextInput
              label="Metric ID"
              value={metric.id}
              onChange={(e) =>
                patch({
                  metrics: value.metrics.map((m, i) =>
                    i === index ? { ...m, id: e.currentTarget.value } : m,
                  ),
                })
              }
            />
            <TextInput
              label="Label"
              value={metric.name}
              onChange={(e) =>
                patch({
                  metrics: value.metrics.map((m, i) =>
                    i === index ? { ...m, name: e.currentTarget.value } : m,
                  ),
                })
              }
            />
            <TextInput
              label="Format"
              value={metric.format || ''}
              onChange={(e) =>
                patch({
                  metrics: value.metrics.map((m, i) =>
                    i === index ? { ...m, format: e.currentTarget.value } : m,
                  ),
                })
              }
            />
          </Group>
          <Textarea
            label="Aggregate SQL expression"
            value={metric.expression}
            onChange={(e) =>
              patch({
                metrics: value.metrics.map((m, i) =>
                  i === index ? { ...m, expression: e.currentTarget.value } : m,
                ),
              })
            }
          />
          <Button
            color="red"
            variant="subtle"
            size="xs"
            onClick={() =>
              patch({ metrics: value.metrics.filter((_, i) => i !== index) })
            }
          >
            Remove metric
          </Button>
        </Paper>
      ))}
      <Button
        variant="light"
        onClick={() =>
          patch({
            metrics: [
              ...value.metrics,
              {
                id: `metric_${value.metrics.length + 1}`,
                name: '',
                expression: 'COUNT(*)',
              },
            ],
          })
        }
      >
        Add metric
      </Button>
      <Divider label="Dataset relationships" />
      {(value.relationships || []).map((relation) => (
        <Paper withBorder p="sm" key={relation.id}>
          <Group grow>
            <Select
              label="Target dataset"
              renderOption={({ option }) => (
                <span translate="no">{option.label}</span>
              )}
              data={datasets
                .filter(
                  (d) =>
                    d.id !== value.id && d.connectionId === value.connectionId,
                )
                .map((d) => ({ value: d.id, label: d.name }))}
              value={relation.targetDatasetId}
              onChange={(v) =>
                patch({
                  relationships: value.relationships?.map((r) =>
                    r.id === relation.id
                      ? { ...r, targetDatasetId: v || '', targetFieldId: '' }
                      : r,
                  ),
                })
              }
            />
            <Select
              label="Source key"
              renderOption={({ option }) => (
                <span translate="no">{option.label}</span>
              )}
              data={value.fields.map((f) => ({
                value: f.id,
                label: f.name || f.id,
              }))}
              value={relation.sourceFieldId}
              onChange={(v) =>
                patch({
                  relationships: value.relationships?.map((r) =>
                    r.id === relation.id ? { ...r, sourceFieldId: v || '' } : r,
                  ),
                })
              }
            />
            <Select
              label="Target key"
              data={(
                datasets.find((d) => d.id === relation.targetDatasetId)
                  ?.fields || []
              ).map((f) => ({ value: f.id, label: f.name || f.id }))}
              value={relation.targetFieldId}
              onChange={(v) =>
                patch({
                  relationships: value.relationships?.map((r) =>
                    r.id === relation.id ? { ...r, targetFieldId: v || '' } : r,
                  ),
                })
              }
            />
            <Select
              label="Cardinality"
              data={enumOptions(
                ['many-to-one', 'one-to-many', 'one-to-one'],
                language,
              )}
              value={relation.cardinality}
              onChange={(v) =>
                patch({
                  relationships: value.relationships?.map((r) =>
                    r.id === relation.id
                      ? { ...r, cardinality: v || 'many-to-one' }
                      : r,
                  ),
                })
              }
            />
          </Group>
          <Group mt="sm">
            <Checkbox
              label="Allow related filtering"
              checked={relation.allowFiltering}
              onChange={(e) =>
                patch({
                  relationships: value.relationships?.map((r) =>
                    r.id === relation.id
                      ? { ...r, allowFiltering: e.currentTarget.checked }
                      : r,
                  ),
                })
              }
            />
            <Button
              variant="subtle"
              color="red"
              onClick={() =>
                patch({
                  relationships: value.relationships?.filter(
                    (r) => r.id !== relation.id,
                  ),
                })
              }
            >
              Remove relationship
            </Button>
          </Group>
        </Paper>
      ))}
      <Button
        variant="light"
        onClick={() =>
          patch({
            relationships: [
              ...(value.relationships || []),
              {
                id: crypto.randomUUID(),
                targetDatasetId: '',
                sourceFieldId: '',
                targetFieldId: '',
                cardinality: 'many-to-one',
                allowFiltering: true,
              },
            ],
          })
        }
      >
        Add relationship
      </Button>
      {error && <Alert color="red">{error}</Alert>}
      <Group>
        <Button
          variant="light"
          loading={loading}
          disabled={mode === 'visual' || !value.connectionId}
          onClick={() => void preview()}
        >
          Preview / inspect columns
        </Button>
        <Button
          loading={saving}
          disabled={mode === 'visual' || !value.name || !value.connectionId}
          onClick={() => void onSave(materialize())}
        >
          Save dataset
        </Button>
        {dataset.revision > 0 && (
          <Button
            color="red"
            variant="subtle"
            onClick={() => setConfirmDelete(!confirmDelete)}
          >
            Delete dataset
          </Button>
        )}
      </Group>
      {confirmDelete && (
        <Alert color="red" title="Delete saved dataset?">
          <Text size="sm">
            Dependent charts prevent deletion. This removes its saved
            definition.
          </Text>
          <Group mt="sm">
            <Button
              color="red"
              loading={saving}
              onClick={() => void onDelete(dataset)}
            >
              Confirm deletion
            </Button>
            <Button variant="default" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </Group>
        </Alert>
      )}
      {result && (
        <Stack>
          <Group>
            <Text fw={600}>
              Preview: {result.rows.length} rows
              {result.truncated ? ' (limited)' : ''}
            </Text>
            <Button size="xs" variant="light" onClick={adoptColumns}>
              Add discovered fields
            </Button>
          </Group>
          {result.rows.length === 0 && (
            <Text c="dimmed">No rows match this dataset.</Text>
          )}
          <ScrollArea>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  {result.columns.map((c) => (
                    <Table.Th key={c.name}>
                      <span translate="no">{c.name}</span>
                      <Text size="xs" c="dimmed">
                        {translateLabel(enumLabel(c.type), language)}
                      </Text>
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.rows.map((row, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Read-only preview preserves duplicate source rows.
                  <Table.Tr key={`preview-${index}`}>
                    {result.columns.map((c) => (
                      <Table.Td translate="no" key={c.name}>
                        {row[c.name] == null ? 'NULL' : String(row[c.name])}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Stack>
      )}
    </Stack>
  );
}
function normalizeType(type: string) {
  const value = type.toLowerCase();
  if (/int/.test(value)) return 'integer';
  if (/float|numeric|decimal|double/.test(value)) return 'number';
  if (/bool/.test(value)) return 'boolean';
  if (/timestamp|datetim/.test(value)) return 'timestamp';
  if (value === 'date') return 'date';
  return 'string';
}
