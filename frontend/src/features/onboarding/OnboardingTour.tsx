import {
  ActionIcon,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  Portal,
  Progress,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconArrowRight,
  IconCompass,
  IconHelpCircle,
  IconPlayerPlay,
} from '@tabler/icons-react';
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  useWorkspacePanels,
  type WorkspacePanelId,
} from '../app/WorkspaceLayout';
import { useI18n } from '../i18n/i18n';

type TourMode = 'closed' | 'welcome' | 'tour';
type TourPlacement = 'top' | 'right' | 'bottom' | 'left';

interface TourStep {
  description: string;
  panelId?: WorkspacePanelId;
  placement: TourPlacement;
  target: string;
  title: string;
}

interface TargetRect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

const onboardingStorageKey = 'geopanel-onboarding-v1';
const targetGap = 6;
const cardGap = 14;
const estimatedCardHeight = 250;

const copy = {
  en: {
    welcomeTitle: 'Welcome to GeoPanel',
    welcomeBody:
      'This workspace is flexible, but it can look busy at first. Take a short tour of the controls used to connect data, inspect records, and build map layers.',
    tourLength: '7 short steps · about 2 minutes',
    start: 'Start tour',
    skipWelcome: 'Explore myself',
    restart: 'Start guided tour',
    skip: 'Skip tour',
    back: 'Back',
    next: 'Next',
    finish: 'Finish',
    step: 'Step',
    of: 'of',
    steps: [
      {
        title: 'Your dockable workspace',
        description:
          'Drag tabs to dock them, resize panel edges, pin side panels, or float a tab. Reset restores the default layout.',
        target: 'workspace-toolbar',
        placement: 'bottom',
      },
      {
        title: 'Connect a data source',
        description:
          'Add a PostGIS connection here. Existing server-managed connections also appear in this panel.',
        target: 'add-connection',
        panelId: 'sources',
        placement: 'right',
      },
      {
        title: 'Browse your data',
        description:
          'Open a connected source, browse schemas and tables, then select a table to inspect or map.',
        target: 'sources-panel',
        panelId: 'sources',
        placement: 'right',
      },
      {
        title: 'Inspect table records',
        description:
          'Selected table rows open here. Search, filter, edit allowed fields, and locate geographic records on the map.',
        target: 'table-panel',
        panelId: 'table',
        placement: 'top',
      },
      {
        title: 'Create a map layer',
        description:
          'Use Create new, choose a layer type, then select its data table and geographic columns. Opening the table first is optional.',
        target: 'layer-actions',
        panelId: 'layers',
        placement: 'right',
      },
      {
        title: 'Manage layer appearance',
        description:
          'Select a layer to control visibility, zoom, data setup, fill, borders, line width, and other styling.',
        target: 'layers-panel',
        panelId: 'layers',
        placement: 'right',
      },
      {
        title: 'Explore on the map',
        description:
          'Click map objects to inspect their records and relations. The Workspace panel shows details for the active layer and selection.',
        target: 'map-panel',
        panelId: 'map',
        placement: 'top',
      },
    ] satisfies TourStep[],
  },
  ru: {
    welcomeTitle: 'Добро пожаловать в GeoPanel',
    welcomeBody:
      'Рабочая область гибкая, но сначала может выглядеть перегруженной. Короткий тур покажет, как подключать данные, открывать записи и создавать слои.',
    tourLength: '7 коротких шагов · около 2 минут',
    start: 'Начать тур',
    skipWelcome: 'Разобраться самому',
    restart: 'Запустить обучение',
    skip: 'Пропустить тур',
    back: 'Назад',
    next: 'Далее',
    finish: 'Готово',
    step: 'Шаг',
    of: 'из',
    steps: [
      {
        title: 'Рабочая область с док-панелями',
        description:
          'Перетаскивайте вкладки, меняйте размеры, закрепляйте боковые панели или открывайте их окнами. Сброс вернет исходную компоновку.',
        target: 'workspace-toolbar',
        placement: 'bottom',
      },
      {
        title: 'Подключите источник данных',
        description:
          'Добавьте подключение PostGIS. Здесь же появятся подключения, настроенные на сервере.',
        target: 'add-connection',
        panelId: 'sources',
        placement: 'right',
      },
      {
        title: 'Просматривайте данные',
        description:
          'Откройте источник, найдите схему и таблицу, затем выберите таблицу для просмотра или отображения на карте.',
        target: 'sources-panel',
        panelId: 'sources',
        placement: 'right',
      },
      {
        title: 'Проверяйте записи таблицы',
        description:
          'Здесь открываются строки выбранной таблицы. Ищите, фильтруйте, редактируйте доступные поля и находите геообъекты на карте.',
        target: 'table-panel',
        panelId: 'table',
        placement: 'top',
      },
      {
        title: 'Создавайте слой карты',
        description:
          'Нажмите «Создать», выберите тип слоя, затем таблицу и географические столбцы. Предварительно открывать таблицу необязательно.',
        target: 'layer-actions',
        panelId: 'layers',
        placement: 'right',
      },
      {
        title: 'Управляйте видом слоя',
        description:
          'Выберите слой, чтобы настроить видимость, масштаб, данные, заливку, границы, толщину линий и другие стили.',
        target: 'layers-panel',
        panelId: 'layers',
        placement: 'right',
      },
      {
        title: 'Исследуйте карту',
        description:
          'Нажимайте объекты карты для просмотра записей и связей. Панель Workspace показывает активный слой и выделение.',
        target: 'map-panel',
        panelId: 'map',
        placement: 'top',
      },
    ] satisfies TourStep[],
  },
} as const;

