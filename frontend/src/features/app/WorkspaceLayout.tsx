import {
  ActionIcon,
  Box,
  Group,
  Text,
  useComputedColorScheme,
} from '@mantine/core';
import {
  IconDatabase,
  IconDatabaseSearch,
  IconLayoutGrid,
  IconMap,
  IconPencil,
  IconPin,
  IconPinnedOff,
  IconPlugConnected,
  IconRestore,
  IconStack2,
} from '@tabler/icons-react';
import {
  type Action,
  Actions,
  BorderNode,
  DockLocation,
  type IJsonModel,
  type ITabRenderValues,
  type ITabSetRenderValues,
  Layout,
  Model,
  Rect,
  type TabNode,
  type TabSetNode,
} from 'flexlayout-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

export type WorkspacePanelId =
  | 'sources'
  | 'layers'
  | 'map'
  | 'table'
  | 'workspace';

const workspaceStorageKey = 'geopanel-workspace-layout-v1';
const dynamicPanelPrefix = 'workspace-dynamic:';

export type WorkspaceDynamicPanelIcon = 'record' | 'related';

export interface WorkspaceDynamicPanel {
  content: ReactNode;
  floatRect: {
    height: number;
    right: number;
    top: number;
    width: number;
  };
  icon: WorkspaceDynamicPanelIcon;
  id: string;
  name: string;
  onClose: () => void;
}

interface WorkspacePanelsContextValue {
  closePanel: (panelId: string) => void;
  focusPanel: (panelId: string) => void;
  registerPanel: (panel: WorkspaceDynamicPanel) => void;
}

const WorkspacePanelsContext =
  createContext<WorkspacePanelsContextValue | null>(null);

export function useWorkspacePanels() {
  const context = useContext(WorkspacePanelsContext);
  if (!context) {
    throw new Error('useWorkspacePanels must be used inside WorkspaceLayout.');
  }
  return context;
}

const defaultWorkspaceLayout: IJsonModel = {
  global: {
    borderAutoSelectTabWhenClosed: true,
    borderAutoSelectTabWhenOpen: true,
    borderMaxSize: 720,
    borderMinSize: 180,
    enableEdgeDock: true,
    enableEdgeDockIndicators: true,
    enableRotateBorderIcons: false,
    tabEnableClose: false,
    tabEnablePopout: false,
    tabEnablePopoutFloatIcon: true,
    tabEnableRename: false,
    tabSetEnableMaximize: true,
    tabSetMinHeight: 120,
    tabSetMinWidth: 180,
  },
  borders: [
    {
      type: 'border',
      location: 'left',
      borderType: 'split',
      selected: 0,
      size: 280,
      children: [
        {
          type: 'tab',
          id: 'panel-sources',
          name: 'Data Sources',
          component: 'sources',
        },
        {
          type: 'tab',
          id: 'panel-layers',
          name: 'Map Layers',
          component: 'layers',
        },
      ],
    },
    {
      type: 'border',
      location: 'right',
      borderType: 'split',
      selected: 0,
      size: 340,
      children: [
        {
          type: 'tab',
          id: 'panel-workspace',
          name: 'Workspace',
          component: 'workspace',
        },
      ],
    },
    {
      type: 'border',
      location: 'bottom',
      borderType: 'split',
      selected: 0,
      size: 260,
      children: [
        {
          type: 'tab',
          id: 'panel-table',
          name: 'Table',
          component: 'table',
        },
      ],
    },
  ],
  layout: {
    type: 'row',
    id: 'workspace-root',
    children: [
      {
        type: 'tabset',
        id: 'main-tabset',
        active: true,
        children: [
          {
            type: 'tab',
            id: 'panel-map',
            name: 'Map',
            component: 'map',
          },
        ],
      },
    ],
  },
};

const panelIcons = {
  sources: IconPlugConnected,
  layers: IconStack2,
  map: IconMap,
  table: IconDatabase,
  workspace: IconLayoutGrid,
} as const;

const dynamicPanelIcons = {
  record: IconPencil,
  related: IconDatabaseSearch,
} as const;

function dynamicPanelTabId(panelId: string) {
  return `${dynamicPanelPrefix}${panelId}`;
}

function dynamicPanelIdFromTabId(tabId: string) {
  return tabId.startsWith(dynamicPanelPrefix)
    ? tabId.slice(dynamicPanelPrefix.length)
    : null;
}

function hasDynamicPanels(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const node = value as Record<string, unknown>;
  if (
    typeof node.component === 'string' &&
    node.component.startsWith(dynamicPanelPrefix)
  ) {
    return true;
  }

  return Object.values(node).some(hasDynamicPanels);
}

function createDefaultModel() {
  return Model.fromJson(defaultWorkspaceLayout);
}

type MutableLayoutNode = {
  children?: MutableLayoutNode[];
  component?: string;
  name?: string;
  selected?: number;
  [key: string]: unknown;
};

