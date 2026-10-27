// Fertilization decision (second layer of the engine).
//
// What it needs: measured N, P, K of the field (a lab test entered by the owner, or an NPK sensor), the crop's sufficiency limits
// and the list of fertilizers (reference tables, each row carries a source_id). Until nutrients are measured the answer is
// always "insufficient_data" and says which ones are missing: a missing value is NEVER read as 0 and never filled in.
//
// A measurement is only compared with a limit that was set for the SAME METHOD and the SAME UNIT (pickNutrientValues): a leaf
// value in % is not a soil value in ppm, and a sensor's number is not a lab number. A measurement that no stored limit fits is
// reported as "not comparable" and never judged. Among the comparable ones the NEWEST wins; its date, source (lab or sensor) and
// method are returned with the decision. No age limit is applied (no source gives one): the age is shown instead.
//
// Doses and soil notes are DATA too (crop_nutrient_rates, fertilizer_soil_notes): a dose is only ever the stored source ceiling
// converted to kg of product (kg of nutrient / (content % / 100)); nothing is invented, and without a stored dose no amount is shown.
// Reference rows are DATA, not code: this module contains no nutrient number. If the crop has no sufficiency row for a
// nutrient the answer is "reference_missing". Fertilizer choice: among the listed fertilizers, the one with the highest
// content of the nutrient with the largest relative shortage.

export type Nutrient = 'n' | 'p' | 'k';

export interface NutrientValues {
  n: number | null;
  p: number | null;
  k: number | null;
}

/** one row of crop_nutrient_sufficiency: the measured value below which the crop needs that nutrient */
export interface SufficiencyRow {
  nutrient: Nutrient;
  unit: string;
  lowBelow: number;
  sourceId: string;
  /** the method the limit was set for (nutrient_methods.code, e.g. 'soil_olsen_p'); a measurement is compared only with the same method */
  methodCode?: string;
}

export type MeasurementSource = 'lab' | 'sensor';

/** one row of nutrient_measurements (a lab result entered by the owner, or a value from an NPK sensor) */
export interface NutrientMeasurement {
  nutrient: Nutrient;
  value: number;
  unit: string;
  methodCode: string;
  sourceKind: MeasurementSource;
  /** ISO time */
  measuredAt: string;
}

export interface UsedMeasurement extends NutrientMeasurement {
  /** whole days between the measurement and now (0 = today); shown to the user, never used to throw a value away */
  ageDays: number;
  methodLabelEn: string | null;
  methodLabelAr: string | null;
}

export interface RejectedMeasurement extends NutrientMeasurement {
  reason: 'no_limit_for_method' | 'unit_mismatch' | 'in_future' | 'invalid_value';
}

export interface MeasurementTrace {
  /** the measurements the decision is based on */
  measurements?: UsedMeasurement[];
  /** NEWER measurements that were not used, with the reason */
  rejected?: RejectedMeasurement[];
}

