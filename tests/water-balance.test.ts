import { describe, it, expect } from 'vitest';
import {
  adjustedDepletionFraction,
  decideIrrigation,
  describeIrrigation,
  effectiveRainMm,
  rootZoneDepletionMm,
  totalAvailableWaterMm,
  type IrrigationInput,
} from '../src/engine/water-balance';

// Numbers below come from FAO-56 Chapter 8, Examples 36 and 37 (https://www.fao.org/4/X0490e/x0490e0e.htm).

describe('TAW and RAW (Eq. 82, 83) against the book', () => {
  it('Example 37: tomato Zr 0.8 m, p 0.40, silt FC 32 / WP 12  ->  TAW 160, RAW 64', () => {
    const taw = totalAvailableWaterMm(32, 12, 0.8);
    expect(taw).toBeCloseTo(160, 6);
    expect(0.4 * (taw as number)).toBeCloseTo(64, 6);
  });
  it('Example 36: tomato on loamy sand 15/6 -> TAW 72 RAW 29; silt 32/15 -> 136 and 54; silty clay 35/23 -> 96 and 38', () => {
    const t = (fc: number, wp: number) => totalAvailableWaterMm(fc, wp, 0.8) as number;
    expect(t(15, 6)).toBeCloseTo(72, 6);
    expect(Math.round(0.4 * t(15, 6))).toBe(29);
    expect(t(32, 15)).toBeCloseTo(136, 6);
    expect(Math.round(0.4 * t(32, 15))).toBe(54);
    expect(t(35, 23)).toBeCloseTo(96, 6);
    expect(Math.round(0.4 * t(35, 23))).toBe(38);
  });
  it('rejects impossible soil values instead of computing', () => {
    expect(totalAvailableWaterMm(10, 12, 0.8)).toBeNull();
    expect(totalAvailableWaterMm(30, 15, 0)).toBeNull();
    expect(totalAvailableWaterMm(130, 15, 0.8)).toBeNull();
    expect(totalAvailableWaterMm(Number.NaN, 15, 0.8)).toBeNull();
  });
});

describe('p adjustment (Table 22 note 2)', () => {
  it('is unchanged at ETc = 5 mm/day', () => expect(adjustedDepletionFraction(0.4, 5)).toBeCloseTo(0.4, 10));
  it('is lower when it is hotter and higher when it is cooler', () => {
    expect(adjustedDepletionFraction(0.4, 8)).toBeCloseTo(0.28, 10);
    expect(adjustedDepletionFraction(0.4, 2)).toBeCloseTo(0.52, 10);
  });
  it('is limited to 0.1 .. 0.8', () => {
    expect(adjustedDepletionFraction(0.7, 0)).toBe(0.8);
    expect(adjustedDepletionFraction(0.2, 12)).toBe(0.1);
  });
});

describe('depletion from a measured moisture (Eq. 87)', () => {
  it('is 0 at field capacity and negative above it', () => {
    expect(rootZoneDepletionMm(32, 32, 0.8)).toBe(0);
    expect(rootZoneDepletionMm(32, 35, 0.8)).toBeLessThan(0);
  });
  it('1000 (0.32 - 0.25) 0.8 = 56 mm', () => expect(rootZoneDepletionMm(32, 25, 0.8)).toBeCloseTo(56, 6));
});

describe('rain that counts (below 0.2 ET0 is ignored)', () => {
  it('ignores small rain, counts the rest', () => {
    expect(effectiveRainMm(0.9, 5)).toBe(0);
    expect(effectiveRainMm(1.0, 5)).toBe(1.0);
    expect(effectiveRainMm(7, 5)).toBe(7);
  });
  it('unknown stays unknown (never 0)', () => {
    expect(effectiveRainMm(null, 5)).toBeNull();
    expect(effectiveRainMm(3, null)).toBeNull();
  });
});

// Example 37 soil and crop: TAW 160, RAW 64 (ETc = 6 mm/day would adjust p, so we use ETc = 5 here).
const base: IrrigationInput = {
  moisturePct: 25,
  fieldCapacityPct: 32,
  wiltingPointPct: 12,
  rootDepthM: 0.8,
  depletionFractionTable: 0.4,
  etcMmDay: 5,
  et0MmDay: 4.2,
  rainForecastNext24hMm: 0,
};

