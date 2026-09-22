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
  'Line chart': 'Линейный график',
  'invalid definition: import validation failed':
    'Проверка импортируемых объектов не пройдена',
  'invalid definition: filter targets unknown widget':
    'Фильтр ссылается на неизвестный виджет',
  'invalid definition: chart filter targets unknown widget':
    'Фильтр диаграммы ссылается на неизвестный виджет',
  'invalid definition: native filter targets unknown widget':
    'Фильтр дашборда ссылается на неизвестный виджет',
  'invalid definition: widget references unknown chart':
    'Диаграмма виджета не найдена',
  'invalid definition: invalid widget id or layout':
    'Некорректный идентификатор или размер виджета',
  'invalid definition: invalid native filter reference':
    'Некорректная ссылка в фильтре дашборда',
  'invalid definition: refresh interval must be zero or at least 30 seconds':
    'Интервал обновления должен быть 0 или не менее 30 секунд',
  'invalid definition: malformed dashboard': 'Некорректное описание дашборда',
  'invalid definition: composite chart dependency cycle':
    'Обнаружен цикл зависимостей слоёв составной карты',
  'invalid definition: invalid layer chart reference':
    'Некорректная ссылка на диаграмму слоя',
  'invalid definition: HAVING references unselected metric':
    'Условие HAVING ссылается на невыбранный показатель',
  'invalid definition: chart references unknown date field':
    'Поле даты диаграммы не найдено',
  'invalid definition: chart references unknown metric':
    'Показатель диаграммы не найден',
  'invalid definition: chart references unknown field':
    'Поле диаграммы не найдено',
  'invalid definition: chart query dataset mismatch':
    'Набор данных запроса не совпадает с набором данных диаграммы',
  'invalid definition: chart references unknown dataset':
    'Набор данных диаграммы не найден',
  'invalid definition: malformed chart': 'Некорректное описание диаграммы',
  'invalid definition: relationship references unknown dataset/field':
    'В связи указан неизвестный набор данных или поле',
  'invalid definition: unknown default date field':
    'Поле даты по умолчанию не найдено',
  'invalid definition: invalid or duplicate metric':
    'Некорректный или повторяющийся показатель',
  'invalid definition: invalid or duplicate field':
    'Некорректное или повторяющееся поле',
  'invalid definition: dataset needs connectionId and either SQL or schema/table':
    'Укажите подключение и SQL-запрос либо схему и таблицу',
  'invalid definition: malformed dataset':
    'Некорректное описание набора данных',
  'Query failed. Check dataset fields, SQL, filters, and source access.':
    'Запрос не выполнен. Проверьте поля набора данных, SQL, фильтры и доступ к источнику.',
  'invalid definition': 'Некорректное описание объекта',
  'revision conflict':
    'Объект изменён другим пользователем. Обновите данные перед сохранением.',
  'object not found': 'Объект не найден',
  'Dashboard setting not migrated; native interactive dashboard behavior applies.':
    'Параметр дашборда не перенесён; используется поведение встроенного интерактивного дашборда.',
  'Preserved section/order/12-column widths; exported pixel heights scaled to native grid rows. Header typography is native.':
    'Сохранены разделы, порядок и ширина в сетке из 12 столбцов; высота пересчитана из пикселей в строки сетки. Заголовки используют оформление приложения.',
  'City filter expanded to all compatible widgets; export lists only ten chart IDs despite global scope.':
    'Фильтр города применён ко всем совместимым виджетам; в экспорте указаны только десять диаграмм, хотя область действия глобальная.',
  'Public city control accepts typed values because public arbitrary field-options queries are intentionally unavailable.':
    'В публичном фильтре города значения вводятся вручную: произвольные запросы списка значений недоступны.',
  'Export setting not migrated; native renderer behavior applies.':
    'Параметр экспорта не перенесён; используется поведение встроенной визуализации.',
  'Preserved lower date bound 2022-01-01; weekly bucketing uses UTC source sessions.':
    'Сохранена нижняя граница даты 2022-01-01; группировка по неделям использует UTC.',
  'Rolling three months resolved in UTC at request time; source Superset timezone was not exported.':
    'Последние три месяца определяются на момент запроса в UTC; часовой пояс Superset отсутствует в экспорте.',
  'Departure/destination layers overlaid; title does not imply subtraction.':
    'Слои отправлений и прибытий наложены друг на друга; разность значений не вычисляется.',
  'Palette approximated; exact Superset category-to-color assignments are not pinned.':
    'Подобрана близкая палитра; точное соответствие цветов категориям Superset не сохранено.',
  'Clamped exported row limit to server maximum 10000; truncation is reported.':
    'Лимит строк ограничен серверным максимумом 10000; при усечении результата выводится уведомление.',
  'Journey filters mean respondents with matching journeys, implemented with EXISTS; respondent totals retain questionnaire grain.':
    'Фильтры перемещений выбирают респондентов с подходящими поездками через EXISTS; итоговое число респондентов считается по анкетам.',
  'Added matching Russian gender calculated field for value-compatible semantic filtering; raw gender codes remain separately mapped.':
    'Добавлено вычисляемое поле пола с русскими значениями для совместной фильтрации; исходные коды пола сохранены отдельно.',
  'Corrected integer division to numeric ratio and guarded zero denominator.':
    'Целочисленное деление заменено дробным; добавлена защита от деления на ноль.',
  Analytics: 'Аналитика',
  'Analytics request failed': 'Не удалось выполнить запрос аналитики',
  Dataset: 'Набор данных',
  Datasets: 'Наборы данных',
  'Dataset catalog': 'Каталог наборов данных',
  'Dataset name': 'Название набора данных',
  'New dataset': 'Новый набор данных',
  'Edit dataset': 'Редактирование набора данных',
  'Save dataset': 'Сохранить набор данных',
  'Delete dataset': 'Удалить набор данных',
  'Dataset saved.': 'Набор данных сохранён.',
  'Dataset deleted.': 'Набор данных удалён.',
  'Choose a saved dataset': 'Выберите сохранённый набор данных',
  'Choose a dataset or create one from a server connection.':
    'Выберите набор данных или создайте его на основе серверного подключения.',
  'Choose a dataset.': 'Выберите набор данных.',
  'Could not load analytics.': 'Не удалось загрузить аналитику.',
  'Could not load server connections.':
    'Не удалось загрузить серверные подключения.',
  'Server connection': 'Серверное подключение',
  'Source connection': 'Подключение к источнику',
  'Row grain': 'Что представляет одна строка',
  'One row per submission_id': 'Одна строка на submission_id',
  'Default date field': 'Поле даты по умолчанию',
  'Physical table': 'Таблица базы данных',
  'SQL / virtual table': 'SQL / виртуальная таблица',
  'Visual joins': 'Конструктор связей таблиц',
  'Read-only SQL': 'SQL-запрос для чтения',
  'Use table names within this connection. Preview inspects output columns.':
    'Используйте таблицы выбранного подключения. Предпросмотр покажет столбцы результата.',
  Schema: 'Схема',
  'Base schema': 'Схема основной таблицы',
  'Base table (alias: base)': 'Основная таблица (псевдоним: base)',
  'Projected columns / expressions': 'Столбцы и выражения результата',
  'Example: base.id AS submission_id, status.description_ru AS social_status':
    'Пример: base.id AS submission_id, status.description_ru AS social_status',
  'Join schema': 'Схема присоединяемой таблицы',
  'Join table': 'Присоединяемая таблица',
  'Base key': 'Ключ основной таблицы',
  'Joined key': 'Ключ присоединяемой таблицы',
  Join: 'Соединение',
  'Add join': 'Добавить соединение',
  'Remove join': 'Удалить соединение',
  'Generate SQL': 'Сформировать SQL',
  'Base table and every join table, alias and key are required.':
    'Укажите основную таблицу, а для каждого соединения — таблицу, псевдоним и ключи.',
  'Joins may multiply rows. Use unique joined keys to preserve the declared grain; preview before saving.':
    'Соединения могут дублировать строки. Используйте уникальные ключи присоединяемых таблиц и проверьте результат перед сохранением.',
  'Fields and calculated columns': 'Поля и вычисляемые столбцы',
  Field: 'Поле',
  'Field ID': 'Идентификатор поля',
  'Column name': 'Имя столбца',
  'Display label': 'Подпись',
  'Shared semantic ID': 'Общий идентификатор поля для фильтрации',
  Type: 'Тип',
  Role: 'Назначение',
  Format: 'Формат',
  'Calculated SQL expression (optional)':
    'Вычисляемое SQL-выражение (необязательно)',
  'Add field': 'Добавить поле',
  'Remove field': 'Удалить поле',
  'Reusable metrics': 'Общие показатели',
  Metric: 'Показатель',
  Metrics: 'Показатели',
  'Metric ID': 'Идентификатор показателя',
  Label: 'Подпись',
  'Aggregate SQL expression': 'Агрегатное SQL-выражение',
  'Add metric': 'Добавить показатель',
  'Remove metric': 'Удалить показатель',
  'Dataset relationships': 'Связи наборов данных',
  'Target dataset': 'Связанный набор данных',
  'Source key': 'Ключ текущего набора',
  'Target key': 'Ключ связанного набора',
  Cardinality: 'Тип связи',
  'Allow related filtering': 'Разрешить фильтрацию по связанному набору',
  'Add relationship': 'Добавить связь',
  'Remove relationship': 'Удалить связь',
  'Preview / inspect columns': 'Предпросмотр и проверка столбцов',
  'Preview failed.': 'Не удалось загрузить предпросмотр.',
  'Delete saved dataset?': 'Удалить сохранённый набор данных?',
  'Dependent charts prevent deletion. This removes its saved definition.':
    'Набор нельзя удалить, пока его используют графики. Будет удалена только сохранённая настройка набора.',
  'Confirm deletion': 'Подтвердить удаление',
  'Add discovered fields': 'Добавить найденные поля',
  'No rows match this dataset.': 'В наборе данных нет строк.',
  'Refresh catalog': 'Обновить каталог',
  'Reload selected': 'Загрузить сохранённую версию',
  Chart: 'График',
  Charts: 'Графики',
  'New chart': 'Новый график',
  'Chart name': 'Название графика',
  'Save chart': 'Сохранить график',
  'Delete chart': 'Удалить график',
  'Chart saved.': 'График сохранён.',
  'Chart deleted.': 'График удалён.',
  'Chart failed': 'Не удалось построить график',
  'Chart query failed.': 'Не удалось получить данные графика.',
  'Could not load charts.': 'Не удалось загрузить графики.',
  'Chart definition unavailable.': 'Настройки графика недоступны.',
  'Choose at least one metric.': 'Выберите хотя бы один показатель.',
  'Enter a chart name.': 'Укажите название графика.',
  Visualization: 'Вид графика',
  Dimensions: 'Поля группировки',
  'Order: category, series breakdown. Map: longitude, latitude, destination longitude, destination latitude.':
    'Порядок: категория, затем разделение на серии. Для карты: долгота, широта, долгота и широта назначения.',
  'Each layer uses its saved query and coordinates.':
    'Каждый слой использует собственный сохранённый запрос и координаты.',
  'Map layers': 'Слои карты',
  Coordinates: 'Координаты',
  'Weight metric': 'Показатель веса',
  'Default filters': 'Фильтры по умолчанию',
  'Add filter': 'Добавить фильтр',
  'Remove filter': 'Удалить фильтр',
  Condition: 'Условие',
  'Separate multiple values with |. Dates use ISO 8601 (UTC).':
    'Разделяйте значения символом |. Даты указывайте в формате ISO 8601 (UTC).',
  'Month count, e.g. 3. Resolves at query time.':
    'Количество месяцев, например 3. Период рассчитывается при выполнении запроса.',
  'Aggregate filters': 'Фильтры по показателям',
  'Aggregate condition': 'Условие для показателя',
  'Aggregate values': 'Значения показателя',
  'Add aggregate filter': 'Добавить фильтр по показателю',
  'Remove aggregate filter': 'Удалить фильтр по показателю',
  'Number; separate range bounds with |.':
    'Число; границы диапазона разделяйте символом |.',
  'Date field': 'Поле даты',
  'Time grouping': 'Группировка по времени',
  'Sort by': 'Сортировать по',
  'Descending sort': 'По убыванию',
  'Row limit': 'Ограничение числа строк',
  Appearance: 'Оформление',
  'Primary color': 'Основной цвет',
  Decimals: 'Знаков после запятой',
  Prefix: 'Перед значением',
  Suffix: 'После значения',
  Legend: 'Легенда',
  'Value labels': 'Подписи значений',
  Horizontal: 'Горизонтально',
  Stacked: 'С накоплением',
  'Category order': 'Порядок категорий',
  'Row order': 'Порядок строк',
  'Normalization scope': 'Область нормализации',
  'Color by percentile rank': 'Цвет по процентильному рангу',
  'Show percentage in tooltip': 'Показывать долю в подсказке',
  'Heat radius (pixels)': 'Радиус теплового пятна (пиксели)',
  'Run preview': 'Построить предпросмотр',
  'Clear selection': 'Снять выделение',
  'Selection ready': 'Выделение готово',
  'Click marks to select. Ctrl/Shift-click combines selections. Dashboard determines filter targets.':
    'Нажмите на элемент графика для выделения. Ctrl/Shift + щелчок добавляет элементы. Область действия фильтра задаётся в дашборде.',
  'No data for current filters.': 'Нет данных для выбранных фильтров.',
  'Row limit reached. Narrow filters to display complete results.':
    'Достигнуто ограничение числа строк. Уточните фильтры, чтобы увидеть полный результат.',
  Dashboard: 'Дашборд',
  Dashboards: 'Дашборды',
  'New dashboard': 'Новый дашборд',
  'Dashboard catalog': 'Каталог дашбордов',
  'Dashboard name': 'Название дашборда',
  'Dashboard catalog unavailable.': 'Каталог дашбордов недоступен.',
  'Dashboard unavailable': 'Дашборд недоступен',
  'Dashboard unavailable.': 'Дашборд недоступен.',
  Description: 'Описание',
  'Refresh dashboards and charts': 'Обновить дашборды и графики',
  'Reload dashboard': 'Загрузить сохранённый дашборд',
  'Save current selections as default filters':
    'Сохранить текущее выделение как фильтры по умолчанию',
  'Auto refresh (seconds; 0 = off, minimum 30)':
    'Автообновление в секундах (0 — выключено, минимум 30)',
  'Save dashboard and filters': 'Сохранить дашборд и фильтры',
  'Dashboard and current filters saved.':
    'Дашборд и текущие фильтры сохранены.',
  'Delete dashboard': 'Удалить дашборд',
  'Delete dashboard definition?': 'Удалить сохранённый дашборд?',
  'Confirm dashboard deletion': 'Подтвердить удаление дашборда',
  Layout: 'Компоновка',
  'Interactive preview': 'Интерактивный предпросмотр',
  'Publish and share': 'Публикация и доступ',
  'Saved chart': 'Сохранённый график',
  'Add chart': 'Добавить график',
  'Add section heading': 'Добавить заголовок раздела',
  'Add text': 'Добавить текст',
  'Dashboard filter controls': 'Фильтры дашборда',
  'Filter title': 'Название фильтра',
  'Filter dataset': 'Набор данных фильтра',
  'Filter column': 'Поле фильтра',
  'Filter target charts': 'Графики, к которым применяется фильтр',
  'Add filter control': 'Добавить фильтр дашборда',
  'Remove filter control': 'Удалить фильтр дашборда',
  'Drag cards to reorder. Width uses 12 columns; mobile stacks cards. Height controls chart area.':
    'Перетаскивайте карточки для изменения порядка. Ширина задаётся в сетке из 12 столбцов; на телефоне карточки располагаются друг под другом. Высота задаёт размер области графика.',
  'Missing chart': 'График не найден',
  'Section heading': 'Заголовок раздела',
  'Text block': 'Текстовый блок',
  Text: 'Текст',
  'Remove widget': 'Удалить блок',
  'Width (columns)': 'Ширина (столбцы)',
  'Height (units)': 'Высота (единицы сетки)',
  'Selection targets (empty = compatible charts)':
    'Область действия выделения (пусто — все совместимые графики)',
  'Move earlier': 'Переместить выше',
  'Move later': 'Переместить ниже',
  'Saved publications': 'Сохранённые публикации',
  'Load publications': 'Загрузить публикации',
  'Publication list unavailable.': 'Список публикаций недоступен.',
  'Publication unavailable.': 'Публикация недоступна.',
  'Publish the saved revision to freeze chart and dataset definitions. Source data stays live.':
    'Опубликуйте сохранённую версию, чтобы закрепить настройки графиков и наборов данных. Данные источника продолжат обновляться.',
  'Publish saved dashboard': 'Опубликовать сохранённый дашборд',
  'Published revision': 'Опубликованная версия',
  'Published saved revision. Draft changes require saving and publishing again.':
    'Сохранённая версия опубликована. Чтобы опубликовать изменения черновика, сохраните его и создайте новую публикацию.',
  'Authenticated viewer link': 'Ссылка для пользователей с доступом',
  'Public link expiry (optional)':
    'Срок действия публичной ссылки (необязательно)',
  'Lock current filters into public link':
    'Закрепить текущие фильтры в публичной ссылке',
  'Create public link': 'Создать публичную ссылку',
  'Public dashboard link (copy now)':
    'Публичная ссылка на дашборд (скопируйте сейчас)',
  'Refresh shares': 'Обновить ссылки доступа',
  'No expiry': 'Без срока действия',
  'Revoke link': 'Отозвать ссылку',
  Revoked: 'Отозвана',
  'Publish failed.': 'Не удалось опубликовать дашборд.',
  'Share creation failed.': 'Не удалось создать ссылку доступа.',
  'Revocation failed.': 'Не удалось отозвать ссылку.',
  'Refresh charts': 'Обновить графики',
  'Filter field': 'Поле фильтрации',
  'Target charts (empty = compatible charts)':
    'Область действия фильтра (пусто — все совместимые графики)',
  'Apply filter': 'Применить фильтр',
  'Clear filters': 'Сбросить фильтры',
  'Filter choices come from visible chart results.':
    'Варианты значений получены из данных отображаемых графиков.',
  'Filter options unavailable.': 'Не удалось загрузить значения фильтра.',
  'Retry chart': 'Повторить запрос',
  'Published definition': 'Опубликованная версия',
  'Choose suggestions or type values and press Enter. Multiple values match any selection.':
    'Выберите предложенное значение или введите своё и нажмите Enter. При нескольких значениях достаточно совпадения с любым из них.',
  'Enter valid numeric values.': 'Введите корректные числовые значения.',
  'A filter has no compatible target charts. Clear it or change its scope before saving.':
    'Для одного из фильтров нет совместимых графиков. Сбросьте его или измените область действия перед сохранением.',
  'Import reference': 'Импорт из Superset',
  'Import movements dashboard': 'Импорт дашборда передвижений',
  'Import reference dashboard': 'Импортировать дашборд из Superset',
  'Create two datasets, twenty charts and the dashboard from the saved Superset reference. Reimport restores these imported definitions; other dashboards stay separate.':
    'Создать два набора данных, двадцать графиков и дашборд из сохранённого экспорта Superset. Повторный импорт восстановит их исходные настройки; остальные дашборды не изменятся.',
  'Import failed.': 'Не удалось выполнить импорт.',
  'Filter to visible map area': 'Фильтровать по видимой области карты',
  'WebGL map unavailable.': 'Не удалось отобразить карту WebGL.',
  'Region map unavailable.': 'Не удалось отобразить карту регионов.',
  'Drag to rotate map, click to reset north':
    'Перетащите для поворота карты, нажмите, чтобы вернуть север наверх',
  'Toggle attribution': 'Показать или скрыть сведения об источниках',
  True: 'Да',
  False: 'Нет',
  'Save failed.': 'Не удалось сохранить изменения.',
  'Delete failed.': 'Не удалось удалить объект.',
  'Another editor changed this object. Reload before saving again.':
    'Другой пользователь изменил этот объект. Загрузите актуальную версию перед сохранением.',
  'Failed to fetch': 'Не удалось соединиться с сервером',
  'Not in list': 'Не в списке',
  Between: 'В диапазоне',
  Contains: 'Содержит',
  'Is empty': 'Не задано',
  'Is not empty': 'Задано',
  'Last months': 'За последние месяцы',
  Number: 'Число',
  Integer: 'Целое число',
  Boolean: 'Логическое значение',
  Date: 'Дата',
  'Date and time': 'Дата и время',
  Dimension: 'Поле группировки',
  Time: 'Время',
  Latitude: 'Широта',
  Longitude: 'Долгота',
  Identifier: 'Идентификатор',
  'Many to one': 'Многие к одному',
  'One to many': 'Один ко многим',
  'One to one': 'Один к одному',
  Hour: 'Час',
  Day: 'День',
  Week: 'Неделя',
  Month: 'Месяц',
  Quarter: 'Квартал',
  Year: 'Год',
  'Hour of day': 'Час суток',
  'Day of week': 'День недели',
  'Left join': 'Левое соединение',
  'Inner join': 'Внутреннее соединение',
  KPI: 'Ключевой показатель',
  Bar: 'Столбчатая диаграмма',
  Pie: 'Круговая диаграмма',
  'Matrix heatmap': 'Матричная тепловая карта',
  'Calendar heatmap': 'Календарная тепловая карта',
  'Geographic heatmap': 'Географическая тепловая карта',
  'Movement arcs': 'Дуги передвижений',
  'Composite map': 'Карта с несколькими слоями',
  'Label ascending': 'По подписи: по возрастанию',
  'Label descending': 'По подписи: по убыванию',
  'Total ascending': 'По сумме: по возрастанию',
  'Total descending': 'По сумме: по убыванию',
  'Entire heatmap': 'Вся тепловая карта',
  'Within each row': 'В пределах строки',
  'Within each column': 'В пределах столбца',
  'Calendar heatmap requires one date dimension, one metric, and day time grouping.':
    'Для календарной тепловой карты нужны одно поле даты, один показатель и группировка по дням.',
  'Choose coordinate fields and include each in dimensions.':
    'Выберите координатные поля и добавьте каждое в поля группировки.',
  'Choose one category dimension, optionally a second for series breakdown.':
    'Выберите поле категорий. При необходимости добавьте второе поле для разделения на серии.',
  'KPI requires metrics and no dimensions.':
    'Для ключевого показателя выберите показатели без полей группировки.',
  'Matrix heatmap requires two dimensions and one metric.':
    'Для матричной тепловой карты нужны два поля группировки и один показатель.',
  'Pie requires one dimension and one metric.':
    'Для круговой диаграммы нужны одно поле группировки и один показатель.',
  'Multiple selected groups': 'Несколько выбранных групп',
  Revision: 'Версия',
  'Preview:': 'Предпросмотр:',
  '(limited)': '(показана часть строк)',
  'Locked:': 'Закреплено:',
  'created,': 'создано,',
  'updated,': 'обновлено,',
  'unchanged. Charts remain editable.':
    'без изменений. Графики можно редактировать.',
  'migration notes': 'примечаний к импорту',

  'Switch to light theme': 'Переключить на светлую тему',
  'Switch to dark theme': 'Переключить на темную тему',
  Basemap: 'Карта',
  Light: 'Светлая',
  Dark: 'Темная',
  Satellite: 'Спутник',
  'Data & Layers': 'Данные и слои',
  Workspace: 'Рабочая область',
  'Application settings': 'Настройки приложения',
  'Map settings': 'Настройки карты',
  Display: 'Отображение',
  'Data Sources': 'Источники данных',
  Map: 'Карта',
  'Auto-hide panel': 'Автоматически скрывать панель',
  'Pin panel open': 'Закрепить панель',
  'Float selected tab': 'Открыть выбранную вкладку в окне',
  'Drag tabs to dock · pin or float panels':
    'Перетаскивайте вкладки для стыковки · закрепляйте или открывайте в окнах',
  'Reset workspace layout': 'Сбросить компоновку рабочей области',
  Resize: 'Изменить размер',
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
  'Visible schemas': 'Видимые схемы',
  'Choose schemas shown in catalog and give technical names readable aliases. Settings are stored in database.':
    'Выберите схемы для каталога и задайте техническим именам понятные псевдонимы. Настройки хранятся в базе данных.',
  'Schema settings failed': 'Ошибка настроек схем',
  Alias: 'Псевдоним',
  Show: 'Показать',
  'Open in Google Maps': 'Открыть в Google Картах',
  'Configure schemas': 'Настроить схемы',
  'All schemas are hidden. Configure schemas from connection options.':
    'Все схемы скрыты. Настройте схемы в параметрах подключения.',
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
  Density: 'Плотность',
  'Optional numeric weight/count column': 'Необязательный числовой вес/счетчик',
  'Flow setup incomplete': 'Настройка потока не завершена',
  'One table. Static read-only flows from selected point columns.':
    'Одна таблица. Статические потоки только для чтения из выбранных столбцов точек.',
  'Create layer': 'Создать слой',
  'Connected Sources': 'Подключенные источники',
  'Add connection': 'Добавить подключение',
  Connection: 'Подключение',
  'Configured on backend': 'Настроено на бэкенде',
  'Connection test passed.': 'Подключение успешно проверено.',
  'Not tested': 'Не проверено',
  Delete: 'Удалить',
  'Delete record?': 'Удалить запись?',
  'Deletion failed': 'Не удалось удалить запись',
  'Failed to delete record.': 'Не удалось удалить запись.',
  'Database foreign-key rules will decide whether linked rows are restricted, cascaded, or updated.':
    'Правила внешних ключей базы данных определят, будут связанные записи защищены от удаления, удалены каскадно или обновлены.',
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
  'Layer Actions': 'Действия со слоями',
  'This icon appears next to the layer in the Map Layers list.':
    'Этот значок отображается рядом со слоем в списке слоев карты.',
  'Create new': 'Создать',
  'Point layer': 'Точечный слой',
  'Polygon layer': 'Полигональный слой',
  'Create point layer': 'Создать точечный слой',
  'Create polygon layer': 'Создать полигональный слой',
  'Polygon geometry': 'Полигональная геометрия',
  'Only Polygon and MultiPolygon geometry columns are available.':
    'Доступны только столбцы геометрии Polygon и MultiPolygon.',
  'Select polygon geometry column': 'Выберите столбец полигональной геометрии',
  'No polygon geometry': 'Нет полигональной геометрии',
  'This table has no Polygon or MultiPolygon geometry column.':
    'В этой таблице нет столбца геометрии Polygon или MultiPolygon.',
  'Flowmap layer': 'Слой потоков',
  'Arc layer': 'Слой дуг',
  'Data table': 'Таблица данных',
  'Choose layer data directly. Opening the table for inspection is optional.':
    'Выберите данные слоя напрямую. Открывать таблицу для просмотра необязательно.',
  'Select schema and table': 'Выберите схему и таблицу',
  'Point geometry': 'Точечная геометрия',
  'Only Point and MultiPoint geometry columns are available.':
    'Доступны только столбцы геометрии Point и MultiPoint.',
  'Select point geometry column': 'Выберите столбец точечной геометрии',
  'No point geometry': 'Нет точечной геометрии',
  'This table has no Point or MultiPoint geometry column.':
    'В этой таблице нет столбца геометрии Point или MultiPoint.',
  All: 'Все',
  Configured: 'Настроенные',
  Previews: 'Предпросмотры',
  'Record preview': 'Предпросмотр записи',
  'No layers match this filter.': 'Нет слоев для выбранного фильтра.',
  'Import Layer': 'Импорт слоя',
  'Create Flowmap': 'Создать карту потоков',
  'Create Arc': 'Создать дуги',
  Close: 'Закрыть',
  Settings: 'Настройки',
  Setup: 'Данные',
  Style: 'Стиль',
  Tooltip: 'Подсказка',
  'Tooltip configuration': 'Настройка подсказки',
  'Field selection, labels, order, and value formatting will be configured here.':
    'Здесь будут настраиваться поля, подписи, порядок и формат значений.',
  'Zoom to layer': 'Показать слой на карте',
  'Hide layer': 'Скрыть слой',
  'Show layer': 'Показать слой',
  'Layer source is unavailable.': 'Источник слоя недоступен.',
  'Layer has no mappable features.':
    'В слое нет объектов для отображения на карте.',
  'Failed to locate layer.': 'Не удалось найти слой.',
  'Select table below, then import geometry or create flow layer.':
    'Выберите таблицу ниже, затем импортируйте геометрию или создайте слой потоков.',
  'Use Create new to choose a layer type and configure its data.':
    'Нажмите «Создать», выберите тип слоя и настройте его данные.',
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
  'Table alias': 'Псевдоним таблицы',
  'Relation values': 'Связанные значения',
  'Raw id': 'Исходный идентификатор',
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
  table: 'таблица',
  view: 'представление',
  'partitioned table': 'секционированная таблица',
  'materialized view': 'материализованное представление',
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
  'Record editor': 'Редактор записи',
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
  'Related data': 'Связанные данные',
  'Loading related records': 'Загрузка связанных записей',
  'No related records.': 'Нет связанных записей.',
  Fields: 'Поля',
  'Geo:': 'Гео:',
  'No geographic columns.': 'Нет географических столбцов.',
  Arc: 'Дуга',
  'Show arc': 'Показать дугу',
  From: 'Откуда',
  To: 'Куда',
  'No changes': 'Нет изменений',
  'Saved.': 'Сохранено.',
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
  'Analytics workspace': 'Аналитика',
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
  Location: 'Точка',
  'Flow layer': 'Слой потоков',
  'No editable polygon layer selected':
    'Редактируемый полигональный слой не выбран',
  'Draw polygon': 'Нарисовать полигон',
  'New feature': 'Новый объект',
  'Geometry only.': 'Только геометрия.',
  Cancel: 'Отмена',
  'Loading map...': 'Загрузка карты...',
  'Loading visible layers...': 'Загрузка видимых слоев...',
  'Zoom in': 'Приблизить',
  'Zoom out': 'Отдалить',
  Optional: 'Необязательно',
  true: 'да',
  false: 'нет',
  unknown: 'неизвестно',
  Loaded: 'Загружено',
  of: 'из',
  'requested rows.': 'запрошенных строк.',
  '• rows': '• строки',
  'Table:': 'Таблица:',
  'Geometry:': 'Геометрия:',
  'Flow columns:': 'Столбцы потоков:',
  'Focused on': 'Фокус на',
  with: 'с',
  'Clicked object mapped to': 'Объект на карте связан с',
  'Loading first page from': 'Загрузка первой страницы из',
  'Database connection test failed.':
    'Не удалось проверить подключение к базе данных.',
  'Failed to load schema display settings.':
    'Не удалось загрузить настройки отображения схем.',
  'Failed to save schema display settings.':
    'Не удалось сохранить настройки отображения схем.',
  'Failed to load schemas.': 'Не удалось загрузить схемы.',
  'Failed to load related rows.': 'Не удалось загрузить связанные строки.',
  'Failed to load selected rows.': 'Не удалось загрузить выбранные строки.',
  'Failed to load table display settings.':
    'Не удалось загрузить настройки отображения таблицы.',
  'Failed to load table metadata.': 'Не удалось загрузить метаданные таблицы.',
  'Failed to load table rows.': 'Не удалось загрузить строки таблицы.',
  'Failed to locate related row.':
    'Не удалось найти связанную строку на карте.',
  'Failed to locate row.': 'Не удалось найти строку на карте.',
  'Failed to save related record.': 'Не удалось сохранить связанную запись.',
  'Failed to save table changes.': 'Не удалось сохранить изменения таблицы.',
  'Failed to save table display settings.':
    'Не удалось сохранить настройки отображения таблицы.',
  'Failed to load visible layers.': 'Не удалось загрузить видимые слои.',
  'Failed to register vector tile source.':
    'Не удалось зарегистрировать источник векторных тайлов.',
  'Failed to create feature.': 'Не удалось создать объект.',
  'Drawn geometry must be polygon.':
    'Нарисованная геометрия должна быть полигоном.',
  'Select editable polygon layer first.':
    'Сначала выберите редактируемый полигональный слой.',
  'Selected row does not have usable flow coordinates.':
    'В выбранной строке нет подходящих координат потока.',
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
      /^Native renderer heat scale replaces exported palette (.+)\.$/,
      'Цветовая шкала встроенной карты заменяет палитру экспорта $1.',
    )
    .replace(
      /^Export category sort (.+) is not reproduced; native series ordering applies\.$/,
      'Сортировка категорий $1 не перенесена; используется порядок рядов встроенной диаграммы.',
    )
    .replace(
      /^Analytics request failed \((\d+)\)$/,
      'Запрос аналитики не выполнен ($1)',
    )
    .replace(
      /^(.+) interactive chart\. Click to filter; Ctrl or Shift click to select multiple\.$/,
      '$1 — интерактивная диаграмма. Нажмите для фильтрации; Ctrl или Shift — для выбора нескольких значений.',
    )
    .replace(
      /^(.+) region map\. Click a region to filter; Ctrl or Shift click to select multiple\.$/,
      '$1 — интерактивная карта регионов. Нажмите на регион для фильтрации; Ctrl или Shift — для выбора нескольких значений.',
    )
    .replace(/^(.+) map$/, '$1 — карта')
    .replace(/\bVisible schemas(?=\s*·)/g, 'Видимые схемы')
    .replace(/^Alias for\s+(.+)$/g, 'Псевдоним для $1')
    .replace(/^Relation label for\s+(.+)$/g, 'Подпись связи для $1')
    .replace(
      /^Inspect\s+(.+)\s+related row\s+(.+)$/g,
      'Открыть связанную запись $1 $2',
    )
    .replace(/^Edit\s+(.+)$/g, 'Редактировать $1')
    .replace(/^Expand\s+(.+)$/g, 'Развернуть $1')
    .replace(/^Collapse\s+(.+)$/g, 'Свернуть $1')
    .replace(/^(.+)\s+options$/g, '$1: параметры')
    .replace(/^Record\s+·\s+/g, 'Запись · ')
    .replace(/^Related\s+·\s+/g, 'Связанные · ')
    .replace(/^(.+)\s+record inspector$/g, 'Запись $1')
    .replace(/^Delete\s+(?!layer\s+"|saved view\s+")(.+)$/g, 'Удалить $1')
    .replace(/^Locate in\s+(.+)$/g, 'Найти в слое $1')
    .replace(/^Zoom to\s+(.+)$/g, 'Показать на карте: $1')
    .replace(/\b(\d+)\s+pending\b/g, 'Несохраненных изменений: $1')
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
    .replace(/\b(\d+)\s+rows?\b/g, 'Строк: $1')
    .replace(/^New feature:\s+(.+)$/g, 'Новый объект: $1')
    .replace(/^(.+)\s+flows$/g, '$1: потоки')
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

