import {
  ActionIcon,
  Box,
  Center,
  Flex,
  Group,
  Paper,
  Stack,
  Text,
  Title,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { IconMoonStars, IconSun } from '@tabler/icons-react';
import type { ReactNode } from 'react';

import type { LayerGlyphIcon } from '../connections/store';

export function ColorSchemeToggle() {
  const computedColorScheme = useComputedColorScheme('light');
  const { setColorScheme } = useMantineColorScheme();

  const isDark = computedColorScheme === 'dark';

  return (
    <ActionIcon
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
      size="lg"
      variant="default"
    >
      {isDark ? <IconSun size={18} /> : <IconMoonStars size={18} />}
    </ActionIcon>
  );
}

export function PanelFrame({
  title,
  hint,
  children,
}: {
  title?: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <Paper
      h="100%"
      p="md"
      radius={0}
      shadow="xs"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {title || hint ? (
        <Flex align="center" justify="space-between" mb="md">
          {title ? (
            <Title c="text" order={5} tt="uppercase">
              {title}
            </Title>
          ) : null}
          {hint ? (
            <Text c="dimmed" fw={500} size="xs">
              {hint}
            </Text>
          ) : null}
        </Flex>
      ) : null}

      <Box
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {children}
      </Box>
    </Paper>
  );
}

export function EmptyState({
  label,
  detail,
}: {
  label: string;
  detail: string;
}) {
  return (
    <Center
      h="100%"
      style={{
        background: 'var(--mantine-color-default)',
        border: '1px dashed var(--mantine-color-default-border)',
        borderRadius: 'var(--mantine-radius-md)',
      }}
    >
      <Stack align="center" gap={6}>
        <Text fw={700} size="lg">
          {label}
        </Text>
        <Text c="dimmed" size="sm">
          {detail}
        </Text>
      </Stack>
    </Center>
  );
}

export function LayerGlyph({
  color,
  icon,
  visible,
}: {
  color: string;
  icon: LayerGlyphIcon;
  visible: boolean;
}) {
  const sharedStyle = {
    flexShrink: 0,
    opacity: visible ? 1 : 0.5,
  } as const;

  if (icon === 'flow') {
    return (
      <Group gap={2} wrap="nowrap">
        <Box
          style={{
            ...sharedStyle,
            width: 6,
            height: 6,
            borderRadius: 999,
            background: color,
          }}
        />
        <Box
          style={{
            ...sharedStyle,
            width: 12,
            height: 2,
            borderRadius: 999,
            background: color,
          }}
        />
        <Box
          style={{
            ...sharedStyle,
            width: 6,
            height: 6,
            borderRadius: 999,
            background: color,
          }}
        />
      </Group>
    );
  }

  if (icon === 'line') {
    return (
      <Box
        style={{
          ...sharedStyle,
          width: 14,
          height: 4,
          borderRadius: 999,
          background: color,
        }}
      />
    );
  }

  if (icon === 'diamond') {
    return (
      <Box
        style={{
          ...sharedStyle,
          width: 11,
          height: 11,
          background: color,
          transform: 'rotate(45deg)',
        }}
      />
    );
  }

  return (
    <Box
      style={{
        ...sharedStyle,
        width: 10,
        height: 10,
        borderRadius: icon === 'circle' ? 999 : 2,
        background: color,
      }}
    />
  );
}
