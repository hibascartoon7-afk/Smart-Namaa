import { describe, it, expect } from 'vitest';
import { estimateFieldSaving, estimateSavingMm } from '../src/engine/savings';
import { estimateBetweenSensors, haversineM, idwAt, looRmse } from '../src/engine/idw';
import { evaluateForecast } from '../src/engine/forecast-alert';
import { decideFertilization, describeFertilization } from '../src/engine/fertilization';
import { decideIrrigation, type IrrigationInput } from '../src/engine/water-balance';
import { latestFreshMoisture, usableMoisture } from '../src/engine/readings';
import { summarizeWeather } from '../src/engine/weather-summary';

const base: IrrigationInput = {
  moisturePct: 22, fieldCapacityPct: 32, wiltingPointPct: 12, rootDepthM: 0.8, depletionFractionTable: 0.4,
  etcMmDay: 5, et0MmDay: 4.2, rainForecastNext24hMm: 0,
}; // TAW 160, RAW 64, Dr 80

describe('savings (rain credit, never more than the depletion)', () => {
  it('rain keeps irrigation away: saved = effective rain', () => {
    expect(estimateSavingMm(decideIrrigation({ ...base, rainForecastNext24hMm: 20 }))).toBeCloseTo(20, 9);
  });
  it('partial rain: irrigate less, saved = the rain', () => {
    const r = decideIrrigation({ ...base, rainForecastNext24hMm: 10 });
    expect(r.status).toBe('recommend_irrigation');
    expect(estimateSavingMm(r)).toBeCloseTo(10, 9);
  });
  it('saved never exceeds the depletion', () => {
    expect(estimateSavingMm(decideIrrigation({ ...base, rainForecastNext24hMm: 500 }))).toBeCloseTo(80, 9);
  });
  it('no rain, ok moisture, or missing data: no saving is claimed', () => {
    expect(estimateSavingMm(decideIrrigation(base))).toBe(0);
    expect(estimateSavingMm(decideIrrigation({ ...base, moisturePct: 30, rainForecastNext24hMm: 20 }))).toBe(0);
    expect(estimateSavingMm(decideIrrigation({ ...base, moisturePct: null }))).toBe(0);
  });
  it('field level: mean over the points that have a decision, volume = mm x m2 / 1000', () => {
    const a = decideIrrigation({ ...base, rainForecastNext24hMm: 20 }); // 20
    const b = decideIrrigation({ ...base, moisturePct: 30, rainForecastNext24hMm: 20 }); // 0
    const c = decideIrrigation({ ...base, moisturePct: null }); // ignored
    const s = estimateFieldSaving([a, b, c], 1000)!;
    expect(s.savedMm).toBeCloseTo(10, 9);
    expect(s.savedM3).toBeCloseTo(10, 9);
    expect(estimateFieldSaving([a], null)!.savedM3).toBeNull();
    expect(estimateFieldSaving([c], 1000)).toBeNull();
  });
});

describe('IDW between sensors (Shepard 1968) with leave-one-out error', () => {
  const sq = [
    { id: 'a', lat: 32.0, lng: 35.0, value: 20 },
    { id: 'b', lat: 32.0, lng: 35.001, value: 30 },
    { id: 'c', lat: 32.001, lng: 35.0, value: 30 },
    { id: 'd', lat: 32.001, lng: 35.001, value: 40 },
  ];
  it('distance: one degree of latitude is about 111.2 km', () => {
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeGreaterThan(111_000);
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeLessThan(111_400);
  });
  it('standing on a sensor returns that sensor', () => {
    expect(idwAt(sq, { lat: 32.0, lng: 35.0 }, 2)).toBe(20);
  });
  it('the centre of a symmetric square is the mean', () => {
    const r = estimateBetweenSensors(sq, { lat: 32.0005, lng: 35.0005 });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.value).toBeCloseTo(30, 3); // a degree of longitude is shorter than a degree of latitude, so the square is not perfect
      expect(r.sensors).toBe(4);
      expect(r.outsideSensorArea).toBe(false);
      expect(r.looRmse).toBeGreaterThanOrEqual(0);
    }
  });
  it('never gives a value outside the sensor range', () => {
    const r = estimateBetweenSensors(sq, { lat: 32.0004, lng: 35.0009 });
    expect(r.status === 'ok' && r.value >= 20 && r.value <= 40).toBe(true);
  });
  it('flags a target outside the sensor area', () => {
    const r = estimateBetweenSensors(sq, { lat: 32.01, lng: 35.01 });
    expect(r.status === 'ok' && r.outsideSensorArea).toBe(true);
  });
  it('needs at least 3 sensors', () => {
    expect(estimateBetweenSensors(sq.slice(0, 2), { lat: 32, lng: 35 })).toEqual({ status: 'unavailable', reason: 'too_few_points' });
  });
  it('leave-one-out error is zero for a perfectly uniform field', () => {
    expect(looRmse(sq.map((p) => ({ ...p, value: 25 })), 2)).toBeCloseTo(0, 9);
  });
});