const MAX_FUTURE_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const clean = (x: string | null | undefined): string => (x ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * From all stored measurements, the value of each nutrient the engine may judge: the newest measurement that has a stored limit for
 * its method AND unit. Newer measurements that cannot be compared are returned as "rejected" with the reason; older ones are not
 * examined once a usable one is found. Nothing is converted between units and no method is assumed equal to another.
 */
export function pickNutrientValues(
  measurements: NutrientMeasurement[],
  reference: SufficiencyRow[],
  nowMs: number,
  labels: Record<string, { en: string; ar: string }> = {},
): { values: NutrientValues; reference: SufficiencyRow[]; used: UsedMeasurement[]; rejected: RejectedMeasurement[] } {
  const values: NutrientValues = { n: null, p: null, k: null };
  const picked: SufficiencyRow[] = [];
  const used: UsedMeasurement[] = [];
  const rejected: RejectedMeasurement[] = [];
  for (const nutrient of ALL) {
    const mine = measurements
      .filter((m) => m.nutrient === nutrient)
      .map((m) => ({ m, t: Date.parse(m.measuredAt) }))
      .sort((a, b) => (Number.isFinite(b.t) ? b.t : -Infinity) - (Number.isFinite(a.t) ? a.t : -Infinity));
    for (const { m, t } of mine) {
      if (!isNum(m.value) || m.value < 0 || !Number.isFinite(t)) { rejected.push({ ...m, reason: 'invalid_value' }); continue; }
      if (t > nowMs + MAX_FUTURE_MS) { rejected.push({ ...m, reason: 'in_future' }); continue; }
      const sameMethod = reference.filter((r) => r.nutrient === nutrient && r.methodCode !== undefined && clean(r.methodCode) === clean(m.methodCode));
      if (sameMethod.length === 0) { rejected.push({ ...m, reason: 'no_limit_for_method' }); continue; }
      const ref = sameMethod.find((r) => clean(r.unit) === clean(m.unit));
      if (!ref) { rejected.push({ ...m, reason: 'unit_mismatch' }); continue; }
      values[nutrient] = m.value;
      picked.push(ref);
      const label = labels[m.methodCode];
      used.push({ ...m, ageDays: Math.max(0, Math.floor((nowMs - t) / DAY_MS)), methodLabelEn: label?.en ?? null, methodLabelAr: label?.ar ?? null });
      break;
    }
  }
  return { values, reference: picked, used, rejected };
}

/** one row of fertilizers: nutrient content in percent (N, P2O5, K2O) */
export interface FertilizerRow {
  name: string;
  nPct: number | null;
  p2o5Pct: number | null;
  k2oPct: number | null;
  sourceId: string;
}

/** one row of crop_nutrient_rates: the dose CEILING of a nutrient for a crop, kg of nutrient per dunum (1 dunum = 1000 m2), from a source */
export interface RateRow {
  nutrient: Nutrient;
  minKgPerDunum: number | null;
  maxKgPerDunum: number;
  basisEn: string;
  basisAr: string;
  sourceId: string;
}

/** one row of fertilizer_soil_notes: what a source says about a fertilizer on a soil type (or on a condition the app does not record) */
export interface SoilNoteRow {
  fertilizerName: string;
  soilName: string | null;
  condition: string | null;
  rating: 'better' | 'caution';
  noteEn: string;
  noteAr: string;
  sourceId: string;
}

export interface FertilizationContext {
  rates?: RateRow[];
  soilNotes?: SoilNoteRow[];
  /** soil_name of the field's soil type */
  fieldSoilName?: string | null;
  areaM2?: number | null;
  /** from pickNutrientValues: what the values come from, and what newer values were not used */
  measurements?: UsedMeasurement[];
  rejected?: RejectedMeasurement[];
}

export interface DoseInfo {
  nutrient: Nutrient;
  minKgPerDunum: number | null;
  maxKgPerDunum: number;
  basisEn: string;
  basisAr: string;
  sourceId: string;
}

export interface SoilNoteGroup {
  rating: 'better' | 'caution';
  /** soil types the note is about (empty for a condition note) */
  soils: string[];
  condition: string | null;
  noteEn: string;
  noteAr: string;
  sourceId: string;
}

export interface FertilizerOption {
  name: string;
  contentPct: number;
  sourceId: string;
  /** kg of this product per dunum that carries the nutrient dose; null when no sourced dose is stored */
  productKgPerDunum: { min: number | null; max: number } | null;
  /** the same for the whole field; null without a dose or without the field area */
  productKgForField: { min: number | null; max: number } | null;
  /** the OTHER nutrients this product delivers when the dose ceiling is applied with it (compound fertilizers): kg of nutrient per dunum */
  alsoSupplies: { nutrient: Nutrient; kgPerDunum: number }[];
  soilNotes: SoilNoteGroup[];
  /** the note that matches the soil type of THIS field, if a source has one */
  fieldSoil: { rating: 'better' | 'caution'; noteEn: string; noteAr: string; sourceId: string } | null;
}

export interface NutrientPlan {
  nutrient: Nutrient;
  dose: DoseInfo | null;
  /** every stored fertilizer that carries the nutrient, highest content first (ties by name) */
  options: FertilizerOption[];
}

export type FertilizationResult = (
  | { status: 'insufficient_data'; reason: 'nutrients_not_measured' | 'reference_missing' | 'measurements_not_comparable'; missing: Nutrient[] }
  | { status: 'no_fertilization_needed'; notMeasured: Nutrient[] }
  | {
      status: 'recommend_fertilization';
      needed: { nutrient: Nutrient; value: number; lowBelow: number; unit: string; sourceId: string }[];
      fertilizer: { name: string; contentPct: number; sourceId: string } | null;
      /** one plan per needed nutrient, the largest relative shortage first: dose ceiling + the fertilizer options */
      plans: NutrientPlan[];
      area: { dunum: number } | null;
      notMeasured: Nutrient[];
    }
) & MeasurementTrace;

const ALL: Nutrient[] = ['n', 'p', 'k'];
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function contentOf(f: FertilizerRow, nutrient: Nutrient): number | null {
  const v = nutrient === 'n' ? f.nPct : nutrient === 'p' ? f.p2o5Pct : f.k2oPct;
  return isNum(v) && v > 0 ? v : null;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;
const norm = (x: string | null | undefined): string => (x ?? '').trim().toLowerCase();

function buildPlan(
  nutrient: Nutrient,
  fertilizers: FertilizerRow[],
  ctx: FertilizationContext,
  dunum: number | null,
): NutrientPlan {
  const rate = (ctx.rates ?? []).find((r) => r.nutrient === nutrient) ?? null;
  const dose: DoseInfo | null = rate
    ? { nutrient, minKgPerDunum: rate.minKgPerDunum, maxKgPerDunum: rate.maxKgPerDunum, basisEn: rate.basisEn, basisAr: rate.basisAr, sourceId: rate.sourceId }
    : null;

  const options: FertilizerOption[] = fertilizers
    .map((f) => ({ f, c: contentOf(f, nutrient) }))
    .filter((x): x is { f: FertilizerRow; c: number } => x.c !== null)
    .sort((a, b) => b.c - a.c || a.f.name.localeCompare(b.f.name))
    .map(({ f, c }) => {
      // kg of product = kg of nutrient / (content % / 100); the whole-field amount is computed from the unrounded value
      const rawMin = dose && dose.minKgPerDunum !== null ? (dose.minKgPerDunum * 100) / c : null;
      const rawMax = dose ? (dose.maxKgPerDunum * 100) / c : null;
      const perDunum = rawMax !== null ? { min: rawMin === null ? null : round1(rawMin), max: round1(rawMax) } : null;
      const forField = rawMax !== null && dunum !== null
        ? { min: rawMin === null ? null : round1(rawMin * dunum), max: round1(rawMax * dunum) }
        : null;
      const alsoSupplies = rawMax === null
        ? []
        : ALL.filter((k) => k !== nutrient)
            .flatMap((k) => { const pct = contentOf(f, k); return pct === null ? [] : [{ nutrient: k, kgPerDunum: round1((rawMax * pct) / 100) }]; });

      const notes = (ctx.soilNotes ?? []).filter((n) => norm(n.fertilizerName) === norm(f.name));
      const groups = new Map<string, SoilNoteGroup>();
      for (const n of notes) {
        const key = [n.rating, n.condition ?? '', n.noteEn, n.sourceId].join('|');
        const g = groups.get(key) ?? { rating: n.rating, soils: [], condition: n.condition, noteEn: n.noteEn, noteAr: n.noteAr, sourceId: n.sourceId };
        if (n.soilName && !g.soils.includes(n.soilName)) g.soils.push(n.soilName);
        groups.set(key, g);
      }
      const mine = ctx.fieldSoilName ? notes.find((n) => n.soilName !== null && norm(n.soilName) === norm(ctx.fieldSoilName)) : undefined;
      return {
        name: f.name,
        contentPct: c,
        sourceId: f.sourceId,
        productKgPerDunum: perDunum,
        productKgForField: forField,
        alsoSupplies,
        soilNotes: [...groups.values()],
        fieldSoil: mine ? { rating: mine.rating, noteEn: mine.noteEn, noteAr: mine.noteAr, sourceId: mine.sourceId } : null,
      };
    });
  return { nutrient, dose, options };
}

export function decideFertilization(
  values: NutrientValues,
  reference: SufficiencyRow[],
  fertilizers: FertilizerRow[],
  ctx: FertilizationContext = {},
): FertilizationResult {
  const trace: MeasurementTrace = {};
  if (ctx.measurements) trace.measurements = ctx.measurements;
  if (ctx.rejected && ctx.rejected.length > 0) trace.rejected = ctx.rejected;
  const measured = ALL.filter((k) => isNum(values[k]) && (values[k] as number) >= 0);
  const notMeasured = ALL.filter((k) => !measured.includes(k));
  if (measured.length === 0) {
    // values exist but none can be judged with the stored limits (other method or unit): say so instead of "not measured"
    if (trace.rejected) return { status: 'insufficient_data', reason: 'measurements_not_comparable', missing: [...new Set(trace.rejected.map((x) => x.nutrient))], ...trace };
    return { status: 'insufficient_data', reason: 'nutrients_not_measured', missing: notMeasured, ...trace };
  }

  const withoutReference = measured.filter((k) => !reference.some((r) => r.nutrient === k));
  if (withoutReference.length === measured.length) return { status: 'insufficient_data', reason: 'reference_missing', missing: withoutReference, ...trace };

  const needed = measured
    .map((k) => ({ k, ref: reference.find((r) => r.nutrient === k) }))
    .filter((x): x is { k: Nutrient; ref: SufficiencyRow } => !!x.ref && (values[x.k] as number) < x.ref.lowBelow)
    .map((x) => ({ nutrient: x.k, value: values[x.k] as number, lowBelow: x.ref.lowBelow, unit: x.ref.unit, sourceId: x.ref.sourceId }));

  if (needed.length === 0) return { status: 'no_fertilization_needed', notMeasured, ...trace };

  // largest relative shortage first
  needed.sort((a, b) => (b.lowBelow - b.value) / b.lowBelow - (a.lowBelow - a.value) / a.lowBelow);

  const area = isNum(ctx.areaM2) && ctx.areaM2 > 0 ? { dunum: ctx.areaM2 / 1000 } : null;
  const plans = needed.map((n) => buildPlan(n.nutrient, fertilizers, ctx, area ? area.dunum : null));
  const top = plans[0].options[0] ?? null;
  const best = top ? { name: top.name, contentPct: top.contentPct, sourceId: top.sourceId } : null;
  return { status: 'recommend_fertilization', needed, fertilizer: best, plans, area, notMeasured, ...trace };
}

const NAME: Record<Nutrient, { en: string; ar: string }> = {
  n: { en: 'nitrogen (N)', ar: 'النيتروجين (N)' },
  p: { en: 'phosphorus (P)', ar: 'الفسفور (P)' },
  k: { en: 'potassium (K)', ar: 'البوتاسيوم (K)' },
};

export function describeFertilization(r: FertilizationResult): { en: string; ar: string } {
  const list = (xs: Nutrient[], lang: 'en' | 'ar') => xs.map((x) => NAME[x][lang]).join(lang === 'en' ? ', ' : '، ');
  const kindEn = (k: MeasurementSource) => (k === 'sensor' ? 'sensor' : 'lab test');
  const kindAr = (k: MeasurementSource) => (k === 'sensor' ? 'مجس' : 'تحليل مخبري');
  const ageEn = (d: number) => (d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`);
  const ageAr = (d: number) => (d === 0 ? 'اليوم' : d === 1 ? 'قبل يوم' : `قبل ${d} يوماً`);
  const val = (v: number) => String(Math.round(v * 1000) / 1000);
  const used = r.measurements ?? [];
  const basis = used.length
    ? {
        en: ` Based on: ${used.map((m) => `${NAME[m.nutrient].en} ${val(m.value)} ${m.unit} (${m.methodLabelEn ?? m.methodCode}, ${kindEn(m.sourceKind)}, ${ageEn(m.ageDays)})`).join('; ')}.`,
        ar: ` بناءً على: ${used.map((m) => `${NAME[m.nutrient].ar} ${val(m.value)} ${m.unit} (${m.methodLabelAr ?? m.methodLabelEn ?? m.methodCode}، ${kindAr(m.sourceKind)}، ${ageAr(m.ageDays)})`).join('؛ ')}.`,
      }
    : { en: '', ar: '' };
  const sensorCaution = used.some((m) => m.sourceKind === 'sensor')
    ? { en: ' A value comes from a sensor, not from a lab test: confirm it with a lab test before applying fertilizer.', ar: ' إحدى القيم من مجس وليست من تحليل مخبري: أكّدي القيمة بتحليل مخبري قبل التسميد.' }
    : { en: '', ar: '' };
  const skipped = r.rejected && r.rejected.length > 0
    ? {
        en: ` Not used (a stored limit does not fit its method or unit): ${r.rejected.map((m) => `${NAME[m.nutrient].en} ${val(m.value)} ${m.unit} (${m.methodCode}, ${kindEn(m.sourceKind)})`).join('; ')}.`,
        ar: ` لم تُستخدم (لا يوجد حد مخزّن يناسب طريقتها أو وحدتها): ${r.rejected.map((m) => `${NAME[m.nutrient].ar} ${val(m.value)} ${m.unit} (${m.methodCode}، ${kindAr(m.sourceKind)})`).join('؛ ')}.`,
      }
    : { en: '', ar: '' };
  if (r.status === 'insufficient_data') {
    if (r.reason === 'measurements_not_comparable') {
      return {
        en: `Fertilizer need cannot be determined: ${list(r.missing, 'en')} was measured, but the stored limits cannot judge it (they were set for another method or unit).${skipped.en} Enter a lab result in the method the limits use, or add limits for this method with a source.`,
        ar: `لا أستطيع تحديد حاجة النبتة للسماد: ${list(r.missing, 'ar')} مقاسة، لكن الحدود المخزّنة لا تستطيع الحكم عليها (وُضعت لطريقة أو وحدة أخرى).${skipped.ar} أدخلي نتيجة مخبرية بالطريقة التي تستخدمها الحدود، أو أضيفي حدوداً لهذه الطريقة مع مصدرها.`,
      };
    }
    if (r.reason === 'nutrients_not_measured') {
      return {
        en: `Fertilizer need cannot be determined: ${list(r.missing, 'en')} not measured.`,
        ar: `لا أستطيع تحديد حاجة النبتة للسماد: ${list(r.missing, 'ar')} غير مقاسة.`,
      };
    }
    return {
      en: `Fertilizer need cannot be determined: no reference limits are stored for this crop for ${list(r.missing, 'en')}.`,
      ar: `لا أستطيع تحديد حاجة النبتة للسماد: لا توجد حدود مرجعية لهذا المحصول لـ ${list(r.missing, 'ar')}.`,
    };
  }
  const nm = r.notMeasured.length ? { en: ` Not measured: ${list(r.notMeasured, 'en')}.`, ar: ` غير مقاس: ${list(r.notMeasured, 'ar')}.` } : { en: '', ar: '' };
  if (r.status === 'no_fertilization_needed') {
    return { en: `No fertilizer needed for the measured nutrients.${nm.en}${basis.en}${sensorCaution.en}${skipped.en}`, ar: `لا حاجة للتسميد حسب العناصر المقاسة.${nm.ar}${basis.ar}${sensorCaution.ar}${skipped.ar}` };
  }
  const low = r.needed.map((x) => x.nutrient);
  const top = r.plans[0];
  let dose = { en: '', ar: '' };
  if (top?.dose) {
    const d = top.dose;
    const first = top.options[0];
    const range = d.minKgPerDunum !== null ? `${d.minKgPerDunum} to ${d.maxKgPerDunum}` : `up to ${d.maxKgPerDunum}`;
    const rangeAr = d.minKgPerDunum !== null ? `من ${d.minKgPerDunum} إلى ${d.maxKgPerDunum}` : `حتى ${d.maxKgPerDunum}`;
    const prod = first?.productKgPerDunum
      ? { en: ` (about ${first.productKgPerDunum.min !== null ? `${first.productKgPerDunum.min} to ` : 'up to '}${first.productKgPerDunum.max} kg of ${first.name} per dunum)`, ar: ` (حوالي ${first.productKgPerDunum.min !== null ? `${first.productKgPerDunum.min} إلى ` : 'حتى '}${first.productKgPerDunum.max} كغ من ${first.name} للدونم)` }
      : { en: '', ar: '' };
    const also = first && first.alsoSupplies.length > 0
      ? { en: ` At that amount it also supplies ${first.alsoSupplies.map((a) => `${a.kgPerDunum} kg ${list([a.nutrient], 'en')}`).join(', ')} per dunum.`, ar: ` وبهذه الكمية يضيف أيضاً ${first.alsoSupplies.map((a) => `${a.kgPerDunum} كغ ${list([a.nutrient], 'ar')}`).join('، ')} للدونم.` }
      : { en: '', ar: '' };
    dose = {
      en: ` Reference dose ceiling for ${list([top.nutrient], 'en')}: ${range} kg per dunum for the whole season${prod.en}. It is a ceiling, not a target: do not exceed it, and split it over several applications.${also.en}`,
      ar: ` السقف المرجعي لـ ${list([top.nutrient], 'ar')}: ${rangeAr} كغ للدونم لكامل الموسم${prod.ar}. هذا سقف وليس هدفاً: لا تتجاوزيه، ووزّعيه على عدة دفعات.${also.ar}`,
    };
  } else if (top) {
    dose = {
      en: ` No sourced dose is stored for ${list([top.nutrient], 'en')} on this crop, so no amount is suggested: ask an agronomist.`,
      ar: ` لا توجد جرعة مرجعية محفوظة لـ ${list([top.nutrient], 'ar')} لهذا المحصول، فلا توجد كمية مقترحة: اسألي مهندساً زراعياً.`,
    };
  }
  const fert = r.fertilizer
    ? { en: ` Suggested fertilizer: ${r.fertilizer.name} (${r.fertilizer.contentPct}% of the needed nutrient).`, ar: ` السماد المقترح: ${r.fertilizer.name} (${r.fertilizer.contentPct}% من العنصر المطلوب).` }
    : { en: ' No fertilizer list is stored yet, so no product is suggested.', ar: ' لا توجد قائمة أسمدة محفوظة بعد، فلا يوجد منتج مقترح.' };
  return {
    en: `The crop needs ${list(low, 'en')}.${basis.en}${sensorCaution.en}${fert.en}${dose.en}${nm.en}${skipped.en}`,
    ar: `النبتة تحتاج ${list(low, 'ar')}.${basis.ar}${sensorCaution.ar}${fert.ar}${dose.ar}${nm.ar}${skipped.ar}`,
  };
}