function initialMode(): TourMode {
  try {
    return localStorage.getItem(onboardingStorageKey) === 'complete'
      ? 'closed'
      : 'welcome';
  } catch {
    return 'welcome';
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function getCardPosition(
  rect: TargetRect | null,
  placement: TourPlacement,
  viewport: { height: number; width: number },
) {
  const width = Math.min(360, Math.max(280, viewport.width - 24));
  if (!rect) {
    return {
      left: Math.max(12, (viewport.width - width) / 2),
      top: Math.max(12, (viewport.height - estimatedCardHeight) / 2),
      width,
    };
  }

  const available = {
    top: rect.top - cardGap >= estimatedCardHeight + 12,
    right: rect.right + cardGap + width <= viewport.width - 12,
    bottom: rect.bottom + cardGap + estimatedCardHeight <= viewport.height - 12,
    left: rect.left - cardGap - width >= 12,
  };
  const fallbackOrder: TourPlacement[] = [
    placement,
    'right',
    'left',
    'bottom',
    'top',
  ];
  const resolvedPlacement =
    fallbackOrder.find((candidate) => available[candidate]) ?? null;

  if (resolvedPlacement === 'right') {
    return {
      left: rect.right + cardGap,
      top: clamp(rect.top, 12, viewport.height - estimatedCardHeight - 12),
      width,
    };
  }
  if (resolvedPlacement === 'left') {
    return {
      left: rect.left - cardGap - width,
      top: clamp(rect.top, 12, viewport.height - estimatedCardHeight - 12),
      width,
    };
  }
  if (resolvedPlacement === 'bottom') {
    return {
      left: clamp(
        rect.left + rect.width / 2 - width / 2,
        12,
        viewport.width - width - 12,
      ),
      top: rect.bottom + cardGap,
      width,
    };
  }
  if (resolvedPlacement === 'top') {
    return {
      left: clamp(
        rect.left + rect.width / 2 - width / 2,
        12,
        viewport.width - width - 12,
      ),
      top: rect.top - cardGap - estimatedCardHeight,
      width,
    };
  }

  return {
    left: clamp(rect.left + 16, 12, viewport.width - width - 12),
    top: clamp(rect.top + 16, 12, viewport.height - estimatedCardHeight - 12),
    width,
  };
}

export function OnboardingTour() {
  const { focusPanel } = useWorkspacePanels();
  const { language } = useI18n();
  const content = copy[language];
  const steps = content.steps;
  const [mode, setMode] = useState<TourMode>(initialMode);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [viewport, setViewport] = useState(() => ({
    height: window.innerHeight,
    width: window.innerWidth,
  }));
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const step = steps[stepIndex];

  function rememberCompletion() {
    try {
      localStorage.setItem(onboardingStorageKey, 'complete');
    } catch {
      // Persistence failure should not trap the user inside onboarding.
    }
  }

  function closeTour() {
    rememberCompletion();
    setMode('closed');
    setTargetRect(null);
  }

  function startTour() {
    setStepIndex(0);
    setMode('tour');
  }

  function showWelcome() {
    setStepIndex(0);
    setTargetRect(null);
    setMode('welcome');
  }

  useEffect(() => {
    if (mode !== 'tour' || !step) {
      return;
    }

    if (step.panelId) {
      focusPanel(step.panelId);
    }

    let target: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let retryCount = 0;
    let retryTimer = 0;

    function measure() {
      setViewport({
        height: window.innerHeight,
        width: window.innerWidth,
      });
      if (!target?.isConnected) {
        setTargetRect(null);
        return;
      }

      const rect = target.getBoundingClientRect();
      setTargetRect({
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
      });
    }

    function findTarget() {
      target = document.querySelector<HTMLElement>(
        `[data-tour="${step.target}"]`,
      );
      if (!target) {
        retryCount += 1;
        if (retryCount < 20) {
          retryTimer = window.setTimeout(findTarget, 100);
        }
        return;
      }

      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(target);
      measure();
    }

    const animationFrame = window.requestAnimationFrame(findTarget);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(retryTimer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      resizeObserver?.disconnect();
    };
  }, [focusPanel, mode, step]);

  useEffect(() => {
    if (mode !== 'tour') {
      return;
    }

    const timer = window.setTimeout(() => nextButtonRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'tour') {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeTour();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const cardPosition = useMemo(
    () => getCardPosition(targetRect, step?.placement ?? 'bottom', viewport),
    [step?.placement, targetRect, viewport],
  );
  const maskColor = 'rgba(15, 23, 42, 0.68)';
  const maskRects: Array<[string, CSSProperties]> = targetRect
    ? [
        [
          'top',
          {
            height: Math.max(0, targetRect.top - targetGap),
            left: 0,
            top: 0,
            width: viewport.width,
          },
        ],
        [
          'left',
          {
            height: targetRect.height + targetGap * 2,
            left: 0,
            top: Math.max(0, targetRect.top - targetGap),
            width: Math.max(0, targetRect.left - targetGap),
          },
        ],
        [
          'right',
          {
            height: targetRect.height + targetGap * 2,
            left: targetRect.right + targetGap,
            top: Math.max(0, targetRect.top - targetGap),
            width: Math.max(0, viewport.width - targetRect.right - targetGap),
          },
        ],
        [
          'bottom',
          {
            height: Math.max(
              0,
              viewport.height - targetRect.bottom - targetGap,
            ),
            left: 0,
            top: targetRect.bottom + targetGap,
            width: viewport.width,
          },
        ],
      ]
    : [
        [
          'full',
          {
            height: viewport.height,
            left: 0,
            top: 0,
            width: viewport.width,
          },
        ],
      ];

  return (
    <>
      <ActionIcon
        aria-label={content.restart}
        onClick={showWelcome}
        title={content.restart}
        variant="default"
      >
        <IconHelpCircle size={16} />
      </ActionIcon>

      <Modal
        centered
        closeOnClickOutside={false}
        onClose={closeTour}
        opened={mode === 'welcome'}
        size="md"
        title={content.welcomeTitle}
      >
        <Stack gap="lg">
          <Group align="flex-start" wrap="nowrap">
            <ThemeIcon radius="xl" size={48} variant="light">
              <IconCompass size={26} />
            </ThemeIcon>
            <Stack gap={4}>
              <Text>{content.welcomeBody}</Text>
              <Text c="dimmed" size="sm">
                {content.tourLength}
              </Text>
            </Stack>
          </Group>
          <Group justify="flex-end">
            <Button onClick={closeTour} variant="subtle">
              {content.skipWelcome}
            </Button>
            <Button
              data-autofocus
              leftSection={<IconPlayerPlay size={16} />}
              onClick={startTour}
            >
              {content.start}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {mode === 'tour' && step ? (
        <Portal>
          {maskRects.map(([maskId, maskRect]) => (
            <Box
              aria-hidden
              key={`${step.target}-mask-${maskId}`}
              style={{
                ...maskRect,
                background: maskColor,
                position: 'fixed',
                zIndex: 1300,
              }}
            />
          ))}

          {targetRect ? (
            <Box
              aria-hidden
              style={{
                border: '2px solid var(--mantine-primary-color-filled)',
                borderRadius: 'var(--mantine-radius-md)',
                boxShadow: '0 0 0 3px var(--mantine-primary-color-light)',
                height: targetRect.height + targetGap * 2,
                left: targetRect.left - targetGap,
                pointerEvents: 'none',
                position: 'fixed',
                top: targetRect.top - targetGap,
                width: targetRect.width + targetGap * 2,
                zIndex: 1301,
              }}
            />
          ) : null}

          <Paper
            aria-labelledby="onboarding-tour-title"
            aria-live="polite"
            p="md"
            radius="md"
            role="dialog"
            shadow="xl"
            style={{
              ...cardPosition,
              maxHeight: 'calc(100vh - 24px)',
              overflowY: 'auto',
              position: 'fixed',
              zIndex: 1302,
            }}
            withBorder
          >
            <Stack gap="sm">
              <Group justify="space-between" wrap="nowrap">
                <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                  {content.step} {stepIndex + 1} {content.of} {steps.length}
                </Text>
                <Button onClick={closeTour} size="compact-xs" variant="subtle">
                  {content.skip}
                </Button>
              </Group>
              <Progress
                aria-label={`${content.step} ${stepIndex + 1} ${content.of} ${steps.length}`}
                size="xs"
                value={((stepIndex + 1) / steps.length) * 100}
              />
              <Title id="onboarding-tour-title" order={4}>
                {step.title}
              </Title>
              <Text c="dimmed" size="sm">
                {step.description}
              </Text>
              <Group justify="space-between" mt="xs">
                <Button
                  disabled={stepIndex === 0}
                  leftSection={<IconArrowLeft size={15} />}
                  onClick={() => setStepIndex((current) => current - 1)}
                  variant="default"
                >
                  {content.back}
                </Button>
                <Button
                  ref={nextButtonRef}
                  rightSection={
                    stepIndex < steps.length - 1 ? (
                      <IconArrowRight size={15} />
                    ) : undefined
                  }
                  onClick={() => {
                    if (stepIndex === steps.length - 1) {
                      closeTour();
                      return;
                    }
                    setStepIndex((current) => current + 1);
                  }}
                >
                  {stepIndex === steps.length - 1
                    ? content.finish
                    : content.next}
                </Button>
              </Group>
            </Stack>
          </Paper>
        </Portal>
      ) : null}
    </>
  );
}
