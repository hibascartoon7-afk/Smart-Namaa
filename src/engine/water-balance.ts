// Irrigation decision from the root-zone water balance (FAO-56, Chapter 8).
// Source: Allen, Pereira, Raes, Smith (1998), FAO Irrigation and Drainage Paper 56, https://www.fao.org/4/X0490e/x0490e0e.htm
//   Eq. 82  TAW = 1000 (theta_FC - theta_WP) Zr          total available water in the root zone [mm]
//   Eq. 83  RAW = p x TAW                                 water the crop can use before stress [mm]
//   Eq. 87  Dr  = 1000 (theta_FC - theta) Zr              root-zone depletion from a measured moisture [mm]
//   Table 22, note 2:  p = p_table + 0.04 (5 - ETc), limited to 0.1 <= p <= 0.8   (ETc in mm/day)
//   "Forecasting or allocating irrigations": irrigate before or when Dr reaches RAW; net depth I <= Dr.
//   Eq. 85 / "Precipitation": daily rain below about 0.2 x ETo is evaporated and ignored.
// Pure functions: no database, no network. A missing value is never 0 and never guessed:
// the answer is "insufficient_data" and says which input is missing.

/** Table 22, note 2: p is given for ETc of about 5 mm/day. */
export const P_REFERENCE_ETC_MM_DAY = 5;
/** Table 22, note 2: slope of the adjustment. */
export const P_ADJUSTMENT_SLOPE = 0.04;
/** Chapter 8: the adjusted p is limited to 0.1 .. 0.8. */
export const P_MIN = 0.1;
export const P_MAX = 0.8;
/** Chapter 8 "Precipitation": rain below about 0.2 ETo per day is ignored. */
export const IGNORED_RAIN_FRACTION_OF_ET0 = 0.2;

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Eq. 82. Soil values are percent by volume (the unit stored in soil_types and sensor_readings). */
export function totalAvailableWaterMm(fieldCapacityPct: number, wiltingPointPct: number, rootDepthM: number): number | null {
  if (![fieldCapacityPct, wiltingPointPct, rootDepthM].every(isNum)) return null;
  if (wiltingPointPct <= 0 || fieldCapacityPct > 100 || fieldCapacityPct <= wiltingPointPct || rootDepthM <= 0) return null;
  return 1000 * ((fieldCapacityPct - wiltingPointPct) / 100) * rootDepthM;
}

/** Table 22, note 2. */
export function adjustedDepletionFraction(pTable: number, etcMmDay: number): number {
  const p = pTable + P_ADJUSTMENT_SLOPE * (P_REFERENCE_ETC_MM_DAY - etcMmDay);
  return Math.min(P_MAX, Math.max(P_MIN, p));
}

/** Eq. 87. Not clamped: a negative value means the soil is wetter than field capacity. */
export function rootZoneDepletionMm(fieldCapacityPct: number, moisturePct: number, rootDepthM: number): number {
  return 1000 * ((fieldCapacityPct - moisturePct) / 100) * rootDepthM;
}

/** Rain that counts: below 0.2 x ET0 it is ignored. null = forecast or ET0 unknown. */
export function effectiveRainMm(forecastMm: number | null, et0MmDay: number | null): number | null {
  if (!isNum(forecastMm) || !isNum(et0MmDay) || forecastMm < 0 || et0MmDay < 0) return null;
  return forecastMm < IGNORED_RAIN_FRACTION_OF_ET0 * et0MmDay ? 0 : forecastMm;
}

export interface IrrigationInput {
  /** moisture of ONE sensor point, percent by volume (0-100). null = not measured. */
  moisturePct: number | null;
  /** soil_types.field_capacity_pct / wilting_point_pct */
  fieldCapacityPct: number | null;
  wiltingPointPct: number | null;
  /** crop_water_params: Zr in metres. For irrigation scheduling use the smaller value of Table 22 (note 1). */
  rootDepthM: number | null;
  /** crop_water_params.depletion_fraction_p (Table 22, for ETc about 5 mm/day) */
  depletionFractionTable: number | null;
  /** ETc = Kc x ET0 today, mm/day: only used to adjust p */
  etcMmDay: number | null;
  /** ET0 today, mm/day: only used for the "ignore small rain" rule */
  et0MmDay: number | null;
  /** forecast rain in the next 24 h, mm. null = no forecast: the decision is made without rain. */
  rainForecastNext24hMm: number | null;
  /** shown in the explanation only. There is no sourced threshold for it, so it never changes the decision. */
  rainProbabilityPct?: number | null;
}

