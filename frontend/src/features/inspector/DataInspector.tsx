import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  Group,
  Loader,
  Menu,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconChartBar,
  IconDeviceFloppy,
  IconMapPin,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconRestore,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import {
  MantineReactTable,
  type MRT_ColumnDef,
  useMantineReactTable,
} from 'mantine-react-table';
import { MRT_Localization_RU } from 'mantine-react-table/locales/ru/index.esm.mjs';
import 'mantine-react-table/styles.css';
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  combineTableFilters,
  filtersToTableFilter,
  sourceCompatible,
} from '../analytics/workspace-context';
import { useWorkspaceAnalyticsStore } from '../analytics/workspace-store';
import {
  createEmptyInsertRow,
  type DraftInsertRow,
  formatRowCount,
  serializeRowKey,
} from '../app/app-utils';
import { EmptyState, PanelFrame } from '../app/chrome';
import { useWorkspacePanels } from '../app/WorkspaceLayout';
import {
  type DatabaseConnection,
  type FlowmapTableSource,
  type GeoJsonTableSource,
  type MapLayer,
  type MapSource,
  type TableDisplayConfig,
  useConnectionStore,
} from '../connections/store';
import { SavedViewModal } from '../filters/SavedViewModal';
import type { SavedTableView, TableFilterDefinition } from '../filters/types';
import { useI18n } from '../i18n/i18n';
import type { RowReference } from '../map/selection';
import {
  commitInspectorRows,
  fetchInspectorRows,
  fetchRelatedRows,
  fetchRelationLabels,
  type InspectableTable,
  type InspectorColumn,
  type InspectorRow,
  type InspectorRowsResponse,
  type RelatedRowsGroup,
  type RelationOption,
  saveTableDisplayConfig,
  type TableChangeOperation,
} from './api';
import {
  relationDisplayKey,
  relationValueKey,
  tableDisplayKey,
  tableDisplayKeyFromParts,
} from './keys';
import {
  RecordEditorPanel,
  RelatedRecordPanel,
  RelationCellValue,
} from './RecordPanels';
import {
  areEditorValuesEqual,
  formatCellValue,
  getCellFontFamily,
  getCellTextAlign,
  isEditableColumnType,
  normalizeEditorValue,
} from './table-editing';
import type { InspectorGridRow, LocateTarget } from './types';

const pageSize = 100;
const recordEditorPanelId = 'record-editor';

interface InspectedRelatedRecord {
  panelId: string;
  group: RelatedRowsGroup;
  row: InspectorRow;
}

function createRelatedRecordPanelId(
  connectionId: string,
  group: RelatedRowsGroup,
  row: InspectorRow,
) {
  const rowIdentity =
    serializeRowKey(row.rowKey, group.primaryKey) ||
    JSON.stringify(
      Object.entries(row.values).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );

  return [
    'related-record',
    connectionId,
    group.schema,
    group.table,
    rowIdentity,
  ]
    .map(encodeURIComponent)
    .join(':');
}

