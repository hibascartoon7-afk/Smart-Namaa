// The decision engine for ONE field. Pure: rows in, decision + alerts + estimated saving out.
// The Edge Function only loads the rows and stores the result; every rule lives here and is tested.
//
// Inputs combined: sensor readings (per sensor point) + weather (ET0, rain forecast) + soil type (field capacity, wilting
// point) + crop (Kc curve, stage lengths, root depth, depletion fraction) + planting date + (when available) NPK and an ML forecast.
// Rules: FAO-56 Chapter 6 (Kc, ETc = Kc x ET0) and Chapter 8 (TAW, RAW, Dr, rain credit). See docs/formulas.md.
//
// Honest by design: if an input is missing the decision for that point is "insufficient_data" and says which input.
// The engine never predicts: it reads the ML forecast (if the model is active) only to word a separate predictive alert.

import { dailyEt0FromHourly } from './et0';
import type { KcRow, Range } from './kc';
import { resolveCropKcToday, type GrowthStage, type KcCurveResult, type StageLengths } from './kc-curve';
import { evaluateForecast } from './forecast-alert';
import {
  decideFertilization,
  describeFertilization,
  pickNutrientValues,
  type NutrientMeasurement,
  type FertilizationResult,
  type FertilizerRow,
  type RateRow,
  type SoilNoteRow,
  type NutrientValues,
  type SufficiencyRow,
} from './fertilization';
import { latestFreshMoisture, type ReadingInput } from './readings';
import { estimateFieldSaving, estimateSavingMm, type SavingEstimate } from './savings';
import { localDayString } from './time';
import { summarizeWeather, type WeatherRow } from './weather-summary';
import { decideIrrigation, describeIrrigation, type IrrigationResult } from './water-balance';

export const ENGINE_VERSION = 'engine-1.0.0';

/** Operational settings (software policy, not scientific constants). */
export const DEFAULT_MAX_READING_AGE_HOURS = 6;
export const DEFAULT_FORECAST_MAX_AGE_HOURS = 12;

export interface ForecastInput {
  sensorPointId: string | null;
  madeAt: string;
  targetTime: string;
  predictedMoisturePct: number;
  modelName: string;
  modelVersion: string;
  /** from ml_model_registry.active: an inactive model is never used */
  modelActive: boolean;
}

export interface DecideFieldInput {
  field: { id: string; name: string; timezone: string | null; plantingDate: string | null; areaM2: number | null };
  soil: { fieldCapacityPct: number | null; wiltingPointPct: number | null } | null;
  crop: {
    name: string;
    kcRow: KcRow | null;
    kcGroupRow: KcRow | null;
    stages: StageLengths | null;
    /** Table 22: for irrigation scheduling the smaller root depth is used (note 1) */
    rootDepthMinM: number | null;
    depletionFractionP: number | null;
  } | null;
  points: { id: string; name: string }[];
  readings: ReadingInput[];
  weather: WeatherRow[];
  forecasts: ForecastInput[];
  nutrients: NutrientValues;
  /** stored measurements (lab results and sensor values); when given they replace `nutrients`: the newest one each stored limit can judge is used */
  nutrientMeasurements?: NutrientMeasurement[];
  /** code -> label of nutrient_methods, for the text */
  nutrientMethodLabels?: Record<string, { en: string; ar: string }>;
  nutrientReference: SufficiencyRow[];
  fertilizers: FertilizerRow[];
  /** alert_thresholds row, only when the owner stored one with a source */
  fertilizerHoldAirTempMaxC: { value: number; sourceId: string } | null;
  /** doses, soil notes and the field soil name for the fertilizer options (all optional: without them no dose or soil note is shown) */
  fertilizationContext?: { rates: RateRow[]; soilNotes: SoilNoteRow[]; soilName: string | null };
  nowMs: number;
  options?: { maxReadingAgeHours?: number; forecastMaxAgeHours?: number };
}

export interface PointDecision {
  pointId: string;
  pointName: string;
  moisturePct: number | null;
  measuredAt: string | null;
  result: IrrigationResult;
  text: { en: string; ar: string };
  savedMm: number;
}