describe('decideIrrigation', () => {
  it('moisture ok: depletion 56 mm is below RAW 64 mm', () => {
    const r = decideIrrigation(base);
    expect(r.status).toBe('do_not_irrigate');
    if (r.status === 'do_not_irrigate') {
      expect(r.reason).toBe('moisture_ok');
      expect(r.numbers.tawMm).toBeCloseTo(160, 6);
      expect(r.numbers.rawMm).toBeCloseTo(64, 6);
      expect(r.numbers.depletionMm).toBeCloseTo(56, 6);
    }
  });

  it('irrigates when depletion reaches RAW, and never more than the depletion', () => {
    const r = decideIrrigation({ ...base, moisturePct: 22 }); // Dr = 80
    expect(r.status).toBe('recommend_irrigation');
    if (r.status === 'recommend_irrigation') {
      expect(r.netDepthMm).toBeCloseTo(80, 6);
      expect(r.netDepthMm).toBeLessThanOrEqual(r.numbers.depletionMm);
    }
  });

  it('rain on the way keeps the soil above the stress limit -> do not irrigate', () => {
    const r = decideIrrigation({ ...base, moisturePct: 22, rainForecastNext24hMm: 20, rainProbabilityPct: 80 }); // Dr 80 - 20 = 60 < 64
    expect(r.status).toBe('do_not_irrigate');
    if (r.status === 'do_not_irrigate') {
      expect(r.reason).toBe('rain_expected');
      expect(describeIrrigation(r).en).toContain('80% probability');
    }
  });

  it('rain that is not enough: irrigate only what is still missing', () => {
    const r = decideIrrigation({ ...base, moisturePct: 22, rainForecastNext24hMm: 10 }); // 80 - 10 = 70 >= 64
    expect(r.status).toBe('recommend_irrigation');
    if (r.status === 'recommend_irrigation') expect(r.netDepthMm).toBeCloseTo(70, 6);
  });

  it('a few drops (below 0.2 ET0) do not cancel irrigation', () => {
    const r = decideIrrigation({ ...base, moisturePct: 22, rainForecastNext24hMm: 0.5 });
    expect(r.status).toBe('recommend_irrigation');
  });

  it('no rain forecast available: still decides, and says so', () => {
    const r = decideIrrigation({ ...base, moisturePct: 22, rainForecastNext24hMm: null });
    expect(r.status).toBe('recommend_irrigation');
    expect(describeIrrigation(r).en).toContain('No rain forecast');
  });

  it('at or above field capacity -> do not irrigate', () => {
    const r = decideIrrigation({ ...base, moisturePct: 33 });
    expect(r.status === 'do_not_irrigate' && r.reason).toBe('at_or_above_field_capacity');
  });

  it('below the wilting point is flagged', () => {
    const r = decideIrrigation({ ...base, moisturePct: 8 });
    expect(r.status).toBe('recommend_irrigation');
    if (r.status === 'recommend_irrigation') expect(r.numbers.belowWiltingPoint).toBe(true);
  });

  it('hot day lowers p, so irrigation starts earlier', () => {
    const cool = decideIrrigation({ ...base, moisturePct: 23 }); // Dr 72, RAW 64 -> irrigate even at ETc 5
    const hot = decideIrrigation({ ...base, moisturePct: 25, etcMmDay: 9 }); // p 0.24, RAW 38.4, Dr 56 -> irrigate
    expect(cool.status).toBe('recommend_irrigation');
    expect(hot.status).toBe('recommend_irrigation');
  });

  it('a measured 0 is a value, a missing moisture is not', () => {
    expect(decideIrrigation({ ...base, moisturePct: 0 }).status).toBe('recommend_irrigation');
    const r = decideIrrigation({ ...base, moisturePct: null });
    expect(r.status).toBe('insufficient_data');
    if (r.status === 'insufficient_data') {
      expect(r.reason).toBe('missing_inputs');
      expect(r.fields).toEqual(['moisture']);
      expect(describeIrrigation(r).en).toContain('not measured');
    }
  });

  it('lists every missing crop / soil / weather input', () => {
    const r = decideIrrigation({ ...base, rootDepthM: null, depletionFractionTable: null, etcMmDay: null, et0MmDay: null });
    expect(r.status === 'insufficient_data' && r.fields).toEqual(['root_depth', 'depletion_fraction', 'etc', 'et0']);
  });

  it('rejects impossible values', () => {
    const bad = decideIrrigation({ ...base, moisturePct: 120 });
    expect(bad.status === 'insufficient_data' && bad.reason).toBe('invalid_inputs');
    const soil = decideIrrigation({ ...base, fieldCapacityPct: 10, wiltingPointPct: 12 });
    expect(soil.status === 'insufficient_data' && soil.fields).toContain('soil_or_root_depth');
    const rain = decideIrrigation({ ...base, rainForecastNext24hMm: -2 });
    expect(rain.status === 'insufficient_data' && rain.fields).toContain('rain_forecast');
  });

  it('works for any crop: only the numbers change (lettuce: Zr 0.3, p 0.30)', () => {
    const r = decideIrrigation({ ...base, rootDepthM: 0.3, depletionFractionTable: 0.3, moisturePct: 20 });
    // TAW = 1000 x 0.2 x 0.3 = 60, RAW = 18, Dr = 1000 x 0.12 x 0.3 = 36
    expect(r.status).toBe('recommend_irrigation');
    if (r.status === 'recommend_irrigation') {
      expect(r.numbers.tawMm).toBeCloseTo(60, 6);
      expect(r.numbers.rawMm).toBeCloseTo(18, 6);
    }
  });
});
