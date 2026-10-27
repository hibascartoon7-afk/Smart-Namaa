import { describe, it, expect } from 'vitest';
import { computeEtc, resolveKc, type KcRow } from '../src/engine/kc';
import { dbRowToKcRow } from '../src/lib/kc-repository';
import { loadTable12 } from './fixtures/table12';

const { csv, db } = loadTable12();
const rows = db.map(dbRowToKcRow);
const find = (crop: string, variant: string | null = null) => {
  const r = rows.find((x) => x.crop === crop && x.variant === variant);
  if (!r) throw new Error(`row not found: ${crop} ${variant ?? ''}`);
  return r;
};
const groupOf = (r: KcRow) => rows.find((x) => x.section === r.section && x.rowType === 'group_row') ?? null;

describe('ETc = Kc x ET0 (FAO-56 Chapter 6, Eq. 58) - worked examples from the book', () => {
  it('Example 24: Kc ini 0.85, ETo 4.0 mm/day -> ETc 3.4 mm/day', () => {
    const r = computeEtc({ min: 0.85, max: 0.85 }, 4.0);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.etc.min).toBeCloseTo(3.4, 10);
  });
  it('Example 25: Kc ini 0.60, ETo 5 mm/day -> ETc 3.0 mm/day', () => {
    const r = computeEtc({ min: 0.6, max: 0.6 }, 5);
    expect(r.status === 'ok' && r.etc.max).toBeCloseTo(3.0, 10);
  });
});

describe('computeEtc never turns missing data into 0', () => {
  const kc = { min: 1.15, max: 1.15 };
  it('ET0 null/undefined -> et0_missing', () => {
    expect(computeEtc(kc, null)).toEqual({ status: 'unavailable', reason: 'et0_missing' });
    expect(computeEtc(kc, undefined)).toEqual({ status: 'unavailable', reason: 'et0_missing' });
  });
  it('ET0 NaN / negative -> et0_invalid', () => {
    expect(computeEtc(kc, Number.NaN)).toEqual({ status: 'unavailable', reason: 'et0_invalid' });
    expect(computeEtc(kc, -1)).toEqual({ status: 'unavailable', reason: 'et0_invalid' });
  });
  it('Kc null -> kc_missing', () => {
    expect(computeEtc(null, 5)).toEqual({ status: 'unavailable', reason: 'kc_missing' });
  });
  it('ET0 = 0 is a real value -> ETc = 0', () => {
    expect(computeEtc(kc, 0)).toEqual({ status: 'ok', etc: { min: 0, max: 0 } });
  });
});

describe('Tomato (Table 12 row, real data)', () => {
  const tomato = find('Tomato');
  it('Kc mid = 1.15, footnote 2 must be reviewed, ETc(ET0=5) = 5.75', () => {
    const k = resolveKc(tomato, groupOf(tomato), 'mid');
    expect(k.status).toBe('ok');
    if (k.status !== 'ok') return;
    expect(k.kc).toEqual({ min: 1.15, max: 1.15 });
    expect(k.isRange).toBe(false);
    expect(k.origin).toBe('own');
    expect(k.reviewFootnotes).toContain('2');
    const e = computeEtc(k.kc, 5);
    expect(e.status === 'ok' && e.etc.min).toBeCloseTo(5.75, 10);
  });
  it('Kc end is a RANGE 0.70-0.90 and is reported as a range (never silently one end)', () => {
    const k = resolveKc(tomato, groupOf(tomato), 'end');
    expect(k.status === 'ok' && k.isRange).toBe(true);
    if (k.status !== 'ok') return;
    expect(k.kc).toEqual({ min: 0.7, max: 0.9 });
    const e = computeEtc(k.kc, 5);
    expect(e.status === 'ok' && e.etc.min).toBeCloseTo(3.5, 10);
    expect(e.status === 'ok' && e.etc.max).toBeCloseTo(4.5, 10);
  });
  it('Kc ini cell is blank -> uses the Solanum group row (0.6), flagged approximate, footnote 1 to review', () => {
    expect(tomato.kc.ini).toBeNull();
    const k = resolveKc(tomato, groupOf(tomato), 'ini');
    expect(k.status).toBe('ok');
    if (k.status !== 'ok') return;
    expect(k.kc).toEqual({ min: 0.6, max: 0.6 });
    expect(k.origin).toBe('group_row');
    expect(k.approximate).toBe(true);
    expect(k.reviewFootnotes).toContain('1');
  });
  it('Without a group row, a blank Kc ini stays unavailable', () => {
    expect(resolveKc(tomato, null, 'ini')).toEqual({ status: 'unavailable', stage: 'ini', reason: 'not_in_table' });
  });
});

