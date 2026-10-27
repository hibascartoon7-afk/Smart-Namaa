import { describe, it, expect } from 'vitest';
import { dailyEt0FromHourly, type HourlyEt0 } from '../src/engine/et0';
import { computeEtc, resolveKc } from '../src/engine/kc';
import { dbRowToKcRow } from '../src/lib/kc-repository';
import { loadTable12 } from './fixtures/table12';

// Test data is generated here and is never stored or shown anywhere.
const H = 3_600_000;
const series = (startIso: string, hours: number, value: (i: number) => number | null): HourlyEt0[] =>
  Array.from({ length: hours }, (_, i) => ({
    observedAt: new Date(Date.parse(startIso) + i * H).toISOString(),
    et0Mm: value(i),
  }));

describe('dailyEt0FromHourly (formula F-002)', () => {
  it('sums the 24 hourly values of the local day (time zone without DST)', () => {
    // Asia/Tokyo is UTC+9: local 2026-06-10 00:00 = 2026-06-09T15:00Z. Three days of hourly data around it.
    const rows = series('2026-06-08T00:00:00Z', 72, (i) => (i % 2 === 0 ? 0.1 : 0.3));
    const r = dailyEt0FromHourly(rows, '2026-06-10', 'Asia/Tokyo');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.hours).toBe(24);
    expect(r.et0MmPerDay).toBeCloseTo(4.8, 10); // 12 x 0.1 + 12 x 0.3
  });

  it('a real 0 (night hour) is a value, not missing data', () => {
    const rows = series('2026-06-09T15:00:00Z', 24, (i) => (i >= 6 && i <= 18 ? 0.4 : 0));
    const r = dailyEt0FromHourly(rows, '2026-06-10', 'Asia/Tokyo');
    expect(r.status === 'ok' && r.et0MmPerDay).toBeCloseTo(13 * 0.4, 10);
  });

  it('never returns a partial sum: a missing hour -> unavailable', () => {
    const rows = series('2026-06-09T15:00:00Z', 24, () => 0.2).filter((_, i) => i !== 10);
    expect(dailyEt0FromHourly(rows, '2026-06-10', 'Asia/Tokyo')).toEqual({
      status: 'unavailable', localDay: '2026-06-10', reason: 'missing_hours',
    });
  });

  it('a day that starts late or ends early is incomplete', () => {
    const late = series('2026-06-09T20:00:00Z', 19, () => 0.2); // local 05:00 -> 23:00
    expect(dailyEt0FromHourly(late, '2026-06-10', 'Asia/Tokyo')).toMatchObject({ reason: 'missing_hours' });
    const early = series('2026-06-09T15:00:00Z', 12, () => 0.2); // local 00:00 -> 11:00
    expect(dailyEt0FromHourly(early, '2026-06-10', 'Asia/Tokyo')).toMatchObject({ reason: 'missing_hours' });
  });

  it('a NULL hour -> unavailable (null_values), never counted as 0', () => {
    const rows = series('2026-06-09T15:00:00Z', 24, (i) => (i === 7 ? null : 0.2));
    expect(dailyEt0FromHourly(rows, '2026-06-10', 'Asia/Tokyo')).toMatchObject({
      status: 'unavailable', reason: 'null_values',
    });
  });

  it('no rows for that local day -> no_data', () => {
    const rows = series('2026-06-09T15:00:00Z', 24, () => 0.2);
    expect(dailyEt0FromHourly(rows, '2026-06-20', 'Asia/Tokyo')).toMatchObject({ reason: 'no_data' });
  });

  it('invalid time zone -> invalid_timezone', () => {
    expect(dailyEt0FromHourly([], '2026-06-10', 'Not/AZone')).toMatchObject({ reason: 'invalid_timezone' });
  });

  it('daylight-saving change days have 23 or 25 hours and are still complete days', () => {
    // Europe/Berlin: 2026-03-29 has 23 hours (clocks forward), 2026-10-25 has 25 hours (clocks back).
    const spring = series('2026-03-28T00:00:00Z', 72, () => 0.1);
    const s = dailyEt0FromHourly(spring, '2026-03-29', 'Europe/Berlin');
    expect(s.status === 'ok' && s.hours).toBe(23);
    const autumn = series('2026-10-24T00:00:00Z', 72, () => 0.1);
    const a = dailyEt0FromHourly(autumn, '2026-10-25', 'Europe/Berlin');
    expect(a.status === 'ok' && a.hours).toBe(25);
    expect(a.status === 'ok' && a.et0MmPerDay).toBeCloseTo(2.5, 10);
  });
});

describe('ET0 (F-002) feeds ETc = Kc x ET0 (F-001)', () => {
  it('tomato Kc mid 1.15 with a daily ET0 of 2.70 mm/day -> ETc 3.105 mm/day', () => {
    // 2.70 mm/day = the first live weather-sync run for the project's test field (arithmetic example only).
    const rows = loadTable12().db.map(dbRowToKcRow);
    const tomato = rows.find((r) => r.crop === 'Tomato' && r.variant === null)!;
    const kc = resolveKc(tomato, null, 'mid');
    expect(kc.status).toBe('ok');
    if (kc.status !== 'ok') return;
    const etc = computeEtc(kc.kc, 2.7);
    expect(etc.status === 'ok' && etc.etc.min).toBeCloseTo(3.105, 10);
    expect(etc.status === 'ok' && etc.etc.max).toBeCloseTo(3.105, 10);
  });
});
