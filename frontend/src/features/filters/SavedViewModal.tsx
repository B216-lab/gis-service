import {
  Button,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';

import type { InspectableTable } from '../inspector/api';
import {
  buildTableFilterDefinition,
  createDefaultTableFilterCondition,
  isEditableColumnType,
} from '../inspector/table-editing';
import type {
  SavedTableView,
  TableFilterCondition,
  TableFilterDefinition,
  TableFilterOperator,
} from './types';

type DraftFilterMode = 'builder' | 'sql';

export function SavedViewModal({
  opened,
  selectedTable,
  view,
  onClose,
  onSave,
}: {
  opened: boolean;
  selectedTable: InspectableTable | null;
  view: SavedTableView | null;
  onClose: () => void;
  onSave: (payload: {
    viewId: string | null;
    name: string;
    filter: TableFilterDefinition;
  }) => void;
}) {
  const [draftViewName, setDraftViewName] = useState('');
  const [draftFilterMode, setDraftFilterMode] =
    useState<DraftFilterMode>('builder');
  const [draftWhereClause, setDraftWhereClause] = useState('');
  const [draftViewCondition, setDraftViewCondition] =
    useState<TableFilterCondition>(() =>
      createDefaultTableFilterCondition(selectedTable),
    );
  const filterableColumnOptions = useMemo(
    () =>
      (selectedTable?.columns ?? [])
        .filter((column) => isEditableColumnType(column.type))
        .map((column) => ({
          label: `${column.name} (${column.type})`,
          value: column.name,
        })),
    [selectedTable],
  );

  useEffect(() => {
    if (!opened) {
      return;
    }

    const filter = view?.filter;
    const isSqlFilter = filter?.mode === 'sql';
    const firstCondition =
      filter && filter.mode !== 'sql' ? filter.conditions[0] : undefined;
    setDraftViewName(view?.name ?? '');
    setDraftFilterMode(isSqlFilter ? 'sql' : 'builder');
    setDraftWhereClause(isSqlFilter ? filter.where : '');
    setDraftViewCondition({
      column:
        firstCondition?.column ??
        createDefaultTableFilterCondition(selectedTable).column,
      operator: firstCondition?.operator ?? 'eq',
      value: firstCondition?.value ?? '',
      values: firstCondition?.values ?? [],
    });
  }, [opened, selectedTable, view]);

  const nextName = draftViewName.trim();
  const nextColumn = draftViewCondition.column.trim();
  const nextOperator = draftViewCondition.operator;
  const nextRawValue = (draftViewCondition.value ?? '').trim();
  const nextValues =
    nextOperator === 'in'
      ? (draftViewCondition.values ?? []).filter(Boolean)
      : [];
  const nextWhereClause = draftWhereClause.trim();
  const canSave =
    draftFilterMode === 'sql'
      ? Boolean(nextName && nextWhereClause)
      : Boolean(nextName && nextColumn) &&
        (nextOperator === 'eq' ? Boolean(nextRawValue) : nextValues.length > 0);

  function handleSave() {
    if (!canSave) {
      return;
    }

    onSave({
      viewId: view?.id ?? null,
      name: nextName,
      filter:
        draftFilterMode === 'sql'
          ? { mode: 'sql', where: nextWhereClause }
          : buildTableFilterDefinition({
              column: nextColumn,
              operator: nextOperator,
              value: nextRawValue,
              values: nextValues,
            }),
    });
  }

  return (
    <Modal
      centered
      onClose={onClose}
      opened={opened}
      title={view ? 'Edit saved view' : 'Save table view'}
    >
      <Stack gap="sm">
        <TextInput
          label="View name"
          onChange={(event) => setDraftViewName(event.currentTarget.value)}
          placeholder="Cities"
          value={draftViewName}
        />
        <SegmentedControl
          data={[
            { label: 'Builder', value: 'builder' },
            { label: 'WHERE', value: 'sql' },
          ]}
          onChange={(value) => setDraftFilterMode(value as DraftFilterMode)}
          value={draftFilterMode}
        />
        {draftFilterMode === 'builder' ? (
          <>
            <Select
              data={filterableColumnOptions}
              label="Column"
              onChange={(value) =>
                setDraftViewCondition((current) => ({
                  ...current,
                  column: value ?? '',
                }))
              }
              searchable
              value={draftViewCondition.column}
            />
            <Select
              allowDeselect={false}
              data={[
                { label: 'Equals', value: 'eq' },
                { label: 'In list', value: 'in' },
              ]}
              label="Operator"
              onChange={(value) =>
                setDraftViewCondition((current) => ({
                  ...current,
                  operator: (value ?? 'eq') as TableFilterOperator,
                  value: value === 'in' ? '' : current.value,
                  values: value === 'in' ? current.values : [],
                }))
              }
              value={draftViewCondition.operator}
            />
            <TextInput
              description={
                draftViewCondition.operator === 'in'
                  ? 'Comma-separated values. Example: 7, 8'
                  : 'Single value. Example: 8'
              }
              label={draftViewCondition.operator === 'in' ? 'Values' : 'Value'}
              onChange={(event) => {
                const nextRawInput = event.currentTarget.value;
                setDraftViewCondition((current) => ({
                  ...current,
                  value:
                    current.operator === 'eq' ? nextRawInput : current.value,
                  values:
                    current.operator === 'in'
                      ? nextRawInput
                          .split(',')
                          .map((value) => value.trim())
                          .filter(Boolean)
                      : current.values,
                }));
              }}
              placeholder={draftViewCondition.operator === 'in' ? '7, 8' : '8'}
              value={
                draftViewCondition.operator === 'in'
                  ? (draftViewCondition.values ?? []).join(', ')
                  : (draftViewCondition.value ?? '')
              }
            />
          </>
        ) : (
          <Textarea
            autosize
            description="Condition only. Do not include WHERE."
            label="WHERE clause"
            minRows={6}
            onChange={(event) => setDraftWhereClause(event.currentTarget.value)}
            placeholder={`osm_level in (7, 8)\nboundary = 'administrative' and name is not null`}
            value={draftWhereClause}
          />
        )}
        {draftFilterMode === 'sql' ? (
          <Text c="dimmed" size="xs">
            SQL WHERE supports table columns and PostgreSQL operators. DDL, DML,
            subqueries, comments, semicolons, and placeholders are blocked.
          </Text>
        ) : null}
        <Group justify="space-between" pt="xs">
          <Text c="dimmed" size="xs">
            Local virtual view over current table.
          </Text>
          <Button disabled={!canSave} onClick={handleSave}>
            {view ? 'Update View' : 'Save View'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