export type AlertKind = 'engine' | 'forecast' | 'savings';
export type AlertSeverity = 'info' | 'warning' | 'action';

export interface AlertDraft {
  kind: AlertKind;
  code: string;
  severity: AlertSeverity;
  pointId: string | null;
  titleEn: string;
  titleAr: string;
  messageEn: string;
  messageAr: string;
  details: Record<string, unknown>;
}

export type FieldIrrigationStatus = 'recommend_irrigation' | 'do_not_irrigate' | 'insufficient_data';

export interface FieldDecision {
  engineVersion: string;
  generatedAt: string;
  localDay: string | null;
  growthStage: GrowthStage | null;
  dayOfSeason: number | null;
  kc: Range | null;
  et0MmDay: number | null;
  etcMmDay: Range | null;
  /** the value used to adjust p: the upper end of ETc (cautious: a higher ETc lowers p, so irrigation starts earlier) */
  etcUsedMmDay: number | null;
  /** what blocked the upstream numbers, if anything: { kc: 'stage_lengths_missing', et0: 'missing_hours' } */
  upstream: Record<string, string>;
  irrigation: { status: FieldIrrigationStatus; summaryEn: string; summaryAr: string };
  fertilization: { result: FertilizationResult; text: { en: string; ar: string } };
  perPoint: PointDecision[];
  alerts: AlertDraft[];
  saving: SavingEstimate | null;
  explanation: { en: string; ar: string };
}

const r1 = (x: number): string => (Math.round(x * 10) / 10).toString();

const UPSTREAM_TEXT: Record<string, { en: string; ar: string }> = {
  planting_date_missing: { en: 'planting date is not set', ar: 'تاريخ الزراعة غير مُدخل' },
  planting_date_invalid: { en: 'planting date is not valid', ar: 'تاريخ الزراعة غير صالح' },
  planting_in_future: { en: 'planting date is in the future', ar: 'تاريخ الزراعة في المستقبل' },
  invalid_time_zone: { en: 'the field time zone is not valid', ar: 'المنطقة الزمنية للحقل غير صالحة' },
  kc_row_missing: { en: 'the crop has no Kc row (FAO-56 Table 12)', ar: 'المحصول بلا صف Kc (جدول FAO-56 رقم 12)' },
  kc_missing: { en: 'Kc is missing for part of the crop cycle', ar: 'قيمة Kc ناقصة لجزء من دورة المحصول' },
  stage_lengths_missing: { en: 'growth-stage lengths are not stored for this crop', ar: 'أطوال مراحل النمو غير محفوظة لهذا المحصول' },
  stage_lengths_invalid: { en: 'growth-stage lengths are not valid', ar: 'أطوال مراحل النمو غير صالحة' },
  cycle_ended: { en: 'the crop cycle has ended (past the last growth stage)', ar: 'انتهت دورة المحصول (بعد آخر مرحلة نمو)' },
  no_data: { en: 'no weather data for today', ar: 'لا توجد بيانات طقس لليوم' },
  missing_hours: { en: 'weather for today is incomplete', ar: 'بيانات الطقس لليوم غير مكتملة' },
  null_values: { en: 'weather values for today are missing', ar: 'قيم الطقس لليوم ناقصة' },
  no_crop: { en: 'the field has no crop', ar: 'الحقل بلا محصول' },
  no_soil: { en: 'the field has no soil type', ar: 'الحقل بلا نوع تربة' },
};

function upstreamSentence(upstream: Record<string, string>): { en: string; ar: string } | null {
  const keys = Object.values(upstream);
  if (keys.length === 0) return null;
  return {
    en: ` Reason: ${keys.map((k) => UPSTREAM_TEXT[k]?.en ?? k).join('; ')}.`,
    ar: ` السبب: ${keys.map((k) => UPSTREAM_TEXT[k]?.ar ?? k).join('؛ ')}.`,
  };
}

const names = (xs: PointDecision[]): string => xs.map((x) => x.pointName).join(', ');