export function DataInspector({
  connection,
  featureCreateRefreshToken,
  isLoadingTables,
  isLoadingTableMetadata,
  mapLayers = [],
  mapSources = [],
  onCreateRelatedArc,
  onLocateFeature,
  onLocateRelatedFeature,
  selectedView,
  selectedTable,
  tablesError,
}: {
  connection: DatabaseConnection | null;
  featureCreateRefreshToken: number;
  isLoadingTables: boolean;
  isLoadingTableMetadata: boolean;
  mapLayers: MapLayer[];
  mapSources: MapSource[];
  onCreateRelatedArc: (
    group: RelatedRowsGroup,
    row: InspectorRow,
    startGeometryColumn: string,
    endGeometryColumn: string,
  ) => void;
  onLocateFeature: (
    target: LocateTarget,
    row: InspectorRow,
    primaryKey: string[],
  ) => Promise<void>;
  onLocateRelatedFeature: (
    group: RelatedRowsGroup,
    row: InspectorRow,
    geometryColumnName: string,
  ) => Promise<void>;
  selectedView: SavedTableView | null;
  selectedTable: InspectableTable | null;
  tablesError: string;
}) {
  const { language } = useI18n();
  const workspacePanels = useWorkspacePanels();
  const [savedViewOpened, savedViewModal] = useDisclosure(false);
  const [rowsState, setRowsState] = useState<InspectorRowsResponse | null>(
    null,
  );
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [rowsError, setRowsError] = useState('');
  const [rowsRefreshToken, setRowsRefreshToken] = useState(0);
  const [acceptedTableFilter, setAcceptedTableFilter] =
    useState<TableFilterDefinition | null>(null);
  const [draftUpdates, setDraftUpdates] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [draftDeletes, setDraftDeletes] = useState<Record<string, true>>({});
  const [draftInserts, setDraftInserts] = useState<DraftInsertRow[]>([]);
  const [isSavingChanges, setIsSavingChanges] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [locatingRowToken, setLocatingRowToken] = useState<string | null>(null);
  const [locateError, setLocateError] = useState('');
  const [relatedGroups, setRelatedGroups] = useState<RelatedRowsGroup[]>([]);
  const [isLoadingRelatedRows, setIsLoadingRelatedRows] = useState(false);
  const [relatedRowsError, setRelatedRowsError] = useState('');
  const [relatedRowsRefreshToken, setRelatedRowsRefreshToken] = useState(0);
  const [inspectedRelatedRecords, setInspectedRelatedRecords] = useState<
    Record<string, InspectedRelatedRecord>
  >({});
  const inspectedRelatedPanelIdsRef = useRef<string[]>([]);
  inspectedRelatedPanelIdsRef.current = Object.keys(inspectedRelatedRecords);
  const [selectedGridRowId, setSelectedGridRowId] = useState<string | null>(
    null,
  );
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const rowSelectionInteractionRef = useRef(false);
  const [relationLabels, setRelationLabels] = useState<
    Record<string, Record<string, RelationOption>>
  >({});
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [activeSavedViewId, setActiveSavedViewId] = useState<string | null>(
    null,
  );
  const [editingSavedView, setEditingSavedView] =
    useState<SavedTableView | null>(null);
  const deferredSearchInput = useDeferredValue(searchInput);
  const savedTableViews = useConnectionStore((state) => state.savedTableViews);
  const addSavedTableView = useConnectionStore(
    (state) => state.addSavedTableView,
  );
  const updateSavedTableView = useConnectionStore(
    (state) => state.updateSavedTableView,
  );
  const removeSavedTableView = useConnectionStore(
    (state) => state.removeSavedTableView,
  );
  const refreshMapSourcesForConnection = useConnectionStore(
    (state) => state.refreshMapSourcesForConnection,
  );
  const relationDisplayByKey = useConnectionStore(
    (state) => state.relationDisplayByKey,
  );
  const setRelationDisplayConfig = useConnectionStore(
    (state) => state.setRelationDisplayConfig,
  );
  const tableDisplayByKey = useConnectionStore(
    (state) => state.tableDisplayByKey,
  );
  const setTableDisplayConfig = useConnectionStore(
    (state) => state.setTableDisplayConfig,
  );
  const requestAnalysis = useWorkspaceAnalyticsStore(
    (state) => state.requestAnalysis,
  );
  const setWorkspaceSelection = useWorkspaceAnalyticsStore(
    (state) => state.setSelection,
  );
  const refreshAnalytics = useWorkspaceAnalyticsStore((state) => state.refresh);
  const workspaceFilters = useWorkspaceAnalyticsStore((state) => state.filters);
  const workspaceFilterDataset = useWorkspaceAnalyticsStore(
    (state) => state.filterDataset,
  );
  const activeWorkspaceSource = useWorkspaceAnalyticsStore(
    (state) => state.activeSource,
  );
  const workspaceSelection = useWorkspaceAnalyticsStore(
    (state) => state.selection,
  );

  const matchingSavedViews = useMemo(
    () =>
      savedTableViews.filter(
        (view) =>
          view.connectionId === connection?.id &&
          view.sourceSchema === selectedTable?.schema &&
          view.sourceTable === selectedTable?.name,
      ),
    [
      connection?.id,
      savedTableViews,
      selectedTable?.name,
      selectedTable?.schema,
    ],
  );
  const selectedViewFromList =
    matchingSavedViews.find((view) => view.id === selectedView?.id) ?? null;
  const activeSavedView =
    selectedViewFromList ??
    matchingSavedViews.find((view) => view.id === activeSavedViewId) ??
    null;
  const locateTargets = useMemo(() => {
    if (!selectedTable) {
      return [];
    }

    const targets = mapLayers.flatMap<LocateTarget>((layer) => {
      if (!layer.visible) {
        return [];
      }

      if (layer.type === 'geojson') {
        const source = mapSources.find(
          (candidate): candidate is GeoJsonTableSource =>
            candidate.id === layer.sourceId &&
            candidate.type === 'geojson-table' &&
            (candidate.sourceViewId === activeSavedView?.id ||
              (candidate.schema === selectedTable.schema &&
                candidate.table === selectedTable.name)),
        );

        return source ? [{ kind: 'geojson', layer, source }] : [];
      }

      if (layer.type === 'flowmap' || layer.type === 'arc') {
        const source = mapSources.find(
          (candidate): candidate is FlowmapTableSource =>
            candidate.id === layer.sourceId &&
            candidate.type === 'flowmap-table' &&
            candidate.schema === selectedTable.schema &&
            candidate.table === selectedTable.name,
        );

        return source ? [{ kind: 'flowmap', layer, source }] : [];
      }

      return [];
    });

    return targets.sort((left, right) => {
      if (left.kind !== 'geojson' || right.kind !== 'geojson') {
        return left.kind === right.kind ? 0 : left.kind === 'flowmap' ? -1 : 1;
      }

      const leftMatchesView = left.source.sourceViewId === activeSavedView?.id;
      const rightMatchesView =
        right.source.sourceViewId === activeSavedView?.id;
      if (leftMatchesView === rightMatchesView) {
        return 0;
      }

      return leftMatchesView ? -1 : 1;
    });
  }, [activeSavedView?.id, mapLayers, mapSources, selectedTable]);
  const activeTableFilter = activeSavedView?.filter ?? null;
  const workspaceTableSource = useMemo(
    () =>
      connection && selectedTable
        ? {
            connectionId: connection.id,
            schema: selectedTable.schema,
            table: selectedTable.name,
            name: activeSavedView?.name ?? selectedTable.name,
            filter: activeTableFilter,
          }
        : null,
    [activeSavedView?.name, activeTableFilter, connection, selectedTable],
  );
  const compatibleWorkspaceFilterState = useMemo(() => {
    const dataset = workspaceFilterDataset;
    if (
      !workspaceTableSource ||
      !dataset ||
      !sourceCompatible(workspaceTableSource, dataset)
    ) {
      return { filter: null, error: null };
    }

    if (
      workspaceFilters.some(
        (filter) => filter.datasetId && filter.datasetId !== dataset.id,
      )
    ) {
      return {
        filter: null,
        error: 'Analytics filters belong to a different dataset.',
      };
    }

    try {
      return {
        filter: filtersToTableFilter(workspaceFilters, dataset),
        error: null,
      };
    } catch (error) {
      return {
        filter: null,
        error:
          error instanceof Error
            ? error.message
            : 'Analytics filters could not be applied to this table.',
      };
    }
  }, [workspaceFilterDataset, workspaceFilters, workspaceTableSource]);
  const compatibleWorkspaceFilter = compatibleWorkspaceFilterState.filter;
  const workspaceFilterError = compatibleWorkspaceFilterState.error;
  const effectiveTableFilter = useMemo<TableFilterDefinition | null>(() => {
    return combineTableFilters(activeTableFilter, compatibleWorkspaceFilter);
  }, [activeTableFilter, compatibleWorkspaceFilter]);
  const canCreateSavedView = Boolean(
    selectedTable?.columns.some((column) => isEditableColumnType(column.type)),
  );
  const activePrimaryKey =
    rowsState?.primaryKey ?? selectedTable?.primaryKey ?? [];
  const foreignKeyByColumn = useMemo(
    () =>
      new Map(
        (selectedTable?.foreignKeys ?? []).map((foreignKey) => [
          foreignKey.columnName,
          foreignKey,
        ]),
      ),
    [selectedTable?.foreignKeys],
  );
  const relationConfigByColumn = useMemo(() => {
    if (!connection || !selectedTable) {
      return new Map<string, string[]>();
    }

    return new Map(
      (selectedTable.foreignKeys ?? []).map((foreignKey) => {
        const key = relationDisplayKey(
          connection.id,
          selectedTable,
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
  }, [connection, relationDisplayByKey, selectedTable]);
  const tableDisplayKeyValue =
    connection && selectedTable
      ? tableDisplayKey(connection.id, selectedTable)
      : null;
  const tableDisplayConfig: TableDisplayConfig = tableDisplayKeyValue
    ? (tableDisplayByKey[tableDisplayKeyValue] ?? {
        tableAlias: '',
        columnLabels: {},
        hiddenColumns: [],
      })
    : {
        tableAlias: '',
        columnLabels: {},
        hiddenColumns: [],
      };
  const selectedTableAlias = tableDisplayConfig.tableAlias?.trim() || null;
  const columnVisibility = useMemo(
    () =>
      Object.fromEntries(
        (rowsState?.columns ?? []).map((column) => [
          column.name,
          !tableDisplayConfig.hiddenColumns.includes(column.name),
        ]),
      ),
    [rowsState?.columns, tableDisplayConfig.hiddenColumns],
  );
  const hasDirtyChanges =
    draftInserts.length > 0 ||
    Object.keys(draftUpdates).length > 0 ||
    Object.keys(draftDeletes).length > 0;
  const touchedRowCount =
    draftInserts.length +
    Object.keys(draftUpdates).length +
    Object.keys(draftDeletes).length;
  const pendingTableFilterChange =
    hasDirtyChanges &&
    JSON.stringify(acceptedTableFilter) !==
      JSON.stringify(effectiveTableFilter);

  const resetDraftState = useCallback(() => {
    setDraftUpdates({});
    setDraftDeletes({});
    setDraftInserts([]);
    setSaveError('');
  }, []);

  const confirmDraftReset = useCallback(
    (actionLabel: string) => {
      if (!hasDirtyChanges) {
        return true;
      }

      return window.confirm(
        `Discard unsaved table changes before ${actionLabel}?`,
      );
    },
    [hasDirtyChanges],
  );

  useEffect(() => {
    if (!connection || !selectedTable || workspaceFilterError) {
      return;
    }

    const filterChanged =
      JSON.stringify(acceptedTableFilter) !==
      JSON.stringify(effectiveTableFilter);
    if (!filterChanged || hasDirtyChanges) {
      return;
    }

    setAcceptedTableFilter(effectiveTableFilter);
  }, [
    acceptedTableFilter,
    connection,
    effectiveTableFilter,
    hasDirtyChanges,
    selectedTable,
    workspaceFilterError,
  ]);

  useEffect(() => {
    const nextSearch = deferredSearchInput.trim();
    if (nextSearch === appliedSearch) {
      return;
    }

    if (!confirmDraftReset('changing search filter')) {
      setSearchInput(appliedSearch);
      return;
    }

    resetDraftState();
    setSaveMessage('');
    setAppliedSearch(nextSearch);
  }, [appliedSearch, confirmDraftReset, deferredSearchInput, resetDraftState]);

  useEffect(() => {
    if (
      activeSavedViewId &&
      !matchingSavedViews.some((view) => view.id === activeSavedViewId)
    ) {
      setActiveSavedViewId(null);
    }
  }, [activeSavedViewId, matchingSavedViews]);

  useEffect(() => {
    setActiveSavedViewId(selectedView?.id ?? null);
    setEditingSavedView(null);
  }, [selectedView?.id]);

  useEffect(() => {
    if (!connection || !selectedTable) {
      setRowsState(null);
      setRowsError('');
      setDraftUpdates({});
      setDraftDeletes({});
      setDraftInserts([]);
      setSaveError('');
      setSaveMessage('');
      return;
    }

    const activeConnection = connection;
    const activeTable = selectedTable;
    const featureRefreshVersion = featureCreateRefreshToken;
    const refreshVersion = rowsRefreshToken;
    let isActive = true;
    if (workspaceFilterError) {
      return;
    }

    void featureRefreshVersion;
    void refreshVersion;

    async function loadRows(offset: number) {
      setIsLoadingRows(true);
      setRowsError('');

      try {
        const payload = await fetchInspectorRows(
          activeConnection,
          activeTable,
          offset,
          pageSize,
          appliedSearch,
          acceptedTableFilter,
        );

        if (!isActive) {
          return;
        }

        setRowsState(payload);
        setSaveError('');
      } catch (error) {
        if (!isActive) {
          return;
        }

        setRowsError(
          error instanceof Error ? error.message : 'Failed to load table rows.',
        );
      } finally {
        if (isActive) {
          setIsLoadingRows(false);
        }
      }
    }

    void loadRows(0);

    return () => {
      isActive = false;
    };
  }, [
    acceptedTableFilter,
    appliedSearch,
    connection,
    featureCreateRefreshToken,
    rowsRefreshToken,
    selectedTable,
    workspaceFilterError,
  ]);

  useEffect(() => {
    if (!connection || !selectedTable || !rowsState) {
      setRelationLabels({});
      return;
    }

    const activeConnection = connection;
    const activeTable = selectedTable;
    const activeRowsState = rowsState;
    const foreignKeys = selectedTable.foreignKeys ?? [];
    if (foreignKeys.length === 0) {
      setRelationLabels({});
      return;
    }

    let isActive = true;

    async function loadRelationLabels() {
      const entries = await Promise.all(
        foreignKeys.map(async (foreignKey) => {
          const values = Array.from(
            new Set(
              activeRowsState.rows
                .map((row) => row.values[foreignKey.columnName])
                .filter((value) => value !== null && value !== undefined)
                .map((value) => JSON.stringify(value)),
            ),
          ).map((value) => JSON.parse(value) as unknown);
          if (values.length === 0) {
            return [foreignKey.columnName, {}] as const;
          }

          const options = await fetchRelationLabels(activeConnection, {
            schema: activeTable.schema,
            table: activeTable.name,
            column: foreignKey.columnName,
            labelColumns:
              relationConfigByColumn.get(foreignKey.columnName) ?? [],
            values,
          });

          return [
            foreignKey.columnName,
            Object.fromEntries(
              options.map((option) => [String(option.value), option]),
            ),
          ] as const;
        }),
      );

      if (!isActive) {
        return;
      }

      setRelationLabels(Object.fromEntries(entries));
    }

    void loadRelationLabels().catch(() => {
      if (isActive) {
        setRelationLabels({});
      }
    });

    return () => {
      isActive = false;
    };
  }, [connection, relationConfigByColumn, rowsState, selectedTable]);

  async function handlePageChange(nextOffset: number) {
    if (!connection || !selectedTable) {
      return;
    }

    if (!confirmDraftReset(`changing to offset ${nextOffset}`)) {
      return;
    }

    resetDraftState();
    setSaveMessage('');

    setIsLoadingRows(true);
    setRowsError('');

    try {
      const payload = await fetchInspectorRows(
        connection,
        selectedTable,
        nextOffset,
        pageSize,
        appliedSearch,
        acceptedTableFilter,
      );
      setRowsState(payload);
    } catch (error) {
      setRowsError(
        error instanceof Error ? error.message : 'Failed to load table rows.',
      );
    } finally {
      setIsLoadingRows(false);
    }
  }

  function handleRefreshRows() {
    if (!confirmDraftReset('refreshing rows')) {
      return;
    }

    resetDraftState();
    setSaveMessage('');
    startTransition(() => {
      setRowsRefreshToken((value) => value + 1);
    });
  }

  function handleAnalyzeTable() {
    if (!connection || !selectedTable) {
      return;
    }

    const sourceSelection =
      selectedRowReferences.length > 0
        ? selectedRowReferences
        : activeWorkspaceSource?.connectionId === connection.id &&
            activeWorkspaceSource.schema === selectedTable.schema &&
            activeWorkspaceSource.table === selectedTable.name
          ? workspaceSelection
          : [];
    requestAnalysis({
      connectionId: connection.id,
      schema: selectedTable.schema,
      table: selectedTable.name,
      name: activeSavedView?.name ?? selectedTableAlias ?? selectedTable.name,
      geometryColumn:
        selectedTable.geometryColumns.length === 1
          ? selectedTable.geometryColumns[0].name
          : undefined,
      ...(activeTableFilter ? { filter: activeTableFilter } : {}),
    });
    setWorkspaceSelection(sourceSelection);
  }

  function handleApplyPendingTableFilter() {
    if (!pendingTableFilterChange) {
      return;
    }

    if (!confirmDraftReset('applying analytics filters')) {
      return;
    }

    resetDraftState();
    setSaveMessage('');
    setAcceptedTableFilter(effectiveTableFilter);
  }

  function handleAddDraftRow() {
    if (!rowsState) {
      return;
    }

    setDraftInserts((current) => [
      createEmptyInsertRow(
        rowsState.columns.filter((column) => isEditableColumnType(column.type)),
      ),
      ...current,
    ]);
    setSaveMessage('');
  }

  const handleDraftInsertChange = useCallback(
    (draftId: string, column: InspectorColumn, nextValue: unknown) => {
      setDraftInserts((current) =>
        current.map((draftRow) =>
          draftRow.id === draftId
            ? {
                ...draftRow,
                values: {
                  ...draftRow.values,
                  [column.name]: normalizeEditorValue(column.type, nextValue),
                },
              }
            : draftRow,
        ),
      );
      setSaveMessage('');
    },
    [],
  );

  const handleExistingCellChange = useCallback(
    (row: InspectorRow, column: InspectorColumn, nextValue: unknown) => {
      const rowToken = serializeRowKey(row.rowKey, activePrimaryKey);
      if (!rowToken || draftDeletes[rowToken]) {
        return;
      }

      const baseValue = row.values[column.name];
      const normalizedValue = normalizeEditorValue(column.type, nextValue);

      setDraftUpdates((current) => {
        const currentRowPatch = current[rowToken] ?? {};
        const nextRowPatch = {
          ...currentRowPatch,
        };

        if (areEditorValuesEqual(baseValue, normalizedValue)) {
          delete nextRowPatch[column.name];
        } else {
          nextRowPatch[column.name] = normalizedValue;
        }

        if (Object.keys(nextRowPatch).length === 0) {
          const { [rowToken]: _removed, ...rest } = current;
          return rest;
        }

        return {
          ...current,
          [rowToken]: nextRowPatch,
        };
      });
      setSaveMessage('');
    },
    [activePrimaryKey, draftDeletes],
  );

  function handleToggleDeleteExistingRow(row: InspectorRow) {
    const rowToken = serializeRowKey(row.rowKey, activePrimaryKey);
    if (!rowToken) {
      return;
    }

    setDraftDeletes((current) => {
      if (current[rowToken]) {
        const { [rowToken]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [rowToken]: true,
      };
    });
    setDraftUpdates((current) => {
      const { [rowToken]: _removed, ...rest } = current;
      return rest;
    });
    setSaveMessage('');
  }

  function handleRemoveDraftInsertRow(draftId: string) {
    setDraftInserts((current) =>
      current.filter((draftRow) => draftRow.id !== draftId),
    );
    setSaveMessage('');
  }

  async function handleSaveChanges() {
    if (!connection || !selectedTable || !rowsState || !hasDirtyChanges) {
      return;
    }

    const operations: TableChangeOperation[] = [];

    for (const draftRow of draftInserts) {
      operations.push({
        type: 'insert',
        values: draftRow.values,
      });
    }

    for (const row of rowsState.rows) {
      const rowToken = serializeRowKey(row.rowKey, rowsState.primaryKey);
      if (!rowToken) {
        continue;
      }

      if (draftDeletes[rowToken]) {
        operations.push({
          type: 'delete',
          rowKey: row.rowKey ?? undefined,
        });
        continue;
      }

      if (draftUpdates[rowToken]) {
        operations.push({
          type: 'update',
          rowKey: row.rowKey ?? undefined,
          changes: draftUpdates[rowToken],
        });
      }
    }

    if (operations.length === 0) {
      return;
    }

    setIsSavingChanges(true);
    setSaveError('');
    setSaveMessage('');

    try {
      const payload = await commitInspectorRows(connection, {
        schema: selectedTable.schema,
        table: selectedTable.name,
        operations,
      });

      resetDraftState();
      setSaveMessage(
        `Saved ${payload.applied} change${payload.applied === 1 ? '' : 's'}.`,
      );
      refreshAnalytics();
      refreshMapSourcesForConnection(connection.id);
      startTransition(() => {
        setRowsRefreshToken((value) => value + 1);
      });
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Failed to save table changes.',
      );
    } finally {
      setIsSavingChanges(false);
    }
  }

  function handleDiscardChanges() {
    if (!hasDirtyChanges) {
      return;
    }

    if (!window.confirm('Discard all unsaved table changes?')) {
      return;
    }

    resetDraftState();
    setSaveMessage('');
  }

  function handleTableDisplayConfigChange(nextConfig: TableDisplayConfig) {
    if (!connection || !selectedTable || !tableDisplayKeyValue) {
      return;
    }

    setTableDisplayConfig(tableDisplayKeyValue, nextConfig);
    void saveTableDisplayConfig(connection, {
      schema: selectedTable.schema,
      table: selectedTable.name,
      config: nextConfig,
    }).catch((error) => {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Failed to save table display settings.',
      );
    });
  }

  async function handleLocateRow(row: InspectorRow) {
    if (!row.rowKey || locateTargets.length === 0) {
      return;
    }

    const rowToken = serializeRowKey(row.rowKey, activePrimaryKey);
    setLocatingRowToken(rowToken);
    setLocateError('');

    try {
      await onLocateFeature(locateTargets[0], row, activePrimaryKey);
    } catch (error) {
      setLocateError(
        error instanceof Error ? error.message : 'Failed to locate row.',
      );
    } finally {
      setLocatingRowToken(null);
    }
  }

  async function handleLocateRelatedRow(
    group: RelatedRowsGroup,
    row: InspectorRow,
    geometryColumnName: string,
  ) {
    if (!row.rowKey || group.geometryColumns.length === 0) {
      return;
    }

    const rowToken = serializeRowKey(row.rowKey, group.primaryKey);
    setLocatingRowToken(rowToken);
    setLocateError('');

    try {
      await onLocateRelatedFeature(group, row, geometryColumnName);
    } catch (error) {
      setLocateError(
        error instanceof Error
          ? error.message
          : 'Failed to locate related row.',
      );
    } finally {
      setLocatingRowToken(null);
    }
  }

  function handleInspectRelatedRecord(
    group: RelatedRowsGroup,
    row: InspectorRow,
  ) {
    if (!connection) {
      return;
    }

    const panelId = createRelatedRecordPanelId(connection.id, group, row);
    const isAlreadyOpen = Boolean(inspectedRelatedRecords[panelId]);

    setInspectedRelatedRecords((current) => ({
      ...current,
      [panelId]: { panelId, group, row },
    }));

    if (isAlreadyOpen) {
      workspacePanels.focusPanel(panelId);
    }
  }

  function handleOpenSavedViewModal() {
    setEditingSavedView(null);
    savedViewModal.open();
  }

  function handleOpenEditSavedViewModal(view: SavedTableView) {
    setEditingSavedView(view);
    savedViewModal.open();
  }

  function handleCloseSavedViewModal() {
    setEditingSavedView(null);
    savedViewModal.close();
  }

  function handleSaveView(payload: {
    viewId: string | null;
    name: string;
    filter: TableFilterDefinition;
  }) {
    if (!connection || !selectedTable) {
      return;
    }

    if (payload.viewId) {
      updateSavedTableView(payload.viewId, {
        name: payload.name,
        filter: payload.filter,
      });
    } else {
      addSavedTableView({
        name: payload.name,
        connectionId: connection.id,
        sourceSchema: selectedTable.schema,
        sourceTable: selectedTable.name,
        filter: payload.filter,
      });
    }

    setEditingSavedView(null);
    savedViewModal.close();
  }

  function handleRemoveActiveSavedView() {
    if (!activeSavedView) {
      return;
    }

    if (!window.confirm(`Delete saved view "${activeSavedView.name}"?`)) {
      return;
    }

    if (activeSavedView.id === activeSavedViewId) {
      setActiveSavedViewId(null);
    }

    removeSavedTableView(activeSavedView.id);
  }

  const inspectorGridRows = useMemo<InspectorGridRow[]>(() => {
    if (!rowsState) {
      return [];
    }

    const draftRows: InspectorGridRow[] = draftInserts.map((draftRow) => ({
      id: `draft:${draftRow.id}`,
      kind: 'draft',
      draftRow,
      row: null,
      rowPatch: undefined,
      rowToken: null,
      values: draftRow.values,
      isDeleted: false,
    }));

    const recordRows = rowsState.rows.map<InspectorGridRow>((row) => {
      const rowToken = serializeRowKey(row.rowKey, rowsState.primaryKey);
      const rowPatch = rowToken ? draftUpdates[rowToken] : undefined;

      return {
        id:
          rowToken ??
          JSON.stringify([rowsState.offset, rowsState.primaryKey, row.values]),
        kind: 'record',
        draftRow: null,
        row,
        rowPatch,
        rowToken,
        values: {
          ...row.values,
          ...(rowPatch ?? {}),
        },
        isDeleted: rowToken ? Boolean(draftDeletes[rowToken]) : false,
      };
    });

    return [...draftRows, ...recordRows];
  }, [draftDeletes, draftInserts, draftUpdates, rowsState]);
  const selectedGridRow =
    inspectorGridRows.find((gridRow) => gridRow.id === selectedGridRowId) ??
    null;
  const selectedGridRowLabel =
    selectedGridRow?.kind === 'record'
      ? activePrimaryKey
          .map((columnName) =>
            formatCellValue(selectedGridRow.values[columnName]),
          )
          .join(', ')
      : '';

  const selectedRowReferences = useMemo<RowReference[]>(
    () =>
      inspectorGridRows.flatMap((gridRow) => {
        if (
          gridRow.kind !== 'record' ||
          !rowSelection[gridRow.id] ||
          !gridRow.row.rowKey
        ) {
          return [];
        }

        return [
          {
            primaryKey: activePrimaryKey,
            rowKey: gridRow.row.rowKey,
          },
        ];
      }),
    [activePrimaryKey, inspectorGridRows, rowSelection],
  );

  useEffect(() => {
    if (!rowSelectionInteractionRef.current) {
      return;
    }

    rowSelectionInteractionRef.current = false;
    if (
      !activeWorkspaceSource ||
      !connection ||
      !selectedTable ||
      activeWorkspaceSource.connectionId !== connection.id ||
      activeWorkspaceSource.schema !== selectedTable.schema ||
      activeWorkspaceSource.table !== selectedTable.name
    ) {
      return;
    }

    setWorkspaceSelection(selectedRowReferences);
  }, [
    activeWorkspaceSource,
    connection,
    selectedRowReferences,
    selectedTable,
    setWorkspaceSelection,
  ]);

  useEffect(() => {
    const tableKey = `${connection?.id ?? ''}:${selectedTable?.schema ?? ''}.${selectedTable?.name ?? ''}`;
    setRowSelection({});
    setAcceptedTableFilter(null);
    if (!tableKey) {
      return;
    }
  }, [connection?.id, selectedTable?.name, selectedTable?.schema]);

  useEffect(() => {
    void relatedRowsRefreshToken;
    if (
      !connection ||
      !selectedTable ||
      !selectedGridRow ||
      selectedGridRow.kind !== 'record' ||
      !selectedGridRow.row.rowKey
    ) {
      setRelatedGroups([]);
      setRelatedRowsError('');
      setIsLoadingRelatedRows(false);
      return;
    }

    const activeConnection = connection;
    const activeTable = selectedTable;
    const activeRowKey = selectedGridRow.row.rowKey;
    let isActive = true;

    async function loadRelatedRows() {
      setIsLoadingRelatedRows(true);
      setRelatedRowsError('');

      try {
        const payload = await fetchRelatedRows(activeConnection, {
          schema: activeTable.schema,
          table: activeTable.name,
          rowKey: activeRowKey,
          limit: 20,
        });
        if (isActive) {
          setRelatedGroups(payload.groups);
        }
      } catch (error) {
        if (isActive) {
          setRelatedGroups([]);
          setRelatedRowsError(
            error instanceof Error
              ? error.message
              : 'Failed to load related rows.',
          );
        }
      } finally {
        if (isActive) {
          setIsLoadingRelatedRows(false);
        }
      }
    }

    void loadRelatedRows();

    return () => {
      isActive = false;
    };
  }, [connection, relatedRowsRefreshToken, selectedGridRow, selectedTable]);

  const inspectorColumns = useMemo<MRT_ColumnDef<InspectorGridRow>[]>(
    () =>
      (rowsState?.columns ?? []).map((column) => {
        const foreignKey = foreignKeyByColumn.get(column.name);
        const isPrimaryKey = activePrimaryKey.includes(column.name);
        const columnLabel =
          tableDisplayConfig.columnLabels[column.name]?.trim() || column.name;

        return {
          id: column.name,
          accessorFn: (gridRow) => gridRow.values[column.name],
          header: columnLabel,
          Header: () => (
            <Stack gap={4}>
              <Group gap={4} wrap="nowrap">
                <Text fw={600} size="sm">
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
              <Text c="dimmed" size="xs">
                {column.type}
              </Text>
            </Stack>
          ),
          Cell: ({ row }) => {
            const gridRow = row.original;
            const displayValue = gridRow.values[column.name];
            const relationOption =
              foreignKey && displayValue !== null && displayValue !== undefined
                ? relationLabels[column.name]?.[relationValueKey(displayValue)]
                : undefined;

            return (
              <RelationCellValue
                isDeleted={gridRow.isDeleted}
                option={relationOption}
                value={displayValue}
              />
            );
          },
          enableEditing: false,
          mantineTableBodyCellProps: {
            style: {
              fontFamily: getCellFontFamily(column.name, column.type),
              textAlign: getCellTextAlign(column.type),
              verticalAlign: 'top',
            },
          },
          mantineTableHeadCellProps: {
            style: {
              minHeight: 54,
              overflow: 'hidden',
            },
          },
          size: foreignKey ? 240 : 180,
        } satisfies MRT_ColumnDef<InspectorGridRow>;
      }),
    [
      activePrimaryKey,
      foreignKeyByColumn,
      relationLabels,
      rowsState?.columns,
      tableDisplayConfig.columnLabels,
    ],
  );

  const inspectorTable = useMantineReactTable<InspectorGridRow>({
    columns: inspectorColumns,
    data: inspectorGridRows,
    enableRowSelection: ({ original }) =>
      original.kind === 'record' && Boolean(original.row.rowKey),
    enableBottomToolbar: false,
    enableColumnActions: false,
    enableColumnOrdering: true,
    enableColumnPinning: true,
    enableColumnResizing: true,
    enableColumnVirtualization: false,
    enableDensityToggle: true,
    enableEditing: false,
    enableFullScreenToggle: false,
    enableGlobalFilter: true,
    enablePagination: false,
    enableRowActions: true,
    enableRowVirtualization: true,
    enableStickyHeader: true,
    getRowId: (row) => row.id,
    initialState: {
      columnPinning: {
        left: ['mrt-row-actions'],
      },
      density: 'xs',
    },
    layoutMode: 'grid',
    localization: language === 'ru' ? MRT_Localization_RU : undefined,
    mantinePaperProps: {
      style: {
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        minHeight: 0,
      },
    },
    mantineTableBodyRowProps: ({ row }) => ({
      onClick: () => {
        setSelectedGridRowId(row.original.id);
        workspacePanels.focusPanel(recordEditorPanelId);
      },
      style: {
        background:
          row.original.id === selectedGridRowId
            ? 'rgba(34, 139, 230, 0.12)'
            : row.original.kind === 'draft'
              ? 'rgba(18, 184, 134, 0.08)'
              : row.original.isDeleted
                ? 'rgba(224, 49, 49, 0.08)'
                : row.original.rowPatch
                  ? 'rgba(250, 176, 5, 0.08)'
                  : undefined,
        cursor: 'pointer',
      },
    }),
    mantineTableContainerProps: {
      style: {
        flex: 1,
        height: '100%',
        minHeight: 0,
        overflow: 'auto',
      },
    },
    positionActionsColumn: 'first',
    renderRowActions: ({ row }) => {
      const gridRow = row.original;
      if (gridRow.kind === 'draft') {
        return (
          <Group gap={6} wrap="nowrap">
            <Badge color="teal" size="xs" variant="light">
              New
            </Badge>
            <ActionIcon
              aria-label="Remove new row"
              color="red"
              onClick={() => handleRemoveDraftInsertRow(gridRow.draftRow.id)}
              size="sm"
              variant="subtle"
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
        );
      }

      const canLocateRow =
        Boolean(gridRow.row.rowKey) && locateTargets.length > 0;

      return (
        <Group gap={6} wrap="nowrap">
          {gridRow.isDeleted ? (
            <Badge color="red" size="xs" variant="light">
              Delete
            </Badge>
          ) : gridRow.rowPatch ? (
            <Badge color="orange" size="xs" variant="light">
              Edit
            </Badge>
          ) : null}
          {rowsState?.isEditable && gridRow.row.rowKey ? (
            <ActionIcon
              aria-label={
                gridRow.isDeleted ? 'Restore row' : 'Mark row for delete'
              }
              color={gridRow.isDeleted ? 'gray' : 'red'}
              onClick={() => handleToggleDeleteExistingRow(gridRow.row)}
              size="sm"
              variant="subtle"
            >
              {gridRow.isDeleted ? (
                <IconRestore size={14} />
              ) : (
                <IconTrash size={14} />
              )}
            </ActionIcon>
          ) : null}
          {gridRow.row.rowKey ? (
            <ActionIcon
              aria-label="Locate row on map"
              color="blue"
              disabled={!canLocateRow}
              loading={
                Boolean(gridRow.rowToken) &&
                locatingRowToken === gridRow.rowToken
              }
              onClick={() => void handleLocateRow(gridRow.row)}
              size="sm"
              title={
                canLocateRow
                  ? `Locate in ${locateTargets[0].layer.name}`
                  : 'No visible geometry layer for this row'
              }
              variant="subtle"
            >
              <IconMapPin size={14} />
            </ActionIcon>
          ) : null}
        </Group>
      );
    },
    state: {
      columnVisibility,
      isLoading: isLoadingRows,
      rowSelection,
      showAlertBanner: Boolean(rowsError),
      showProgressBars: isLoadingRows,
    },
    onRowSelectionChange: (updater) => {
      rowSelectionInteractionRef.current = true;
      setRowSelection(updater);
    },
  });

  useEffect(() => {
    const tableLabel = selectedTableAlias || selectedTable?.fullName || '';
    const visibleTableColumns = (rowsState?.columns ?? []).filter(
      (column) => !tableDisplayConfig.hiddenColumns.includes(column.name),
    );

    if (connection && selectedTable && selectedGridRow && rowsState) {
      workspacePanels.registerPanel({
        id: recordEditorPanelId,
        floatRect: { height: 776, right: 24, top: 34, width: 360 },
        icon: 'record',
        name: `Record · ${tableLabel}${selectedGridRowLabel ? ` #${selectedGridRowLabel}` : ''}`,
        onClose: () => setSelectedGridRowId(null),
        content: (
          <PanelFrame>
            <RecordEditorPanel
              activePrimaryKey={activePrimaryKey}
              columnLabels={tableDisplayConfig.columnLabels}
              connection={connection}
              disabled={isSavingChanges}
              foreignKeyByColumn={foreignKeyByColumn}
              hasDirtyChanges={hasDirtyChanges}
              isSavingChanges={isSavingChanges}
              isLoadingRelatedRows={isLoadingRelatedRows}
              onChangeDraft={handleDraftInsertChange}
              onChangeExisting={handleExistingCellChange}
              onDiscard={handleDiscardChanges}
              onInspectRelatedRow={handleInspectRelatedRecord}
              onSave={() => void handleSaveChanges()}
              relatedGroups={relatedGroups}
              relatedRowsError={relatedRowsError}
              relationConfigByColumn={relationConfigByColumn}
              relationLabels={relationLabels}
              recordLabel={selectedGridRowLabel}
              row={selectedGridRow}
              selectedTable={selectedTable}
              tableColumns={visibleTableColumns}
              tableIsEditable={rowsState.isEditable}
              tableLabel={tableLabel}
              touchedRowCount={touchedRowCount}
            />
          </PanelFrame>
        ),
      });
    } else {
      workspacePanels.closePanel(recordEditorPanelId);
    }

    if (connection) {
      Object.values(inspectedRelatedRecords).forEach(
        (inspectedRelatedRecord, index) => {
          const relatedDisplayConfig =
            tableDisplayByKey[
              tableDisplayKeyFromParts(
                connection.id,
                inspectedRelatedRecord.group.schema,
                inspectedRelatedRecord.group.table,
              )
            ];
          const relatedTableLabel =
            relatedDisplayConfig?.tableAlias?.trim() ||
            inspectedRelatedRecord.group.label;
          const relatedRecordKey = inspectedRelatedRecord.group.primaryKey
            .map((columnName) =>
              formatCellValue(inspectedRelatedRecord.row.values[columnName]),
            )
            .join(', ');

          workspacePanels.registerPanel({
            id: inspectedRelatedRecord.panelId,
            floatRect: {
              height: 837,
              right: 404 + (index % 5) * 28,
              top: 34 + (index % 5) * 28,
              width: 420,
            },
            icon: 'record',
            name: `${relatedTableLabel}${relatedRecordKey ? ` #${relatedRecordKey}` : ''}`,
            onClose: () =>
              setInspectedRelatedRecords((current) => {
                const next = { ...current };
                delete next[inspectedRelatedRecord.panelId];
                return next;
              }),
            content: (
              <PanelFrame>
                <RelatedRecordPanel
                  connection={connection}
                  group={inspectedRelatedRecord.group}
                  key={`${inspectedRelatedRecord.group.schema}.${inspectedRelatedRecord.group.table}:${serializeRowKey(inspectedRelatedRecord.row.rowKey, inspectedRelatedRecord.group.primaryKey)}`}
                  onCreateArc={(startGeometryColumn, endGeometryColumn) =>
                    onCreateRelatedArc(
                      inspectedRelatedRecord.group,
                      inspectedRelatedRecord.row,
                      startGeometryColumn,
                      endGeometryColumn,
                    )
                  }
                  onLocateRow={(geometryColumnName) =>
                    void handleLocateRelatedRow(
                      inspectedRelatedRecord.group,
                      inspectedRelatedRecord.row,
                      geometryColumnName,
                    )
                  }
                  onInspectRelatedRow={handleInspectRelatedRecord}
                  onDeleted={() => {
                    workspacePanels.closePanel(inspectedRelatedRecord.panelId);
                    setInspectedRelatedRecords((current) => {
                      const next = { ...current };
                      delete next[inspectedRelatedRecord.panelId];
                      return next;
                    });
                    setRelatedRowsRefreshToken((value) => value + 1);
                    startTransition(() => {
                      setRowsRefreshToken((value) => value + 1);
                    });
                    refreshAnalytics();
                    refreshMapSourcesForConnection(connection.id);
                  }}
                  onSaved={(values) => {
                    const savedRowToken = serializeRowKey(
                      inspectedRelatedRecord.row.rowKey,
                      inspectedRelatedRecord.group.primaryKey,
                    );
                    setInspectedRelatedRecords((current) => {
                      const currentRecord =
                        current[inspectedRelatedRecord.panelId];
                      if (!currentRecord) {
                        return current;
                      }

                      return {
                        ...current,
                        [inspectedRelatedRecord.panelId]: {
                          ...currentRecord,
                          group: {
                            ...currentRecord.group,
                            rows: currentRecord.group.rows.map((candidate) =>
                              serializeRowKey(
                                candidate.rowKey,
                                currentRecord.group.primaryKey,
                              ) === savedRowToken
                                ? { ...candidate, values }
                                : candidate,
                            ),
                          },
                          row: { ...currentRecord.row, values },
                        },
                      };
                    });
                    refreshAnalytics();
                    refreshMapSourcesForConnection(connection.id);
                    setRelatedRowsRefreshToken((value) => value + 1);
                  }}
                  row={inspectedRelatedRecord.row}
                />
              </PanelFrame>
            ),
          });
        },
      );
    }
  });

  useEffect(
    () => () => {
      workspacePanels.closePanel(recordEditorPanelId);
      for (const panelId of inspectedRelatedPanelIdsRef.current) {
        workspacePanels.closePanel(panelId);
      }
    },
    [workspacePanels],
  );

  if (!connection) {
    return (
      <EmptyState
        detail="Select a connection to inspect table data."
        label="No Connection"
      />
    );
  }

  if (connection.testStatus !== 'success') {
    return (
      <EmptyState
        detail="Test selected connection first to load table data safely."
        label="Connection Not Ready"
      />
    );
  }

  return (
    <>
      <SavedViewModal
        onClose={handleCloseSavedViewModal}
        onSave={handleSaveView}
        opened={savedViewOpened}
        selectedTable={selectedTable}
        view={editingSavedView}
      />

      <Stack h="100%" gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" grow wrap="nowrap">
            <TextInput
              leftSection={<IconSearch size={14} />}
              onChange={(event) => setSearchInput(event.currentTarget.value)}
              placeholder="Search rows"
              disabled={!selectedTable}
              rightSection={
                searchInput ? (
                  <ActionIcon
                    aria-label="Clear search"
                    color="gray"
                    onClick={() => setSearchInput('')}
                    size="sm"
                    variant="subtle"
                  >
                    <IconX size={14} />
                  </ActionIcon>
                ) : null
              }
              value={searchInput}
            />
            {isLoadingTables || isLoadingTableMetadata ? (
              <Group gap={6} wrap="nowrap">
                <Loader size={14} />
                <Text c="dimmed" size="xs">
                  Loading catalog
                </Text>
              </Group>
            ) : null}
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Button
              disabled={!selectedTable}
              leftSection={<IconChartBar size={14} />}
              onClick={handleAnalyzeTable}
              size="compact-sm"
              variant="light"
            >
              Analyze
            </Button>
            <Button
              disabled={!canCreateSavedView}
              leftSection={<IconPlus size={14} />}
              onClick={handleOpenSavedViewModal}
              size="compact-sm"
              variant="default"
            >
              View
            </Button>
            {selectedTable?.isEditable ? (
              <Button
                leftSection={<IconPlus size={14} />}
                onClick={handleAddDraftRow}
                size="compact-sm"
                variant="light"
              >
                Row
              </Button>
            ) : null}
            <Button
              disabled={!hasDirtyChanges || isSavingChanges}
              leftSection={<IconRestore size={14} />}
              onClick={handleDiscardChanges}
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
              onClick={() => void handleSaveChanges()}
              size="compact-sm"
            >
              Save
            </Button>
            <ActionIcon
              aria-label="Refresh rows"
              onClick={handleRefreshRows}
              size="md"
              variant="subtle"
            >
              {isLoadingRows ? <Loader size={16} /> : <IconRefresh size={16} />}
            </ActionIcon>
          </Group>
        </Group>

        {activeSavedView ? (
          <Group justify="space-between" wrap="nowrap">
            <Badge color="grape" size="sm" variant="light">
              View: {activeSavedView.name}
            </Badge>
            <Group gap={4} wrap="nowrap">
              <ActionIcon
                aria-label="Edit active saved view"
                color="grape"
                onClick={() => handleOpenEditSavedViewModal(activeSavedView)}
                size="sm"
                variant="subtle"
              >
                <IconPencil size={14} />
              </ActionIcon>
              <ActionIcon
                aria-label="Delete active saved view"
                color="red"
                onClick={handleRemoveActiveSavedView}
                size="sm"
                variant="subtle"
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Group>
          </Group>
        ) : null}

        {tablesError ? (
          <Alert color="red" title="Table discovery failed" variant="light">
            {tablesError}
          </Alert>
        ) : null}

        {isLoadingTables ? (
          <Alert
            color="blue"
            icon={<Loader size={16} />}
            title="Discovering database tables"
            variant="light"
          >
            Remote databases can take a while while columns, primary keys,
            privileges, and geometry metadata are inspected.
          </Alert>
        ) : null}

        {isLoadingTableMetadata ? (
          <Alert
            color="blue"
            icon={<Loader size={16} />}
            title="Loading table metadata"
            variant="light"
          >
            Reading selected table columns, primary key, privileges, and
            geometry.
          </Alert>
        ) : null}

        {rowsError ? (
          <Text c="red" size="sm">
            {rowsError}
          </Text>
        ) : null}

        {workspaceFilterError ? (
          <Alert
            color="orange"
            title="Analytics filter not applied"
            variant="light"
          >
            {workspaceFilterError}
          </Alert>
        ) : null}

        {pendingTableFilterChange && !workspaceFilterError ? (
          <Alert
            color="orange"
            title="Analytics filter waiting for unsaved edits"
            variant="light"
          >
            Apply the new analytics filter after deciding what to do with the
            pending table changes.
            <Button
              mt="xs"
              onClick={handleApplyPendingTableFilter}
              size="compact-sm"
              variant="light"
            >
              Apply analytics filter
            </Button>
          </Alert>
        ) : null}

        {saveError ? (
          <Alert color="red" title="Save failed" variant="light">
            {saveError}
          </Alert>
        ) : null}

        {saveMessage ? (
          <Alert color="teal" title="Draft committed" variant="light">
            {saveMessage}
          </Alert>
        ) : null}

        {locateError ? (
          <Alert color="orange" title="Locate failed" variant="light">
            {locateError}
          </Alert>
        ) : null}

        {!selectedTable && (isLoadingTables || isLoadingTableMetadata) ? (
          <Center
            style={{
              flex: 1,
              minHeight: 0,
            }}
          >
            <Stack align="center" gap="xs">
              <Loader size="sm" />
              <Text c="dimmed" size="sm">
                {isLoadingTableMetadata
                  ? 'Reading table metadata...'
                  : 'Reading table catalog...'}
              </Text>
            </Stack>
          </Center>
        ) : null}

        {!selectedTable && !isLoadingTables && !isLoadingTableMetadata ? (
          <EmptyState
            detail="Choose schemas from the selected connection catalog first."
            label="No Table Selected"
          />
        ) : null}

        {selectedTable && rowsState ? (
          <>
            <Group justify="space-between">
              <Group gap="xs">
                <Text c="dimmed" size="xs">
                  {selectedTableAlias ?? selectedTable.fullName}
                  {selectedTableAlias ? ` • ${selectedTable.fullName}` : ''} •{' '}
                  {selectedTable.kind} • rows{' '}
                  {rowsState.rows.length === 0 ? 0 : rowsState.offset + 1}-
                  {rowsState.offset + rowsState.rows.length} of{' '}
                  {formatRowCount(rowsState.totalRows)}
                </Text>
                {rowsState.primaryKey.length === 0 ? (
                  <Badge color="gray" size="sm" variant="outline">
                    No primary key
                  </Badge>
                ) : null}
                <Badge
                  color={rowsState.isEditable ? 'teal' : 'gray'}
                  size="sm"
                  variant="light"
                >
                  {rowsState.isEditable ? 'Editable draft' : 'Read only'}
                </Badge>
                {appliedSearch ? (
                  <Badge color="blue" size="sm" variant="light">
                    Search: {appliedSearch}
                  </Badge>
                ) : null}
                {activeSavedView ? (
                  <Badge color="grape" size="sm" variant="light">
                    View: {activeSavedView.name}
                  </Badge>
                ) : null}
              </Group>
              <Group gap="xs">
                {hasDirtyChanges ? (
                  <Badge color="orange" size="sm" variant="light">
                    {touchedRowCount} pending
                  </Badge>
                ) : null}
                <Text c="dimmed" size="xs">
                  page size {rowsState.limit}
                </Text>
                {isLoadingRows ? (
                  <Badge color="blue" size="sm" variant="light">
                    Loading rows
                  </Badge>
                ) : null}
              </Group>
            </Group>

            {!rowsState.isEditable ? (
              <Alert color="gray" variant="light">
                Editing enabled only for base tables with primary key and
                insert/update/delete privileges. Geometry cells stay read-only
                in this first pass.
              </Alert>
            ) : null}

            <Group justify="space-between" wrap="nowrap">
              {tableDisplayKeyValue && rowsState.columns.length > 0 ? (
                <Menu
                  closeOnItemClick={false}
                  position="bottom-start"
                  shadow="md"
                >
                  <Menu.Target>
                    <Button size="compact-sm" variant="default">
                      Display
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <ScrollArea h={360} type="auto">
                      <Stack gap="xs" p="xs" w={360}>
                        <TextInput
                          label="Table alias"
                          onChange={(event) => {
                            handleTableDisplayConfigChange({
                              ...tableDisplayConfig,
                              tableAlias: event.currentTarget.value,
                            });
                          }}
                          placeholder={selectedTable.name}
                          size="xs"
                          value={tableDisplayConfig.tableAlias ?? ''}
                        />
                        {rowsState.columns.map((column) => {
                          const isHidden =
                            tableDisplayConfig.hiddenColumns.includes(
                              column.name,
                            );
                          const currentLabel =
                            tableDisplayConfig.columnLabels[column.name] ?? '';

                          return (
                            <Stack gap={4} key={column.name}>
                              <Checkbox
                                checked={!isHidden}
                                label={column.name}
                                onChange={(event) => {
                                  if (!tableDisplayKeyValue) {
                                    return;
                                  }

                                  const nextHidden = event.currentTarget.checked
                                    ? tableDisplayConfig.hiddenColumns.filter(
                                        (columnName) =>
                                          columnName !== column.name,
                                      )
                                    : Array.from(
                                        new Set([
                                          ...tableDisplayConfig.hiddenColumns,
                                          column.name,
                                        ]),
                                      );
                                  handleTableDisplayConfigChange({
                                    ...tableDisplayConfig,
                                    hiddenColumns: nextHidden,
                                  });
                                }}
                                size="xs"
                              />
                              <TextInput
                                onChange={(event) => {
                                  if (!tableDisplayKeyValue) {
                                    return;
                                  }

                                  const nextLabels = {
                                    ...tableDisplayConfig.columnLabels,
                                  };
                                  const nextValue = event.currentTarget.value;
                                  if (nextValue.trim() === '') {
                                    delete nextLabels[column.name];
                                  } else {
                                    nextLabels[column.name] = nextValue;
                                  }

                                  handleTableDisplayConfigChange({
                                    ...tableDisplayConfig,
                                    columnLabels: nextLabels,
                                  });
                                }}
                                placeholder="Readable label"
                                size="xs"
                                value={currentLabel}
                              />
                            </Stack>
                          );
                        })}

                        {connection && selectedTable.foreignKeys.length > 0 ? (
                          <Stack gap="xs" mt="xs">
                            <Text fw={600} size="xs">
                              Relation values
                            </Text>
                            {selectedTable.foreignKeys.map((foreignKey) => {
                              const relationColumns =
                                relationConfigByColumn.get(
                                  foreignKey.columnName,
                                ) ?? [];
                              const columnLabel =
                                tableDisplayConfig.columnLabels[
                                  foreignKey.columnName
                                ]?.trim() || foreignKey.columnName;

                              return (
                                <Select
                                  allowDeselect={false}
                                  aria-label={`Relation label for ${foreignKey.columnName}`}
                                  data={foreignKey.labelColumns.map(
                                    (labelColumn) => ({
                                      label: labelColumn,
                                      value: labelColumn,
                                    }),
                                  )}
                                  disabled={
                                    foreignKey.labelColumns.length === 0
                                  }
                                  key={foreignKey.columnName}
                                  label={columnLabel}
                                  onChange={(value) => {
                                    if (!value) {
                                      return;
                                    }

                                    setRelationLabels((currentLabels) => {
                                      const nextLabels = { ...currentLabels };
                                      delete nextLabels[foreignKey.columnName];
                                      return nextLabels;
                                    });
                                    setRelationDisplayConfig(
                                      relationDisplayKey(
                                        connection.id,
                                        selectedTable,
                                        foreignKey,
                                      ),
                                      { labelColumns: [value] },
                                    );
                                  }}
                                  placeholder="Raw id"
                                  size="xs"
                                  value={relationColumns[0] ?? null}
                                />
                              );
                            })}
                          </Stack>
                        ) : null}
                      </Stack>
                    </ScrollArea>
                  </Menu.Dropdown>
                </Menu>
              ) : null}

              <Group gap="xs" wrap="nowrap">
                <Button
                  disabled={isLoadingRows || rowsState.offset === 0}
                  onClick={() =>
                    void handlePageChange(
                      Math.max(rowsState.offset - pageSize, 0),
                    )
                  }
                  size="compact-sm"
                  variant="light"
                >
                  Previous
                </Button>
                <Text c="dimmed" size="xs">
                  offset {rowsState.offset}
                </Text>
                <Button
                  disabled={isLoadingRows || !rowsState.hasMore}
                  onClick={() =>
                    void handlePageChange(rowsState.offset + pageSize)
                  }
                  size="compact-sm"
                >
                  Next
                </Button>
              </Group>
            </Group>

            {rowsState.rows.length === 0 && draftInserts.length === 0 ? (
              <EmptyState
                detail={
                  appliedSearch || activeSavedView
                    ? 'No rows match current search/view.'
                    : 'Selected page has no rows.'
                }
                label={
                  appliedSearch || activeSavedView ? 'No Matches' : 'No Rows'
                }
              />
            ) : (
              <Box style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
                <MantineReactTable table={inspectorTable} />
              </Box>
            )}
          </>
        ) : null}

        {selectedTable && !rowsState && isLoadingRows ? (
          <Center
            style={{
              flex: 1,
              minHeight: 0,
            }}
          >
            <Stack align="center" gap="xs">
              <Loader size="sm" />
              <Text c="dimmed" size="sm">
                Loading first page from {selectedTable.fullName}...
              </Text>
            </Stack>
          </Center>
        ) : null}
      </Stack>
    </>
  );
}
