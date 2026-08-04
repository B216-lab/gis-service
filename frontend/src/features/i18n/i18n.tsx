import { Select } from '@mantine/core';
import { IconLanguage } from '@tabler/icons-react';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type AppLanguage = 'en' | 'ru';

const languageStorageKey = 'geopanel-language';

const languageOptions = [
  { label: 'English', value: 'en' },
  { label: 'Русский', value: 'ru' },
] as const;

const translations: Record<string, string> = {
  'Switch to light theme': 'Переключить на светлую тему',
  'Switch to dark theme': 'Переключить на темную тему',
  Basemap: 'Карта',
  Light: 'Светлая',
  Dark: 'Темная',
  Satellite: 'Спутник',
  'Data & Layers': 'Данные и слои',
  Workspace: 'Рабочая область',
  'Add PostGIS connection': 'Добавить подключение PostGIS',
  'Display name': 'Название',
  Host: 'Хост',
  Port: 'Порт',
  Database: 'База данных',
  User: 'Пользователь',
  Password: 'Пароль',
  'City DB': 'Городская БД',
  geopanel_test: 'geopanel_test',
  geopanel: 'geopanel',
  'Optional for now': 'Пока необязательно',
  'Browser connections are local. Server connections keep password on backend.':
    'Подключения браузера локальные. Серверные подключения хранят пароль на бэкенде.',
  'Save connection': 'Сохранить подключение',
  'Layer name': 'Название слоя',
  'Lon/lat columns': 'Столбцы lon/lat',
  'Geometry column': 'Столбец геометрии',
  'Departure point': 'Точка отправления',
  'Destination point': 'Точка назначения',
  'Departure geometry': 'Геометрия отправления',
  'Destination geometry': 'Геометрия назначения',
  'Departure longitude': 'Долгота отправления',
  'Departure latitude': 'Широта отправления',
  'Destination longitude': 'Долгота назначения',
  'Destination latitude': 'Широта назначения',
  'Geometry point column': 'Столбец геометрии точки',
  'Numeric lon/x column': 'Числовой столбец lon/x',
  'Numeric lat/y column': 'Числовой столбец lat/y',
  'Density column': 'Столбец плотности',
  'Default density': 'Плотность по умолчанию',
  'Optional numeric weight/count column': 'Необязательный числовой вес/счетчик',
  'Flow setup incomplete': 'Настройка потока не завершена',
  'One table. Static read-only flows from selected point columns.':
    'Одна таблица. Статические потоки только для чтения из выбранных столбцов точек.',
  'Create layer': 'Создать слой',
  'Connected Sources': 'Подключенные источники',
  'Add connection': 'Добавить подключение',
  Connection: 'Подключение',
  'Configured on backend': 'Настроено на бэкенде',
  'Not tested': 'Не проверено',
  Delete: 'Удалить',
  Connected: 'Подключено',
  Failed: 'Ошибка',
  Testing: 'Проверка',
  Active: 'Активно',
  Saved: 'Сохранено',
  Selected: 'Выбрано',
  Server: 'Сервер',
  Test: 'Проверить',
  Deactivate: 'Отключить',
  Activate: 'Включить',
  'No Connections': 'Нет подключений',
  'Save first PostGIS connection to start building data sources.':
    'Сохраните первое подключение PostGIS, чтобы начать создавать источники данных.',
  'Map Layers': 'Слои карты',
  'Import Layer': 'Импорт слоя',
  'Create Flowmap': 'Создать карту потоков',
  'Create Arc': 'Создать дуги',
  Close: 'Закрыть',
  Style: 'Стиль',
  'Hide layer': 'Скрыть слой',
  'Show layer': 'Показать слой',
  'Select table below, then import geometry or create flow layer.':
    'Выберите таблицу ниже, затем импортируйте геометрию или создайте слой потоков.',
  Catalog: 'Каталог',
  'Refresh catalog schemas': 'Обновить схемы каталога',
  Hide: 'Скрыть',
  Open: 'Открыть',
  'Catalog failed': 'Ошибка каталога',
  'Loading schemas...': 'Загрузка схем...',
  'Open catalog to load schemas.': 'Откройте каталог, чтобы загрузить схемы.',
  'Loading tables...': 'Загрузка таблиц...',
  'No loaded tables.': 'Нет загруженных таблиц.',
  Collapse: 'Свернуть',
  Expand: 'Развернуть',
  'Data setup': 'Настройка данных',
  Visuals: 'Вид',
  'Geographic column': 'Географический столбец',
  Color: 'Цвет',
  Circle: 'Круг',
  Square: 'Квадрат',
  Diamond: 'Ромб',
  Line: 'Линия',
  Flow: 'Поток',
  'List icon': 'Значок списка',
  Opacity: 'Непрозрачность',
  Width: 'Ширина',
  Curved: 'Изогнутый',
  Straight: 'Прямой',
  'Animated straight': 'Анимированный прямой',
  'Render mode': 'Режим отрисовки',
  'Thickness scale': 'Масштаб толщины',
  Teal: 'Бирюзовая',
  Blue: 'Синяя',
  Red: 'Красная',
  Purp: 'Фиолетовая',
  'Color scheme': 'Цветовая схема',
  'Show locations': 'Показывать точки',
  'Show totals': 'Показывать итоги',
  'Show labels': 'Показывать подписи',
  'Enable clustering': 'Включить кластеризацию',
  'Dark mode palette': 'Темная палитра',
  'Top flows': 'Главные потоки',
  'No Connection': 'Нет подключения',
  'Select a connection to inspect table data.':
    'Выберите подключение, чтобы просмотреть данные таблицы.',
  'Connection Not Ready': 'Подключение не готово',
  'Test selected connection first to load table data safely.':
    'Сначала проверьте выбранное подключение, чтобы безопасно загрузить данные таблицы.',
  'Search rows': 'Поиск строк',
  'Clear search': 'Очистить поиск',
  'Loading catalog': 'Загрузка каталога',
  View: 'Представление',
  Row: 'Строка',
  Discard: 'Отменить',
  Save: 'Сохранить',
  'Refresh rows': 'Обновить строки',
  'Edit active saved view': 'Редактировать активное представление',
  'Delete active saved view': 'Удалить активное представление',
  'Table discovery failed': 'Ошибка поиска таблиц',
  'Discovering database tables': 'Поиск таблиц базы данных',
  'Remote databases can take a while while columns, primary keys, privileges, and geometry metadata are inspected.':
    'Удаленные базы могут отвечать долго, пока проверяются столбцы, первичные ключи, права и геометрия.',
  'Loading table metadata': 'Загрузка метаданных таблицы',
  'Reading selected table columns, primary key, privileges, and geometry.':
    'Чтение столбцов выбранной таблицы, первичного ключа, прав и геометрии.',
  'Save failed': 'Ошибка сохранения',
  'Draft committed': 'Черновик применен',
  'Locate failed': 'Ошибка поиска на карте',
  'Reading table metadata...': 'Чтение метаданных таблицы...',
  'Reading table catalog...': 'Чтение каталога таблиц...',
  'No Table Selected': 'Таблица не выбрана',
  'Choose schemas from the selected connection catalog first.':
    'Сначала выберите схемы из каталога выбранного подключения.',
  rows: 'строки',
  'No primary key': 'Нет первичного ключа',
  'Editable draft': 'Редактируемый черновик',
  'Read only': 'Только чтение',
  Search: 'Поиск',
  pending: 'ожидают',
  'page size': 'размер страницы',
  'Loading rows': 'Загрузка строк',
  'Editing enabled only for base tables with primary key and insert/update/delete privileges. Geometry cells stay read-only in this first pass.':
    'Редактирование доступно только для базовых таблиц с первичным ключом и правами insert/update/delete. Ячейки геометрии пока только для чтения.',
  Columns: 'Столбцы',
  'Readable label': 'Понятная подпись',
  'No Matches': 'Нет совпадений',
  'No Rows': 'Нет строк',
  'No rows match current search/view.':
    'Нет строк для текущего поиска/представления.',
  'Selected page has no rows.': 'На выбранной странице нет строк.',
  Previous: 'Назад',
  Next: 'Вперед',
  offset: 'смещение',
  Layer: 'Слой',
  Data: 'Данные',
  Analysis: 'Анализ',
  'No Active Layer': 'Нет активного слоя',
  'Select layer from left panel or click map object to set active layer.':
    'Выберите слой слева или объект на карте, чтобы задать активный слой.',
  Visible: 'Виден',
  Hidden: 'Скрыт',
  'Current map selection': 'Текущее выделение на карте',
  'Layer controls next': 'Управление слоем позже',
  'Right pane owns layer settings next. Existing style editor stays in left pane for now so data inspection can land without blocking that move.':
    'Настройки слоя позже переедут в правую панель. Редактор стиля пока остается слева.',
  'Source summary': 'Сводка источника',
  Table: 'Таблица',
  Geometry: 'Геометрия',
  'Flow columns': 'Столбцы потоков',
  'Spatial filter active': 'Пространственный фильтр активен',
  'Clear Spatial Filter': 'Очистить пространственный фильтр',
  'No Map Selection': 'Нет выделения на карте',
  'Click map object to inspect source rows from its backing table.':
    'Нажмите объект на карте, чтобы просмотреть строки из исходной таблицы.',
  'Open Table': 'Открыть таблицу',
  'Use selection as spatial filter':
    'Использовать выделение как пространственный фильтр',
  'Target layer': 'Целевой слой',
  Predicate: 'Предикат',
  'One endpoint inside selection': 'Один конец внутри выделения',
  'Entire flow inside selection': 'Весь поток внутри выделения',
  'Partially intersects selection': 'Частично пересекает выделение',
  'Fully inside selection': 'Полностью внутри выделения',
  'Apply Spatial Filter': 'Применить пространственный фильтр',
  'Selection truncated': 'Выделение усечено',
  'Showing first 25 matched rows in right pane. Full selection still available through table view.':
    'Справа показаны первые 25 совпавших строк. Полное выделение доступно в таблице.',
  'Row lookup failed': 'Ошибка поиска строк',
  'Loading selected rows': 'Загрузка выбранных строк',
  'Resolving primary keys back to database rows.':
    'Сопоставление первичных ключей со строками базы данных.',
  'Snapshot only': 'Только снимок',
  'Source table has no stable primary key metadata for exact row lookup. Showing attributes carried by rendered object.':
    'У исходной таблицы нет стабильного первичного ключа для точного поиска. Показаны атрибуты отрисованного объекта.',
  'Rows Not Found': 'Строки не найдены',
  'No matching rows came back for selected primary keys.':
    'Для выбранных первичных ключей строки не найдены.',
  'Geometry preview unavailable': 'Предпросмотр геометрии недоступен',
  Record: 'Запись',
  'New row': 'Новая строка',
  'Selected row': 'Выбранная строка',
  'Close record editor': 'Закрыть редактор записи',
  'Row is marked for delete.': 'Строка помечена на удаление.',
  New: 'Новая',
  Edit: 'Правка',
  'Remove new row': 'Удалить новую строку',
  'Restore row': 'Восстановить строку',
  'Mark row for delete': 'Пометить строку на удаление',
  'Locate row on map': 'Найти строку на карте',
  'No visible geometry layer for this row':
    'Для этой строки нет видимого геометрического слоя',
  'Loading...': 'Загрузка...',
  'No records': 'Нет записей',
  'Select related record': 'Выберите связанную запись',
  'Entire flow inside': 'Весь поток внутри',
  'Endpoint inside': 'Конец внутри',
  'Fully inside': 'Полностью внутри',
  Intersects: 'Пересекает',
  'No Analysis Context': 'Нет контекста анализа',
  'Analytics widgets will react to active layer and map selection.':
    'Виджеты анализа будут реагировать на активный слой и выделение на карте.',
  'Active layer': 'Активный слой',
  Source: 'Источник',
  Flowmap: 'Карта потоков',
  'Analytics workspace': 'Рабочая область анализа',
  'Use this tab for widgets, charts, and infographics bound to current layer or map selection.':
    'Эта вкладка для виджетов, графиков и инфографики, связанных с активным слоем или выделением.',
  'No object selected': 'Объект не выбран',
  'Widgets Next': 'Виджеты позже',
  'Charts and analysis widgets plug in here next without changing map/data selection model.':
    'Графики и виджеты анализа будут добавлены сюда без изменения модели выбора карты/данных.',
  'Save table view': 'Сохранить представление таблицы',
  'Edit saved view': 'Редактировать представление',
  'View name': 'Название представления',
  Cities: 'Города',
  Builder: 'Конструктор',
  WHERE: 'WHERE',
  Column: 'Столбец',
  Operator: 'Оператор',
  Equals: 'Равно',
  'In list': 'В списке',
  'Comma-separated values. Example: 7, 8':
    'Значения через запятую. Пример: 7, 8',
  'Single value. Example: 8': 'Одно значение. Пример: 8',
  Values: 'Значения',
  Value: 'Значение',
  'Condition only. Do not include WHERE.':
    'Только условие. Не добавляйте WHERE.',
  'WHERE clause': 'Условие WHERE',
  'SQL WHERE supports table columns and PostgreSQL operators. DDL, DML, subqueries, comments, semicolons, and placeholders are blocked.':
    'SQL WHERE поддерживает столбцы таблицы и операторы PostgreSQL. DDL, DML, подзапросы, комментарии, точки с запятой и плейсхолдеры заблокированы.',
  'Local virtual view over current table.':
    'Локальное виртуальное представление текущей таблицы.',
  'Update View': 'Обновить представление',
  'Save View': 'Сохранить представление',
  'Pick object': 'Выбрать объект',
  'Close feature picker': 'Закрыть выбор объекта',
  Feature: 'Объект',
  'No editable polygon layer selected':
    'Редактируемый полигональный слой не выбран',
  'Draw polygon': 'Нарисовать полигон',
  'New feature': 'Новый объект',
  'Geometry only.': 'Только геометрия.',
  Cancel: 'Отмена',
  'Loading map...': 'Загрузка карты...',
  'Loading visible layers...': 'Загрузка видимых слоев...',
};