export interface WaterNumbers {
  tawMm: number;
  rawMm: number;
  pAdjusted: number;
  depletionMm: number;
  /** Dr / TAW = (theta_FC - theta) / (theta_FC - theta_WP): root depth cancels, so this does not depend on Zr */
  depletionFractionOfTaw: number;
  rainForecastMm: number | null;
  effectiveRainMm: number | null;
  depletionAfterRainMm: number;
  rainProbabilityPct: number | null;
  belowWiltingPoint: boolean;
}

export type IrrigationReason =
  | 'at_or_above_field_capacity'
  | 'moisture_ok'
  | 'rain_expected'
  | 'depletion_reached';

export type IrrigationResult =
  | { status: 'insufficient_data'; reason: 'missing_inputs' | 'invalid_inputs'; fields: string[] }
  | { status: 'do_not_irrigate'; reason: Exclude<IrrigationReason, 'depletion_reached'>; numbers: WaterNumbers }
  | { status: 'recommend_irrigation'; reason: 'depletion_reached'; netDepthMm: number; numbers: WaterNumbers };

export function decideIrrigation(input: IrrigationInput): IrrigationResult {
  const required: [string, number | null][] = [
    ['moisture', input.moisturePct],
    ['field_capacity', input.fieldCapacityPct],
    ['wilting_point', input.wiltingPointPct],
    ['root_depth', input.rootDepthM],
    ['depletion_fraction', input.depletionFractionTable],
    ['etc', input.etcMmDay],
    ['et0', input.et0MmDay],
  ];
  const missing = required.filter(([, v]) => v === null || v === undefined).map(([k]) => k);
  if (missing.length > 0) return { status: 'insufficient_data', reason: 'missing_inputs', fields: missing };

  const moisture = input.moisturePct as number;
  const fc = input.fieldCapacityPct as number;
  const wp = input.wiltingPointPct as number;
  const zr = input.rootDepthM as number;
  const pTable = input.depletionFractionTable as number;
  const etc = input.etcMmDay as number;
  const et0 = input.et0MmDay as number;

  const invalid: string[] = [];
  if (!isNum(moisture) || moisture < 0 || moisture > 100) invalid.push('moisture');
  if (!isNum(etc) || etc < 0) invalid.push('etc');
  if (!isNum(et0) || et0 < 0) invalid.push('et0');
  if (!isNum(pTable) || pTable <= 0 || pTable > 1) invalid.push('depletion_fraction');
  const taw = totalAvailableWaterMm(fc, wp, zr);
  if (taw === null) invalid.push('soil_or_root_depth');
  if (input.rainForecastNext24hMm !== null && (!isNum(input.rainForecastNext24hMm) || input.rainForecastNext24hMm < 0)) {
    invalid.push('rain_forecast');
  }
  if (invalid.length > 0 || taw === null) return { status: 'insufficient_data', reason: 'invalid_inputs', fields: invalid };

  const pAdjusted = adjustedDepletionFraction(pTable, etc);
  const rawMm = pAdjusted * taw;
  const depletionMm = rootZoneDepletionMm(fc, moisture, zr);
  const effRain = effectiveRainMm(input.rainForecastNext24hMm, et0);
  const depletionAfterRainMm = Math.max(0, depletionMm - (effRain ?? 0));

  const numbers: WaterNumbers = {
    tawMm: taw,
    rawMm,
    pAdjusted,
    depletionMm,
    depletionFractionOfTaw: depletionMm / taw,
    rainForecastMm: input.rainForecastNext24hMm,
    effectiveRainMm: effRain,
    depletionAfterRainMm,
    rainProbabilityPct: isNum(input.rainProbabilityPct) ? input.rainProbabilityPct : null,
    belowWiltingPoint: depletionMm > taw,
  };

  if (depletionMm <= 0) return { status: 'do_not_irrigate', reason: 'at_or_above_field_capacity', numbers };
  if (depletionMm < rawMm) return { status: 'do_not_irrigate', reason: 'moisture_ok', numbers };
  if (depletionAfterRainMm < rawMm) return { status: 'do_not_irrigate', reason: 'rain_expected', numbers };

  // I <= Dr: never apply more than the depletion (avoids deep percolation and leaching of nutrients).
  return { status: 'recommend_irrigation', reason: 'depletion_reached', netDepthMm: depletionAfterRainMm, numbers };
}

const r1 = (x: number): string => (Math.round(x * 10) / 10).toString();

