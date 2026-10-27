// Pure helpers for what the dashboard shows. No network, no React.
// Rules (docs/STATUS.md): a missing value is NULL, never 0, never imputed; nothing is invented.

export type VariableKey = 'moisture' | 'soil_temperature' | 'ec';

export interface SensorPoint {
  id: string;
  point_name: string;
  latitude: number | null;
  longitude: number | null;
}

export interface Reading {
  sensor_point_id: string;
  measured_at: string;
  moisture: number | null;
  soil_temperature: number | null;
  ec: number | null;
  moisture_status: string | null;
  soil_temperature_status: string | null;
  ec_status: string | null;
}

const STATUS_COLUMN = {
  moisture: 'moisture_status',
  soil_temperature: 'soil_temperature_status',
  ec: 'ec_status',
} as const;

// A value counts only when it exists and its status does not say it is missing or wrong.
const NOT_USABLE = new Set(['not_measured', 'suspect', 'sensor_error']);

export function usableValue(r: Reading, key: VariableKey): number | null {
  const v = r[key];
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const status = r[STATUS_COLUMN[key]];
  if (status && NOT_USABLE.has(status)) return null;
  return v;
}

function safeZone(timeZone: string | null): string {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/** 'YYYY-MM-DD' of an instant in the field's time zone. */
export function localDay(ms: number, timeZone: string | null): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

export function formatLocalTime(iso: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export interface PointValue {
  value: number;
  measuredAt: string;
}

/** Latest usable value of ONE sensor point during the given local day. */
export function pointValueToday(
  readings: Reading[],
  pointId: string,
  key: VariableKey,
  day: string,
  timeZone: string | null,
): PointValue | null {
  let best: PointValue | null = null;
  for (const r of readings) {
    if (r.sensor_point_id !== pointId) continue;
    const ms = Date.parse(r.measured_at);
    if (!Number.isFinite(ms) || localDay(ms, timeZone) !== day) continue;
    const v = usableValue(r, key);
    if (v === null) continue;
    if (!best || ms > Date.parse(best.measuredAt)) best = { value: v, measuredAt: r.measured_at };
  }
  return best;
}

export type VariableSummary =
  | { status: 'not_measured_today' }
  | { status: 'measured'; average: number; lastMeasuredAt: string; pointsMeasured: number; pointsTotal: number };

/** Field level: average of each point's latest value today. Not measured today = say so. */
export function summarizeVariable(
  points: SensorPoint[],
  readings: Reading[],
  key: VariableKey,
  day: string,
  timeZone: string | null,
): VariableSummary {
  const values: PointValue[] = [];
  for (const p of points) {
    const v = pointValueToday(readings, p.id, key, day, timeZone);
    if (v) values.push(v);
  }
  if (values.length === 0) return { status: 'not_measured_today' };
  const average = values.reduce((s, v) => s + v.value, 0) / values.length;
  const lastMeasuredAt = values.reduce((a, b) => (Date.parse(a.measuredAt) >= Date.parse(b.measuredAt) ? a : b)).measuredAt;
  return { status: 'measured', average, lastMeasuredAt, pointsMeasured: values.length, pointsTotal: points.length };
}

export { summarizeWeather, type WeatherRow, type WeatherSummary } from './engine/weather-summary';

export interface MapPosition {
  id: string;
  x: number;
  y: number;
}

export interface ProjectionBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function projectionBounds(points: SensorPoint[]): ProjectionBounds | null {
  const withCoords = points.filter((p) => p.latitude !== null && p.longitude !== null);
  if (withCoords.length === 0) return null;
  const lats = withCoords.map((p) => p.latitude as number);
  const lngs = withCoords.map((p) => p.longitude as number);
  return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
}

const scale = (v: number, lo: number, hi: number) => (hi === lo ? 50 : 10 + ((v - lo) / (hi - lo)) * 80);
const unscale = (x: number, lo: number, hi: number) => (hi === lo ? lo : lo + ((x - 10) / 80) * (hi - lo));

/** Puts points that have coordinates on a 0-100 box (10 % margin, north is up). Points without coordinates are returned separately. */
export function projectPoints(points: SensorPoint[]): { placed: MapPosition[]; unplaced: SensorPoint[] } {
  const b = projectionBounds(points);
  const unplaced = points.filter((p) => p.latitude === null || p.longitude === null);
  if (!b) return { placed: [], unplaced };
  const placed = points
    .filter((p) => p.latitude !== null && p.longitude !== null)
    .map((p) => ({ id: p.id, x: scale(p.longitude as number, b.minLng, b.maxLng), y: 100 - scale(p.latitude as number, b.minLat, b.maxLat) }));
  return { placed, unplaced };
}

/** the inverse of projectPoints: where on the ground is the map position (x, y)? */
export function unprojectXY(b: ProjectionBounds, x: number, y: number): { lat: number; lng: number } {
  return { lng: unscale(x, b.minLng, b.maxLng), lat: unscale(100 - y, b.minLat, b.maxLat) };
}

/** where a ground position falls on the 0-100 box of projectPoints (give it the SAME bounds) */
export function projectLatLng(b: ProjectionBounds, lat: number, lng: number): { x: number; y: number } {
  return { x: scale(lng, b.minLng, b.maxLng), y: 100 - scale(lat, b.minLat, b.maxLat) };
}

/** Map the engine's status words (old and new vocabulary) to what the UI shows. */
export type IrrigationStatus = 'recommend_irrigation' | 'do_not_irrigate' | 'insufficient_data' | 'unknown';

export function normalizeIrrigationStatus(raw: unknown): IrrigationStatus {
  switch (raw) {
    case 'recommend_irrigation':
    case 'irrigate':
      return 'recommend_irrigation';
    case 'do_not_irrigate':
    case 'wait':
      return 'do_not_irrigate';
    case 'insufficient_data':
      return 'insufficient_data';
    default:
      return 'unknown';
  }
}