describe('forecast alert (from an ML estimate, using RAW)', () => {
  const f = { fieldCapacityPct: 32, wiltingPointPct: 12, rootDepthM: 0.8, depletionFractionTable: 0.4, etcMmDay: 5 };
  it('alerts when the forecast depletion reaches RAW (64 mm)', () => {
    const r = evaluateForecast({ ...f, forecastMoisturePct: 23 }); // Dr 72
    expect(r.status).toBe('predicted_stress');
  });
  it('no alert while it stays below RAW', () => {
    expect(evaluateForecast({ ...f, forecastMoisturePct: 28 }).status).toBe('no_alert'); // Dr 32
  });
  it('missing or impossible forecast gives no alert, just "insufficient"', () => {
    expect(evaluateForecast({ ...f, forecastMoisturePct: null }).status).toBe('insufficient_data');
    expect(evaluateForecast({ ...f, forecastMoisturePct: 140 }).status).toBe('insufficient_data');
  });
});

describe('fertilization (reference tables are data; nothing is invented)', () => {
  const ref = [
    { nutrient: 'n' as const, unit: 'mg/kg', lowBelow: 20, sourceId: 'T' },
    { nutrient: 'p' as const, unit: 'mg/kg', lowBelow: 10, sourceId: 'T' },
    { nutrient: 'k' as const, unit: 'mg/kg', lowBelow: 100, sourceId: 'T' },
  ];
  const ferts = [
    { name: 'Product A', nPct: 46, p2o5Pct: null, k2oPct: null, sourceId: 'T' },
    { name: 'Product B', nPct: 18, p2o5Pct: 46, k2oPct: null, sourceId: 'T' },
    { name: 'Product C', nPct: null, p2o5Pct: 52, k2oPct: null, sourceId: 'T' },
  ];
  it('nothing measured: says which nutrients are not measured (never 0)', () => {
    const r = decideFertilization({ n: null, p: null, k: null }, ref, ferts);
    expect(r).toEqual({ status: 'insufficient_data', reason: 'nutrients_not_measured', missing: ['n', 'p', 'k'] });
    expect(describeFertilization(r).en).toContain('not measured');
  });
  it('no reference limits for the crop: reference_missing', () => {
    expect(decideFertilization({ n: 5, p: null, k: null }, [], ferts)).toMatchObject({ status: 'insufficient_data', reason: 'reference_missing' });
  });
  it('a measured 0 is a real, very low value', () => {
    const r = decideFertilization({ n: 0, p: 50, k: 500 }, ref, ferts);
    expect(r.status).toBe('recommend_fertilization');
  });
  it('picks the fertilizer richest in the most limiting nutrient (phosphorus)', () => {
    const r = decideFertilization({ n: 25, p: 2, k: 150 }, ref, ferts);
    expect(r.status === 'recommend_fertilization' && r.needed.map((x) => x.nutrient)).toEqual(['p']);
    expect(r.status === 'recommend_fertilization' && r.fertilizer?.name).toBe('Product C');
  });
  it('partial measurements are evaluated and the rest is reported as not measured', () => {
    const r = decideFertilization({ n: 5, p: null, k: null }, ref, ferts);
    expect(r.status === 'recommend_fertilization' && r.notMeasured).toEqual(['p', 'k']);
  });
  it('enough of everything measured: no fertilizer', () => {
    expect(decideFertilization({ n: 30, p: 20, k: 200 }, ref, ferts).status).toBe('no_fertilization_needed');
  });
  it('no fertilizer list stored: no product is invented', () => {
    const r = decideFertilization({ n: 5, p: 20, k: 200 }, ref, []);
    expect(r.status === 'recommend_fertilization' && r.fertilizer).toBeNull();
  });
});

