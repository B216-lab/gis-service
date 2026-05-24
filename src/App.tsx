import { Split } from '@gfazioli/mantine-split-pane';
import { Box, Center, Flex, Paper, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

function PanelFrame({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
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
        minHeight: 0,
      }}
    >
      <Flex align="center" justify="space-between" mb="md">
        <Title c="dark.7" order={5} tt="uppercase">
          {title}
        </Title>
        <Text c="dimmed" fw={500} size="xs">
          {hint}
        </Text>
      </Flex>

      <Box
        style={{
          flex: 1,
          minHeight: 0,
        }}
      >
        {children}
      </Box>
    </Paper>
  );
}

function EmptyState({
  label,
  detail,
  background,
}: {
  label: string;
  detail: string;
  background?: string;
}) {
  return (
    <Center
      h="100%"
      style={{
        background:
          background ??
          'linear-gradient(180deg, rgba(248,249,250,0.92) 0%, rgba(241,243,245,0.92) 100%)',
        border: '1px dashed var(--mantine-color-gray-4)',
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

export function App() {
  return (
    <Flex
      direction="column"
      h="100dvh"
      style={{
        overflow: 'hidden',
      }}
    >
      <Paper
        px="lg"
        py="sm"
        radius={0}
        shadow="xs"
        style={{
          borderBottom: '1px solid var(--mantine-color-gray-3)',
        }}
      >
        <Flex align="center" justify="space-between">
          <div>
            <Title order={3}>Geopanel</Title>
            <Text c="dimmed" size="sm">
              Phase 1 layout base
            </Text>
          </div>
          <Text c="dimmed" fw={500} size="sm">
            Resizable workspace shell
          </Text>
        </Flex>
      </Paper>

      <Box
        style={{
          flex: 1,
          minHeight: 0,
        }}
      >
        <Split
          style={{
            height: '100%',
            width: '100%',
          }}
        >
          <Split.Pane initialWidth={280} minWidth={180} maxWidth={480}>
            <PanelFrame hint="Resizable" title="Data & Layers">
              <EmptyState detail="Left workspace pane" label="Sidebar" />
            </PanelFrame>
          </Split.Pane>

          <Split.Resizer />

          <Split.Pane grow minWidth={420}>
            <Split
              orientation="horizontal"
              style={{
                height: '100%',
              }}
            >
              <Split.Pane grow minHeight={220}>
                <PanelFrame hint="Resizable" title="Map">
                  <EmptyState
                    background="linear-gradient(135deg, rgba(228,240,255,0.9) 0%, rgba(231,245,255,0.9) 35%, rgba(255,249,219,0.85) 100%)"
                    detail="Center top pane"
                    label="Map Canvas"
                  />
                </PanelFrame>
              </Split.Pane>

              <Split.Resizer />

              <Split.Pane initialHeight={260} minHeight={160} maxHeight={420}>
                <PanelFrame hint="Resizable" title="Table">
                  <EmptyState
                    detail="Center bottom pane"
                    label="Tabular View"
                  />
                </PanelFrame>
              </Split.Pane>
            </Split>
          </Split.Pane>

          <Split.Resizer />

          <Split.Pane initialWidth={340} minWidth={220} maxWidth={520}>
            <PanelFrame hint="Resizable" title="Analytics">
              <EmptyState detail="Right workspace pane" label="Insights" />
            </PanelFrame>
          </Split.Pane>
        </Split>
      </Box>
    </Flex>
  );
}
