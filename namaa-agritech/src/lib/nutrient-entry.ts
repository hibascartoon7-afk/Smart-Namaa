// Entering and listing the measured N, P, K of an environment (a lab result typed by the owner; NPK sensor values arrive by the ingest).
// Pure helpers, no React. The same matching rule as the engine (src/engine/fertilization.ts, pickNutrientValues): a value can be judged
// only by a stored limit for the SAME method and the SAME unit. Nothing is converted.

export type Lang = 'en' | 'ar';
export type NutrientCode = 'n' | 'p' | 'k';

export interface LimitRow { nutrient: NutrientCode; unit: string; low_below: number | string; method_code: string; source_id: string }
export interface MethodRow { code: string; label_en: string; label_ar: string }
export interface MeasurementRow {
  id: string;
  nutrient: NutrientCode;
  value: number | string;
  unit: string;
  method_code: string;
  source_kind: 'lab' | 'sensor';
  measured_at: string;
  note: string | null;
}

export interface EntryOption { key: string; nutrient: NutrientCode; methodCode: string; unit: string; label: string; lowBelow: number }

export const NUTRIENT_NAME: Record<NutrientCode, { en: string; ar: string }> = {
  n: { en: 'Nitrogen (N)', ar: 'النيتروجين (N)' },
  p: { en: 'Phosphorus (P)', ar: 'الفسفور (P)' },
  k: { en: 'Potassium (K)', ar: 'البوتاسيوم (K)' },
};
const ORDER: NutrientCode[] = ['n', 'p', 'k'];
const clean = (x: string | null | undefined) => (x ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const methodLabel = (methods: MethodRow[], code: string, lang: Lang) => {
  const m = methods.find((x) => x.code === code);
  return m ? (lang === 'ar' ? m.label_ar : m.label_en) : code;
};

/** the tests the owner can enter for the crop: one per stored limit (nutrient + method). A result no limit exists for could never be judged. */
export function entryOptions(limits: LimitRow[], methods: MethodRow[], lang: Lang): EntryOption[] {
  return limits
    .map((l) => ({
      key: `${l.nutrient}|${l.method_code}`,
      nutrient: l.nutrient,
      methodCode: l.method_code,
      unit: l.unit,
      label: `${NUTRIENT_NAME[l.nutrient][lang]} · ${methodLabel(methods, l.method_code, lang)} (${l.unit})`,
      lowBelow: Number(l.low_below),
    }))
    .sort((a, b) => ORDER.indexOf(a.nutrient) - ORDER.indexOf(b.nutrient) || a.label.localeCompare(b.label));
}

/** "12,5", "12.5" and Arabic-Indic digits ("١٢٫٥") are read as 12.5; anything else, an empty text or a negative number is null */
export function parseNumber(text: string): number | null {
  const western = text
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٫,]/g, '.')
    .trim();
  if (!/^\d+(\.\d+)?$/.test(western)) return null;
  const n = Number(western);
  return Number.isFinite(n) ? n : null;
}

export type EntryError = 'choose_test' | 'value' | 'date' | 'future' | 'note';
export type EntryCheck = { ok: true; value: number; measuredAt: string } | { ok: false; error: EntryError };

/** `today` is the local date (YYYY-MM-DD) of the owner. The date alone is stored as noon UTC so no time zone can move it to another day. */
export function validateEntry(input: { option: EntryOption | undefined; valueText: string; date: string; today: string; note?: string }): EntryCheck {
  if (!input.option) return { ok: false, error: 'choose_test' };
  const value = parseNumber(input.valueText);
  if (value === null) return { ok: false, error: 'value' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(`${input.date}T12:00:00Z`))) return { ok: false, error: 'date' };
  if (input.date > input.today) return { ok: false, error: 'future' };
  if ((input.note ?? '').length > 300) return { ok: false, error: 'note' };
  return { ok: true, value, measuredAt: `${input.date}T12:00:00Z` };
}

/** the row sent to nutrient_measurements: a LAB result (the database refuses any other kind from the browser) */
export function insertRow(fieldId: string, option: EntryOption, value: number, measuredAt: string, note: string | undefined) {
  const trimmed = (note ?? '').trim();
  return {
    field_id: fieldId, nutrient: option.nutrient, value, unit: option.unit, method_code: option.methodCode,
    source_kind: 'lab' as const, measured_at: measuredAt, note: trimmed === '' ? null : trimmed,
  };
}

/** can the engine judge this stored value? Same rule as the engine: a limit for the same nutrient, method and unit */
export function isJudgeable(m: Pick<MeasurementRow, 'nutrient' | 'method_code' | 'unit'>, limits: LimitRow[]): boolean {
  return limits.some((l) => l.nutrient === m.nutrient && clean(l.method_code) === clean(m.method_code) && clean(l.unit) === clean(m.unit));
}

export interface MeasurementLine { id: string; nutrient: string; value: string; method: string; source: string; date: string; judged: boolean; deletable: boolean; note: string | null }

export function measurementLines(rows: MeasurementRow[], limits: LimitRow[], methods: MethodRow[], lang: Lang): MeasurementLine[] {
  return rows.map((m) => ({
    id: m.id,
    nutrient: NUTRIENT_NAME[m.nutrient][lang],
    value: `${Math.round(Number(m.value) * 1000) / 1000} ${m.unit}`,
    method: methodLabel(methods, m.method_code, lang),
    source: m.source_kind === 'sensor' ? (lang === 'ar' ? 'مجس' : 'sensor') : lang === 'ar' ? 'تحليل مخبري' : 'lab test',
    date: m.measured_at.slice(0, 10),
    judged: isJudgeable(m, limits),
    deletable: m.source_kind === 'lab',
    note: m.note,
  }));
}