describe('readings', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const r = (iso: string, moisture: number | null, st: string | null = 'measured') => ({ sensorPointId: 'p', measuredAt: iso, moisture, moistureStatus: st });
  it('takes the newest usable reading inside the age limit', () => {
    const rows = [r('2026-10-21T09:00:00Z', 30), r('2026-10-21T11:00:00Z', 25), r('2026-10-21T11:30:00Z', 99, 'suspect')];
    expect(latestFreshMoisture(rows, 'p', now, 6)).toEqual({ value: 25, measuredAt: '2026-10-21T11:00:00Z' });
  });
  it('ignores stale, future, missing and out-of-range values', () => {
    expect(latestFreshMoisture([r('2026-10-21T01:00:00Z', 30)], 'p', now, 6)).toBeNull();
    expect(latestFreshMoisture([r('2026-10-21T13:00:00Z', 30)], 'p', now, 6)).toBeNull();
    expect(usableMoisture(r('2026-10-21T11:00:00Z', null))).toBeNull();
    expect(usableMoisture(r('2026-10-21T11:00:00Z', 130))).toBeNull();
    expect(usableMoisture(r('2026-10-21T11:00:00Z', 0))).toBe(0);
    expect(usableMoisture(r('2026-10-21T11:00:00Z', 42, 'normal'))).toBe(42);
  });
});

describe('weather summary', () => {
  const now = Date.parse('2026-10-21T10:00:00Z');
  const row = (h: number, p: number | null, t = 20) => ({
    observed_at: new Date(now + h * 3_600_000).toISOString(), air_temperature_c: t, precipitation_mm: p, rain_probability_pct: 10, et0_mm: 0.1,
  });
  it('complete 24 h window: sum, max temperature, first rain', () => {
    const rows = Array.from({ length: 24 }, (_, i) => row(i + 1, i === 5 ? 2 : 0, 20 + i));
    const w = summarizeWeather(rows, now).next24h;
    expect(w.precipitationComplete).toBe(true);
    expect(w.precipitationMm).toBe(2);
    expect(w.maxAirTemperatureC).toBe(43);
    expect(w.firstRainAt).toBe(rows[5].observed_at);
  });
  it('a missing hour makes the sum incomplete', () => {
    const rows = Array.from({ length: 24 }, (_, i) => row(i + 1, i === 3 ? null : 0));
    expect(summarizeWeather(rows, now).next24h.precipitationComplete).toBe(false);
  });
});

import { changeOverWindow, spreadAcrossSensors } from '../src/engine/stats';

describe('stats across sensors', () => {
  it('mean, min, max with the sensor names, range and sample standard deviation', () => {
    const r = spreadAcrossSensors([{ pointId: 'a', name: '1', value: 20 }, { pointId: 'b', name: 'left', value: 30 }, { pointId: 'c', name: '3', value: 40 }]);
    expect(r).toMatchObject({ status: 'ok', count: 3, mean: 30, range: 20, min: { value: 20, name: '1' }, max: { value: 40, name: '3' } });
    expect(r.status === 'ok' && r.stdDev).toBeCloseTo(10, 9);
  });
  it('one sensor has no standard deviation; none is "no_data"', () => {
    const one = spreadAcrossSensors([{ pointId: 'a', name: '1', value: 25 }]);
    expect(one.status === 'ok' && one.stdDev).toBeNull();
    expect(spreadAcrossSensors([])).toEqual({ status: 'no_data' });
  });
  it('change over a window uses the first and last reading by time', () => {
    expect(changeOverWindow([{ measuredAt: '2026-10-21T10:00:00Z', value: 30 }, { measuredAt: '2026-10-21T06:00:00Z', value: 36 }])).toBe(-6);
    expect(changeOverWindow([{ measuredAt: '2026-10-21T06:00:00Z', value: 36 }])).toBeNull();
  });
});

describe('depletion as a share of TAW (Zr cancels)', () => {
  it('is the same for any root depth', () => {
    const a = decideIrrigation({ ...base, rootDepthM: 0.3 });
    const b = decideIrrigation({ ...base, rootDepthM: 1.2 });
    expect(a.status !== 'insufficient_data' && b.status !== 'insufficient_data' && a.numbers.depletionFractionOfTaw).toBeCloseTo((b as { numbers: { depletionFractionOfTaw: number } }).numbers.depletionFractionOfTaw, 12);
    expect(a.status !== 'insufficient_data' && a.numbers.depletionFractionOfTaw).toBeCloseTo(0.5, 12); // (32 - 22) / (32 - 12)
  });
});