export function translateLabel(value: string, language: AppLanguage): string {
  return language === 'ru' ? (translations[value] ?? value) : value;
}

const originalTextByNode = new WeakMap<Text, string>();
const originalAttributesByElement = new WeakMap<Element, Map<string, string>>();

function localizeNode(root: ParentNode, language: AppLanguage) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  for (const node of textNodes) {
    if (node.parentElement?.closest('[translate="no"]')) continue;
    const currentValue = node.nodeValue ?? '';
    const storedValue = originalTextByNode.get(node);
    const originalValue =
      storedValue !== undefined &&
      currentValue !== storedValue &&
      currentValue !== translateText(storedValue)
        ? currentValue
        : (storedValue ?? currentValue);
    originalTextByNode.set(node, originalValue);
    const nextValue =
      language === 'ru' ? translateText(originalValue) : originalValue;
    if (nextValue !== node.nodeValue) {
      node.nodeValue = nextValue;
    }
  }

  const attrNames = ['aria-label', 'title', 'placeholder'];
  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (element.closest('[translate="no"]')) continue;
    for (const attrName of attrNames) {
      const value = element.getAttribute(attrName);
      if (!value) {
        continue;
      }
      let originalAttributes = originalAttributesByElement.get(element);
      if (!originalAttributes) {
        originalAttributes = new Map<string, string>();
        originalAttributesByElement.set(element, originalAttributes);
      }
      const storedValue = originalAttributes.get(attrName);
      const originalValue =
        storedValue !== undefined &&
        value !== storedValue &&
        value !== translateText(storedValue)
          ? value
          : (storedValue ?? value);
      originalAttributes.set(attrName, originalValue);
      const nextValue =
        language === 'ru' ? translateText(originalValue) : originalValue;
      if (nextValue !== value) {
        element.setAttribute(attrName, nextValue);
      }
    }
  }
}

function localizeApplication(language: AppLanguage) {
  const root = document.getElementById('root');
  if (root) {
    localizeNode(root, language);
  }
  for (const portal of document.querySelectorAll('[data-portal="true"]')) {
    localizeNode(portal, language);
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
    localizeApplication(language);
    const observer = new MutationObserver(() => localizeApplication(language));
    observer.observe(document.body, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
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
