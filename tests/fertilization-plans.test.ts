// Fertilizer options, dose ceilings and soil notes. Pure engine tests with small hand-made rows; the real stored rows are
// tested in migrations.test.ts and pipeline.test.ts.
import { describe, it, expect } from 'vitest';
import { decideFertilization, describeFertilization, type FertilizerRow, type RateRow, type SoilNoteRow, type SufficiencyRow } from '../src/engine/fertilization';

const ref: SufficiencyRow[] = [
  { nutrient: 'n', unit: '% leaf', lowBelow: 1.4, sourceId: 'S1' },
  { nutrient: 'k', unit: '% leaf', lowBelow: 0.4, sourceId: 'S1' },
];
const fert: FertilizerRow[] = [
  { name: 'Urea', nPct: 46, p2o5Pct: null, k2oPct: null, sourceId: 'F' },
  { name: 'Ammonium sulphate', nPct: 20, p2o5Pct: null, k2oPct: null, sourceId: 'F' },
  { name: 'Potassium sulphate (SOP)', nPct: null, p2o5Pct: null, k2oPct: 50, sourceId: 'F' },
  { name: 'Alpha K', nPct: null, p2o5Pct: null, k2oPct: 50, sourceId: 'F' },
];
const rates: RateRow[] = [
  { nutrient: 'n', minKgPerDunum: 4, maxKgPerDunum: 11, basisEn: 'b', basisAr: 'ب', sourceId: 'R' },
  { nutrient: 'k', minKgPerDunum: null, maxKgPerDunum: 20, basisEn: 'b', basisAr: 'ب', sourceId: 'R' },
];
const soilNotes: SoilNoteRow[] = [
  { fertilizerName: 'Urea', soilName: 'Sand', condition: null, rating: 'caution', noteEn: 'sandy loses more', noteAr: 'رملية', sourceId: 'U' },
  { fertilizerName: 'Urea', soilName: 'Loamy sand', condition: null, rating: 'caution', noteEn: 'sandy loses more', noteAr: 'رملية', sourceId: 'U' },
  { fertilizerName: 'Urea', soilName: 'Clay', condition: null, rating: 'better', noteEn: 'clay loses less', noteAr: 'طينية', sourceId: 'U' },
  { fertilizerName: 'Urea', soilName: null, condition: 'soil pH above 7', rating: 'caution', noteEn: 'alkaline', noteAr: 'قلوية', sourceId: 'U' },
];

