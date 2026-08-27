import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  getDefaultZIndex,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Tabs,
  Text,
} from '@mantine/core';
import {
  IconBrandGoogleMaps,
  IconDeviceFloppy,
  IconMapPin,
  IconRestore,
  IconRoute,
  IconTable,
  IconTrash,
} from '@tabler/icons-react';
import 'mantine-react-table/styles.css';
import { useEffect, useMemo, useState } from 'react';

import { serializeRowKey } from '../app/app-utils';
import {
  type DatabaseConnection,
  useConnectionStore,
} from '../connections/store';
import { getFlowmapRowPoint } from '../map/flowmap-geometry';
import {
  commitInspectorRows,
  fetchRelatedRows,
  fetchRelationLabels,
  fetchRelationOptions,
  fetchTableMetadata,
  type InspectableTable,
  type InspectorColumn,
  type InspectorForeignKey,
  type InspectorRow,
  type RelatedRowsGroup,
  type RelationOption,
} from './api';
import { googleMapsPointUrl, parsePreviewGeometry } from './GeometryPreview';
import {
  relationDisplayKey,
  relationValueKey,
  tableDisplayKeyFromParts,
} from './keys';
import {
  areEditorValuesEqual,
  formatCellValue,
  isEditableColumnType,
  normalizeEditorValue,
  renderEditableCell,
} from './table-editing';
import type { InspectorGridRow } from './types';

export function RecordEditorPanel({
  activePrimaryKey,
  columnLabels,
  connection,
  disabled,
  foreignKeyByColumn,
  hasDirtyChanges,
  isSavingChanges,
  isLoadingRelatedRows,
  onChangeDraft,
  onChangeExisting,
  onDiscard,
  onInspectRelatedRow,
  onSave,
  relatedGroups,
  relatedRowsError,
  relationConfigByColumn,
  relationLabels,
  recordLabel,
  row,
  selectedTable,
  tableColumns,
  tableIsEditable,
  tableLabel,
  touchedRowCount,
}: {
  activePrimaryKey: string[];
  columnLabels: Record<string, string>;
  connection: DatabaseConnection;
  disabled: boolean;
  foreignKeyByColumn: Map<string, InspectorForeignKey>;
  hasDirtyChanges: boolean;
  isSavingChanges: boolean;
  isLoadingRelatedRows: boolean;
  onChangeDraft: (
    draftId: string,
    column: InspectorColumn,
    nextValue: unknown,
  ) => void;
  onChangeExisting: (
    row: InspectorRow,
    column: InspectorColumn,
    nextValue: unknown,
  ) => void;
  onDiscard: () => void;
  onInspectRelatedRow: (group: RelatedRowsGroup, row: InspectorRow) => void;
  onSave: () => void;
  relatedGroups: RelatedRowsGroup[];
  relatedRowsError: string;
  relationConfigByColumn: Map<string, string[]>;
  relationLabels: Record<string, Record<string, RelationOption>>;
  recordLabel: string;
  row: InspectorGridRow;
  selectedTable: InspectableTable;
  tableColumns: InspectorColumn[];
  tableIsEditable: boolean;
  tableLabel: string;
  touchedRowCount: number;
}) {
  return (
    <Stack
      aria-label="Record editor"
      gap="xs"
      h="100%"
      style={{ minHeight: 0 }}
    >
      <Text c="dimmed" size="xs" truncate="end">
        {tableLabel} ·{' '}
        {row.kind === 'draft'
          ? 'New row'
          : recordLabel
            ? `#${recordLabel}`
            : 'Selected row'}
      </Text>

      {row.isDeleted ? (
        <Alert color="red" mb="xs" variant="light">
          Row is marked for delete.
        </Alert>
      ) : null}

      <ScrollArea
        offsetScrollbars
        scrollbarSize={8}
        style={{ flex: 1, minHeight: 0 }}
      >
        <Stack gap="xs">
          {tableColumns.map((column) => {
            const foreignKey = foreignKeyByColumn.get(column.name);
            const columnLabel =
              columnLabels[column.name]?.trim() || column.name;
            const value = row.values[column.name];
            const relationOption =
              foreignKey && value !== null && value !== undefined
                ? relationLabels[column.name]?.[relationValueKey(value)]
                : undefined;
            const isPrimaryKey = activePrimaryKey.includes(column.name);
            const canEdit =
              row.kind === 'draft'
                ? isEditableColumnType(column.type)
                : tableIsEditable &&
                  Boolean(row.row?.rowKey) &&
                  isEditableColumnType(column.type) &&
                  !isPrimaryKey &&
                  !row.isDeleted;

            return (
              <Stack gap={4} key={column.name}>
                <Group gap={4} wrap="nowrap">
                  <Text fw={600} size="xs">
                    {columnLabel}
                  </Text>
                  {isPrimaryKey ? (
                    <Badge color="blue" size="xs" variant="light">
                      PK
                    </Badge>
                  ) : null}
                  {foreignKey ? (
                    <Badge color="grape" size="xs" variant="light">
                      FK
                    </Badge>
                  ) : null}
                </Group>
                {canEdit ? (
                  foreignKey ? (
                    <RelationCellEditor
                      connection={connection}
                      disabled={disabled}
                      foreignKey={foreignKey}
                      initialOption={relationOption}
                      labelColumns={
                        relationConfigByColumn.get(column.name) ?? []
                      }
                      onChange={(nextValue) => {
                        if (row.kind === 'draft') {
                          onChangeDraft(row.draftRow.id, column, nextValue);
                          return;
                        }

                        onChangeExisting(row.row, column, nextValue);
                      }}
                      selectedTable={selectedTable}
                      value={value}
                    />
                  ) : (
                    renderEditableCell({
                      column,
                      disabled,
                      onChange: (nextValue) => {
                        if (row.kind === 'draft') {
                          onChangeDraft(row.draftRow.id, column, nextValue);
                          return;
                        }

                        onChangeExisting(row.row, column, nextValue);
                      },
                      value,
                    })
                  )
                ) : (
                  <Box
                    style={{
                      border: '1px solid var(--mantine-color-default-border)',
                      borderRadius: 4,
                      padding: '5px 8px',
                    }}
                  >
                    <RelationCellValue
                      isDeleted={row.isDeleted}
                      option={relationOption}
                      value={value}
                    />
                  </Box>
                )}
              </Stack>
            );
          })}
          {row.kind === 'record' ? (
            <Stack
              gap="xs"
              pt="sm"
              style={{
                borderTop: '1px solid var(--mantine-color-default-border)',
              }}
            >
              <Text fw={700} size="sm">
                Related data
              </Text>
              <RelatedRowsPanel
                connectionId={connection.id}
                error={relatedRowsError}
                groups={relatedGroups}
                isLoading={isLoadingRelatedRows}
                onInspectRow={onInspectRelatedRow}
              />
            </Stack>
          ) : null}
        </Stack>
      </ScrollArea>

      <Group justify="space-between" mt="xs" wrap="nowrap">
        <Text c="dimmed" size="xs">
          {touchedRowCount} pending
        </Text>
        <Group gap={6} wrap="nowrap">
          <Button
            disabled={!hasDirtyChanges || isSavingChanges}
            leftSection={<IconRestore size={14} />}
            onClick={onDiscard}
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
            onClick={onSave}
            size="compact-sm"
          >
            Save
          </Button>
        </Group>
      </Group>
    </Stack>
  );
}

