// Open-Meteo hourly response -> rows for public.weather_observations.
// Pure TypeScript (no Deno / Node APIs) so it can be unit-tested with vitest.
// Rule: a value that is missing, not a number, or out of range becomes NULL. Never 0.
// Docs: https://open-meteo.com/en/docs

export const HOURLY_VARIABLES = [
  'temperature_2m',
  'precipitation',
  'precipitation_probability',
  'et0_fao_evapotranspiration',
] as const;

export interface FieldLocation {
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface HourlyRow {
  observed_at: string; // ISO-8601 UTC
  air_temperature_c: number | null;
  precipitation_mm: number | null;
  rain_probability_pct: number | null;
  et0_mm: number | null;
}

export type ParseResult =
  | { ok: true; rows: HourlyRow[]; rejected: number }
  | { ok: false; error: string };

/** Units are requested explicitly, so they cannot silently change. Time comes as unix seconds (UTC). */
export function buildOpenMeteoUrl(f: FieldLocation, pastDays = 1, forecastDays = 3): string {
  if (!Number.isFinite(f.latitude) || f.latitude < -90 || f.latitude > 90) throw new Error('invalid latitude');
  if (!Number.isFinite(f.longitude) || f.longitude < -180 || f.longitude > 180) throw new Error('invalid longitude');
  if (!f.timezone || f.timezone.trim() === '') throw new Error('invalid timezone');
  const p = new URLSearchParams({
    latitude: String(f.latitude),
    longitude: String(f.longitude),
    hourly: HOURLY_VARIABLES.join(','),
    timezone: f.timezone,
    timeformat: 'unixtime',
    temperature_unit: 'celsius',
    precipitation_unit: 'mm',
    past_days: String(pastDays),
    forecast_days: String(forecastDays),
  });
  return `https://api.open-meteo.com/v1/forecast?${p.toString()}`;
}

type Check = (v: number) => boolean;
const RULES: Record<(typeof HOURLY_VARIABLES)[number], { field: keyof Omit<HourlyRow, 'observed_at'>; ok: Check }> = {
  temperature_2m: { field: 'air_temperature_c', ok: (v) => v >= -60 && v <= 70 },
  precipitation: { field: 'precipitation_mm', ok: (v) => v >= 0 },
  precipitation_probability: { field: 'rain_probability_pct', ok: (v) => v >= 0 && v <= 100 },
  et0_fao_evapotranspiration: { field: 'et0_mm', ok: (v) => v >= 0 },
};

export function parseOpenMeteoHourly(json: unknown): ParseResult {
  if (typeof json !== 'object' || json === null) return { ok: false, error: 'response is not an object' };
  const hourly = (json as { hourly?: unknown }).hourly;
  if (typeof hourly !== 'object' || hourly === null) return { ok: false, error: 'response has no "hourly" block' };
  const h = hourly as Record<string, unknown>;

  const time = h.time;
  if (!Array.isArray(time) || time.length === 0) return { ok: false, error: 'hourly.time is missing or empty' };
  if (!time.every((t) => typeof t === 'number' && Number.isFinite(t))) {
    return { ok: false, error: 'hourly.time must be unix seconds (timeformat=unixtime)' };
  }

  for (const name of HOURLY_VARIABLES) {
    const arr = h[name];
    if (!Array.isArray(arr)) return { ok: false, error: `hourly.${name} is missing` };
    if (arr.length !== time.length) return { ok: false, error: `hourly.${name} length differs from hourly.time` };
  }

  let rejected = 0;
  const rows: HourlyRow[] = (time as number[]).map((sec, i) => {
    const row: HourlyRow = {
      observed_at: new Date(sec * 1000).toISOString(),
      air_temperature_c: null,
      precipitation_mm: null,
      rain_probability_pct: null,
      et0_mm: null,
    };
    for (const name of HOURLY_VARIABLES) {
      const raw = (h[name] as unknown[])[i];
      if (raw === null || raw === undefined) continue; // API has no value -> stays NULL
      if (typeof raw !== 'number' || !Number.isFinite(raw) || !RULES[name].ok(raw)) {
        rejected++; // present but unusable -> NULL, and we count it
        continue;
      }
      row[RULES[name].field] = raw;
    }
    return row;
  });

  return { ok: true, rows, rejected };
}
