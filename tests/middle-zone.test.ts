import { describe, it, expect } from 'vitest';
import { middleZone, midpoint } from '../src/engine/middle-zone';
import { idwAt } from '../src/engine/idw';

describe('middle zone between two sensors', () => {
  it('is the mean of the two readings, with both readings and their difference', () => {
    const z = middleZone({ name: 'A', value: 20 }, { name: 'B', value: 30 });
    expect(z).toEqual({ status: 'ok', value: 25, low: { name: 'A', value: 20 }, high: { name: 'B', value: 30 }, difference: 10 });
  });

  it('does not depend on the order of the two sensors', () => {
    expect(middleZone({ name: 'B', value: 30 }, { name: 'A', value: 20 })).toEqual(middleZone({ name: 'A', value: 20 }, { name: 'B', value: 30 }));
  });

  it('is never above the higher or below the lower reading', () => {
    for (const [a, b] of [[10, 12.5], [0, 55], [-3, 4], [40.1, 40.1]]) {
      const z = middleZone({ name: 'A', value: a }, { name: 'B', value: b });
      if (z.status !== 'ok') throw new Error('expected an estimate');
      expect(z.value).toBeGreaterThanOrEqual(Math.min(a, b));
      expect(z.value).toBeLessThanOrEqual(Math.max(a, b));
    }
  });

  it('equal readings: the same value, difference 0', () => {
    expect(middleZone({ name: 'A', value: 33 }, { name: 'B', value: 33 })).toMatchObject({ status: 'ok', value: 33, difference: 0 });
  });

  it('a reading of 0 is a real reading, not a missing one', () => {
    expect(middleZone({ name: 'A', value: 0 }, { name: 'B', value: 30 })).toMatchObject({ status: 'ok', value: 15 });
  });

  it('a missing reading gives NO estimate: it is never replaced by 0 or by the other sensor', () => {
    expect(middleZone({ name: 'A', value: null }, { name: 'B', value: 30 })).toEqual({ status: 'unavailable', reason: 'reading_missing', missing: ['A'] });
    expect(middleZone({ name: 'A', value: 20 }, { name: 'B', value: null })).toEqual({ status: 'unavailable', reason: 'reading_missing', missing: ['B'] });
    expect(middleZone({ name: 'A', value: null }, { name: 'B', value: null })).toEqual({ status: 'unavailable', reason: 'reading_missing', missing: ['A', 'B'] });
  });

  it('NaN and infinity count as missing', () => {
    expect(middleZone({ name: 'A', value: Number.NaN }, { name: 'B', value: 30 })).toMatchObject({ status: 'unavailable', missing: ['A'] });
    expect(middleZone({ name: 'A', value: 10 }, { name: 'B', value: Number.POSITIVE_INFINITY })).toMatchObject({ status: 'unavailable', missing: ['B'] });
  });

  it('matches inverse distance weighting halfway between the two sensors, to far better than a sensor can resolve (the claim in middle-zone.ts)', () => {
    const a = { id: 'a', lat: 32.2211, lng: 35.2544, value: 18.4 };
    const b = { id: 'b', lat: 32.2219, lng: 35.2561, value: 31.7 };
    const mid = midpoint(a, b);
    const z = middleZone({ name: 'A', value: a.value }, { name: 'B', value: b.value });
    if (z.status !== 'ok') throw new Error('expected an estimate');
    // the coordinate average is not exactly equidistant on the sphere: the difference is about 1e-5 on a 13-point gap
    for (const power of [1, 2, 3]) expect(Math.abs((idwAt([a, b], mid, power) as number) - z.value)).toBeLessThan(0.001);
  });

  it('midpoint: halfway between the two coordinates', () => {
    expect(midpoint({ lat: 32, lng: 35 }, { lat: 33, lng: 36 })).toEqual({ lat: 32.5, lng: 35.5 });
  });
});
