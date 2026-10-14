import type {
  FieldMeter, ValidatedReading, WeatherForecast, IrrigationPriorityResult,
  FertilizerPriorityResult,
} from "./types.ts";

const VWC_THRESHOLDS: Record<string, { optimal: number; critical: number }> = {
  high: { optimal: 30, critical: 24 },
  mid: { optimal: 28, critical: 22 },
  low: { optimal: 26, critical: 20 },
};

const NUTRIENT_THRESHOLDS = {
  n: { critical: 25, low: 40 },
  p: { critical: 12, low: 20 },
  k: { critical: 130, low: 180 },
};

const EC_SALINITY_THRESHOLD = 6.0;
const HIGH_RAIN_PROBABILITY = 50;
const HIGH_RAINFALL_MM = 5.0;

export function calculateIrrigationPriority(
  meters: FieldMeter[],
  readings: ValidatedReading[],
  weather: WeatherForecast | null,
): IrrigationPriorityResult[] {
  const rainExpected = weather
    ? weather.rain_probability_3h >= HIGH_RAIN_PROBABILITY && weather.expected_rainfall_mm >= HIGH_RAINFALL_MM
    : false;

  const results: IrrigationPriorityResult[] = readings.map((reading) => {
    const meter = meters.find((m) => m.id === reading.meter_id);
    if (!meter) return null;

    const thresholds = VWC_THRESHOLDS[meter.elevation] ?? VWC_THRESHOLDS.mid;
    const vwcDeficit = thresholds.optimal - reading.vwc;
    const isCritical = reading.vwc < thresholds.critical;

    let score = 0;
    if (isCritical) score += 40;
    score += Math.max(0, vwcDeficit) * 1.5;

    if (meter.elevation === "high") score += 12;
    else if (meter.elevation === "mid") score += 4;

    score += meter.slope * 1.2;

    if (reading.is_stale) score -= 10;

    if (rainExpected) {
      const rainCoverage = Math.min(1, (weather?.expected_rainfall_mm ?? 0) / 8);
      score -= rainCoverage * 15;
    }

    const deficitMm = Math.max(0, ((thresholds.optimal - reading.vwc) / 100) * 300);
    const recommendedDose = Math.max(0, deficitMm * 0.01 * 100);

    let reason = `VWC ${reading.vwc}% (threshold ${thresholds.critical}%–${thresholds.optimal}% for ${meter.elevation} elevation)`;
    if (meter.elevation === "high") reason += `, high elevation dries faster`;
    if (rainExpected) reason += `, rain expected (${weather?.expected_rainfall_mm}mm) reduces urgency`;
    if (reading.is_stale) reason += `, data is stale (${reading.age_minutes} min old)`;

    return {
      meter_id: reading.meter_id,
      priority_score: Math.round(score * 10) / 10,
      rank: 0,
      vwc: reading.vwc,
      elevation: meter.elevation,
      slope: meter.slope,
      deficit_mm: Math.round(deficitMm * 10) / 10,
      recommended_dose_m3: Math.round(recommendedDose * 10) / 10,
      reason,
    };
  }).filter((r): r is IrrigationPriorityResult => r !== null);

  results.sort((a, b) => b.priority_score - a.priority_score);
  results.forEach((r, i) => { r.rank = i + 1; });

  return results;
}

export function calculateFertilizerPriority(
  meters: FieldMeter[],
  readings: ValidatedReading[],
  weather: WeatherForecast | null,
): FertilizerPriorityResult[] {
  const rainWarning = weather
    ? weather.rain_probability_3h >= HIGH_RAIN_PROBABILITY && weather.expected_rainfall_mm >= HIGH_RAINFALL_MM
    : false;

  const results: FertilizerPriorityResult[] = [];

  for (const reading of readings) {
    const meter = meters.find((m) => m.id === reading.meter_id);
    if (!meter || reading.is_stale) continue;

    for (const [nutrient, thresholds] of Object.entries(NUTRIENT_THRESHOLDS)) {
      const value = reading[nutrient as "n" | "p" | "k"] as number;
      let urgency: FertilizerPriorityResult["urgency"] = "moderate";
      if (value < thresholds.critical) urgency = "critical";
      else if (value < thresholds.low) urgency = "high";

      if (urgency === "moderate") continue;

      let reason = `${nutrient.toUpperCase()} at ${value} (critical <${thresholds.critical}, low <${thresholds.low})`;
      if (reading.ec > EC_SALINITY_THRESHOLD) reason += `, high EC (${reading.ec} mS/cm) — salinity stress limits uptake`;
      if (rainWarning) reason += `, rain expected — delay application to prevent leaching`;

      results.push({
        meter_id: reading.meter_id,
        nutrient: nutrient.toUpperCase() as "N" | "P" | "K",
        urgency,
        value,
        threshold: thresholds.critical,
        ec: reading.ec,
        reason,
        rain_warning: rainWarning,
      });
    }
  }

  results.sort((a, b) => {
    const order = { critical: 0, high: 1, moderate: 2, low: 3 };
    return order[a.urgency] - order[b.urgency];
  });

  return results;
}

export function calculateWaterScarcityPriority(
  meters: FieldMeter[],
  readings: ValidatedReading[],
  weather: WeatherForecast | null,
): IrrigationPriorityResult[] {
  const priorities = calculateIrrigationPriority(meters, readings, weather);
  return priorities.filter((p) => p.priority_score > 20).slice(0, 3);
}
