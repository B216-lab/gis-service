import { describe, expect, test } from 'bun:test';
import { translateLabel } from '../src/features/i18n/i18n';

describe('controlled interface labels', () => {
  test('switches a controlled selection label without changing its identifier', () => {
    const option = { value: 'datetime', label: 'Date and time' };
    const russian = { ...option, label: translateLabel(option.label, 'ru') };
    expect(russian).toEqual({ value: 'datetime', label: 'Дата и время' });
    expect(translateLabel(option.label, 'en')).toBe('Date and time');
  });

  test('uses exact matches and preserves unknown names and SQL', () => {
    for (const value of [
      'Number of journeys',
      'SUM(Number)',
      'Edit customer_table',
      'metrics.total',
    ]) {
      expect(translateLabel(value, 'ru')).toBe(value);
    }
  });

  test('keeps comparison symbols unchanged in both languages', () => {
    for (const language of ['ru', 'en'] as const) {
      expect(translateLabel('≤', language)).toBe('≤');
      expect(translateLabel('≠', language)).toBe('≠');
    }
  });

  test('localizes shared map controls and boolean labels', () => {
    expect(
      translateLabel('Drag to rotate map, click to reset north', 'ru'),
    ).toBe(
      'Перетащите для поворота карты, нажмите, чтобы вернуть север наверх',
    );
    expect(translateLabel('Toggle attribution', 'ru')).toBe(
      'Показать или скрыть сведения об источниках',
    );
    expect(translateLabel('True', 'ru')).toBe('Да');
    expect(translateLabel('False', 'ru')).toBe('Нет');
  });
});
