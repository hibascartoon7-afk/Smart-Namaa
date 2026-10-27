// ESP32 -> database: parse and check what a device sends, and the device-token helpers.
// Rules (docs/STATUS.md): a value that was not measured stays empty (never 0); an impossible value is stored as 'suspect'
// so the engine ignores it but the owner can still see that a sensor misbehaves.
//
// Payload (JSON, header "Authorization: Bearer <device token>"):
//   { "measured_at": "2026-10-21T09:00:00Z",                       // optional: the server time is used when missing
//     "readings": [ { "sensor": "1", "moisture": 31.2, "soil_temperature": 24.1, "ec": 1.3 },
//                   { "sensor": "left", "moisture": null } ] }       // null / missing = not measured
//
// An NPK sensor adds "nitrogen", "phosphorus", "potassium" (plain numbers, never negative) to a reading. Their UNIT and METHOD are NOT sent
// by the device: the owner declares them on the device (devices.npk_unit, devices.npk_method_code), because a device must not decide
// what its own numbers mean. They are stored in nutrient_measurements (one value per nutrient and request: the mean of the sensor points
// that sent one), and the fertilization decision uses them only if a stored limit exists for that method and unit.

export type ReadingStatus = 'measured' | 'not_measured' | 'suspect';

/** physical limits only (a sensor cannot read outside them), not agronomic limits */
export const LIMITS = {
  moisture: { min: 0, max: 100 }, // percent by volume
  soil_temperature: { min: -50, max: 100 }, // degrees C
  ec: { min: 0, max: 100 }, // dS/m
} as const;
/** an NPK sensor cannot read below 0 or above 1 000 000 (mg/kg; 1 000 000 mg/kg = 100 %): a physical limit, not an agronomic one */
export const NUTRIENT_LIMITS = { min: 0, max: 1_000_000 } as const;
export const NUTRIENT_KEYS = { nitrogen: 'n', phosphorus: 'p', potassium: 'k' } as const;
export type NutrientCode = 'n' | 'p' | 'k';
export const MAX_READINGS_PER_REQUEST = 50;
const MAX_FUTURE_MS = 5 * 60_000;
const MAX_PAST_MS = 24 * 3_600_000;

export interface ParsedReading {
  sensor: string;
  moisture: number | null;
  soil_temperature: number | null;
  ec: number | null;
  moisture_status: ReadingStatus;
  soil_temperature_status: ReadingStatus;
  ec_status: ReadingStatus;
  /** NPK sensor values (null = not sent); the status says whether a sent value is usable */
  nutrients: Record<NutrientCode, { value: number | null; status: ReadingStatus }>;
}

export type IngestParse =
  | { ok: true; measuredAt: string; readings: ParsedReading[] }
  | { ok: false; error: string };

function numberField(v: unknown, min: number, max: number): { value: number | null; status: ReadingStatus } {
  if (v === null || v === undefined) return { value: null, status: 'not_measured' };
  if (typeof v !== 'number' || !Number.isFinite(v)) return { value: null, status: 'suspect' };
  return { value: v, status: v < min || v > max ? 'suspect' : 'measured' };
}

function field(v: unknown, key: keyof typeof LIMITS): { value: number | null; status: ReadingStatus } {
  const { min, max } = LIMITS[key];
  return numberField(v, min, max);
}

export function parseIngestPayload(body: unknown, nowMs: number): IngestParse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;

  let measuredAt = new Date(nowMs).toISOString();
  if (b.measured_at !== undefined && b.measured_at !== null) {
    const t = typeof b.measured_at === 'string' ? Date.parse(b.measured_at) : Number.NaN;
    if (!Number.isFinite(t)) return { ok: false, error: 'measured_at is not a valid ISO date' };
    if (t > nowMs + MAX_FUTURE_MS) return { ok: false, error: 'measured_at is in the future' };
    if (t < nowMs - MAX_PAST_MS) return { ok: false, error: 'measured_at is older than 24 hours' };
    measuredAt = new Date(t).toISOString();
  }

  if (!Array.isArray(b.readings) || b.readings.length === 0) return { ok: false, error: 'readings must be a non-empty array' };
  if (b.readings.length > MAX_READINGS_PER_REQUEST) return { ok: false, error: `at most ${MAX_READINGS_PER_REQUEST} readings per request` };

  const readings: ParsedReading[] = [];
  const seen = new Set<string>();
  for (const [i, item] of b.readings.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return { ok: false, error: `readings[${i}] must be an object` };
    const r = item as Record<string, unknown>;
    if (typeof r.sensor !== 'string' && typeof r.sensor !== 'number') return { ok: false, error: `readings[${i}].sensor (the sensor name) is required` };
    const sensor = String(r.sensor).replace(/\s+/g, ' ').trim();
    if (!sensor || sensor.length > 50) return { ok: false, error: `readings[${i}].sensor must be 1-50 characters` };
    if (seen.has(sensor.toLowerCase())) return { ok: false, error: `sensor "${sensor}" appears twice in one request` };
    seen.add(sensor.toLowerCase());

    const m = field(r.moisture, 'moisture');
    const t = field(r.soil_temperature, 'soil_temperature');
    const e = field(r.ec, 'ec');
    const nutrients = {} as ParsedReading['nutrients'];
    for (const [key, code] of Object.entries(NUTRIENT_KEYS) as [keyof typeof NUTRIENT_KEYS, NutrientCode][]) {
      const f = numberField(r[key], NUTRIENT_LIMITS.min, NUTRIENT_LIMITS.max);
      // a sensor value of a nutrient is stored as sent: an invalid one keeps its value out (null) and is reported
      nutrients[code] = { value: f.status === 'measured' ? f.value : null, status: f.status };
    }
    readings.push({
      sensor,
      moisture: m.value, soil_temperature: t.value, ec: e.value,
      moisture_status: m.status, soil_temperature_status: t.status, ec_status: e.status,
      nutrients,
    });
  }
  return { ok: true, measuredAt, readings };
}

/** matches the names a device sends with the sensor points of its environment (case and spaces ignored) */
export function matchSensors(
  readings: ParsedReading[],
  points: { id: string; point_name: string }[],
): { matched: { pointId: string; reading: ParsedReading }[]; unknown: string[] } {
  const key = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const byName = new Map(points.map((p) => [key(p.point_name), p.id]));
  const matched: { pointId: string; reading: ParsedReading }[] = [];
  const unknown: string[] = [];
  for (const r of readings) {
    const id = byName.get(key(r.sensor));
    if (id) matched.push({ pointId: id, reading: r });
    else unknown.push(r.sensor);
  }
  return { matched, unknown };
}

export const TOKEN_PREFIX = 'nmd_';

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 of the token, hex. Only this hash is stored. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

/** 32 random bytes (256 bits) as hex, with a prefix so a leaked token is recognisable */
export function generateDeviceToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return TOKEN_PREFIX + toHex(bytes);
}

export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m ? m[1] : null;
}
