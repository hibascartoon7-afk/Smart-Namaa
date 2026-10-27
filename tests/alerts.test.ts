import { describe, it, expect } from 'vitest';
import { KIND_LABEL, alertText, sortAlerts, type AlertRow } from '../src/lib/alerts';

const row = (id: string, severity: AlertRow['severity'], created_at: string, kind: AlertRow['kind'] = 'engine'): AlertRow => ({
  id, sensor_point_id: null, kind, code: `code_${id}`, severity,
  title_en: `title ${id}`, title_ar: `عنوان ${id}`, message_en: `message ${id}`, message_ar: `رسالة ${id}`, created_at,
});

describe('sortAlerts', () => {
  it('puts action first, then warning, then info', () => {
    const sorted = sortAlerts([
      row('i', 'info', '2026-10-20T08:00:00Z'),
      row('a', 'action', '2026-10-20T09:00:00Z'),
      row('w', 'warning', '2026-10-20T07:00:00Z'),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['a', 'w', 'i']);
  });
  it('keeps the oldest first inside the same level', () => {
    const sorted = sortAlerts([row('late', 'warning', '2026-10-20T10:00:00Z'), row('early', 'warning', '2026-10-20T08:00:00Z')]);
    expect(sorted.map((x) => x.id)).toEqual(['early', 'late']);
  });
  it('does not change the array it receives and handles an empty list', () => {
    const input = [row('b', 'info', '2026-10-20T10:00:00Z'), row('a', 'action', '2026-10-20T09:00:00Z')];
    sortAlerts(input);
    expect(input.map((x) => x.id)).toEqual(['b', 'a']);
    expect(sortAlerts([])).toEqual([]);
  });
});

describe('alertText', () => {
  it('returns the Arabic or the English text, never a mix', () => {
    const a = row('1', 'info', '2026-10-20T08:00:00Z');
    expect(alertText(a, 'en')).toEqual({ title: 'title 1', message: 'message 1' });
    expect(alertText(a, 'ar')).toEqual({ title: 'عنوان 1', message: 'رسالة 1' });
  });
});

describe('KIND_LABEL', () => {
  it('has an English and an Arabic label for every kind of alert', () => {
    for (const kind of ['engine', 'savings'] as const) {
      expect(KIND_LABEL[kind].en.length).toBeGreaterThan(0);
      expect(KIND_LABEL[kind].ar.length).toBeGreaterThan(0);
    }
  });
});
