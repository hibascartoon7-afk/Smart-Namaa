// Turns the stored fertilization decision (decisions.fertilization_decision, written by the decision engine) into
// plain lines for the screen. Nothing is calculated here: every number and note was stored by the engine with its source.

export type Lang = 'en' | 'ar';
type Nutrient = 'n' | 'p' | 'k';

interface StoredSoilNote { rating: 'better' | 'caution'; soils: string[]; condition: string | null; noteEn: string; noteAr: string; sourceId: string }
interface StoredOption {
  name: string;
  contentPct: number;
  sourceId: string;
  productKgPerDunum: { min: number | null; max: number } | null;
  productKgForField: { min: number | null; max: number } | null;
  alsoSupplies?: { nutrient: Nutrient; kgPerDunum: number }[];
  soilNotes?: StoredSoilNote[];
  fieldSoil?: { rating: 'better' | 'caution'; noteEn: string; noteAr: string; sourceId: string } | null;
}
interface StoredPlan {
  nutrient: Nutrient;
  dose: { minKgPerDunum: number | null; maxKgPerDunum: number; basisEn: string; basisAr: string; sourceId: string } | null;
  options: StoredOption[];
}
export interface StoredFertilization {
  status?: string;
  text_en?: string;
  text_ar?: string;
  result?: { status?: string; plans?: StoredPlan[] } | null;
}

export interface OptionView {
  name: string;
  content: string;
  amount: string | null;
  fieldAmount: string | null;
  also: string | null;
  fieldSoil: { label: string; text: string; tone: 'better' | 'caution' } | null;
  soilLines: { label: string; tone: 'better' | 'caution'; soils: string; text: string }[];
  source: string;
}
export interface PlanView {
  nutrient: string;
  dose: string | null;
  doseBasis: string | null;
  options: OptionView[];
}
export interface FertilizationView {
  summary: string | null;
  plans: PlanView[];
  disclaimer: string | null;
}

const NUTRIENT: Record<Nutrient, { en: string; ar: string; short: string }> = {
  n: { en: 'Nitrogen (N)', ar: 'النيتروجين (N)', short: 'N' },
  p: { en: 'Phosphorus (P)', ar: 'الفسفور (P)', short: 'P₂O₅' },
  k: { en: 'Potassium (K)', ar: 'البوتاسيوم (K)', short: 'K₂O' },
};
const RATING: Record<'better' | 'caution', { en: string; ar: string }> = {
  better: { en: 'Suits better', ar: 'يناسب أكثر' },
  caution: { en: 'Caution', ar: 'انتبهي' },
};

const range = (r: { min: number | null; max: number }, lang: Lang) =>
  r.min !== null ? (lang === 'ar' ? `من ${r.min} إلى ${r.max}` : `${r.min} to ${r.max}`) : lang === 'ar' ? `حتى ${r.max}` : `up to ${r.max}`;

export function fertilizationView(f: StoredFertilization | null | undefined, lang: Lang): FertilizationView {
  const summary = (lang === 'ar' ? f?.text_ar : f?.text_en) ?? null;
  const plans = f?.result?.status === 'recommend_fertilization' ? f.result.plans ?? [] : [];
  const views: PlanView[] = plans.map((p) => ({
    nutrient: NUTRIENT[p.nutrient][lang],
    dose: p.dose
      ? lang === 'ar'
        ? `السقف المرجعي لكامل الموسم: ${range({ min: p.dose.minKgPerDunum, max: p.dose.maxKgPerDunum }, lang)} كغ ${NUTRIENT[p.nutrient].short} للدونم`
        : `Reference ceiling for the whole season: ${range({ min: p.dose.minKgPerDunum, max: p.dose.maxKgPerDunum }, lang)} kg ${NUTRIENT[p.nutrient].short} per dunum`
      : null,
    doseBasis: p.dose ? (lang === 'ar' ? p.dose.basisAr : p.dose.basisEn) : null,
    options: p.options.map((o) => ({
      name: o.name,
      content: lang === 'ar' ? `${o.contentPct}% ${NUTRIENT[p.nutrient].short}` : `${o.contentPct}% ${NUTRIENT[p.nutrient].short}`,
      amount: o.productKgPerDunum ? (lang === 'ar' ? `${range(o.productKgPerDunum, lang)} كغ للدونم` : `${range(o.productKgPerDunum, lang)} kg per dunum`) : null,
      fieldAmount: o.productKgForField ? (lang === 'ar' ? `${range(o.productKgForField, lang)} كغ لحقلك` : `${range(o.productKgForField, lang)} kg for your field`) : null,
      also: o.alsoSupplies && o.alsoSupplies.length > 0
        ? (lang === 'ar' ? 'يضيف أيضاً: ' : 'Also adds: ') + o.alsoSupplies.map((a) => `${a.kgPerDunum} ${lang === 'ar' ? 'كغ' : 'kg'} ${NUTRIENT[a.nutrient].short}`).join(lang === 'ar' ? '، ' : ', ')
        : null,
      fieldSoil: o.fieldSoil ? { label: RATING[o.fieldSoil.rating][lang], tone: o.fieldSoil.rating, text: lang === 'ar' ? o.fieldSoil.noteAr : o.fieldSoil.noteEn } : null,
      soilLines: (o.soilNotes ?? []).map((g) => ({
        label: RATING[g.rating][lang],
        tone: g.rating,
        soils: g.soils.length > 0 ? g.soils.join(lang === 'ar' ? '، ' : ', ') : g.condition ?? '',
        text: lang === 'ar' ? g.noteAr : g.noteEn,
      })),
      source: o.sourceId,
    })),
  }));
  return {
    summary,
    plans: views,
    disclaimer: views.length > 0
      ? lang === 'ar'
        ? 'الكميات أرقام مرجعية من مصادر (غالباً كاليفورنيا) وسقف أقصى وليست وصفة: لا تتجاوزيها ووزّعيها على دفعات، وراجعي مهندساً زراعياً قبل التطبيق.'
        : 'Amounts are reference ceilings from published sources (mostly California), not a prescription: do not exceed them, split them over several applications and check with an agronomist before applying.'
      : null,
  };
}