function detectInitialLanguage(): AppLanguage {
  const stored = localStorage.getItem(languageStorageKey);
  if (stored === 'en' || stored === 'ru') {
    return stored;
  }

  const languages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  return languages.some((language) => language.toLowerCase().startsWith('ru'))
    ? 'ru'
    : 'en';
}

function translateText(value: string) {
  const exact = translations[value.trim()];
  if (exact) {
    return value.replace(value.trim(), exact);
  }

  return value
    .replace(
      /\b(\d+)\s+active\s+\/\s+(\d+)\s+saved\b/g,
      '$1 активно / $2 сохранено',
    )
    .replace(/\b(\d+)\s+layers?\b/g, '$1 слоев')
    .replace(/\bView:\s+/g, 'Представление: ')
    .replace(/\bSearch:\s+/g, 'Поиск: ')
    .replace(
      /\bLoaded\s+(\d+)\s+of\s+(\d+)\s+requested rows\./g,
      'Загружено $1 из $2 запрошенных строк.',
    )
    .replace(/\bFocused on\s+(.+)\s+with\s+(.+)$/g, 'Фокус на $1, $2')
    .replace(/\bClicked object mapped to\s+/g, 'Объект на карте связан с ')
    .replace(
      /\bLoading first page from\s+(.+)\.\.\./g,
      'Загрузка первой страницы из $1...',
    )
    .replace(/\bSaved\s+(\d+)\s+changes?\./g, 'Сохранено изменений: $1.')
    .replace(/\bCreate\s+arc\s+layer\b/g, 'Создать слой дуг')
    .replace(/\bCreate\s+flowmap\s+layer\b/g, 'Создать слой потоков')
    .replace(/\bDelete layer "(.+)" from map\?/g, 'Удалить слой "$1" с карты?')
    .replace(/\bDelete saved view "(.+)"\?/g, 'Удалить представление "$1"?')
    .replace(
      /\bDiscard unsaved table changes before (.+)\?/g,
      'Отменить несохраненные изменения перед действием "$1"?',
    )
    .replace(
      /\bDiscard all unsaved table changes\?/g,
      'Отменить все несохраненные изменения?',
    );
}

