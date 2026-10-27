// Middle zone between TWO sensor points: the value between them is estimated as the MEAN of their two readings.
//
//   value = (reading A + reading B) / 2
//
// This is a NAMAA rule, not a formula from a source (docs/formulas.md, F-005). It is the simplest estimate between two
// sensors: it is what inverse distance weighting (src/engine/idw.ts) gives halfway between two points (equal distances,
// equal weights; for the distances of a field the two differ by far less than a sensor can resolve).
// Honest limits, shown to the user with every value:
//   - it is an ESTIMATE, not a measurement; nothing is measured in the middle;
//   - it can never be above the higher or below the lower reading, but the real soil can be (a wet patch, a leak, a dry spot
//     between the sensors cannot be seen);
//   - with only two sensors the error cannot be checked (idw.ts needs 3 sensors for its leave-one-out error), so the two
//     readings and their difference are returned and shown beside the estimate;
//   - it is for DISPLAY only: the irrigation decision still uses each sensor point's own reading.
// A missing reading is never replaced by 0 or by the other sensor's value: with one reading missing there is no estimate.

export interface ZoneSensor {
  name: string;
  /** today's usable reading, or null when there is none */
  value: number | null;
}

export type MiddleZone =
  | { status: 'ok'; value: number; low: { name: string; value: number }; high: { name: string; value: number }; difference: number }
  | { status: 'unavailable'; reason: 'reading_missing'; missing: string[] };

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function middleZone(a: ZoneSensor, b: ZoneSensor): MiddleZone {
  const missing = [a, b].filter((s) => !isNum(s.value)).map((s) => s.name);
  if (missing.length > 0) return { status: 'unavailable', reason: 'reading_missing', missing };
  const va = a.value as number;
  const vb = b.value as number;
  const [low, high] = va <= vb ? [a, b] : [b, a];
  return {
    status: 'ok',
    value: (va + vb) / 2,
    low: { name: low.name, value: low.value as number },
    high: { name: high.name, value: high.value as number },
    difference: Math.abs(va - vb),
  };
}

/**
 * Where the middle zone is on the ground: halfway between the two sensor points. A plain average of the coordinates is exact
 * enough for the size of a field (hundreds of metres); it is not meant for points far apart or across the 180th meridian.
 */
export function midpoint(a: { lat: number; lng: number }, b: { lat: number; lng: number }): { lat: number; lng: number } {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}
