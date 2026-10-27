// Predictive alert from an ML moisture forecast.
// The model only ESTIMATES a moisture value. THIS function turns that estimate into an alert using the same
// physics as the irrigation decision (FAO-56 Chapter 8): the forecast moisture gives a root-zone depletion
// (Eq. 87); if it reaches RAW (Eq. 83) the crop is predicted to reach its stress limit.
// The result is always worded as an estimate and carries the model name and version.

import { adjustedDepletionFraction, rootZoneDepletionMm, totalAvailableWaterMm } from './water-balance';

export interface ForecastAlertInput {
  forecastMoisturePct: number | null;
  fieldCapacityPct: number | null;
  wiltingPointPct: number | null;
  rootDepthM: number | null;
  depletionFractionTable: number | null;
  etcMmDay: number | null;
}

export type ForecastAlertResult =
  | { status: 'insufficient_data'; fields: string[] }
  | { status: 'no_alert'; depletionMm: number; rawMm: number }
  | { status: 'predicted_stress'; depletionMm: number; rawMm: number; tawMm: number };

export function evaluateForecast(i: ForecastAlertInput): ForecastAlertResult {
  const need: [string, number | null][] = [
    ['forecast_moisture', i.forecastMoisturePct],
    ['field_capacity', i.fieldCapacityPct],
    ['wilting_point', i.wiltingPointPct],
    ['root_depth', i.rootDepthM],
    ['depletion_fraction', i.depletionFractionTable],
    ['etc', i.etcMmDay],
  ];
  const missing = need.filter(([, v]) => v === null || v === undefined || !Number.isFinite(v)).map(([k]) => k);
  if (missing.length) return { status: 'insufficient_data', fields: missing };

  const forecast = i.forecastMoisturePct as number;
  if (forecast < 0 || forecast > 100) return { status: 'insufficient_data', fields: ['forecast_moisture'] };
  const taw = totalAvailableWaterMm(i.fieldCapacityPct as number, i.wiltingPointPct as number, i.rootDepthM as number);
  if (taw === null) return { status: 'insufficient_data', fields: ['soil_or_root_depth'] };

  const rawMm = adjustedDepletionFraction(i.depletionFractionTable as number, i.etcMmDay as number) * taw;
  const depletionMm = rootZoneDepletionMm(i.fieldCapacityPct as number, forecast, i.rootDepthM as number);
  return depletionMm >= rawMm ? { status: 'predicted_stress', depletionMm, rawMm, tawMm: taw } : { status: 'no_alert', depletionMm, rawMm };
}
