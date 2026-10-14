import { describe, it, expect } from 'vitest';
import {
  calculateIrrigationPriority,
  calculateFertilizerPriority,
  calculateWaterScarcityPriority,
} from '../supabase/functions/namaa-chat/lib/calculations.ts';
import type {
  FieldMeter, ValidatedReading, WeatherForecast,
} from '../supabase/functions/namaa-chat/lib/types.ts';

const METERS: FieldMeter[] = [
  { id: 'M1', label: 'Meter 1', x: 22, y: 28, elevation: 'high', slope: 4, aspect: 'SW', crop: 'Tomato' },
  { id: 'M2', label: 'Meter 2', x: 48, y: 18, elevation: 'mid', slope: 2, aspect: 'S', crop: 'Tomato' },
  { id: 'M3', label: 'Meter 3', x: 72, y: 32, elevation: 'low', slope: 1, aspect: 'E', crop: 'Tomato' },
  { id: 'M6', label: 'Meter 6', x: 80, y: 58, elevation: 'high', slope: 5, aspect: 'W', crop: 'Pepper' },
];

function makeReading(
  meterId: string, vwc: number, ageMinutes = 0, overrides: Partial<ValidatedReading> = {},
): ValidatedReading {
  return {
    meter_id: meterId,
    n: 40, p: 20, k: 180, ec: 3.0, temp: 23, ph: 7.0, vwc,
    ts: new Date(Date.now() - ageMinutes * 60000).toISOString(),
    is_stale: ageMinutes > 30,
    age_minutes: ageMinutes,
    warnings: [],
    ...overrides,
  };
}

const NO_RAIN_WEATHER: WeatherForecast = {
  location: 'Test',
  now_temp: 31, now_humidity: 38, now_wind: 12, now_condition: 'Clear', now_icon: 'sun',
  rain_probability_3h: 10, rain_start_minutes: 999, expected_rainfall_mm: 0.5,
  evapotranspiration: 5.2, hourly: [],
};

const HEAVY_RAIN_WEATHER: WeatherForecast = {
  location: 'Test',
  now_temp: 28, now_humidity: 60, now_wind: 18, now_condition: 'Rain', now_icon: 'rain',
  rain_probability_3h: 75, rain_start_minutes: 120, expected_rainfall_mm: 8.4,
  evapotranspiration: 3.0, hourly: [],
};

describe('calculateIrrigationPriority', () => {
  it('ranks meter with lowest VWC as highest priority', () => {
    const readings = [
      makeReading('M1', 24),
      makeReading('M2', 31),
      makeReading('M3', 46),
      makeReading('M6', 19),
    ];
    const result = calculateIrrigationPriority(METERS, readings, null);
    expect(result[0].meter_id).toBe('M6');
    expect(result[0].vwc).toBe(19);
    expect(result[0].rank).toBe(1);
  });

  it('gives higher priority to high-elevation meters at same VWC', () => {
    const readings = [
      makeReading('M1', 24), // high elevation, slope 4
      makeReading('M3', 24), // low elevation, slope 1
    ];
    const result = calculateIrrigationPriority(METERS, readings, null);
    const m1Rank = result.find((r) => r.meter_id === 'M1')!.rank;
    const m3Rank = result.find((r) => r.meter_id === 'M3')!.rank;
    expect(m1Rank).toBeLessThan(m3Rank);
  });

  it('reduces priority when heavy rain is forecast', () => {
    const readings = [
      makeReading('M1', 24),
      makeReading('M6', 19),
    ];
    const noRain = calculateIrrigationPriority(METERS, readings, NO_RAIN_WEATHER);
    const withRain = calculateIrrigationPriority(METERS, readings, HEAVY_RAIN_WEATHER);
    // With rain, the priority score should be lower
    const m6NoRain = noRain.find((r) => r.meter_id === 'M6')!.priority_score;
    const m6WithRain = withRain.find((r) => r.meter_id === 'M6')!.priority_score;
    expect(m6WithRain).toBeLessThan(m6NoRain);
  });

  it('penalizes stale sensor data in priority score', () => {
    const fresh = [makeReading('M1', 24, 0)];
    const stale = [makeReading('M1', 24, 45)];
    const freshResult = calculateIrrigationPriority(METERS, fresh, null);
    const staleResult = calculateIrrigationPriority(METERS, stale, null);
    expect(staleResult[0].priority_score).toBeLessThan(freshResult[0].priority_score);
  });

  it('assigns rank sequentially from 1', () => {
    const readings = METERS.map((m) => makeReading(m.id, 20 + Math.random() * 30));
    const result = calculateIrrigationPriority(METERS, readings, null);
    result.forEach((r, i) => {
      expect(r.rank).toBe(i + 1);
    });
  });

  it('provides a human-readable reason string', () => {
    const readings = [makeReading('M6', 19)];
    const result = calculateIrrigationPriority(METERS, readings, null);
    expect(result[0].reason).toContain('VWC');
    expect(result[0].reason).toContain('elevation');
  });
});

