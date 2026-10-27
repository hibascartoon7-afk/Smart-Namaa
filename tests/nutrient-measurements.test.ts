// Measured N, P, K: which stored value the engine may judge, and what it says about it. Pure tests with small hand-made rows;
// the stored rows, the owner's input rules and the sensor path are tested in migrations.test.ts and pipeline.test.ts.
import { describe, it, expect } from 'vitest';
import {
  decideFertilization, describeFertilization, pickNutrientValues,
  type FertilizerRow, type NutrientMeasurement, type SufficiencyRow,
} from '../src/engine/fertilization';

const NOW = Date.parse('2026-10-21T09:00:00Z');
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const ref: SufficiencyRow[] = [
  { nutrient: 'p', unit: 'ppm (mg/kg)', lowBelow: 15, sourceId: 'S1', methodCode: 'soil_olsen_p' },
  { nutrient: 'k', unit: 'ppm (mg/kg)', lowBelow: 130, sourceId: 'S1', methodCode: 'soil_nh4oac_k' },
  { nutrient: 'p', unit: 'mg/kg', lowBelow: 20, sourceId: 'S2', methodCode: 'sensor_x' },
];
const fert: FertilizerRow[] = [
  { name: 'TSP', nPct: null, p2o5Pct: 46, k2oPct: null, sourceId: 'F' },
  { name: 'SOP', nPct: null, p2o5Pct: null, k2oPct: 50, sourceId: 'F' },
];
const lab = (nutrient: 'n' | 'p' | 'k', value: number, ageDays: number, over: Partial<NutrientMeasurement> = {}): NutrientMeasurement => ({
  nutrient, value, unit: 'ppm (mg/kg)', methodCode: nutrient === 'p' ? 'soil_olsen_p' : 'soil_nh4oac_k', sourceKind: 'lab', measuredAt: iso(NOW - ageDays * DAY), ...over,
});
const labels = { soil_olsen_p: { en: 'Soil test: Olsen phosphorus', ar: 'فحص تربة: الفسفور بطريقة أولسن' } };

