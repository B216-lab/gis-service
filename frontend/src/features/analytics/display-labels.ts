import { translateLabel } from '../i18n/i18n';

const operators: Record<string, [string, string]> = {
  eq: ['=', '='],
  ne: ['≠', '≠'],
  lt: ['<', '<'],
  le: ['≤', '≤'],
  lte: ['≤', '≤'],
  gt: ['>', '>'],
  ge: ['≥', '≥'],
  gte: ['≥', '≥'],
  in: ['In list', 'в списке'],
  not_in: ['Not in list', 'не в списке'],
  between: ['Between', 'в диапазоне'],
  contains: ['Contains', 'содержит'],
  is_null: ['Is empty', 'не задано'],
  is_not_null: ['Is not empty', 'задано'],
  last_months: ['Last months', 'за последние месяцы'],
};
export function operatorLabel(
  code: string,
  language: 'en' | 'ru' = 'en',
): string {
  return operators[code]?.[language === 'ru' ? 1 : 0] || '—';
}
export function operatorOptions(codes: string[], language: 'en' | 'ru' = 'en') {
  return codes.map((value) => ({
    value,
    label: operatorLabel(value, language),
  }));
}
const enums: Record<string, string> = {
  string: 'Text',
  text: 'Text',
  varchar: 'Text',
  number: 'Number',
  numeric: 'Number',
  float4: 'Number',
  float8: 'Number',
  integer: 'Integer',
  int2: 'Integer',
  int4: 'Integer',
  int8: 'Integer',
  boolean: 'Boolean',
  bool: 'Boolean',
  date: 'Date',
  timestamp: 'Date and time',
  timestamptz: 'Date and time',
  dimension: 'Dimension',
  time: 'Time',
  latitude: 'Latitude',
  longitude: 'Longitude',
  identifier: 'Identifier',
  'many-to-one': 'Many to one',
  'one-to-many': 'One to many',
  'one-to-one': 'One to one',
  hour: 'Hour',
  day: 'Day',
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
  hour_of_day: 'Hour of day',
  day_of_week: 'Day of week',
  LEFT: 'Left join',
  INNER: 'Inner join',
};
export function enumLabel(value: string): string {
  return (
    enums[value] ||
    value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ')
  );
}
export function enumOptions(values: string[], language: 'en' | 'ru' = 'en') {
  return values.map((value) => ({
    value,
    label: translateLabel(enumLabel(value), language),
  }));
}

export function localizedOptions(
  options: { value: string; label: string }[],
  language: 'en' | 'ru',
) {
  return options.map((option) => ({
    ...option,
    label: translateLabel(option.label, language),
  }));
}