describe('fertilizer options with doses', () => {
  it('lists EVERY fertilizer that carries the nutrient, highest content first, ties by name (not only the best one)', () => {
    const r = decideFertilization({ n: null, p: null, k: 0.3 }, ref, fert, { rates });
    expect(r.status).toBe('recommend_fertilization');
    if (r.status !== 'recommend_fertilization') return;
    expect(r.plans).toHaveLength(1);
    expect(r.plans[0].options.map((o) => o.name)).toEqual(['Alpha K', 'Potassium sulphate (SOP)']);
    expect(r.fertilizer?.name).toBe('Alpha K');
  });

  it('dose: the stored ceiling in kg of nutrient per dunum becomes kg of product = nutrient / (content / 100), and kg for the whole field from its area', () => {
    const r = decideFertilization({ n: 1.0, p: null, k: null }, ref, fert, { rates, areaM2: 5000 });
    if (r.status !== 'recommend_fertilization') throw new Error('expected a recommendation');
    expect(r.area).toEqual({ dunum: 5 });
    const urea = r.plans[0].options.find((o) => o.name === 'Urea')!;
    expect(urea.productKgPerDunum).toEqual({ min: 8.7, max: 23.9 }); // 4/0.46, 11/0.46
    expect(urea.productKgForField).toEqual({ min: 43.5, max: 119.6 }); // x 5 dunum
    const as = r.plans[0].options.find((o) => o.name === 'Ammonium sulphate')!;
    expect(as.productKgPerDunum).toEqual({ min: 20, max: 55 }); // 4/0.20, 11/0.20
    // the product amount never goes above the stored ceiling
    for (const o of r.plans[0].options) expect((o.productKgPerDunum!.max * o.contentPct) / 100).toBeLessThanOrEqual(11 + 0.06);
  });

  it('a compound fertilizer says which other nutrients it adds at that dose; a straight one adds none', () => {
    const compound: FertilizerRow = { name: 'NPK 10-10-20', nPct: 10, p2o5Pct: 10, k2oPct: 20, sourceId: 'F' };
    const r = decideFertilization({ n: null, p: null, k: 0.3 }, ref, [...fert, compound], { rates });
    if (r.status !== 'recommend_fertilization') throw new Error('expected a recommendation');
    const npk = r.plans[0].options.find((o) => o.name === 'NPK 10-10-20')!;
    expect(npk.productKgPerDunum).toEqual({ min: null, max: 100 }); // 20 kg K2O / 0.20
    expect(npk.alsoSupplies).toEqual([{ nutrient: 'n', kgPerDunum: 10 }, { nutrient: 'p', kgPerDunum: 10 }]);
    expect(r.plans[0].options.find((o) => o.name === 'Alpha K')!.alsoSupplies).toEqual([]);
  });

  it('a dose with only a ceiling has min null; without the field area there is no whole-field amount', () => {
    const r = decideFertilization({ n: null, p: null, k: 0.3 }, ref, fert, { rates });
    if (r.status !== 'recommend_fertilization') throw new Error('expected a recommendation');
    expect(r.area).toBeNull();
    expect(r.plans[0].options[0].productKgPerDunum).toEqual({ min: null, max: 40 });
    expect(r.plans[0].options[0].productKgForField).toBeNull();
  });

  it('no stored dose for the crop and nutrient: no amount at all (nothing is guessed), and the text says so', () => {
    const r = decideFertilization({ n: 1.0, p: null, k: null }, ref, fert, { rates: [rates[1]], areaM2: 1000 });
    if (r.status !== 'recommend_fertilization') throw new Error('expected a recommendation');
    expect(r.plans[0].dose).toBeNull();
    expect(r.plans[0].options.every((o) => o.productKgPerDunum === null && o.productKgForField === null)).toBe(true);
    expect(describeFertilization(r).en).toContain('No sourced dose is stored');
    expect(describeFertilization(r).ar).toContain('لا توجد جرعة مرجعية');
  });

  it('without any context the old answer is unchanged (same fields, no dose)', () => {
    const r = decideFertilization({ n: null, p: null, k: 0.3 }, ref, fert);
    if (r.status !== 'recommend_fertilization') throw new Error('expected a recommendation');
    expect(r.fertilizer).toMatchObject({ name: 'Alpha K', contentPct: 50 });
    expect(r.plans[0].dose).toBeNull();
  });

  it('two nutrients short: one plan each, the largest relative shortage first', () => {
    const r = decideFertilization({ n: 1.3, p: null, k: 0.1 }, ref, fert, { rates });
    if (r.status !== 'recommend_fertilization') throw new Error('expected a recommendation');
    expect(r.plans.map((p) => p.nutrient)).toEqual(['k', 'n']); // K is 75 % short, N about 7 %
  });

  it('the text gives the dose ceiling, says it is a ceiling and not a target, in English and Arabic', () => {
    const d = describeFertilization(decideFertilization({ n: 1.0, p: null, k: null }, ref, fert, { rates, areaM2: 1000 }));
    expect(d.en).toContain('Reference dose ceiling');
    expect(d.en).toContain('4 to 11 kg per dunum');
    expect(d.en).toContain('Urea');
    expect(d.en).toContain('not a target');
    expect(d.ar).toContain('السقف المرجعي');
    expect(d.ar).toContain('وليس هدفاً');
  });
});

