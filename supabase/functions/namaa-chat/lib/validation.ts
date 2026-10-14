import type { MeterReading, ValidatedReading } from "./types.ts";

const STALE_THRESHOLD_MINUTES = 30;
const RANGES: Record<string, { min: number; max: number; label: string }> = {
  n: { min: 0, max: 200, label: "Nitrogen" },
  p: { min: 0, max: 100, label: "Phosphorus" },
  k: { min: 0, max: 500, label: "Potassium" },
  ec: { min: 0, max: 15, label: "EC" },
  temp: { min: -10, max: 50, label: "Soil temperature" },
  ph: { min: 3, max: 10, label: "pH" },
  vwc: { min: 0, max: 100, label: "VWC" },
};

export function validateReading(reading: MeterReading): ValidatedReading {
  const warnings: string[] = [];
  const now = Date.now();
  const readingTime = new Date(reading.ts).getTime();
  const ageMinutes = Math.max(0, (now - readingTime) / 60000);
  const isStale = ageMinutes > STALE_THRESHOLD_MINUTES;

  if (isStale) {
    warnings.push(`Sensor data is ${Math.round(ageMinutes)} min old (stale threshold: ${STALE_THRESHOLD_MINUTES} min)`);
  }

  for (const [key, range] of Object.entries(RANGES)) {
    const value = reading[key as keyof MeterReading] as number;
    if (value === null || value === undefined || isNaN(value)) {
      warnings.push(`${range.label} value is null/invalid`);
    } else if (value < range.min || value > range.max) {
      warnings.push(`${range.label} value ${value} is outside plausible range [${range.min}, ${range.max}]`);
    }
  }

  return { ...reading, is_stale: isStale, age_minutes: Math.round(ageMinutes), warnings };
}

export function validateReadings(readings: MeterReading[]): ValidatedReading[] {
  return readings.map(validateReading);
}
