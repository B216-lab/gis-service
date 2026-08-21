import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import 'flexlayout-react/style/combined.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  ColorSchemeScript,
  localStorageColorSchemeManager,
  MantineProvider,
} from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { I18nProvider } from './features/i18n/i18n';
import './styles.css';

const colorSchemeManager = localStorageColorSchemeManager({
  key: 'geopanel-color-scheme',
});

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container #root not found');
}

createRoot(container).render(
  <StrictMode>
    <ColorSchemeScript defaultColorScheme="auto" />
    <MantineProvider
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="auto"
    >
      <I18nProvider>
        <App />
      </I18nProvider>
    </MantineProvider>
  </StrictMode>,
);