describe('calculateFertilizerPriority', () => {
  it('flags critically low phosphorus', () => {
    const readings = [
      makeReading('M3', 40, 0, { p: 9, ec: 7.2 }),
    ];
    const result = calculateFertilizerPriority(METERS, readings, null);
    const pResult = result.find((r) => r.nutrient === 'P');
    expect(pResult).toBeDefined();
    expect(pResult!.urgency).toBe('critical');
    expect(pResult!.value).toBe(9);
  });

  it('flags critically low potassium', () => {
    const readings = [
      makeReading('M3', 40, 0, { k: 120 }),
    ];
    const result = calculateFertilizerPriority(METERS, readings, null);
    const kResult = result.find((r) => r.nutrient === 'K');
    expect(kResult).toBeDefined();
    expect(kResult!.urgency).toBe('critical');
  });

  it('includes rain warning when heavy rain is forecast', () => {
    const readings = [
      makeReading('M3', 40, 0, { p: 9 }),
    ];
    const result = calculateFertilizerPriority(METERS, readings, HEAVY_RAIN_WEATHER);
    expect(result[0].rain_warning).toBe(true);
    expect(result[0].reason).toContain('rain');
  });

  it('skips nutrients within optimal range', () => {
    const readings = [
      makeReading('M2', 35, 0, { n: 50, p: 25, k: 200 }),
    ];
    const result = calculateFertilizerPriority(METERS, readings, null);
    expect(result.length).toBe(0);
  });

  it('includes EC salinity warning when EC is high', () => {
    const readings = [
      makeReading('M3', 40, 0, { p: 9, ec: 7.2 }),
    ];
    const result = calculateFertilizerPriority(METERS, readings, null);
    expect(result[0].reason).toContain('EC');
    expect(result[0].reason).toContain('salinity');
  });

  it('skips stale sensor readings', () => {
    const readings = [
      makeReading('M3', 40, 45, { p: 9 }),
    ];
    const result = calculateFertilizerPriority(METERS, readings, null);
    expect(result.length).toBe(0);
  });

  it('sorts results by urgency (critical first)', () => {
    const readings = [
      makeReading('M1', 30, 0, { n: 45, p: 18, k: 140 }),
      makeReading('M3', 40, 0, { n: 20, p: 9, k: 120 }),
    ];
    const result = calculateFertilizerPriority(METERS, readings, null);
    expect(result[0].urgency).toBe('critical');
  });
});

describe('calculateWaterScarcityPriority', () => {
  it('returns at most 3 meters', () => {
    const readings = METERS.map((m) => makeReading(m.id, 15));
    const result = calculateWaterScarcityPriority(METERS, readings, null);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('only returns meters with priority score above threshold', () => {
    const readings = [
      makeReading('M2', 35), // adequate VWC, should not be in scarcity list
      makeReading('M6', 19), // very low VWC, should be included
    ];
    const result = calculateWaterScarcityPriority(METERS, readings, null);
    expect(result.find((r) => r.meter_id === 'M2')).toBeUndefined();
    expect(result.find((r) => r.meter_id === 'M6')).toBeDefined();
  });

  it('ranks most urgent meter first', () => {
    const readings = [
      makeReading('M1', 24),
      makeReading('M6', 19),
      makeReading('M3', 46),
    ];
    const result = calculateWaterScarcityPriority(METERS, readings, null);
    expect(result[0].meter_id).toBe('M6');
  });
});