function migrateStoredLayout(layout: IJsonModel) {
  let hasSourcesPanel = false;
  let layersParent: MutableLayoutNode | null = null;
  let layersIndex = -1;

  function visit(value: unknown) {
    if (!value || typeof value !== 'object') {
      return;
    }

    const node = value as MutableLayoutNode;
    if (node.component === 'sources') {
      hasSourcesPanel = true;
    }

    if (Array.isArray(node.children)) {
      const index = node.children.findIndex(
        (child) => child.component === 'layers',
      );
      if (index >= 0) {
        node.children[index].name = 'Map Layers';
        layersParent = node;
        layersIndex = index;
      }
    }

    for (const child of Object.values(node)) {
      if (child !== node.children) {
        visit(child);
      }
    }
    node.children?.forEach(visit);
  }

  visit(layout);
  const targetParent = layersParent as MutableLayoutNode | null;
  if (hasSourcesPanel || !targetParent || layersIndex < 0) {
    return layout;
  }

  targetParent.children?.splice(layersIndex, 0, {
    type: 'tab',
    id: 'panel-sources',
    name: 'Data Sources',
    component: 'sources',
  });
  if (
    typeof targetParent.selected === 'number' &&
    targetParent.selected >= layersIndex
  ) {
    targetParent.selected += 1;
  }

  return layout;
}

function createStoredModel() {
  try {
    const savedLayout = window.localStorage.getItem(workspaceStorageKey);
    if (savedLayout) {
      const parsedLayout = JSON.parse(savedLayout) as IJsonModel;
      const migratedLayout = migrateStoredLayout(parsedLayout);
      return Model.fromJson({
        ...migratedLayout,
        global: {
          ...migratedLayout.global,
          tabEnablePopout: false,
          tabEnablePopoutFloatIcon: true,
        },
      });
    }
  } catch {
    // Invalid or unavailable local storage should never prevent app startup.
  }

  return createDefaultModel();
}

