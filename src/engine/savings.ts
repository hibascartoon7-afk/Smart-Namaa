// Estimated irrigation water saved because rain is expected (a water-balance credit, not a measurement).
//
//   saved depth (mm) = min( effective rain , Dr )       only when irrigation WOULD have been triggered (Dr >= RAW)
//   saved volume (m3) = saved depth (mm) x area (m2) / 1000        because 1 mm over 1 m2 = 1 litre
//
// Source of the logic: FAO-56 Chapter 8. Irrigation is due when the root-zone depletion Dr reaches RAW and the net
// depth is at most Dr ("Forecasting or allocating irrigations"); expected rain reduces Dr by P (Eq. 85, rain below
// about 0.2 ETo ignored). Without the rain forecast the farmer would have applied Dr, so the rain credit
// (never more than Dr) is the water not applied.
// What this is NOT: it does not claim savings against a fixed timetable or a flood-irrigation habit, because
// we do not know the farmer's baseline. It is a forecast-based estimate and is labelled as such everywhere.

import type { IrrigationResult } from './water-balance';

export interface SavingEstimate {
  savedMm: number;
  savedM3: number | null;
  basis: 'forecast';
}

export function litresFromMm(depthMm: number, areaM2: number): number {
  return depthMm * areaM2;
}

export function estimateSavingMm(result: IrrigationResult): number {
  if (result.status === 'insufficient_data') return 0;
  const n = result.numbers;
  const rain = n.effectiveRainMm ?? 0;
  if (rain <= 0) return 0;
  if (result.status === 'do_not_irrigate') {
    // only "rain_expected" means irrigation was avoided because of rain
    return result.reason === 'rain_expected' ? Math.min(rain, n.depletionMm) : 0;
  }
  // irrigate, but less than without the rain
  return Math.min(rain, n.depletionMm);
}

/** Field level: mean of the sensor points that have a decision (each point stands for an equal share of the field). */
export function estimateFieldSaving(results: IrrigationResult[], areaM2: number | null): SavingEstimate | null {
  const usable = results.filter((r) => r.status !== 'insufficient_data');
  if (usable.length === 0) return null;
  const savedMm = usable.reduce((s, r) => s + estimateSavingMm(r), 0) / usable.length;
  const validArea = areaM2 !== null && Number.isFinite(areaM2) && areaM2 > 0;
  return { savedMm, savedM3: validArea ? (savedMm * (areaM2 as number)) / 1000 : null, basis: 'forecast' };
}
