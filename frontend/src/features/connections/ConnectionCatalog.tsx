import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Collapse,
  Group,
  Loader,
  Stack,
  Text,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconDatabaseSearch,
  IconFolder,
  IconRefresh,
  IconTable,
  IconTrash,
} from '@tabler/icons-react';

import { createSavedViewSelectionKey } from '../app/app-utils';
import type { SavedTableView } from '../filters/types';
import type { TableDisplayConfig } from './store';
import type { CatalogState } from './types';

function tableDisplayKeyFromParts(
  connectionId: string,
  schema: string,
  table: string,
) {
  return [connectionId, schema, table].map(encodeURIComponent).join(':');
}

export function ConnectionCatalog({
  catalog,
  connectionId,
  opened,
  savedViews,
  selectedTableKey,
  tableDisplayByKey,
  onLoadSchemas,
  onRemoveSavedView,
  onSelectSavedView,
  onSelectTable,
  onToggle,
  onToggleSchema,
  onToggleSchemaExpanded,
}: {
  catalog: CatalogState;
  connectionId: string | null;
  opened: boolean;
  savedViews: SavedTableView[];
  selectedTableKey: string | null;
  tableDisplayByKey: Record<string, TableDisplayConfig>;
  onLoadSchemas: () => void;
  onRemoveSavedView: (viewId: string, viewName: string) => void;
  onSelectSavedView: (viewId: string) => void;
  onSelectTable: (tableKey: string) => void;
  onToggle: () => void;
  onToggleSchema: (schemaName: string) => void;
  onToggleSchemaExpanded: (schemaName: string) => void;
}) {
  const selectedSchemaNames = new Set(catalog.selectedSchemaNames);
  const expandedSchemaNames = new Set(catalog.expandedSchemaNames);

  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap">
        <Group gap={6} wrap="nowrap">
          <IconFolder size={15} />
          <Text fw={600} size="xs">
            Catalog
          </Text>
        </Group>
        <Group gap={4} wrap="nowrap">
          <ActionIcon
            aria-label="Refresh catalog schemas"
            disabled={catalog.isLoadingSchemas}
            onClick={(event) => {
              event.stopPropagation();
              onLoadSchemas();
            }}
            size="sm"
            variant="subtle"
          >
            {catalog.isLoadingSchemas ? (
              <Loader size={14} />
            ) : (
              <IconRefresh size={14} />
            )}
          </ActionIcon>
          <Button
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            rightSection={
              opened ? (
                <IconChevronDown size={14} />
              ) : (
                <IconChevronRight size={14} />
              )
            }
            size="compact-xs"
            variant="subtle"
          >
            {opened ? 'Hide' : 'Open'}
          </Button>
        </Group>
      </Group>

      <Collapse expanded={opened}>
        <Stack gap="xs">
          {catalog.error ? (
            <Alert color="red" title="Catalog failed" variant="light">
              {catalog.error}
            </Alert>
          ) : null}

          {catalog.isLoadingSchemas ? (
            <Group gap="xs">
              <Loader size={14} />
              <Text c="dimmed" size="xs">
                Loading schemas...
              </Text>
            </Group>
          ) : null}

          {!catalog.isLoadingSchemas && catalog.schemas.length === 0 ? (
            <Text c="dimmed" size="xs">
              Open catalog to load schemas.
            </Text>
          ) : null}

          {!catalog.isLoadingSchemas &&
          catalog.schemas.length > 0 &&
          catalog.schemas.every((schema) => !schema.visible) ? (
            <Text c="dimmed" size="xs">
              All schemas are hidden. Configure schemas from connection options.
            </Text>
          ) : null}

          {catalog.schemas
            .filter((schema) => schema.visible)
            .map((schema) => {
              const isSelected = selectedSchemaNames.has(schema.name);
              const isExpanded = expandedSchemaNames.has(schema.name);
              const tables = catalog.schemaTablesByName[schema.name] ?? [];
              const schemaViews = savedViews.filter(
                (view) => view.sourceSchema === schema.name,
              );
              const isLoadingTables =
                catalog.loadingSchemaTablesByName[schema.name] ?? false;

              return (
                <Stack key={schema.name} gap={4}>
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${schema.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleSchemaExpanded(schema.name);
                      }}
                      size="sm"
                      variant="subtle"
                    >
                      {isExpanded ? (
                        <IconChevronDown size={14} />
                      ) : (
                        <IconChevronRight size={14} />
                      )}
                    </ActionIcon>
                    <Checkbox
                      checked={isSelected}
                      label={
                        <Text fw={500} size="xs">
                          {schema.alias.trim() || schema.name}
                        </Text>
                      }
                      onChange={() => onToggleSchema(schema.name)}
                      size="xs"
                    />
                    {isLoadingTables ? <Loader size={12} /> : null}
                  </Group>

                  <Collapse expanded={isExpanded}>
                    <Stack gap={2} pl="lg">
                      {isLoadingTables ? (
                        <Text c="dimmed" size="xs">
                          Loading tables...
                        </Text>
                      ) : null}

                      {!isLoadingTables &&
                      tables.length === 0 &&
                      schemaViews.length === 0 ? (
                        <Text c="dimmed" size="xs">
                          No loaded tables.
                        </Text>
                      ) : null}

                      {tables.map((table) => {
                        const tableAlias = connectionId
                          ? tableDisplayByKey[
                              tableDisplayKeyFromParts(
                                connectionId,
                                table.schema,
                                table.name,
                              )
                            ]?.tableAlias?.trim()
                          : '';

                        return (
                          <Button
                            key={table.fullName}
                            aria-label={
                              tableAlias
                                ? `${tableAlias} (${table.fullName})`
                                : table.fullName
                            }
                            color={
                              selectedTableKey === table.fullName
                                ? 'blue'
                                : 'gray'
                            }
                            justify="flex-start"
                            leftSection={<IconTable size={14} />}
                            onClick={() => onSelectTable(table.fullName)}
                            size="compact-xs"
                            title={table.fullName}
                            variant={
                              selectedTableKey === table.fullName
                                ? 'light'
                                : 'subtle'
                            }
                          >
                            <Text size="xs" truncate="end">
                              {tableAlias || table.name}
                            </Text>
                          </Button>
                        );
                      })}

                      {schemaViews.map((view) => {
                        const viewKey = createSavedViewSelectionKey(view.id);

                        return (
                          <Group gap={4} key={view.id} wrap="nowrap">
                            <Button
                              color={
                                selectedTableKey === viewKey ? 'grape' : 'gray'
                              }
                              justify="flex-start"
                              leftSection={<IconDatabaseSearch size={14} />}
                              onClick={() => onSelectSavedView(view.id)}
                              size="compact-xs"
                              style={{
                                flex: 1,
                                minWidth: 0,
                              }}
                              variant={
                                selectedTableKey === viewKey
                                  ? 'light'
                                  : 'subtle'
                              }
                            >
                              <Text size="xs" truncate="end">
                                {view.name}
                              </Text>
                            </Button>
                            <ActionIcon
                              aria-label={`Delete saved view ${view.name}`}
                              color="red"
                              onClick={(event) => {
                                event.stopPropagation();
                                onRemoveSavedView(view.id, view.name);
                              }}
                              size="sm"
                              variant="subtle"
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Group>
                        );
                      })}
                    </Stack>
                  </Collapse>
                </Stack>
              );
            })}
        </Stack>
      </Collapse>
    </Stack>
  );
}
