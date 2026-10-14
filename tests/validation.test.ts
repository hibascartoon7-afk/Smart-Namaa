import { describe, it, expect } from 'vitest';
import { validateReading, validateReadings } from '../supabase/functions/namaa-chat/lib/validation.ts';
import type { MeterReading } from '../supabase/functions/namaa-chat/lib/types.ts';

function makeReading(overrides: Partial<MeterReading> = {}): MeterReading {
  return {
    meter_id: 'M1',
    n: 42, p: 18, k: 165, ec: 2.1, temp: 22.4, ph: 6.8, vwc: 24,
    ts: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

describe('validateReading — stale detection', () => {
  it('marks readings older than 30 minutes as stale', () => {
    const reading = makeReading({ ts: new Date(Date.now() - 45 * 60_000).toISOString() });
    const result = validateReading(reading);
    expect(result.is_stale).toBe(true);
    expect(result.age_minutes).toBeGreaterThanOrEqual(45);
  });

  it('marks fresh readings as not stale', () => {
    const reading = makeReading({ ts: new Date(Date.now() - 10 * 60_000).toISOString() });
    const result = validateReading(reading);
    expect(result.is_stale).toBe(false);
  });

  it('includes stale warning in warnings array', () => {
    const reading = makeReading({ ts: new Date(Date.now() - 40 * 60_000).toISOString() });
    const result = validateReading(reading);
    expect(result.warnings.some((w) => w.includes('stale'))).toBe(true);
  });

  it('reports age in minutes accurately', () => {
    const reading = makeReading({ ts: new Date(Date.now() - 5 * 60_000).toISOString() });
    const result = validateReading(reading);
    expect(result.age_minutes).toBeGreaterThanOrEqual(4);
    expect(result.age_minutes).toBeLessThanOrEqual(6);
  });
});

describe('validateReading — impossible values', () => {
  it('flags VWC above 100% as impossible', () => {
    const reading = makeReading({ vwc: 150 });
    const result = validateReading(reading);
    expect(result.warnings.some((w) => w.includes('VWC'))).toBe(true);
  });

  it('flags VWC below 0 as impossible', () => {
    const reading = makeReading({ vwc: -5 });
    const result = validateReading(reading);
    expect(result.warnings.some((w) => w.includes('VWC'))).toBe(true);
  });

  it('flags pH above 10 as impossible', () => {
    const reading = makeReading({ ph: 12 });
    const result = validateReading(reading);
    expect(result.warnings.some((w) => w.includes('pH'))).toBe(true);
  });

  it('flags pH below 3 as impossible', () => {
    const reading = makeReading({ ph: 2 });
    const result = validateReading(reading);
    expect(result.warnings.some((w) => w.includes('pH'))).toBe(true);
  });

  it('flags EC above 15 as impossible', () => {
    const reading = makeReading({ ec: 20 });
    const result = validateReading(reading);
    expect(result.warnings.some((w) => w.includes('EC'))).toBe(true);
  });

  it('flags temperature above 50 as impossible', () => {
    const reading = makeReading({ temp: 60 });
    const result = validateReading(reading);
    expect(result.warnings.some((w) => w.includes('temperature'))).toBe(true);
  });

  it('flags temperature below -10 as impossible', () => {
    const reading = makeReading({ temp: -15 });
    const result = validateReading(reading);
    expect(result.warnings.some((w) => w.includes('temperature'))).toBe(true);
  });

  it('flags nitrogen above 200 as impossible', () => {
    const reading = makeReading({ n: 300 });
    const result = validateReading(reading);
    expect(result.warnings.some((w) => w.includes('Nitrogen'))).toBe(true);
  });
});

describe('validateReading — valid readings', () => {
  it('produces no warnings for a normal reading', () => {
    const reading = makeReading();
    const result = validateReading(reading);
    expect(result.warnings.length).toBe(0);
    expect(result.is_stale).toBe(false);
  });

  it('preserves original reading values', () => {
    const reading = makeReading({ n: 55, vwc: 30 });
    const result = validateReading(reading);
    expect(result.n).toBe(55);
    expect(result.vwc).toBe(30);
    expect(result.meter_id).toBe('M1');
  });
});

describe('validateReadings — batch', () => {
  it('validates multiple readings', () => {
    const readings = [
      makeReading({ meter_id: 'M1', vwc: 24 }),
      makeReading({ meter_id: 'M2', vwc: -10 }),
      makeReading({ meter_id: 'M3', ts: new Date(Date.now() - 60 * 60_000).toISOString() }),
    ];
    const results = validateReadings(readings);
    expect(results.length).toBe(3);
    expect(results[1].warnings.length).toBeGreaterThan(0);
    expect(results[2].is_stale).toBe(true);
  });

  it('returns empty array for empty input', () => {
    expect(validateReadings([])).toEqual([]);
  });
});
