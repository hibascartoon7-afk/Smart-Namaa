import { describe, it, expect } from 'vitest';
import { resolveCropKcToday, stageAndKc } from '../src/engine/kc-curve';
import { dbRowToKcRow } from '../src/lib/kc-repository';
import { loadTable12 } from './fixtures/table12';

// Test inputs (stage lengths are an example, not stored data): ini 30, dev 40, mid 45, late 30 days.
const L = { initialDays: 30, developmentDays: 40, midDays: 45, lateDays: 30 };
const K = { ini: { min: 0.6, max: 0.6 }, mid: { min: 1.15, max: 1.15 }, end: { min: 0.7, max: 0.9 } };

describe('Kc curve (FAO-56 Chapter 6, Eq. 66)', () => {
  it('initial stage is constant Kc ini', () => {
    expect(stageAndKc(1, L, K)).toEqual({ stage: 'initial', kc: K.ini });
    expect(stageAndKc(30, L, K)?.stage).toBe('initial');
  });
  it('development: linear from Kc ini to Kc mid', () => {
    const d31 = stageAndKc(31, L, K)!;
    expect(d31.stage).toBe('development');
    expect(d31.kc.min).toBeCloseTo(0.6 + (1 / 40) * 0.55, 10);
    const d70 = stageAndKc(70, L, K)!;
    expect(d70.stage).toBe('development');
    expect(d70.kc.min).toBeCloseTo(1.15, 10);
  });
  it('mid is constant Kc mid', () => {
    expect(stageAndKc(71, L, K)).toEqual({ stage: 'mid', kc: K.mid });
    expect(stageAndKc(115, L, K)?.stage).toBe('mid');
  });
  it('late: linear from Kc mid to Kc end, for both ends of a range', () => {
    const d116 = stageAndKc(116, L, K)!;
    expect(d116.stage).toBe('late');
    expect(d116.kc.min).toBeCloseTo(1.15 + (0.7 - 1.15) / 30, 10);
    expect(d116.kc.max).toBeCloseTo(1.15 + (0.9 - 1.15) / 30, 10);
    const d145 = stageAndKc(145, L, K)!;
    expect(d145.kc.min).toBeCloseTo(0.7, 10);
    expect(d145.kc.max).toBeCloseTo(0.9, 10);
  });
  it('after the last stage the cycle has ended (no guess)', () => {
    expect(stageAndKc(146, L, K)).toBeNull();
  });
});

describe('resolveCropKcToday with the real Table 12 tomato row', () => {
  const rows = loadTable12().db.map(dbRowToKcRow);
  const tomato = rows.find((r) => r.crop === 'Tomato')!;
  const group = rows.find((r) => r.rowType === 'group_row' && r.section === tomato.section)!;
  const now = Date.parse('2026-10-21T09:00:00Z');
  const base = { kcRow: tomato, kcGroupRow: group, lengths: L, nowMs: now, timeZone: 'Asia/Hebron' };

  it('day 80 of the season is mid-season: Kc mid 1.15', () => {
    // 2026-10-21 minus 79 days = 2026-08-03 (planting day is day 1)
    const r = resolveCropKcToday({ ...base, plantingDate: '2026-08-03' });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.dayOfSeason).toBe(80);
      expect(r.stage).toBe('mid');
      expect(r.kc.min).toBeCloseTo(1.15, 10);
    }
  });
  it('early days use Kc ini from the group row (Table 12 gives no own value for tomato)', () => {
    const r = resolveCropKcToday({ ...base, plantingDate: '2026-10-21' });
    expect(r.status === 'ok' && r.stage).toBe('initial');
    expect(r.status === 'ok' && r.kc.min).toBeCloseTo(0.6, 10);
    expect(r.status === 'ok' && r.kcIniApproximate).toBe(true);
  });
  it('says why it cannot answer', () => {
    const why = (over: object) => {
      const r = resolveCropKcToday({ ...base, plantingDate: '2026-08-03', ...over });
      return r.status === 'unavailable' ? r.reason : 'ok';
    };
    expect(why({ plantingDate: null })).toBe('planting_date_missing');
    expect(why({ plantingDate: '2026-02-30' })).toBe('planting_date_invalid');
    expect(why({ plantingDate: '2026-12-01' })).toBe('planting_in_future');
    expect(why({ lengths: null })).toBe('stage_lengths_missing');
    expect(why({ lengths: { ...L, developmentDays: 0 } })).toBe('stage_lengths_invalid');
    expect(why({ kcRow: null })).toBe('kc_row_missing');
    expect(why({ timeZone: 'Mars/Base' })).toBe('invalid_time_zone');
    expect(why({ plantingDate: '2026-01-01' })).toBe('cycle_ended');
  });
});