export function WorkspaceLayout({
  panels,
  toolbar,
}: {
  panels: Record<WorkspacePanelId, ReactNode>;
  toolbar?: ReactNode;
}) {
  const colorScheme = useComputedColorScheme('light');
  const [model, setModel] = useState(createStoredModel);
  const [dynamicPanels, setDynamicPanels] = useState<
    Record<string, WorkspaceDynamicPanel>
  >({});
  const dynamicPanelsRef = useRef(dynamicPanels);

  const removePanelRegistration = useCallback((panelId: string) => {
    const { [panelId]: _removed, ...remaining } = dynamicPanelsRef.current;
    dynamicPanelsRef.current = remaining;
    setDynamicPanels(remaining);
  }, []);

  const closePanel = useCallback(
    (panelId: string) => {
      const tabId = dynamicPanelTabId(panelId);
      const hasNode = Boolean(model.getNodeById(tabId));
      const hasRegistration = Boolean(dynamicPanelsRef.current[panelId]);
      if (!hasNode && !hasRegistration) {
        return;
      }

      if (hasNode) {
        model.doAction(Actions.deleteTab(tabId));
      }
      if (hasRegistration) {
        removePanelRegistration(panelId);
      }
    },
    [model, removePanelRegistration],
  );

  const focusPanel = useCallback(
    (panelId: string) => {
      const tabId = dynamicPanelTabId(panelId);
      const tabNode = model.getNodeById(tabId) as TabNode | undefined;
      if (tabNode) {
        model.doAction(Actions.selectTab(tabId));
        if (tabNode.isPoppedOut()) {
          model.doAction(Actions.movePopoutToFront(tabNode.getLayoutId()));
        }
      }
    },
    [model],
  );

  const registerPanel = useCallback(
    (panel: WorkspaceDynamicPanel) => {
      const currentPanel = dynamicPanelsRef.current[panel.id];
      if (
        currentPanel?.content !== panel.content ||
        currentPanel?.name !== panel.name ||
        currentPanel?.onClose !== panel.onClose
      ) {
        const nextPanels = {
          ...dynamicPanelsRef.current,
          [panel.id]: panel,
        };
        dynamicPanelsRef.current = nextPanels;
        setDynamicPanels(nextPanels);
      }

      const tabId = dynamicPanelTabId(panel.id);
      const existingNode = model.getNodeById(tabId);
      if (existingNode) {
        if ((existingNode as TabNode).getName() !== panel.name) {
          model.doAction(Actions.renameTab(tabId, panel.name));
        }
        return;
      }

      const targetTabset =
        model.getNodeById('main-tabset') ?? model.getActiveTabset();
      if (!targetTabset) {
        return;
      }

      model.doAction(
        Actions.addTab(
          {
            type: 'tab',
            id: tabId,
            name: panel.name,
            component: tabId,
            config: { panelIcon: panel.icon },
            enableClose: true,
            enableDrag: true,
            enablePopout: true,
            enablePopoutFloatIcon: true,
          },
          targetTabset.getId(),
          DockLocation.CENTER,
          -1,
          true,
        ),
      );
      model.doAction(Actions.popoutTab(tabId, 'float'));
      const poppedOutNode = model.getNodeById(tabId);
      if (poppedOutNode) {
        const width = Math.min(
          panel.floatRect.width,
          Math.max(304, window.innerWidth - 16),
        );
        const height = Math.min(
          panel.floatRect.height,
          Math.max(180, window.innerHeight - 88),
        );
        model.doAction(
          Actions.moveFloat(
            poppedOutNode.getLayoutId(),
            new Rect(
              Math.max(8, window.innerWidth - width - panel.floatRect.right),
              panel.floatRect.top,
              width,
              height,
            ),
          ),
        );
      }
    },
    [model],
  );

  const workspacePanelsContext = useMemo(
    () => ({ closePanel, focusPanel, registerPanel }),
    [closePanel, focusPanel, registerPanel],
  );

  const factory = useCallback(
    (node: TabNode) => {
      const component = node.getComponent() ?? '';
      const dynamicPanelId = dynamicPanelIdFromTabId(component);
      if (dynamicPanelId) {
        return dynamicPanels[dynamicPanelId]?.content ?? null;
      }

      const panelId = component as WorkspacePanelId;
      return panels[panelId] ?? null;
    },
    [dynamicPanels, panels],
  );

  const handleRenderTab = useCallback(
    (node: TabNode, renderValues: ITabRenderValues) => {
      const panelId = node.getComponent() as WorkspacePanelId;
      const panelIcon = (node.getConfig() as { panelIcon?: string } | undefined)
        ?.panelIcon as WorkspaceDynamicPanelIcon | undefined;
      const PanelIcon = panelIcon
        ? dynamicPanelIcons[panelIcon]
        : panelIcons[panelId];
      if (PanelIcon) {
        renderValues.leading = <PanelIcon aria-hidden size={14} />;
      }
    },
    [],
  );

  const handleAction = useCallback(
    (action: Action) => {
      if (action.type === Actions.DELETE_TAB) {
        const panelId = dynamicPanelIdFromTabId(String(action.data.node));
        const panel = panelId ? dynamicPanelsRef.current[panelId] : null;
        if (panelId && panel) {
          removePanelRegistration(panelId);
          panel.onClose();
        }
      }
      return action;
    },
    [removePanelRegistration],
  );

  const handleRenderTabSet = useCallback(
    (node: TabSetNode | BorderNode, renderValues: ITabSetRenderValues) => {
      if (!(node instanceof BorderNode)) {
        return;
      }

      const isOverlay = node.getBorderType() === 'overlay';
      renderValues.stickyButtons.push(
        <ActionIcon
          aria-label={isOverlay ? 'Pin panel open' : 'Auto-hide panel'}
          className="flexlayout__tab_toolbar_button"
          key={`pin-${node.getId()}`}
          onClick={(event) => {
            event.stopPropagation();
            node
              .getModel()
              .doAction(
                Actions.setBorderType(
                  node.getId(),
                  isOverlay ? 'split' : 'overlay',
                ),
              );
          }}
          onMouseDown={(event) => event.stopPropagation()}
          size="sm"
          title={isOverlay ? 'Pin panel open' : 'Auto-hide panel'}
          variant="subtle"
        >
          {isOverlay ? <IconPin size={14} /> : <IconPinnedOff size={14} />}
        </ActionIcon>,
      );
    },
    [],
  );

  function handleResetLayout() {
    window.localStorage.removeItem(workspaceStorageKey);
    setModel(createDefaultModel());
  }

  return (
    <WorkspacePanelsContext.Provider value={workspacePanelsContext}>
      <Box
        className={`workspace-layout flexlayout__theme_${colorScheme}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100dvh',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <Group
          h={38}
          justify="space-between"
          px="xs"
          style={{
            borderBottom: '1px solid var(--mantine-color-default-border)',
            flex: '0 0 auto',
          }}
          wrap="nowrap"
        >
          <Group gap="xs" wrap="nowrap">
            <IconLayoutGrid aria-hidden size={16} />
            <Text fw={600} size="sm">
              Workspace
            </Text>
            <Text c="dimmed" size="xs" visibleFrom="sm">
              Drag tabs to dock · pin or float panels
            </Text>
          </Group>

          <Group gap={4} wrap="nowrap">
            {toolbar}
            <ActionIcon
              aria-label="Reset workspace layout"
              onClick={handleResetLayout}
              title="Reset workspace layout"
              variant="default"
            >
              <IconRestore size={16} />
            </ActionIcon>
          </Group>
        </Group>

        <Box style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <Layout
            constrainFloatPanels
            factory={factory}
            model={model}
            onAction={handleAction}
            onModelChange={(nextModel) => {
              const nextLayout = nextModel.toJson();
              if (hasDynamicPanels(nextLayout)) {
                return;
              }
              try {
                window.localStorage.setItem(
                  workspaceStorageKey,
                  JSON.stringify(nextLayout),
                );
              } catch {
                // Workspace remains usable if persistence is unavailable.
              }
            }}
            onRenderTab={handleRenderTab}
            onRenderTabSet={handleRenderTabSet}
            realtimeResize
          />
        </Box>
      </Box>
    </WorkspacePanelsContext.Provider>
  );
}