describe('pickNutrientValues: which stored value the engine may judge', () => {
  it('no measurements: nothing is measured (never 0)', () => {
    const r = pickNutrientValues([], ref, NOW);
    expect(r.values).toEqual({ n: null, p: null, k: null });
    expect(r.used).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it('the NEWEST comparable value of each nutrient wins, with the limit it is compared with and its age in days', () => {
    const r = pickNutrientValues([lab('p', 30, 40), lab('p', 10, 12), lab('k', 100, 0)], ref, NOW, labels);
    expect(r.values).toEqual({ n: null, p: 10, k: 100 });
    expect(r.reference.map((x) => `${x.nutrient}:${x.methodCode}`).sort()).toEqual(['k:soil_nh4oac_k', 'p:soil_olsen_p']);
    expect(r.used.find((u) => u.nutrient === 'p')).toMatchObject({ value: 10, ageDays: 12, sourceKind: 'lab', methodLabelEn: 'Soil test: Olsen phosphorus', methodLabelAr: 'فحص تربة: الفسفور بطريقة أولسن' });
    expect(r.used.find((u) => u.nutrient === 'k')).toMatchObject({ ageDays: 0, methodLabelEn: null }); // no label stored: the code is shown
    expect(r.rejected).toEqual([]); // the older P value (30) was simply not needed
  });

  it('a value measured with a method no limit was set for is NOT judged: it is reported, and an older comparable value is used', () => {
    const sensor = lab('p', 99, 1, { methodCode: 'sensor_unknown', sourceKind: 'sensor', unit: 'mg/kg' });
    const r = pickNutrientValues([sensor, lab('p', 10, 12)], ref, NOW);
    expect(r.values.p).toBe(10);
    expect(r.rejected).toEqual([{ ...sensor, reason: 'no_limit_for_method' }]);
  });

  it('same method but another unit: not converted, not judged', () => {
    const wrong = lab('p', 0.001, 0, { unit: '%' });
    const r = pickNutrientValues([wrong], ref, NOW);
    expect(r.values.p).toBeNull();
    expect(r.rejected).toEqual([{ ...wrong, reason: 'unit_mismatch' }]);
  });

  it('method and unit are compared without case or extra spaces; a limit with no method code never matches', () => {
    const m = lab('p', 12, 3, { methodCode: ' SOIL_OLSEN_P ', unit: 'PPM  (mg/kg)' });
    expect(pickNutrientValues([m], ref, NOW).values.p).toBe(12);
    const legacy: SufficiencyRow[] = [{ nutrient: 'p', unit: 'ppm (mg/kg)', lowBelow: 15, sourceId: 'S1' }];
    const r = pickNutrientValues([lab('p', 12, 3)], legacy, NOW);
    expect(r.values.p).toBeNull();
    expect(r.rejected[0].reason).toBe('no_limit_for_method');
  });

  it('a value dated in the future, a negative one and a broken date are rejected, never used', () => {
    const future = lab('p', 5, -1); // tomorrow
    const negative = lab('k', -3, 1);
    const badDate = lab('k', 50, 0, { measuredAt: 'not a date' });
    const r = pickNutrientValues([future, negative, badDate], ref, NOW);
    expect(r.values).toEqual({ n: null, p: null, k: null });
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(['in_future', 'invalid_value', 'invalid_value']);
  });

  it('a sensor with its own limit is judged like any other value (the limit decides, not the source)', () => {
    const s = lab('p', 14, 0, { methodCode: 'sensor_x', unit: 'mg/kg', sourceKind: 'sensor' });
    const r = pickNutrientValues([s], ref, NOW);
    expect(r.values.p).toBe(14);
    expect(r.reference[0]).toMatchObject({ methodCode: 'sensor_x', lowBelow: 20, sourceId: 'S2' });
    expect(r.used[0].sourceKind).toBe('sensor');
  });
});

describe('the decision says what it is based on', () => {
  const decide = (ms: NutrientMeasurement[]) => {
    const p = pickNutrientValues(ms, ref, NOW, labels);
    return decideFertilization(p.values, p.reference, fert, { measurements: p.used, rejected: p.rejected });
  };

  it('a lab value: "Based on", the method, the lab, the age; no sensor warning', () => {
    const r = decide([lab('p', 10, 12)]);
    expect(r.status).toBe('recommend_fertilization');
    expect(r.measurements).toHaveLength(1);
    const t = describeFertilization(r);
    expect(t.en).toContain('Based on: phosphorus (P) 10 ppm (mg/kg) (Soil test: Olsen phosphorus, lab test, 12 days ago).');
    expect(t.en).not.toContain('sensor');
    expect(t.ar).toContain('بناءً على');
    expect(t.ar).toContain('قبل 12 يوماً');
  });

  it('a sensor value: the decision is given, with the warning to confirm it with a lab test (English and Arabic)', () => {
    const r = decide([lab('p', 14, 0, { methodCode: 'sensor_x', unit: 'mg/kg', sourceKind: 'sensor' })]);
    expect(r.status).toBe('recommend_fertilization');
    const t = describeFertilization(r);
    expect(t.en).toContain('sensor, not from a lab test: confirm it with a lab test before applying fertilizer');
    expect(t.ar).toContain('مجس وليست من تحليل مخبري');
    expect(t.en).toContain('today');
  });

  it('only values that no limit can judge: "measured, but not comparable" (not "not measured") and what to do', () => {
    const r = decide([lab('p', 99, 0, { methodCode: 'sensor_unspecified', unit: 'unspecified', sourceKind: 'sensor' })]);
    expect(r).toMatchObject({ status: 'insufficient_data', reason: 'measurements_not_comparable', missing: ['p'] });
    const t = describeFertilization(r);
    expect(t.en).toContain('was measured, but the stored limits cannot judge it');
    expect(t.en).toContain('sensor_unspecified');
    expect(t.en).toContain('add limits for this method with a source');
    expect(t.ar).toContain('مقاسة، لكن الحدود المخزّنة لا تستطيع الحكم عليها');
    expect(t.en).not.toContain('not measured');
  });

  it('a value that is fine: "no fertilizer needed" still says what it is based on', () => {
    const r = decide([lab('k', 200, 5)]);
    expect(r.status).toBe('no_fertilization_needed');
    expect(describeFertilization(r).en).toContain('Based on: potassium (K) 200 ppm (mg/kg)');
  });

  it('a newer value that could not be used is named, while the older usable one decides', () => {
    const r = decide([lab('p', 99, 1, { methodCode: 'sensor_unspecified', unit: 'unspecified', sourceKind: 'sensor' }), lab('p', 10, 12)]);
    expect(r.status).toBe('recommend_fertilization');
    expect(r.rejected).toHaveLength(1);
    expect(describeFertilization(r).en).toContain('Not used (a stored limit does not fit its method or unit)');
  });

  it('nothing stored: exactly the old answer ("not measured")', () => {
    const r = decide([]);
    expect(r).toMatchObject({ status: 'insufficient_data', reason: 'nutrients_not_measured', missing: ['n', 'p', 'k'] });
    expect(r.measurements).toEqual([]);
    expect(r.rejected).toBeUndefined();
  });
});