export function decideField(input: DecideFieldInput): FieldDecision {
  const { field, soil, crop, points, nowMs } = input;
  const maxAge = input.options?.maxReadingAgeHours ?? DEFAULT_MAX_READING_AGE_HOURS;
  const fcMaxAge = input.options?.forecastMaxAgeHours ?? DEFAULT_FORECAST_MAX_AGE_HOURS;
  const tz = field.timezone;
  const upstream: Record<string, string> = {};

  const localDay = tz ? localDayString(nowMs, tz) : null;

  // ---- crop coefficient today and ETc
  let curve: KcCurveResult | null = null;
  if (!crop) upstream.crop = 'no_crop';
  else if (!tz || !localDay) upstream.kc = 'invalid_time_zone';
  else {
    curve = resolveCropKcToday({
      kcRow: crop.kcRow,
      kcGroupRow: crop.kcGroupRow,
      lengths: crop.stages,
      plantingDate: field.plantingDate,
      nowMs,
      timeZone: tz,
    });
    if (curve.status === 'unavailable') upstream.kc = curve.reason;
  }
  if (!soil || soil.fieldCapacityPct === null || soil.wiltingPointPct === null) upstream.soil = 'no_soil';

  // ---- ET0 today (sum of the 24 hourly values of the local day)
  let et0MmDay: number | null = null;
  if (tz && localDay) {
    const e = dailyEt0FromHourly(
      input.weather.map((w) => ({ observedAt: w.observed_at, et0Mm: w.et0_mm })),
      localDay,
      tz,
    );
    if (e.status === 'ok') et0MmDay = e.et0MmPerDay;
    else upstream.et0 = e.reason;
  }

  const kc = curve && curve.status === 'ok' ? curve.kc : null;
  const etcRange = kc && et0MmDay !== null ? { min: kc.min * et0MmDay, max: kc.max * et0MmDay } : null;
  const etcUsed = etcRange ? etcRange.max : null;

  // ---- rain forecast: used only when all 24 hours are present (a partial sum could hide rain)
  const wx = summarizeWeather(input.weather, nowMs);
  const rainForecast = wx.next24h.precipitationComplete ? wx.next24h.precipitationMm : null;

  // ---- irrigation, one decision per sensor point
  const perPoint: PointDecision[] = points.map((p) => {
    const fresh = latestFreshMoisture(input.readings, p.id, nowMs, maxAge);
    const result = decideIrrigation({
      moisturePct: fresh ? fresh.value : null,
      fieldCapacityPct: soil?.fieldCapacityPct ?? null,
      wiltingPointPct: soil?.wiltingPointPct ?? null,
      rootDepthM: crop?.rootDepthMinM ?? null,
      depletionFractionTable: crop?.depletionFractionP ?? null,
      etcMmDay: etcUsed,
      et0MmDay,
      rainForecastNext24hMm: rainForecast,
      rainProbabilityPct: wx.next24h.maxRainProbabilityPct,
    });
    return {
      pointId: p.id,
      pointName: p.name,
      moisturePct: fresh ? fresh.value : null,
      measuredAt: fresh ? fresh.measuredAt : null,
      result,
      text: describeIrrigation(result),
      savedMm: estimateSavingMm(result),
    };
  });

  const usable = perPoint.filter((p) => p.result.status !== 'insufficient_data');
  const irrigate = perPoint.filter((p) => p.result.status === 'recommend_irrigation');
  const byReason = (reason: string) => perPoint.filter((p) => p.result.status === 'do_not_irrigate' && p.result.reason === reason);
  const rainSkip = byReason('rain_expected');
  const saturated = byReason('at_or_above_field_capacity');
  const noReading = perPoint.filter((p) => p.moisturePct === null);

  const status: FieldIrrigationStatus =
    perPoint.length === 0 || usable.length === 0 ? 'insufficient_data' : irrigate.length > 0 ? 'recommend_irrigation' : 'do_not_irrigate';

  const up = upstreamSentence(upstream);
  const alerts: AlertDraft[] = [];

  if (irrigate.length > 0) {
    const detail = irrigate.map((p) => `${p.pointName}: ${r1((p.result as Extract<IrrigationResult, { status: 'recommend_irrigation' }>).netDepthMm)} mm`).join('; ');
    alerts.push({
      kind: 'engine', code: 'irrigate_now', severity: 'action', pointId: irrigate.length === 1 ? irrigate[0].pointId : null,
      titleEn: 'Irrigation recommended', titleAr: 'يُنصح بالري',
      messageEn: `${irrigate.map((p) => p.text.en).join(' ')} (${detail})`,
      messageAr: irrigate.map((p) => `${p.pointName}: ${p.text.ar}`).join(' '),
      details: { points: irrigate.map((p) => ({ id: p.pointId, name: p.pointName, numbers: p.result.status === 'recommend_irrigation' ? p.result.numbers : null })) },
    });
  }
  if (rainSkip.length > 0) {
    alerts.push({
      kind: 'engine', code: 'rain_expected', severity: 'warning', pointId: rainSkip.length === 1 ? rainSkip[0].pointId : null,
      titleEn: 'Do not irrigate: rain is coming', titleAr: 'لا تروِ: مطر قادم',
      messageEn: `${names(rainSkip)}: ${rainSkip[0].text.en}`,
      messageAr: `${names(rainSkip)}: ${rainSkip[0].text.ar}`,
      details: { points: rainSkip.map((p) => ({ id: p.pointId, name: p.pointName })) },
    });
  }
  if (saturated.length > 0) {
    alerts.push({
      kind: 'engine', code: 'soil_saturated', severity: 'warning', pointId: saturated.length === 1 ? saturated[0].pointId : null,
      titleEn: 'Soil is at field capacity', titleAr: 'التربة وصلت سعة الحقل',
      messageEn: `${names(saturated)}: ${saturated[0].text.en}`,
      messageAr: `${names(saturated)}: ${saturated[0].text.ar}`,
      details: { points: saturated.map((p) => ({ id: p.pointId, name: p.pointName })) },
    });
  }
  if (usable.length === 0 && perPoint.length > 0) {
    const first = perPoint[0].text;
    alerts.push({
      kind: 'engine', code: 'cannot_decide', severity: 'info', pointId: null,
      titleEn: 'Not enough data to decide', titleAr: 'بيانات غير كافية للقرار',
      messageEn: `${first.en}${up?.en ?? ''}`, messageAr: `${first.ar}${up?.ar ?? ''}`,
      details: { upstream },
    });
  }
  if (perPoint.length === 0) {
    alerts.push({
      kind: 'engine', code: 'no_sensor_points', severity: 'info', pointId: null,
      titleEn: 'No sensor points', titleAr: 'لا توجد نقاط مجسات',
      messageEn: 'This environment has no sensor points yet, so no decision can be made.',
      messageAr: 'لا توجد نقاط مجسات لهذه البيئة بعد، لذلك لا يمكن اتخاذ قرار.',
      details: {},
    });
  } else if (noReading.length > 0 && usable.length > 0) {
    alerts.push({
      kind: 'engine', code: 'no_recent_reading', severity: 'info', pointId: null,
      titleEn: 'Some sensors have no recent reading', titleAr: 'بعض المجسات بلا قراءة حديثة',
      messageEn: `${names(noReading)}: no usable reading in the last ${maxAge} hours, so no decision was made for them.`,
      messageAr: `${names(noReading)}: لا توجد قراءة صالحة خلال آخر ${maxAge} ساعات، لذلك لم يُتخذ قرار لها.`,
      details: { points: noReading.map((p) => ({ id: p.pointId, name: p.pointName })) },
    });
  }

  // ---- fertilizer timing from the water balance (FAO-56 Eq. 88: water above field capacity drains and can leach nutrients)
  const leachRisk = usable.filter((p) => {
    const n = (p.result as { numbers: { depletionMm: number; effectiveRainMm: number | null } }).numbers;
    return n.depletionMm <= 0 || (etcUsed !== null && (n.effectiveRainMm ?? 0) - n.depletionMm - etcUsed > 0);
  });
  if (leachRisk.length > 0) {
    alerts.push({
      kind: 'engine', code: 'fertilizer_hold_leaching', severity: 'warning', pointId: leachRisk.length === 1 ? leachRisk[0].pointId : null,
      titleEn: 'Do not apply fertilizer now', titleAr: 'لا تضع السماد الآن',
      messageEn: `${names(leachRisk)}: water is expected to drain below the root zone (soil at field capacity or rain larger than the water the soil can still hold), which can wash nutrients out.`,
      messageAr: `${names(leachRisk)}: يُتوقع أن يتسرب الماء تحت منطقة الجذور (التربة عند سعة الحقل أو مطر أكبر مما تستطيع حمله)، وهذا قد يغسل العناصر الغذائية.`,
      details: { rule: 'FAO-56 Eq. 88', points: leachRisk.map((p) => p.pointId) },
    });
  }
  const heat = input.fertilizerHoldAirTempMaxC;
  if (heat && wx.next24h.maxAirTemperatureC !== null && wx.next24h.maxAirTemperatureC >= heat.value) {
    alerts.push({
      kind: 'engine', code: 'fertilizer_hold_heat', severity: 'warning', pointId: null,
      titleEn: 'Do not apply fertilizer: heat', titleAr: 'لا تضع السماد: حرارة عالية',
      messageEn: `Air temperature is forecast to reach ${r1(wx.next24h.maxAirTemperatureC)}°C, at or above the stored limit of ${heat.value}°C. Fertilizer salts plus heat and dry soil can burn plants: wait for cooler weather, or apply early in the morning with irrigation. This limit is a precaution from garden guidance, not a field-crop trial.`,
      messageAr: `يُتوقع أن تصل حرارة الهواء إلى ${r1(wx.next24h.maxAirTemperatureC)}°م، وهي عند الحد المخزّن (${heat.value}°م) أو فوقه. أملاح السماد مع الحرارة وجفاف التربة قد تحرق النبات: انتظري طقساً أبرد، أو سمّدي باكراً صباحاً مع الري. هذا الحد احتياط من إرشادات الحدائق وليس من تجربة على محاصيل حقلية.`,
      details: { limitC: heat.value, sourceId: heat.sourceId },
    });
  }

  // ---- fertilization decision (needs measured NPK + reference tables)
  const fc = input.fertilizationContext;
  // measured N, P, K: the stored measurements (lab results, sensor values) when there are any, else the plain values of the input
  const picked = input.nutrientMeasurements && input.nutrientMeasurements.length > 0
    ? pickNutrientValues(input.nutrientMeasurements, input.nutrientReference, input.nowMs, input.nutrientMethodLabels)
    : null;
  const fertResult = decideFertilization(picked ? picked.values : input.nutrients, picked ? picked.reference : input.nutrientReference, input.fertilizers, {
    rates: fc?.rates, soilNotes: fc?.soilNotes, fieldSoilName: fc?.soilName ?? null, areaM2: field.areaM2,
    measurements: picked?.used, rejected: picked?.rejected,
  });
  const fertText = describeFertilization(fertResult);

  // ---- estimated saving
  const saving = estimateFieldSaving(perPoint.map((p) => p.result), field.areaM2);
  if (saving && saving.savedMm > 0.05) {
    const vol = saving.savedM3 !== null ? ` (about ${r1(saving.savedM3)} m³)` : '';
    const volAr = saving.savedM3 !== null ? ` (حوالي ${r1(saving.savedM3)} م³)` : '';
    alerts.push({
      kind: 'savings', code: 'estimated_saving', severity: 'info', pointId: null,
      titleEn: 'Estimated water saving', titleAr: 'توفير مياه مُقدَّر',
      messageEn: `About ${r1(saving.savedMm)} mm of irrigation is not needed because rain is expected${vol}. This is a forecast-based estimate, not a measurement.`,
      messageAr: `حوالي ${r1(saving.savedMm)} مم من الري غير مطلوب لأن المطر متوقع${volAr}. هذا تقدير مبني على التوقعات وليس قياساً.`,
      details: { savedMm: saving.savedMm, savedM3: saving.savedM3, basis: saving.basis, formula: 'min(effective rain, Dr); m3 = mm x m2 / 1000' },
    });
  }

  // ---- predictive alerts from an ACTIVE ML model (the engine itself never predicts)
  for (const f of input.forecasts) {
    if (!f.modelActive) continue;
    const made = Date.parse(f.madeAt);
    const target = Date.parse(f.targetTime);
    if (!Number.isFinite(made) || !Number.isFinite(target) || nowMs - made > fcMaxAge * 3_600_000 || target <= nowMs || target > nowMs + 36 * 3_600_000) continue;
    const ev = evaluateForecast({
      forecastMoisturePct: f.predictedMoisturePct,
      fieldCapacityPct: soil?.fieldCapacityPct ?? null,
      wiltingPointPct: soil?.wiltingPointPct ?? null,
      rootDepthM: crop?.rootDepthMinM ?? null,
      depletionFractionTable: crop?.depletionFractionP ?? null,
      etcMmDay: etcUsed,
    });
    if (ev.status !== 'predicted_stress') continue;
    const pt = points.find((p) => p.id === f.sensorPointId);
    const who = pt ? pt.name : field.name;
    const hours = Math.round((target - nowMs) / 3_600_000);
    alerts.push({
      kind: 'forecast', code: 'predicted_stress', severity: 'warning', pointId: pt ? pt.id : null,
      titleEn: 'Forecast: the crop may reach its stress limit', titleAr: 'تنبؤ: قد يصل المحصول لحد الإجهاد',
      messageEn: `${who}: the model (${f.modelName} ${f.modelVersion}) estimates soil moisture of ${r1(f.predictedMoisturePct)}% in about ${hours} h, a depletion of ${r1(ev.depletionMm)} mm against a limit of ${r1(ev.rawMm)} mm. This is a model estimate.`,
      messageAr: `${who}: يقدّر النموذج (${f.modelName} ${f.modelVersion}) رطوبة تربة ${r1(f.predictedMoisturePct)}% بعد حوالي ${hours} ساعة، أي نقص ${r1(ev.depletionMm)} مم مقابل حد ${r1(ev.rawMm)} مم. هذا تقدير من نموذج.`,
      details: { model: f.modelName, version: f.modelVersion, targetTime: f.targetTime, depletionMm: ev.depletionMm, rawMm: ev.rawMm },
    });
  }

  // ---- field level summary
  let summaryEn: string;
  let summaryAr: string;
  if (status === 'recommend_irrigation') {
    summaryEn = `Irrigate at: ${names(irrigate)}.`;
    summaryAr = `اسقِ عند: ${names(irrigate)}.`;
  } else if (status === 'do_not_irrigate') {
    const why = (rainSkip[0] ?? saturated[0] ?? usable[0]).text;
    summaryEn = why.en;
    summaryAr = why.ar;
  } else {
    summaryEn = `${perPoint[0]?.text.en ?? 'No sensor points.'}${up?.en ?? ''}`;
    summaryAr = `${perPoint[0]?.text.ar ?? 'لا توجد نقاط مجسات.'}${up?.ar ?? ''}`;
  }

  return {
    engineVersion: ENGINE_VERSION,
    generatedAt: new Date(nowMs).toISOString(),
    localDay,
    growthStage: curve && curve.status === 'ok' ? curve.stage : null,
    dayOfSeason: curve && curve.status === 'ok' ? curve.dayOfSeason : null,
    kc,
    et0MmDay,
    etcMmDay: etcRange,
    etcUsedMmDay: etcUsed,
    upstream,
    irrigation: { status, summaryEn, summaryAr },
    fertilization: { result: fertResult, text: fertText },
    perPoint,
    alerts,
    saving,
    explanation: {
      en: `${summaryEn} ${fertText.en}`,
      ar: `${summaryAr} ${fertText.ar}`,
    },
  };
}