const INPUT_NAMES: Record<string, { en: string; ar: string }> = {
  moisture: { en: 'soil moisture (not measured)', ar: 'رطوبة التربة (غير مقاسة)' },
  field_capacity: { en: 'soil field capacity', ar: 'سعة الحقل للتربة' },
  wilting_point: { en: 'soil wilting point', ar: 'نقطة الذبول للتربة' },
  root_depth: { en: 'crop root depth', ar: 'عمق جذور المحصول' },
  depletion_fraction: { en: 'crop depletion fraction (p)', ar: 'نسبة الاستنزاف المسموحة للمحصول (p)' },
  etc: { en: 'crop water use today (Kc or ET0 missing)', ar: 'استهلاك المحصول اليوم (Kc أو ET0 ناقص)' },
  et0: { en: 'reference evapotranspiration today (ET0)', ar: 'التبخر-نتح المرجعي اليوم (ET0)' },
  soil_or_root_depth: { en: 'soil or root depth values', ar: 'قيم التربة أو عمق الجذور' },
  rain_forecast: { en: 'rain forecast', ar: 'توقع المطر' },
};

/** Fixed sentences built from the result. No model writes these: the numbers are the engine's own. */
export function describeIrrigation(result: IrrigationResult): { en: string; ar: string } {
  if (result.status === 'insufficient_data') {
    const en = result.fields.map((f) => INPUT_NAMES[f]?.en ?? f).join(', ');
    const ar = result.fields.map((f) => INPUT_NAMES[f]?.ar ?? f).join('، ');
    return result.reason === 'missing_inputs'
      ? { en: `Cannot decide about irrigation: missing ${en}.`, ar: `لا أستطيع تحديد الري: ناقص ${ar}.` }
      : { en: `Cannot decide about irrigation: invalid ${en}.`, ar: `لا أستطيع تحديد الري: قيمة غير صالحة في ${ar}.` };
  }
  const n = result.numbers;
  const prob = n.rainProbabilityPct !== null ? ` (${r1(n.rainProbabilityPct)}% probability)` : '';
  const probAr = n.rainProbabilityPct !== null ? ` (احتمال ${r1(n.rainProbabilityPct)}%)` : '';
  const wilt = n.belowWiltingPoint ? ' The soil is below the wilting point.' : '';
  const wiltAr = n.belowWiltingPoint ? ' التربة تحت نقطة الذبول.' : '';

  switch (result.reason) {
    case 'at_or_above_field_capacity':
      return { en: 'Do not irrigate: the soil is at or above field capacity.', ar: 'لا تروِ: التربة وصلت سعة الحقل أو تجاوزتها.' };
    case 'moisture_ok':
      return {
        en: `Do not irrigate: the plant has used ${r1(n.depletionMm)} mm of water, below the ${r1(n.rawMm)} mm it can use before stress.`,
        ar: `لا تروِ: النبتة استهلكت ${r1(n.depletionMm)} مم من الماء، وهو أقل من ${r1(n.rawMm)} مم تقدر تستهلكها قبل الإجهاد.`,
      };
    case 'rain_expected':
      return {
        en: `Do not irrigate: about ${r1(n.effectiveRainMm ?? 0)} mm of rain is forecast in the next 24 hours${prob}, which keeps the depletion (${r1(n.depletionAfterRainMm)} mm) below the stress limit (${r1(n.rawMm)} mm).`,
        ar: `لا تروِ: متوقع حوالي ${r1(n.effectiveRainMm ?? 0)} مم مطر خلال 24 ساعة${probAr}، وهذا بيبقي النقص (${r1(n.depletionAfterRainMm)} مم) تحت حد الإجهاد (${r1(n.rawMm)} مم).`,
      };
    case 'depletion_reached': {
      const net = (result as Extract<IrrigationResult, { status: 'recommend_irrigation' }>).netDepthMm;
      const noRain = n.rainForecastMm === null ? ' No rain forecast was available.' : '';
      const noRainAr = n.rainForecastMm === null ? ' ما توفر توقع للمطر.' : '';
      return {
        en: `Irrigate about ${r1(net)} mm: the plant has used ${r1(n.depletionMm)} mm, above the ${r1(n.rawMm)} mm limit before stress.${wilt}${noRain}`,
        ar: `اسقِ حوالي ${r1(net)} مم: النبتة استهلكت ${r1(n.depletionMm)} مم، وهذا فوق حد ${r1(n.rawMm)} مم قبل الإجهاد.${wiltAr}${noRainAr}`,
      };
    }
  }
}