describe('Group inheritance is limited to Kc ini of the same section', () => {
  it('a group row of another section is rejected', () => {
    const tomato = find('Tomato');
    const wrong = groupOf(find('Cotton'));
    expect(resolveKc(tomato, wrong, 'ini').status).toBe('unavailable');
  });
  it('mid/end are never inherited (no rule in the source)', () => {
    const synthetic: KcRow = { ...find('Tomato'), kc: { ini: null, mid: null, end: null } };
    const group: KcRow = { ...groupOf(find('Tomato'))!, kc: { ini: { min: 0.6, max: 0.6 }, mid: { min: 1.15, max: 1.15 }, end: { min: 0.8, max: 0.8 } } };
    expect(resolveKc(synthetic, group, 'mid').status).toBe('unavailable');
    expect(resolveKc(synthetic, group, 'end').status).toBe('unavailable');
  });
  it('Fibre Crops group row has only Kc ini -> mid is unavailable for it', () => {
    const fibre = rows.find((r) => r.section === 'g. Fibre Crops' && r.rowType === 'group_row')!;
    expect(resolveKc(fibre, null, 'mid').status).toBe('unavailable');
  });
  it('Cotton: Kc end 0.70-0.50 is parsed as min 0.5 / max 0.7', () => {
    const cotton = find('Cotton');
    const k = resolveKc(cotton, groupOf(cotton), 'end');
    expect(k.status === 'ok' && k.kc).toEqual({ min: 0.5, max: 0.7 });
  });
});

describe('Table 12 data integrity (CSV = source of truth)', () => {
  it('has 134 rows with unique row_id', () => {
    expect(csv.length).toBe(134);
    expect(new Set(csv.map((r) => r.row_id)).size).toBe(134);
  });
  it('blank cell <-> NULL, and never 0', () => {
    for (const r of csv) {
      for (const k of ['kc_ini', 'kc_mid', 'kc_end', 'max_height']) {
        const raw = r[`${k}_raw`];
        const min = r[k === 'max_height' ? 'max_height_min_m' : `${k}_min`];
        expect((raw === '') === (min === ''), `${r.crop} ${k}`).toBe(true);
        if (min !== '') expect(Number(min), `${r.crop} ${k}`).toBeGreaterThan(0);
      }
    }
  });
  it('a range in *_raw means min < max, a single value means min = max', () => {
    for (const r of csv) {
      for (const k of ['kc_ini', 'kc_mid', 'kc_end']) {
        const raw = r[`${k}_raw`];
        if (raw === '') continue;
        const isRange = raw.includes('-');
        expect(Number(r[`${k}_min`]) < Number(r[`${k}_max`]), `${r.crop} ${k}`).toBe(isRange);
      }
    }
  });
  it('every footnote id used is 1..25', () => {
    const ids = csv.flatMap((r) => [r.kc_ini_footnote, r.kc_mid_footnote, r.kc_end_footnote, r.crop_name_footnotes])
      .flatMap((s) => (s ? s.split(',') : []));
    for (const id of ids) expect(Number(id)).toBeGreaterThanOrEqual(2);
    for (const id of ids) expect(Number(id)).toBeLessThanOrEqual(25);
  });
});
