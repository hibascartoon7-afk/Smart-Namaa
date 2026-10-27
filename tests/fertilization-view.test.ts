import { describe, it, expect } from 'vitest';
import { fertilizationView, type StoredFertilization } from '../src/lib/fertilization-view';

const stored: StoredFertilization = {
  status: 'recommend_fertilization',
  text_en: 'The crop needs potassium (K).',
  text_ar: 'النبتة تحتاج البوتاسيوم (K).',
  result: {
    status: 'recommend_fertilization',
    plans: [{
      nutrient: 'k',
      dose: { minKgPerDunum: null, maxKgPerDunum: 22.42, basisEn: 'UC IPM: up to 200 lb K2O/acre', basisAr: 'مرجع UC IPM', sourceId: 'UCIPM_TOMATO_SOIL' },
      options: [
        { name: 'Potassium sulphate (SOP)', contentPct: 50, sourceId: 'FAO_FERT_SPECS', productKgPerDunum: { min: null, max: 44.8 }, productKgForField: { min: null, max: 44.8 },
          alsoSupplies: [], soilNotes: [{ rating: 'better', soils: ['Sand', 'Sandy loam'], condition: null, noteEn: 'Safer than potassium chloride.', noteAr: 'أأمن.', sourceId: 'CDFA_OLIVE_LEAF' }],
          fieldSoil: { rating: 'better', noteEn: 'Safer than potassium chloride.', noteAr: 'أأمن.', sourceId: 'CDFA_OLIVE_LEAF' } },
        { name: 'NPK 19-19-19', contentPct: 19, sourceId: 'FAO_FERT_SPECS', productKgPerDunum: { min: null, max: 118 }, productKgForField: null,
          alsoSupplies: [{ nutrient: 'n', kgPerDunum: 22.4 }, { nutrient: 'p', kgPerDunum: 22.4 }], soilNotes: [], fieldSoil: null },
      ],
    }],
  },
};

describe('fertilization view', () => {
  it('turns the stored decision into lines: ceiling, amounts, what a compound product also adds, soil notes, source', () => {
    const v = fertilizationView(stored, 'en');
    expect(v.summary).toBe('The crop needs potassium (K).');
    expect(v.plans[0].dose).toBe('Reference ceiling for the whole season: up to 22.42 kg K₂O per dunum');
    expect(v.plans[0].options[0]).toMatchObject({ name: 'Potassium sulphate (SOP)', content: '50% K₂O', amount: 'up to 44.8 kg per dunum', fieldAmount: 'up to 44.8 kg for your field', also: null });
    expect(v.plans[0].options[0].fieldSoil).toMatchObject({ label: 'Suits better', tone: 'better' });
    expect(v.plans[0].options[0].soilLines[0]).toMatchObject({ soils: 'Sand, Sandy loam', label: 'Suits better' });
    expect(v.plans[0].options[1].also).toBe('Also adds: 22.4 kg N, 22.4 kg P₂O₅');
    expect(v.plans[0].options[1].fieldAmount).toBeNull();
    expect(v.plans[0].options[1].soilLines).toEqual([]);
  });

  it('Arabic', () => {
    const v = fertilizationView(stored, 'ar');
    expect(v.plans[0].nutrient).toBe('البوتاسيوم (K)');
    expect(v.plans[0].options[0].amount).toBe('حتى 44.8 كغ للدونم');
    expect(v.plans[0].options[1].also).toBe('يضيف أيضاً: 22.4 كغ N، 22.4 كغ P₂O₅');
    expect(v.disclaimer).toContain('وصفة');
  });

  it('no plans and no disclaimer when the decision is not a recommendation or is empty', () => {
    expect(fertilizationView({ status: 'insufficient_data', text_en: 'not measured', result: { status: 'insufficient_data' } }, 'en')).toEqual({ summary: 'not measured', plans: [], disclaimer: null });
    expect(fertilizationView(null, 'ar')).toEqual({ summary: null, plans: [], disclaimer: null });
  });
});
