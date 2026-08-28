import {
  Alert,
  Box,
  Checkbox,
  Group,
  NumberInput,
  Select,
  Slider,
  Stack,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { startTransition, useEffect, useState } from 'react';

import { LayerGlyph } from '../app/chrome';
import type { InspectableTable } from '../inspector/api';
import { isNumericColumnType } from '../inspector/table-editing';
import type {
  ArcMapLayer,
  FlowmapMapLayer,
  FlowmapTableSource,
  GeoJsonMapLayer,
  LayerGlyphIcon,
  MapLayer,
  MapSource,
} from './store';

const listIconHelp =
  'This icon appears next to the layer in the Map Layers list.';

function LayerIconSelect({
  colorForIcon,
  data,
  onChange,
  value,
}: {
  colorForIcon: (icon: LayerGlyphIcon) => string;
  data: Array<{ label: string; value: LayerGlyphIcon }>;
  onChange: (value: LayerGlyphIcon) => void;
  value: LayerGlyphIcon;
}) {
  const iconPreview = (icon: LayerGlyphIcon): ReactNode => (
    <Box miw={18}>
      <LayerGlyph color={colorForIcon(icon)} icon={icon} visible />
    </Box>
  );

  return (
    <Select
      data={data}
      label={
        <Group gap={4} wrap="nowrap">
          <Text inherit>List icon</Text>
          <Tooltip label={listIconHelp} withArrow>
            <Box
              aria-label={listIconHelp}
              component="span"
              style={{ cursor: 'help', display: 'inline-flex' }}
              tabIndex={0}
            >
              <IconInfoCircle size={13} />
            </Box>
          </Tooltip>
        </Group>
      }
      leftSection={iconPreview(value)}
      onChange={(nextValue) => {
        if (nextValue) {
          onChange(nextValue as LayerGlyphIcon);
        }
      }}
      renderOption={({ option }) => (
        <Group gap="xs" wrap="nowrap">
          {iconPreview(option.value as LayerGlyphIcon)}
          <Text size="xs">{option.label}</Text>
        </Group>
      )}
      size="xs"
      value={value}
    />
  );
}

function FlowmapSetupFields({
  columns,
  table,
  onChange,
}: {
  columns: FlowmapTableSource['columns'];
  table: InspectableTable | null;
  onChange: (patch: Partial<FlowmapTableSource['columns']>) => void;
}) {
  const numericColumnOptions = (table?.columns ?? [])
    .filter((column) => isNumericColumnType(column.type))
    .map((column) => ({
      label: `${column.name} (${column.type})`,
      value: column.name,
    }));
  const geometryColumnOptions = Array.from(
    new Map(
      [
        ...(table?.geometryColumns ?? []).map((column) => ({
          label: `${column.name} (${column.geometryType})`,
          value: column.name,
        })),
        ...[columns.startGeometry, columns.endGeometry]
          .filter(Boolean)
          .map((columnName) => ({
            label: columnName,
            value: columnName,
          })),
      ].map((option) => [option.value, option]),
    ).values(),
  );

  return (
    <Stack gap="xs">
      <Group grow>
        <Select
          data={[
            { label: 'Lon/lat columns', value: 'coordinates' },
            { label: 'Geometry column', value: 'geometry' },
          ]}
          label="Departure point"
          onChange={(value) =>
            onChange({
              startMode: value === 'geometry' ? 'geometry' : 'coordinates',
            })
          }
          size="xs"
          value={columns.startMode}
        />
        <Select
          data={[
            { label: 'Lon/lat columns', value: 'coordinates' },
            { label: 'Geometry column', value: 'geometry' },
          ]}
          label="Destination point"
          onChange={(value) =>
            onChange({
              endMode: value === 'geometry' ? 'geometry' : 'coordinates',
            })
          }
          size="xs"
          value={columns.endMode}
        />
      </Group>

      {columns.startMode === 'geometry' ? (
        <Select
          data={geometryColumnOptions}
          label="Departure geometry"
          onChange={(value) => onChange({ startGeometry: value ?? '' })}
          searchable
          size="xs"
          value={columns.startGeometry}
        />
      ) : (
        <Group grow>
          <Select
            data={numericColumnOptions}
            label="Departure longitude"
            onChange={(value) => onChange({ startLon: value ?? '' })}
            searchable
            size="xs"
            value={columns.startLon}
          />
          <Select
            data={numericColumnOptions}
            label="Departure latitude"
            onChange={(value) => onChange({ startLat: value ?? '' })}
            searchable
            size="xs"
            value={columns.startLat}
          />
        </Group>
      )}

      {columns.endMode === 'geometry' ? (
        <Select
          data={geometryColumnOptions}
          label="Destination geometry"
          onChange={(value) => onChange({ endGeometry: value ?? '' })}
          searchable
          size="xs"
          value={columns.endGeometry}
        />
      ) : (
        <Group grow>
          <Select
            data={numericColumnOptions}
            label="Destination longitude"
            onChange={(value) => onChange({ endLon: value ?? '' })}
            searchable
            size="xs"
            value={columns.endLon}
          />
          <Select
            data={numericColumnOptions}
            label="Destination latitude"
            onChange={(value) => onChange({ endLat: value ?? '' })}
            searchable
            size="xs"
            value={columns.endLat}
          />
        </Group>
      )}

      <Group grow>
        <Select
          data={numericColumnOptions}
          label="Density column"
          onChange={(value) => onChange({ magnitude: value ?? '' })}
          placeholder="Optional"
          clearable
          searchable
          size="xs"
          value={columns.magnitude}
        />
        <NumberInput
          decimalScale={3}
          disabled={Boolean(columns.magnitude)}
          label="Default density"
          min={0.001}
          onChange={(value) =>
            onChange({
              defaultMagnitude: typeof value === 'number' ? value : 1,
            })
          }
          size="xs"
          value={columns.defaultMagnitude}
        />
      </Group>
    </Stack>
  );
}

export function MapLayerEditor({
  layer,
  source,
  sourceTable,
  onUpdateFlowmapLayer,
  onUpdateFlowmapSource,
  onUpdateArcLayer,
  onUpdateGeoJsonLayer,
  onUpdateGeoJsonSource,
}: {
  layer: MapLayer;
  source: MapSource;
  sourceTable: InspectableTable | null;
  onUpdateFlowmapLayer: (
    layerId: string,
    patch: {
      name?: string;
      icon?: LayerGlyphIcon;
      style?: Partial<FlowmapMapLayer['style']>;
    },
  ) => void;
  onUpdateFlowmapSource: (
    sourceId: string,
    patch: Partial<FlowmapTableSource['columns']>,
  ) => void;
  onUpdateArcLayer: (
    layerId: string,
    patch: Partial<
      Pick<ArcMapLayer, 'name' | 'icon' | 'color' | 'opacity' | 'width'>
    >,
  ) => void;
  onUpdateGeoJsonLayer: (
    layerId: string,
    patch: Partial<
      Pick<
        GeoJsonMapLayer,
        | 'name'
        | 'icon'
        | 'fillColor'
        | 'fillOpacity'
        | 'strokeColor'
        | 'strokeOpacity'
        | 'strokeWidth'
        | 'pointRadius'
      >
    >,
  ) => void;
  onUpdateGeoJsonSource: (
    sourceId: string,
    patch: Partial<Pick<MapSource & { type: 'geojson-table' }, never>> &
      Partial<{ geometryColumn: string; geometryType: string }>,
  ) => void;
}) {
  const [draftName, setDraftName] = useState(layer.name);
  const [draftFillColor, setDraftFillColor] = useState(
    layer.type === 'geojson' ? layer.fillColor : '#0c8599',
  );
  const [draftFillOpacity, setDraftFillOpacity] = useState(
    layer.type === 'geojson' ? layer.fillOpacity : 80,
  );
  const [draftStrokeColor, setDraftStrokeColor] = useState(
    layer.type === 'geojson' ? layer.strokeColor : '#0c8599',
  );
  const [draftStrokeOpacity, setDraftStrokeOpacity] = useState(
    layer.type === 'geojson' ? layer.strokeOpacity : 95,
  );
  const [draftStrokeWidth, setDraftStrokeWidth] = useState(
    layer.type === 'geojson' ? layer.strokeWidth : 2,
  );
  const [draftPointRadius, setDraftPointRadius] = useState(
    layer.type === 'geojson' ? layer.pointRadius : 6,
  );
  const [draftArcColor, setDraftArcColor] = useState(
    layer.type === 'arc' ? layer.color : '#0c8599',
  );
  const [draftArcOpacity, setDraftArcOpacity] = useState(
    layer.type === 'arc' ? layer.opacity : 86,
  );
  const [draftArcWidth, setDraftArcWidth] = useState(
    layer.type === 'arc' ? layer.width : 3,
  );
  const [draftThicknessScale, setDraftThicknessScale] = useState(
    layer.type === 'flowmap' ? layer.style.flowLineThicknessScale : 2,
  );
  const [draftTopFlows, setDraftTopFlows] = useState(
    layer.type === 'flowmap' ? layer.style.maxTopFlowsDisplayNum : 500,
  );

  useEffect(() => {
    setDraftName(layer.name);
    if (layer.type === 'geojson') {
      setDraftFillColor(layer.fillColor);
      setDraftFillOpacity(layer.fillOpacity);
      setDraftStrokeColor(layer.strokeColor);
      setDraftStrokeOpacity(layer.strokeOpacity);
      setDraftStrokeWidth(layer.strokeWidth);
      setDraftPointRadius(layer.pointRadius);
      return;
    }

    if (layer.type === 'arc') {
      setDraftArcColor(layer.color);
      setDraftArcOpacity(layer.opacity);
      setDraftArcWidth(layer.width);
      return;
    }

    setDraftThicknessScale(layer.style.flowLineThicknessScale);
    setDraftTopFlows(layer.style.maxTopFlowsDisplayNum);
  }, [layer]);

  const geometryType =
    layer.type === 'geojson' && source.type === 'geojson-table'
      ? source.geometryType
      : '';
  const showsFillSettings = !/line/i.test(geometryType);
  const showsPointSettings = /point/i.test(geometryType);

  function commitLayerName() {
    if (draftName === layer.name) {
      return;
    }

    startTransition(() => {
      if (layer.type === 'geojson') {
        onUpdateGeoJsonLayer(layer.id, {
          name: draftName,
        });
        return;
      }

      if (layer.type === 'arc') {
        onUpdateArcLayer(layer.id, {
          name: draftName,
        });
        return;
      }

      onUpdateFlowmapLayer(layer.id, {
        name: draftName,
      });
    });
  }

  return (
    <Tabs
      defaultValue="setup"
      pt="xs"
      style={{
        borderTop: '1px solid var(--mantine-color-gray-2)',
      }}
    >
      <Tabs.List grow>
        <Tabs.Tab value="setup">Setup</Tabs.Tab>
        <Tabs.Tab value="style">Style</Tabs.Tab>
        <Tabs.Tab value="tooltip">Tooltip</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel pt="xs" value="setup">
        <Stack gap="xs">
          <TextInput
            label="Layer name"
            onBlur={commitLayerName}
            onChange={(event) => setDraftName(event.currentTarget.value)}
            size="xs"
            value={draftName}
          />

          {layer.type === 'geojson' && source.type === 'geojson-table' ? (
            <Select
              data={
                sourceTable?.geometryColumns.length
                  ? sourceTable.geometryColumns.map((column) => ({
                      label: `${column.name} (${column.geometryType})`,
                      value: column.name,
                    }))
                  : [
                      {
                        label: `${source.geometryColumn} (${source.geometryType})`,
                        value: source.geometryColumn,
                      },
                    ]
              }
              label="Geographic column"
              onChange={(value) => {
                const nextGeometryColumn =
                  sourceTable?.geometryColumns.find(
                    (column) => column.name === value,
                  ) ?? null;

                startTransition(() => {
                  onUpdateGeoJsonSource(source.id, {
                    geometryColumn: value ?? source.geometryColumn,
                    geometryType:
                      nextGeometryColumn?.geometryType ?? source.geometryType,
                  });
                });
              }}
              size="xs"
              value={source.geometryColumn}
            />
          ) : null}

          {(layer.type === 'flowmap' || layer.type === 'arc') &&
          source.type === 'flowmap-table' ? (
            <>
              <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                Data setup
              </Text>
              <FlowmapSetupFields
                columns={source.columns}
                onChange={(patch) =>
                  startTransition(() => {
                    onUpdateFlowmapSource(source.id, patch);
                  })
                }
                table={sourceTable}
              />
            </>
          ) : null}
        </Stack>
      </Tabs.Panel>

      <Tabs.Panel pt="xs" value="style">
        <Stack gap="xs">
          {layer.type === 'geojson' ? (
            <>
              {showsFillSettings ? (
                <>
                  <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                    Fill
                  </Text>
                  <Box>
                    <Text c="dimmed" fw={500} mb={4} size="xs">
                      Fill color
                    </Text>
                    <input
                      aria-label={`Choose fill color for ${layer.name}`}
                      onBlur={() => {
                        if (draftFillColor === layer.fillColor) {
                          return;
                        }

                        startTransition(() => {
                          onUpdateGeoJsonLayer(layer.id, {
                            fillColor: draftFillColor,
                          });
                        });
                      }}
                      onChange={(event) =>
                        setDraftFillColor(event.currentTarget.value)
                      }
                      style={{
                        width: '100%',
                        height: 36,
                        border: '1px solid var(--mantine-color-gray-4)',
                        borderRadius: 8,
                        background: 'transparent',
                        padding: 4,
                      }}
                      type="color"
                      value={draftFillColor}
                    />
                  </Box>
                  <Stack gap={4}>
                    <Group justify="space-between">
                      <Text c="dimmed" fw={500} size="xs">
                        Fill opacity
                      </Text>
                      <Text c="dimmed" size="xs">
                        {draftFillOpacity}%
                      </Text>
                    </Group>
                    <Slider
                      max={100}
                      min={0}
                      onChange={setDraftFillOpacity}
                      onChangeEnd={(value) =>
                        startTransition(() => {
                          onUpdateGeoJsonLayer(layer.id, {
                            fillOpacity: value,
                          });
                        })
                      }
                      size="sm"
                      value={draftFillOpacity}
                    />
                  </Stack>
                </>
              ) : null}

              <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                {showsFillSettings ? 'Border' : 'Line'}
              </Text>
              <Box>
                <Text c="dimmed" fw={500} mb={4} size="xs">
                  {showsFillSettings ? 'Border color' : 'Line color'}
                </Text>
                <input
                  aria-label={`Choose ${showsFillSettings ? 'border' : 'line'} color for ${layer.name}`}
                  onBlur={() => {
                    if (draftStrokeColor === layer.strokeColor) {
                      return;
                    }

                    startTransition(() => {
                      onUpdateGeoJsonLayer(layer.id, {
                        strokeColor: draftStrokeColor,
                      });
                    });
                  }}
                  onChange={(event) =>
                    setDraftStrokeColor(event.currentTarget.value)
                  }
                  style={{
                    width: '100%',
                    height: 36,
                    border: '1px solid var(--mantine-color-gray-4)',
                    borderRadius: 8,
                    background: 'transparent',
                    padding: 4,
                  }}
                  type="color"
                  value={draftStrokeColor}
                />
              </Box>
              <Stack gap={4}>
                <Group justify="space-between">
                  <Text c="dimmed" fw={500} size="xs">
                    {showsFillSettings ? 'Border opacity' : 'Line opacity'}
                  </Text>
                  <Text c="dimmed" size="xs">
                    {draftStrokeOpacity}%
                  </Text>
                </Group>
                <Slider
                  max={100}
                  min={0}
                  onChange={setDraftStrokeOpacity}
                  onChangeEnd={(value) =>
                    startTransition(() => {
                      onUpdateGeoJsonLayer(layer.id, {
                        strokeOpacity: value,
                      });
                    })
                  }
                  size="sm"
                  value={draftStrokeOpacity}
                />
              </Stack>
              <Stack gap={4}>
                <Group justify="space-between">
                  <Text c="dimmed" fw={500} size="xs">
                    {showsFillSettings ? 'Border thickness' : 'Line thickness'}
                  </Text>
                  <Text c="dimmed" size="xs">
                    {draftStrokeWidth.toFixed(1)}px
                  </Text>
                </Group>
                <Slider
                  max={12}
                  min={0}
                  onChange={setDraftStrokeWidth}
                  onChangeEnd={(value) =>
                    startTransition(() => {
                      onUpdateGeoJsonLayer(layer.id, {
                        strokeWidth: value,
                      });
                    })
                  }
                  step={0.5}
                  value={draftStrokeWidth}
                />
              </Stack>

              {showsPointSettings ? (
                <Stack gap={4}>
                  <Group justify="space-between">
                    <Text c="dimmed" fw={500} size="xs">
                      Point radius
                    </Text>
                    <Text c="dimmed" size="xs">
                      {draftPointRadius.toFixed(1)}px
                    </Text>
                  </Group>
                  <Slider
                    max={30}
                    min={1}
                    onChange={setDraftPointRadius}
                    onChangeEnd={(value) =>
                      startTransition(() => {
                        onUpdateGeoJsonLayer(layer.id, {
                          pointRadius: value,
                        });
                      })
                    }
                    step={0.5}
                    value={draftPointRadius}
                  />
                </Stack>
              ) : null}

              <LayerIconSelect
                colorForIcon={(icon) =>
                  icon === 'line' ? layer.strokeColor : layer.fillColor
                }
                data={[
                  { label: 'Circle', value: 'circle' },
                  { label: 'Square', value: 'square' },
                  { label: 'Diamond', value: 'diamond' },
                  { label: 'Line', value: 'line' },
                ]}
                onChange={(value) =>
                  startTransition(() => {
                    onUpdateGeoJsonLayer(layer.id, {
                      icon: value,
                    });
                  })
                }
                value={layer.icon}
              />
            </>
          ) : null}

          {layer.type === 'arc' ? (
            <>
              <Group align="end" grow>
                <Box>
                  <Text c="dimmed" fw={500} mb={4} size="xs">
                    Color
                  </Text>
                  <input
                    aria-label={`Choose color for ${layer.name}`}
                    onBlur={() => {
                      if (draftArcColor === layer.color) {
                        return;
                      }

                      startTransition(() => {
                        onUpdateArcLayer(layer.id, {
                          color: draftArcColor,
                        });
                      });
                    }}
                    onChange={(event) =>
                      setDraftArcColor(event.currentTarget.value)
                    }
                    style={{
                      width: '100%',
                      height: 36,
                      border: '1px solid var(--mantine-color-gray-4)',
                      borderRadius: 8,
                      background: 'transparent',
                      padding: 4,
                    }}
                    type="color"
                    value={draftArcColor}
                  />
                </Box>

                <LayerIconSelect
                  colorForIcon={() => layer.color}
                  data={[
                    { label: 'Flow', value: 'flow' },
                    { label: 'Line', value: 'line' },
                  ]}
                  onChange={(value) =>
                    startTransition(() => {
                      onUpdateArcLayer(layer.id, {
                        icon: value,
                      });
                    })
                  }
                  value={layer.icon}
                />
              </Group>

              <Stack gap={4}>
                <Group justify="space-between">
                  <Text c="dimmed" fw={500} size="xs">
                    Opacity
                  </Text>
                  <Text c="dimmed" size="xs">
                    {draftArcOpacity}%
                  </Text>
                </Group>
                <Slider
                  max={100}
                  min={0}
                  onChange={setDraftArcOpacity}
                  onChangeEnd={(value) =>
                    startTransition(() => {
                      onUpdateArcLayer(layer.id, {
                        opacity: value,
                      });
                    })
                  }
                  size="sm"
                  value={draftArcOpacity}
                />
              </Stack>

              <Stack gap={4}>
                <Group justify="space-between">
                  <Text c="dimmed" fw={500} size="xs">
                    Width
                  </Text>
                  <Text c="dimmed" size="xs">
                    {draftArcWidth}px
                  </Text>
                </Group>
                <Slider
                  max={12}
                  min={1}
                  onChange={setDraftArcWidth}
                  onChangeEnd={(value) =>
                    startTransition(() => {
                      onUpdateArcLayer(layer.id, {
                        width: value,
                      });
                    })
                  }
                  size="sm"
                  value={draftArcWidth}
                />
              </Stack>
            </>
          ) : null}

          {layer.type === 'flowmap' ? (
            <>
              <Select
                data={[
                  { label: 'Curved', value: 'curved' },
                  { label: 'Straight', value: 'straight' },
                  {
                    label: 'Animated straight',
                    value: 'animated-straight',
                  },
                ]}
                label="Render mode"
                onChange={(value) => {
                  if (!value) {
                    return;
                  }

                  startTransition(() => {
                    onUpdateFlowmapLayer(layer.id, {
                      style: {
                        flowLinesRenderingMode:
                          value as FlowmapMapLayer['style']['flowLinesRenderingMode'],
                      },
                    });
                  });
                }}
                size="xs"
                value={layer.style.flowLinesRenderingMode}
              />

              <Stack gap={4}>
                <Group justify="space-between">
                  <Text c="dimmed" fw={500} size="xs">
                    Thickness scale
                  </Text>
                  <Text c="dimmed" size="xs">
                    {draftThicknessScale.toFixed(1)}
                  </Text>
                </Group>
                <Slider
                  max={10}
                  min={1}
                  onChange={setDraftThicknessScale}
                  onChangeEnd={(value) =>
                    startTransition(() => {
                      onUpdateFlowmapLayer(layer.id, {
                        style: {
                          flowLineThicknessScale: value,
                        },
                      });
                    })
                  }
                  step={0.5}
                  value={draftThicknessScale}
                />
              </Stack>

              <Group grow>
                <Select
                  data={[
                    { label: 'Teal', value: 'Teal' },
                    { label: 'Blue', value: 'Blue' },
                    { label: 'Red', value: 'Red' },
                    { label: 'Purp', value: 'Purp' },
                  ]}
                  label="Color scheme"
                  onChange={(value) => {
                    if (!value) {
                      return;
                    }

                    startTransition(() => {
                      onUpdateFlowmapLayer(layer.id, {
                        style: {
                          colorScheme: value,
                        },
                      });
                    });
                  }}
                  size="xs"
                  value={layer.style.colorScheme}
                />
                <LayerIconSelect
                  colorForIcon={() => '#0c8599'}
                  data={[
                    { label: 'Flow', value: 'flow' },
                    { label: 'Line', value: 'line' },
                    { label: 'Diamond', value: 'diamond' },
                  ]}
                  onChange={(value) =>
                    startTransition(() => {
                      onUpdateFlowmapLayer(layer.id, {
                        icon: value,
                      });
                    })
                  }
                  value={layer.icon}
                />
              </Group>

              <Checkbox
                checked={layer.style.locationsEnabled}
                label="Show locations"
                onChange={(event) =>
                  startTransition(() => {
                    onUpdateFlowmapLayer(layer.id, {
                      style: {
                        locationsEnabled: event.currentTarget.checked,
                      },
                    });
                  })
                }
              />
              <Checkbox
                checked={layer.style.locationTotalsEnabled}
                label="Show totals"
                onChange={(event) =>
                  startTransition(() => {
                    onUpdateFlowmapLayer(layer.id, {
                      style: {
                        locationTotalsEnabled: event.currentTarget.checked,
                      },
                    });
                  })
                }
              />
              <Checkbox
                checked={layer.style.locationLabelsEnabled}
                label="Show labels"
                onChange={(event) =>
                  startTransition(() => {
                    onUpdateFlowmapLayer(layer.id, {
                      style: {
                        locationLabelsEnabled: event.currentTarget.checked,
                      },
                    });
                  })
                }
              />
              <Checkbox
                checked={layer.style.clusteringEnabled}
                label="Enable clustering"
                onChange={(event) =>
                  startTransition(() => {
                    onUpdateFlowmapLayer(layer.id, {
                      style: {
                        clusteringEnabled: event.currentTarget.checked,
                      },
                    });
                  })
                }
              />
              <Checkbox
                checked={layer.style.darkMode}
                label="Dark mode palette"
                onChange={(event) =>
                  startTransition(() => {
                    onUpdateFlowmapLayer(layer.id, {
                      style: {
                        darkMode: event.currentTarget.checked,
                      },
                    });
                  })
                }
              />
              <Stack gap={4}>
                <Group justify="space-between">
                  <Text c="dimmed" fw={500} size="xs">
                    Top flows
                  </Text>
                  <Text c="dimmed" size="xs">
                    {draftTopFlows}
                  </Text>
                </Group>
                <Slider
                  max={2000}
                  min={50}
                  onChange={setDraftTopFlows}
                  onChangeEnd={(value) =>
                    startTransition(() => {
                      onUpdateFlowmapLayer(layer.id, {
                        style: {
                          maxTopFlowsDisplayNum: value,
                        },
                      });
                    })
                  }
                  step={50}
                  value={draftTopFlows}
                />
              </Stack>
            </>
          ) : null}
        </Stack>
      </Tabs.Panel>

      <Tabs.Panel pt="xs" value="tooltip">
        <Alert color="blue" title="Tooltip configuration" variant="light">
          Field selection, labels, order, and value formatting will be
          configured here.
        </Alert>
      </Tabs.Panel>
    </Tabs>
  );
}
