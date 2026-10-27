import { describe, it, expect } from 'vitest';
import { entryOptions, parseNumber, validateEntry, insertRow, isJudgeable, measurementLines, type LimitRow, type MethodRow, type MeasurementRow } from '../src/lib/nutrient-entry';

const limits: LimitRow[] = [
  { nutrient: 'k', unit: 'ppm (mg/kg)', low_below: '130', method_code: 'soil_nh4oac_k', source_id: 'UCIPM_TOMATO_SOIL' },
  { nutrient: 'p', unit: 'ppm (mg/kg)', low_below: 15, method_code: 'soil_olsen_p', source_id: 'UCIPM_TOMATO_SOIL' },
];
const methods: MethodRow[] = [
  { code: 'soil_olsen_p', label_en: 'Soil test: Olsen phosphorus', label_ar: 'فحص تربة: الفسفور بطريقة أولسن' },
  { code: 'soil_nh4oac_k', label_en: 'Soil test: ammonium-acetate potassium', label_ar: 'فحص تربة: البوتاسيوم بخلات الأمونيوم' },
];
const TODAY = '2026-10-24';

describe('which tests can be entered', () => {
  it('one per stored limit, ordered N, P, K, with the method name and the unit; a limit comes back as a number', () => {
    const o = entryOptions(limits, methods, 'en');
    expect(o.map((x) => x.key)).toEqual(['p|soil_olsen_p', 'k|soil_nh4oac_k']);
    expect(o[0].label).toBe('Phosphorus (P) · Soil test: Olsen phosphorus (ppm (mg/kg))');
    expect(o[1].lowBelow).toBe(130);
    expect(entryOptions(limits, methods, 'ar')[0].label).toContain('فحص تربة: الفسفور بطريقة أولسن');
  });
  it('a method with no stored name shows its code; a crop with no limits has nothing to enter', () => {
    expect(entryOptions([{ ...limits[1], method_code: 'sensor_x' }], methods, 'en')[0].label).toContain('sensor_x');
    expect(entryOptions([], methods, 'en')).toEqual([]);
  });
});

describe('reading the number typed by the owner', () => {
  it('accepts . , and Arabic digits; refuses everything else', () => {
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('١٢٫٥')).toBe(12.5);
    expect(parseNumber('۱۲.۵')).toBe(12.5);
    expect(parseNumber(' 7 ')).toBe(7);
    expect(parseNumber('0')).toBe(0);
    for (const bad of ['', ' ', 'abc', '-3', '1e3', '1.2.3', '12 ppm', '.5', 'NaN', 'Infinity']) expect(parseNumber(bad), bad).toBeNull();
  });
});

describe('checking an entry before it is sent', () => {
  const option = entryOptions(limits, methods, 'en')[0];
  it('a valid entry: the value and the date as noon UTC (no time zone can move it to another day)', () => {
    expect(validateEntry({ option, valueText: '10', date: '2026-10-12', today: TODAY })).toEqual({ ok: true, value: 10, measuredAt: '2026-10-12T12:00:00Z' });
    expect(validateEntry({ option, valueText: '10', date: TODAY, today: TODAY })).toMatchObject({ ok: true }); // today is allowed
  });
  it('says what is wrong: no test chosen, bad value, bad date, future date, long note', () => {
    expect(validateEntry({ option: undefined, valueText: '10', date: TODAY, today: TODAY })).toEqual({ ok: false, error: 'choose_test' });
    expect(validateEntry({ option, valueText: 'ten', date: TODAY, today: TODAY })).toEqual({ ok: false, error: 'value' });
    expect(validateEntry({ option, valueText: '-1', date: TODAY, today: TODAY })).toEqual({ ok: false, error: 'value' });
    expect(validateEntry({ option, valueText: '10', date: '2026-13-40', today: TODAY })).toEqual({ ok: false, error: 'date' });
    expect(validateEntry({ option, valueText: '10', date: '', today: TODAY })).toEqual({ ok: false, error: 'date' });
    expect(validateEntry({ option, valueText: '10', date: '2026-10-25', today: TODAY })).toEqual({ ok: false, error: 'future' });
    expect(validateEntry({ option, valueText: '10', date: TODAY, today: TODAY, note: 'x'.repeat(301) })).toEqual({ ok: false, error: 'note' });
  });
  it('the row sent to the database is always a lab result, with the unit and method of the chosen limit', () => {
    expect(insertRow('f1', option, 10, '2026-10-12T12:00:00Z', '  composite sample  ')).toEqual({
      field_id: 'f1', nutrient: 'p', value: 10, unit: 'ppm (mg/kg)', method_code: 'soil_olsen_p', source_kind: 'lab', measured_at: '2026-10-12T12:00:00Z', note: 'composite sample',
    });
    expect(insertRow('f1', option, 10, '2026-10-12T12:00:00Z', '   ').note).toBeNull();
    expect(insertRow('f1', option, 10, '2026-10-12T12:00:00Z', undefined).note).toBeNull();
  });
});

describe('the stored results on the screen', () => {
  const rows: MeasurementRow[] = [
    { id: '1', nutrient: 'p', value: '10.0000', unit: 'PPM (mg/kg)', method_code: ' Soil_Olsen_P ', source_kind: 'lab', measured_at: '2026-10-12T12:00:00+00:00', note: 'composite' },
    { id: '2', nutrient: 'n', value: 14.12345, unit: 'unspecified', method_code: 'sensor_unspecified', source_kind: 'sensor', measured_at: '2026-10-24T08:00:00Z', note: null },
  ];
  it('says whether the engine can judge each one (same nutrient, method and unit as a stored limit, ignoring case and spaces)', () => {
    expect(isJudgeable(rows[0], limits)).toBe(true);
    expect(isJudgeable(rows[1], limits)).toBe(false);
    expect(isJudgeable({ ...rows[0], unit: '%' }, limits)).toBe(false);
  });
  it('lines: a lab result can be removed, what a sensor sent cannot; values are rounded to 3 decimals; labels follow the language', () => {
    const en = measurementLines(rows, limits, methods, 'en');
    expect(en[0]).toMatchObject({ nutrient: 'Phosphorus (P)', value: '10 PPM (mg/kg)', source: 'lab test', date: '2026-10-12', judged: true, deletable: true, note: 'composite' });
    expect(en[1]).toMatchObject({ value: '14.123 unspecified', source: 'sensor', judged: false, deletable: false });
    expect(measurementLines(rows, limits, methods, 'ar')[1].source).toBe('مجس');
  });
});