function RelatedRowsPanel({
  connectionId,
  error,
  groups,
  isLoading,
  onInspectRow,
}: {
  connectionId: string;
  error: string;
  groups: RelatedRowsGroup[];
  isLoading: boolean;
  onInspectRow: (group: RelatedRowsGroup, row: InspectorRow) => void;
}) {
  const tableDisplayByKey = useConnectionStore(
    (state) => state.tableDisplayByKey,
  );
  const groupsWithRows = groups.filter((group) => group.rows.length > 0);

  if (isLoading) {
    return (
      <Group gap={6}>
        <Loader size={12} />
        <Text c="dimmed" size="xs">
          Loading related records
        </Text>
      </Group>
    );
  }

  if (error) {
    return (
      <Alert color="orange" variant="light">
        {error}
      </Alert>
    );
  }

  return (
    <Stack gap="xs" pr="xs">
      {groupsWithRows.length === 0 ? (
        <Text c="dimmed" size="xs">
          No related records.
        </Text>
      ) : null}
      {groupsWithRows.map((group) => {
        const displayConfig =
          tableDisplayByKey[
            tableDisplayKeyFromParts(connectionId, group.schema, group.table)
          ];
        const tableLabel = displayConfig?.tableAlias?.trim() || group.label;
        const geometryColumnNames = new Set(
          group.geometryColumns.map((column) => column.name),
        );
        const previewColumns = group.columns
          .filter(
            (column) =>
              !geometryColumnNames.has(column.name) &&
              column.name !== group.targetColumn &&
              !group.primaryKey.includes(column.name),
          )
          .slice(0, 2);

        return (
          <Stack
            gap={6}
            key={`${group.schema}.${group.table}.${group.sourceColumn}.${group.targetColumn}`}
          >
            <Group justify="space-between" wrap="nowrap">
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text fw={600} lineClamp={1} size="xs">
                  {tableLabel}
                </Text>
                <Text c="dimmed" lineClamp={1} size="xs">
                  {group.schema}.{group.table}
                </Text>
              </Stack>
              <Badge color="gray" size="xs" variant="light">
                {group.rows.length}
              </Badge>
            </Group>
            {group.rows.slice(0, 5).map((relatedRow, index) => {
              const titleColumn =
                group.columns.find((column) =>
                  /^(name|title|label|display_name)$/i.test(column.name),
                )?.name ?? group.primaryKey[0];
              const title =
                (titleColumn ? relatedRow.values[titleColumn] : null) ??
                `${group.table} #${index + 1}`;
              const hasGeometry = group.geometryColumns.length > 0;

              return (
                <Paper
                  aria-label={`Inspect ${tableLabel} related row ${formatCellValue(title)}`}
                  component="button"
                  key={
                    relatedRow.rowKey
                      ? serializeRowKey(relatedRow.rowKey, group.primaryKey)
                      : `${group.table}:${index}`
                  }
                  onClick={() => onInspectRow(group, relatedRow)}
                  p="xs"
                  radius="sm"
                  style={{
                    color: 'inherit',
                    cursor: 'pointer',
                    display: 'block',
                    font: 'inherit',
                    textAlign: 'left',
                    width: '100%',
                  }}
                  type="button"
                  withBorder
                >
                  <Stack gap={1} style={{ minWidth: 0 }}>
                    <Text fw={600} lineClamp={1} size="xs">
                      {formatCellValue(title)}
                    </Text>
                    {previewColumns.map((column) => (
                      <Text
                        c="dimmed"
                        key={column.name}
                        lineClamp={1}
                        size="xs"
                      >
                        {displayConfig?.columnLabels[column.name]?.trim() ||
                          column.name}
                        : {formatCellValue(relatedRow.values[column.name])}
                      </Text>
                    ))}
                    {hasGeometry ? (
                      <Text c="dimmed" lineClamp={1} size="xs">
                        Geo:{' '}
                        {group.geometryColumns
                          .map((column) => column.name)
                          .join(', ')}
                      </Text>
                    ) : null}
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        );
      })}
    </Stack>
  );
}

export function RelatedRecordPanel({
  connection,
  group,
  onCreateArc,
  onDeleted,
  onInspectRelatedRow,
  onLocateRow,
  onSaved,
  row,
}: {
  connection: DatabaseConnection;
  group: RelatedRowsGroup;
  onCreateArc: (startGeometryColumn: string, endGeometryColumn: string) => void;
  onDeleted: () => void;
  onInspectRelatedRow: (group: RelatedRowsGroup, row: InspectorRow) => void;
  onLocateRow: (geometryColumnName: string) => void;
  onSaved: (values: Record<string, unknown>) => void;
  row: InspectorRow;
}) {
  const tableDisplayByKey = useConnectionStore(
    (state) => state.tableDisplayByKey,
  );
  const relationDisplayByKey = useConnectionStore(
    (state) => state.relationDisplayByKey,
  );
  const [tableMetadata, setTableMetadata] = useState<InspectableTable | null>(
    null,
  );
  const [isLoadingTableMetadata, setIsLoadingTableMetadata] = useState(true);
  const [tableMetadataError, setTableMetadataError] = useState('');
  const [relatedRelationLabels, setRelatedRelationLabels] = useState<
    Record<string, Record<string, RelationOption>>
  >({});
  const [relatedGroups, setRelatedGroups] = useState<RelatedRowsGroup[]>([]);
  const [isLoadingRelatedRows, setIsLoadingRelatedRows] = useState(false);
  const [relatedRowsError, setRelatedRowsError] = useState('');
  const [relatedRowsRefreshToken, setRelatedRowsRefreshToken] = useState(0);
  const displayConfig =
    tableDisplayByKey[
      tableDisplayKeyFromParts(connection.id, group.schema, group.table)
    ];
  const tableLabel = displayConfig?.tableAlias?.trim() || group.label;
  const tableColumns = tableMetadata?.columns ?? group.columns;
  const tableGeometryColumns =
    tableMetadata?.geometryColumns ?? group.geometryColumns;
  const tablePrimaryKey = tableMetadata?.primaryKey ?? group.primaryKey;
  const tableIsEditable = tableMetadata?.isEditable ?? group.isEditable;
  const geometryColumnNames = new Set(
    tableGeometryColumns.map((column) => column.name),
  );
  const visibleColumns = tableColumns.filter(
    (column) =>
      !geometryColumnNames.has(column.name) &&
      !displayConfig?.hiddenColumns.includes(column.name),
  );
  const recordKey = tablePrimaryKey
    .map((columnName) => formatCellValue(row.values[columnName]))
    .join(', ');
  const pointGeometryColumns = useMemo(
    () =>
      tableGeometryColumns.filter((column) =>
        /^point$/i.test(column.geometryType),
      ),
    [tableGeometryColumns],
  );
  const initialArcStart =
    pointGeometryColumns.find((column) =>
      /(departure|start|origin|from)/i.test(column.name),
    )?.name ??
    pointGeometryColumns[0]?.name ??
    '';
  const initialArcEnd =
    pointGeometryColumns.find(
      (column) =>
        column.name !== initialArcStart &&
        /(destination|end|target|to)/i.test(column.name),
    )?.name ??
    pointGeometryColumns.find((column) => column.name !== initialArcStart)
      ?.name ??
    '';
  const [arcStartGeometry, setArcStartGeometry] = useState(initialArcStart);
  const [arcEndGeometry, setArcEndGeometry] = useState(initialArcEnd);
  const arcStartPoint = getFlowmapRowPoint(
    row.values,
    'geometry',
    '',
    '',
    arcStartGeometry,
  );
  const arcEndPoint = getFlowmapRowPoint(
    row.values,
    'geometry',
    '',
    '',
    arcEndGeometry,
  );
  const pointGeometryOptions = pointGeometryColumns.map((column) => ({
    label:
      displayConfig?.columnLabels[column.name]?.trim() ||
      `${column.name} (${column.geometryType})`,
    value: column.name,
  }));
  const [draftValues, setDraftValues] = useState(row.values);
  const [draftChanges, setDraftChanges] = useState<Record<string, unknown>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [deleteOpened, setDeleteOpened] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const canEditRow = tableIsEditable && Boolean(row.rowKey);
  const hasChanges = Object.keys(draftChanges).length > 0;
  const foreignKeyByColumn = useMemo(
    () =>
      new Map(
        (tableMetadata?.foreignKeys ?? []).map((foreignKey) => [
          foreignKey.columnName,
          foreignKey,
        ]),
      ),
    [tableMetadata?.foreignKeys],
  );
  const relationConfigByColumn = useMemo(() => {
    if (!tableMetadata) {
      return new Map<string, string[]>();
    }

    return new Map(
      tableMetadata.foreignKeys.map((foreignKey) => {
        const key = relationDisplayKey(
          connection.id,
          tableMetadata,
          foreignKey,
        );
        const configuredColumns = relationDisplayByKey[key]?.labelColumns;
        return [
          foreignKey.columnName,
          configuredColumns && configuredColumns.length > 0
            ? configuredColumns
            : foreignKey.defaultLabelColumn
              ? [foreignKey.defaultLabelColumn]
              : [],
        ] as const;
      }),
    );
  }, [connection.id, relationDisplayByKey, tableMetadata]);

  useEffect(() => {
    let isActive = true;
    setTableMetadata(null);
    setTableMetadataError('');
    setIsLoadingTableMetadata(true);

    void fetchTableMetadata(connection, group.schema, group.table)
      .then((metadata) => {
        if (isActive) {
          setTableMetadata(metadata);
        }
      })
      .catch((error) => {
        if (isActive) {
          setTableMetadataError(
            error instanceof Error
              ? error.message
              : 'Failed to load table metadata.',
          );
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoadingTableMetadata(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [connection, group.schema, group.table]);

  useEffect(() => {
    if (!tableMetadata || tableMetadata.foreignKeys.length === 0) {
      setRelatedRelationLabels({});
      return;
    }

    let isActive = true;

    void Promise.all(
      tableMetadata.foreignKeys.map(async (foreignKey) => {
        const value = row.values[foreignKey.columnName];
        if (value === null || value === undefined) {
          return [foreignKey.columnName, {}] as const;
        }

        const options = await fetchRelationLabels(connection, {
          schema: tableMetadata.schema,
          table: tableMetadata.name,
          column: foreignKey.columnName,
          labelColumns: relationConfigByColumn.get(foreignKey.columnName) ?? [],
          values: [value],
        });

        return [
          foreignKey.columnName,
          Object.fromEntries(
            options.map((option) => [relationValueKey(option.value), option]),
          ),
        ] as const;
      }),
    )
      .then((entries) => {
        if (isActive) {
          setRelatedRelationLabels(Object.fromEntries(entries));
        }
      })
      .catch(() => {
        if (isActive) {
          setRelatedRelationLabels({});
        }
      });

    return () => {
      isActive = false;
    };
  }, [connection, relationConfigByColumn, row.values, tableMetadata]);

  useEffect(() => {
    void relatedRowsRefreshToken;
    if (!row.rowKey) {
      setRelatedGroups([]);
      setRelatedRowsError('');
      setIsLoadingRelatedRows(false);
      return;
    }

    const activeRowKey = row.rowKey;
    let isActive = true;
    setIsLoadingRelatedRows(true);
    setRelatedRowsError('');

    void fetchRelatedRows(connection, {
      schema: group.schema,
      table: group.table,
      rowKey: activeRowKey,
      limit: 20,
    })
      .then((payload) => {
        if (isActive) {
          setRelatedGroups(payload.groups);
        }
      })
      .catch((error) => {
        if (isActive) {
          setRelatedGroups([]);
          setRelatedRowsError(
            error instanceof Error
              ? error.message
              : 'Failed to load related rows.',
          );
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoadingRelatedRows(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [
    connection,
    group.schema,
    group.table,
    relatedRowsRefreshToken,
    row.rowKey,
  ]);

  useEffect(() => {
    const pointColumnNames = new Set(
      pointGeometryColumns.map((column) => column.name),
    );
    if (!pointColumnNames.has(arcStartGeometry)) {
      setArcStartGeometry(initialArcStart);
    }
    if (!pointColumnNames.has(arcEndGeometry)) {
      setArcEndGeometry(initialArcEnd);
    }
  }, [
    arcEndGeometry,
    arcStartGeometry,
    initialArcEnd,
    initialArcStart,
    pointGeometryColumns,
  ]);

  function handleFieldChange(column: InspectorColumn, nextValue: unknown) {
    const normalizedValue = normalizeEditorValue(column.type, nextValue);
    setDraftValues((current) => ({
      ...current,
      [column.name]: normalizedValue,
    }));
    setDraftChanges((current) => {
      const nextChanges = { ...current };
      if (areEditorValuesEqual(row.values[column.name], normalizedValue)) {
        delete nextChanges[column.name];
      } else {
        nextChanges[column.name] = normalizedValue;
      }
      return nextChanges;
    });
    setSaveError('');
    setSaveMessage('');
  }

  function handleDiscard() {
    setDraftValues(row.values);
    setDraftChanges({});
    setSaveError('');
    setSaveMessage('');
  }

  async function handleSave() {
    if (!row.rowKey || !hasChanges || isSaving) {
      return;
    }

    setIsSaving(true);
    setSaveError('');
    setSaveMessage('');
    try {
      await commitInspectorRows(connection, {
        schema: group.schema,
        table: group.table,
        operations: [
          {
            type: 'update',
            rowKey: row.rowKey,
            changes: draftChanges,
          },
        ],
      });
      const savedValues = { ...row.values, ...draftChanges };
      setDraftValues(savedValues);
      setDraftChanges({});
      setSaveMessage('Saved.');
      onSaved(savedValues);
      setRelatedRowsRefreshToken((value) => value + 1);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Failed to save related record.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!row.rowKey || isDeleting) {
      return;
    }

    setIsDeleting(true);
    setDeleteError('');
    try {
      await commitInspectorRows(connection, {
        schema: group.schema,
        table: group.table,
        operations: [
          {
            type: 'delete',
            rowKey: row.rowKey,
          },
        ],
      });
      setDeleteOpened(false);
      onDeleted();
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'Failed to delete record.',
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Stack
      aria-label={`${tableLabel} record inspector`}
      gap="xs"
      h="100%"
      style={{ minHeight: 0 }}
    >
      <Modal
        centered
        closeOnClickOutside={!isDeleting}
        closeOnEscape={!isDeleting}
        onClose={() => {
          if (!isDeleting) {
            setDeleteOpened(false);
            setDeleteError('');
          }
        }}
        opened={deleteOpened}
        title="Delete record?"
        zIndex={getDefaultZIndex('max')}
      >
        <Stack gap="md">
          <Text size="sm">
            {group.schema}.{group.table}
            {recordKey ? ` · #${recordKey}` : ''}
          </Text>
          <Alert color="yellow" variant="light">
            Database foreign-key rules will decide whether linked rows are
            restricted, cascaded, or updated.
          </Alert>
          {deleteError ? (
            <Alert color="red" title="Deletion failed" variant="light">
              {deleteError}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button
              disabled={isDeleting}
              onClick={() => {
                setDeleteOpened(false);
                setDeleteError('');
              }}
              variant="default"
            >
              Cancel
            </Button>
            <Button
              color="red"
              leftSection={
                isDeleting ? <Loader size={14} /> : <IconTrash size={14} />
              }
              loading={isDeleting}
              onClick={() => void handleDelete()}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Text c="dimmed" size="xs" truncate="end">
        {group.schema}.{group.table}
        {recordKey ? ` · #${recordKey}` : ''}
      </Text>
      <Tabs
        defaultValue="fields"
        style={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <Tabs.List grow>
          <Tabs.Tab leftSection={<IconTable size={14} />} value="fields">
            Fields
          </Tabs.Tab>
          <Tabs.Tab leftSection={<IconMapPin size={14} />} value="map">
            Map
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel pt="sm" style={{ flex: 1, minHeight: 0 }} value="fields">
          <Stack gap="xs" h="100%" style={{ minHeight: 0 }}>
            {tableMetadataError ? (
              <Alert color="orange" variant="light">
                {tableMetadataError}
              </Alert>
            ) : null}
            <ScrollArea offsetScrollbars style={{ flex: 1, minHeight: 0 }}>
              <Stack gap="xs" pr="xs">
                {isLoadingTableMetadata ? <Loader size="xs" /> : null}
                {visibleColumns.map((column) => {
                  const foreignKey = foreignKeyByColumn.get(column.name);
                  const value = draftValues[column.name];
                  const relationOption =
                    foreignKey && value !== null && value !== undefined
                      ? relatedRelationLabels[column.name]?.[
                          relationValueKey(value)
                        ]
                      : undefined;
                  const isPrimaryKey = tablePrimaryKey.includes(column.name);
                  const canEditColumn =
                    canEditRow &&
                    !isPrimaryKey &&
                    isEditableColumnType(column.type);

                  return (
                    <Stack gap={3} key={column.name}>
                      <Group gap={4} wrap="nowrap">
                        <Text c="dimmed" fw={600} size="xs">
                          {displayConfig?.columnLabels[column.name]?.trim() ||
                            column.name}
                        </Text>
                        {isPrimaryKey ? (
                          <Badge color="blue" size="xs" variant="light">
                            PK
                          </Badge>
                        ) : null}
                        {foreignKey ? (
                          <Badge color="grape" size="xs" variant="light">
                            FK
                          </Badge>
                        ) : null}
                      </Group>
                      {canEditColumn ? (
                        foreignKey && tableMetadata ? (
                          <RelationCellEditor
                            connection={connection}
                            disabled={isSaving}
                            foreignKey={foreignKey}
                            initialOption={relationOption}
                            labelColumns={
                              relationConfigByColumn.get(column.name) ?? []
                            }
                            onChange={(nextValue) =>
                              handleFieldChange(column, nextValue)
                            }
                            selectedTable={tableMetadata}
                            value={value}
                          />
                        ) : (
                          renderEditableCell({
                            column,
                            disabled: isSaving,
                            onChange: (nextValue) =>
                              handleFieldChange(column, nextValue),
                            value,
                          })
                        )
                      ) : (
                        <Box
                          style={{
                            borderBottom:
                              '1px solid var(--mantine-color-default-border)',
                            overflowWrap: 'anywhere',
                            paddingBottom: 6,
                          }}
                        >
                          <RelationCellValue
                            isDeleted={false}
                            option={relationOption}
                            value={value}
                          />
                        </Box>
                      )}
                    </Stack>
                  );
                })}
                {row.rowKey ? (
                  <Stack
                    gap="xs"
                    mt="xs"
                    pt="sm"
                    style={{
                      borderTop:
                        '1px solid var(--mantine-color-default-border)',
                    }}
                  >
                    <Text fw={600} size="sm">
                      Related data
                    </Text>
                    <RelatedRowsPanel
                      connectionId={connection.id}
                      error={relatedRowsError}
                      groups={relatedGroups}
                      isLoading={isLoadingRelatedRows}
                      onInspectRow={onInspectRelatedRow}
                    />
                  </Stack>
                ) : null}
              </Stack>
            </ScrollArea>
            {saveError ? (
              <Alert color="red" variant="light">
                {saveError}
              </Alert>
            ) : null}
            <Group justify="space-between" wrap="nowrap">
              <Text c={saveMessage ? 'green' : 'dimmed'} size="xs">
                {saveMessage ||
                  (hasChanges
                    ? `${Object.keys(draftChanges).length} pending`
                    : canEditRow
                      ? 'No changes'
                      : 'Read only')}
              </Text>
              {canEditRow ? (
                <Group gap="xs" wrap="nowrap">
                  <Button
                    color="red"
                    disabled={isSaving || isDeleting}
                    leftSection={<IconTrash size={14} />}
                    onClick={() => {
                      setDeleteError('');
                      setDeleteOpened(true);
                    }}
                    size="compact-sm"
                    variant="subtle"
                  >
                    Delete
                  </Button>
                  <Button
                    disabled={!hasChanges || isSaving}
                    leftSection={<IconRestore size={14} />}
                    onClick={handleDiscard}
                    size="compact-sm"
                    variant="default"
                  >
                    Discard
                  </Button>
                  <Button
                    disabled={!hasChanges || isSaving}
                    leftSection={
                      isSaving ? (
                        <Loader size={14} />
                      ) : (
                        <IconDeviceFloppy size={14} />
                      )
                    }
                    onClick={() => void handleSave()}
                    size="compact-sm"
                  >
                    Save
                  </Button>
                </Group>
              ) : null}
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel pt="sm" value="map">
          <Stack gap="xs">
            {tableGeometryColumns.length === 0 ? (
              <Text c="dimmed" size="xs">
                No geographic columns.
              </Text>
            ) : (
              tableGeometryColumns.map((geometryColumn) => {
                const geometry = parsePreviewGeometry(
                  draftValues[geometryColumn.name],
                );
                const googleMapsUrl = geometry
                  ? googleMapsPointUrl(geometry)
                  : null;

                return (
                  <Group
                    justify="space-between"
                    key={geometryColumn.name}
                    wrap="nowrap"
                  >
                    <Stack gap={0} style={{ minWidth: 0 }}>
                      <Text fw={600} lineClamp={1} size="xs">
                        {displayConfig?.columnLabels[
                          geometryColumn.name
                        ]?.trim() || geometryColumn.name}
                      </Text>
                      <Text c="dimmed" size="xs">
                        {geometryColumn.geometryType} · SRID{' '}
                        {geometryColumn.srid}
                      </Text>
                    </Stack>
                    <Group gap={4} wrap="nowrap">
                      {googleMapsUrl ? (
                        <ActionIcon
                          aria-label="Open in Google Maps"
                          component="a"
                          href={googleMapsUrl}
                          rel="noopener noreferrer"
                          size="sm"
                          target="_blank"
                          title="Open in Google Maps"
                          variant="subtle"
                        >
                          <IconBrandGoogleMaps size={16} />
                        </ActionIcon>
                      ) : null}
                      <Button
                        disabled={!row.rowKey}
                        leftSection={<IconMapPin size={14} />}
                        onClick={() => onLocateRow(geometryColumn.name)}
                        size="compact-xs"
                        variant="light"
                      >
                        Show
                      </Button>
                    </Group>
                  </Group>
                );
              })
            )}
            {pointGeometryColumns.length >= 2 ? (
              <Stack
                gap="xs"
                pt="xs"
                style={{
                  borderTop: '1px solid var(--mantine-color-default-border)',
                }}
              >
                <Group justify="space-between" wrap="nowrap">
                  <Stack gap={0}>
                    <Text fw={600} size="xs">
                      Arc
                    </Text>
                    <Text c="dimmed" size="xs">
                      {arcStartGeometry} → {arcEndGeometry}
                    </Text>
                  </Stack>
                  <Button
                    disabled={
                      !row.rowKey ||
                      !arcStartGeometry ||
                      !arcEndGeometry ||
                      arcStartGeometry === arcEndGeometry ||
                      !arcStartPoint ||
                      !arcEndPoint
                    }
                    leftSection={<IconRoute size={14} />}
                    onClick={() =>
                      onCreateArc(arcStartGeometry, arcEndGeometry)
                    }
                    size="compact-xs"
                    variant="light"
                  >
                    Show arc
                  </Button>
                </Group>
                <Group grow wrap="nowrap">
                  <Select
                    allowDeselect={false}
                    data={pointGeometryOptions}
                    label="From"
                    onChange={(value) => setArcStartGeometry(value ?? '')}
                    size="xs"
                    value={arcStartGeometry}
                  />
                  <Select
                    allowDeselect={false}
                    data={pointGeometryOptions}
                    label="To"
                    onChange={(value) => setArcEndGeometry(value ?? '')}
                    size="xs"
                    value={arcEndGeometry}
                  />
                </Group>
              </Stack>
            ) : null}
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

export function RelationCellValue({
  isDeleted,
  option,
  value,
}: {
  isDeleted: boolean;
  option?: RelationOption;
  value: unknown;
}) {
  if (option) {
    return (
      <Stack
        gap={0}
        style={{
          opacity: isDeleted ? 0.55 : 1,
          textAlign: 'left',
          textDecoration: isDeleted ? 'line-through' : undefined,
        }}
      >
        <Text lineClamp={2} size="sm">
          {option.label}
        </Text>
        <Text c="dimmed" lineClamp={1} size="xs">
          {formatCellValue(value)}
        </Text>
      </Stack>
    );
  }

  return (
    <Text
      lineClamp={3}
      size="sm"
      style={{
        opacity: isDeleted ? 0.55 : 1,
        textDecoration: isDeleted ? 'line-through' : undefined,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {formatCellValue(value)}
    </Text>
  );
}

function RelationCellEditor({
  connection,
  disabled,
  foreignKey,
  initialOption,
  labelColumns,
  onChange,
  selectedTable,
  value,
}: {
  connection: DatabaseConnection;
  disabled?: boolean;
  foreignKey: InspectorForeignKey;
  initialOption?: RelationOption;
  labelColumns: string[];
  onChange: (value: unknown) => void;
  selectedTable: InspectableTable;
  value: unknown;
}) {
  const [search, setSearch] = useState('');
  const [shouldLoadOptions, setShouldLoadOptions] = useState(false);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [options, setOptions] = useState<RelationOption[]>(
    initialOption ? [initialOption] : [],
  );
  const currentValue =
    value === null || value === undefined ? null : relationValueKey(value);

  useEffect(() => {
    if (!initialOption) {
      return;
    }

    const initialValue = relationValueKey(initialOption.value);
    setOptions((currentOptions) => {
      const existingOption = currentOptions.find(
        (option) => relationValueKey(option.value) === initialValue,
      );
      if (existingOption?.label === initialOption.label) {
        return currentOptions;
      }

      return [
        initialOption,
        ...currentOptions.filter(
          (option) => relationValueKey(option.value) !== initialValue,
        ),
      ];
    });
  }, [initialOption]);

  useEffect(() => {
    if (!shouldLoadOptions) {
      return;
    }

    let isActive = true;

    async function loadOptions() {
      setIsLoadingOptions(true);
      const nextOptions = await fetchRelationOptions(connection, {
        schema: selectedTable.schema,
        table: selectedTable.name,
        column: foreignKey.columnName,
        labelColumns,
        limit: 30,
        search,
      });

      if (!isActive) {
        return;
      }

      setOptions((currentOptions) => {
        const byValue = new Map<string, RelationOption>();
        for (const option of currentOptions) {
          byValue.set(relationValueKey(option.value), option);
        }
        for (const option of nextOptions) {
          byValue.set(relationValueKey(option.value), option);
        }
        if (initialOption) {
          byValue.set(relationValueKey(initialOption.value), initialOption);
        }
        return Array.from(byValue.values());
      });
    }

    void loadOptions()
      .catch(() => {
        if (isActive && initialOption) {
          setOptions([initialOption]);
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoadingOptions(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [
    connection,
    foreignKey.columnName,
    initialOption,
    labelColumns,
    search,
    selectedTable.name,
    selectedTable.schema,
    shouldLoadOptions,
  ]);

  const optionByValue = useMemo(() => {
    const byValue = new Map<string, RelationOption>();
    for (const option of options) {
      byValue.set(relationValueKey(option.value), option);
    }
    return byValue;
  }, [options]);
  const selectedOptionLabel = currentValue
    ? (optionByValue.get(currentValue)?.label ?? '')
    : '';

  const data = useMemo(
    () =>
      options.map((option) => ({
        label: option.label,
        value: relationValueKey(option.value),
      })),
    [options],
  );

  return (
    <Select
      clearable
      comboboxProps={{ zIndex: getDefaultZIndex('max') }}
      data={data}
      disabled={disabled}
      nothingFoundMessage={isLoadingOptions ? 'Loading...' : 'No records'}
      onChange={(nextValue) => {
        if (nextValue === null) {
          onChange(null);
          return;
        }

        onChange(optionByValue.get(nextValue)?.value ?? nextValue);
      }}
      onDropdownOpen={() => {
        setSearch('');
        setShouldLoadOptions(true);
      }}
      onFocus={() => {
        setSearch('');
        setShouldLoadOptions(true);
      }}
      onSearchChange={(nextSearch) => {
        if (nextSearch === selectedOptionLabel) {
          setSearch('');
          setShouldLoadOptions(true);
          return;
        }

        setSearch(nextSearch);
        setShouldLoadOptions(true);
      }}
      placeholder="Select related record"
      searchable
      size="xs"
      styles={{
        input: {
          textAlign: 'left',
        },
      }}
      value={currentValue}
    />
  );
}