describe('soil notes on the options', () => {
  it('groups the soils that share a note, and shows the note of the soil of THIS field', () => {
    const r = decideFertilization({ n: 1.0, p: null, k: null }, ref, fert, { rates, soilNotes, fieldSoilName: 'loamy sand ' });
    if (r.status !== 'recommend_fertilization') throw new Error('expected a recommendation');
    const urea = r.plans[0].options.find((o) => o.name === 'Urea')!;
    const caution = urea.soilNotes.find((g) => g.rating === 'caution' && g.soils.length > 0)!;
    expect(caution.soils.sort()).toEqual(['Loamy sand', 'Sand']);
    expect(urea.soilNotes.find((g) => g.rating === 'better')!.soils).toEqual(['Clay']);
    expect(urea.soilNotes.find((g) => g.condition === 'soil pH above 7')).toBeTruthy();
    expect(urea.fieldSoil).toMatchObject({ rating: 'caution', sourceId: 'U' });
  });

  it('a fertilizer or soil with no note has none: "no information" is never turned into "suitable"', () => {
    const r = decideFertilization({ n: 1.0, p: null, k: null }, ref, fert, { rates, soilNotes, fieldSoilName: 'Loam' });
    if (r.status !== 'recommend_fertilization') throw new Error('expected a recommendation');
    const urea = r.plans[0].options.find((o) => o.name === 'Urea')!;
    expect(urea.fieldSoil).toBeNull(); // Loam is not classified
    expect(r.plans[0].options.find((o) => o.name === 'Ammonium sulphate')!.soilNotes).toEqual([]);
  });
});

describe('what the screen shows (frontend view of the stored decision)', () => {
  it('the stored JSON of the real engine result becomes plain lines in English and Arabic: dose, amounts, "also adds", the field soil note, the source', async () => {
    const { fertilizationView } = await import('../namaa-agritech/src/lib/fertilization-view');
    const result = decideFertilization({ n: 1.0, p: null, k: null }, ref, fert, { rates, soilNotes, fieldSoilName: 'Sand', areaM2: 5000 });
    const text = describeFertilization(result);
    const stored = JSON.parse(JSON.stringify({ status: result.status, text_en: text.en, text_ar: text.ar, result }));
    const en = fertilizationView(stored, 'en');
    expect(en.plans).toHaveLength(1);
    expect(en.plans[0].nutrient).toBe('Nitrogen (N)');
    expect(en.plans[0].dose).toBe('Reference ceiling for the whole season: 4 to 11 kg N per dunum');
    const urea = en.plans[0].options[0];
    expect(urea).toMatchObject({ name: 'Urea', content: '46% N', amount: '8.7 to 23.9 kg per dunum', fieldAmount: '43.5 to 119.6 kg for your field', source: 'F' });
    expect(urea.fieldSoil).toMatchObject({ label: 'Caution', tone: 'caution' });
    expect(urea.soilLines.map((l) => l.label).sort()).toEqual(['Caution', 'Caution', 'Suits better']);
    expect(en.disclaimer).toContain('not a prescription');
    const ar = fertilizationView(stored, 'ar');
    expect(ar.plans[0].options[0].amount).toBe('من 8.7 إلى 23.9 كغ للدونم');
    expect(ar.plans[0].options[0].fieldSoil!.label).toBe('انتبهي');
    expect(ar.disclaimer).toContain('وصفة');
  });

  it('nothing to show when the decision is not a recommendation (no plans, no disclaimer)', async () => {
    const { fertilizationView } = await import('../namaa-agritech/src/lib/fertilization-view');
    const v = fertilizationView({ status: 'insufficient_data', text_en: 'Fertilizer need cannot be determined', text_ar: 'x', result: { status: 'insufficient_data' } }, 'en');
    expect(v.plans).toEqual([]);
    expect(v.disclaimer).toBeNull();
    expect(v.summary).toBe('Fertilizer need cannot be determined');
    expect(fertilizationView(null, 'en')).toEqual({ summary: null, plans: [], disclaimer: null });
  });
});