function localizeNode(root: ParentNode, language: AppLanguage) {
  if (language !== 'ru') {
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  for (const node of textNodes) {
    const nextValue = translateText(node.nodeValue ?? '');
    if (nextValue !== node.nodeValue) {
      node.nodeValue = nextValue;
    }
  }

  const attrNames = ['aria-label', 'title', 'placeholder'];
  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const attrName of attrNames) {
      const value = element.getAttribute(attrName);
      if (!value) {
        continue;
      }
      const nextValue = translateText(value);
      if (nextValue !== value) {
        element.setAttribute(attrName, nextValue);
      }
    }
  }
}

interface I18nContextValue {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(
    detectInitialLanguage,
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage: (nextLanguage) => {
        localStorage.setItem(languageStorageKey, nextLanguage);
        setLanguageState(nextLanguage);
      },
    }),
    [language],
  );

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem(languageStorageKey, language);
  }, [language]);

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) {
      return;
    }

    localizeNode(root, language);
    const observer = new MutationObserver(() => localizeNode(root, language));
    observer.observe(root, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [language]);

  return (
    <I18nContext.Provider key={language} value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used inside I18nProvider');
  }

  return context;
}

export function LanguageSwitcher() {
  const { language, setLanguage } = useI18n();

  return (
    <Select
      allowDeselect={false}
      aria-label={language === 'ru' ? 'Язык' : 'Language'}
      data={languageOptions}
      leftSection={<IconLanguage size={14} />}
      onChange={(value) => {
        if (value === 'en' || value === 'ru') {
          setLanguage(value);
        }
      }}
      size="xs"
      style={{ width: 128 }}
      value={language}
    />
  );
}
