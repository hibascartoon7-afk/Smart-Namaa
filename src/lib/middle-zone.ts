// What the screen shows for the "middle zone" between two sensor points (rule and limits: src/engine/middle-zone.ts).
// Pure helpers, no React. The value is always the mean of the two sensors' readings of TODAY; nothing is invented.
import { middleZone, midpoint, type MiddleZone } from './engine/middle-zone';
import { pointValueToday, projectionBounds, projectLatLng, type Reading, type SensorPoint, type VariableKey } from './field-math';

export type Pair = [string, string];
export const ZONE_VARIABLES: VariableKey[] = ['moisture', 'soil_temperature', 'ec'];

/** the pair shown first: the first two points that have coordinates (so they can be drawn), else the first two points */
export function defaultPair(points: SensorPoint[]): Pair | null {
  if (points.length < 2) return null;
  const located = points.filter((p) => p.latitude !== null && p.longitude !== null);
  const pick = located.length >= 2 ? located : points;
  return [pick[0].id, pick[1].id];
}

/** the chosen pair when both points still exist and are different, otherwise the default pair */
export function validPair(points: SensorPoint[], chosen: Pair | null): Pair | null {
  if (chosen && chosen[0] !== chosen[1] && points.some((p) => p.id === chosen[0]) && points.some((p) => p.id === chosen[1])) return chosen;
  return defaultPair(points);
}

/** the estimate of each variable in the middle zone: mean of the two points' latest usable reading today, or "unavailable" */
export function middleZoneValues(
  points: SensorPoint[],
  readings: Reading[],
  pair: Pair,
  day: string,
  timeZone: string | null,
): Record<VariableKey, MiddleZone> {
  const a = points.find((p) => p.id === pair[0]);
  const b = points.find((p) => p.id === pair[1]);
  const out = {} as Record<VariableKey, MiddleZone>;
  for (const key of ZONE_VARIABLES) {
    out[key] = middleZone(
      { name: a?.point_name ?? '?', value: a ? pointValueToday(readings, a.id, key, day, timeZone)?.value ?? null : null },
      { name: b?.point_name ?? '?', value: b ? pointValueToday(readings, b.id, key, day, timeZone)?.value ?? null : null },
    );
  }
  return out;
}

/** where to draw the middle zone on the 0-100 map box; null when one of the two points has no coordinates */
export function middleZoneMarker(points: SensorPoint[], pair: Pair): { from: { x: number; y: number }; to: { x: number; y: number }; mid: { x: number; y: number } } | null {
  const a = points.find((p) => p.id === pair[0]);
  const b = points.find((p) => p.id === pair[1]);
  const bounds = projectionBounds(points);
  if (!a || !b || !bounds || a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) return null;
  const m = midpoint({ lat: a.latitude, lng: a.longitude }, { lat: b.latitude, lng: b.longitude });
  return {
    from: projectLatLng(bounds, a.latitude, a.longitude),
    to: projectLatLng(bounds, b.latitude, b.longitude),
    mid: projectLatLng(bounds, m.lat, m.lng),
  };
}
