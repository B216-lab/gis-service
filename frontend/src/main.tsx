import '@mantine/core/styles.css';
import '@mantine/code-highlight/styles.css';
import '@mantine/dates/styles.css';
import 'flexlayout-react/style/combined.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  type CodeHighlightAdapter,
  CodeHighlightAdapterProvider,
} from '@mantine/code-highlight';
import {
  ColorSchemeScript,
  createTheme,
  getDefaultZIndex,
  localStorageColorSchemeManager,
  MantineProvider,
  MultiSelect,
  Select,
} from '@mantine/core';
import hljs from 'highlight.js/lib/core';
import sql from 'highlight.js/lib/languages/sql';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { I18nProvider } from './features/i18n/i18n';
import './styles.css';

const colorSchemeManager = localStorageColorSchemeManager({
  key: 'geopanel-color-scheme',
});

const theme = createTheme({
  components: {
    Select: Select.extend({
      defaultProps: {
        comboboxProps: { zIndex: getDefaultZIndex('max') },
      },
    }),
    MultiSelect: MultiSelect.extend({
      defaultProps: {
        comboboxProps: { zIndex: getDefaultZIndex('max') },
      },
    }),
  },
});

hljs.registerLanguage('sql', sql);
const codeHighlightAdapter: CodeHighlightAdapter = {
  getHighlighter:
    () =>
    ({ code, language }) => {
      const resolvedLanguage =
        language && hljs.getLanguage(language) ? language : 'plaintext';
      return {
        highlightedCode: hljs.highlight(code, {
          language: resolvedLanguage,
        }).value,
        isHighlighted: true,
        codeElementProps: { className: `hljs ${resolvedLanguage}` },
      };
    },
};

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
      theme={theme}
    >
      <CodeHighlightAdapterProvider adapter={codeHighlightAdapter}>
        <I18nProvider>
          <App />
        </I18nProvider>
      </CodeHighlightAdapterProvider>
    </MantineProvider>
  </StrictMode>,
);
