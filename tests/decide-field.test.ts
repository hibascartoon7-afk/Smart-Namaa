// End-to-end test of the engine on ONE field: every input source together (sensors, weather, soil, crop, Kc curve,
// planting date, ML forecast, NPK). Real FAO-56 Table 12 rows; the stage lengths and sensor values are test inputs.
import { describe, it, expect } from 'vitest';
import { decideField, type DecideFieldInput, type ForecastInput } from '../src/engine/decide-field';
import { dbRowToKcRow } from '../src/lib/kc-repository';
import { loadTable12 } from './fixtures/table12';

const rows = loadTable12().db.map(dbRowToKcRow);
const tomato = rows.find((r) => r.crop === 'Tomato')!;
const group = rows.find((r) => r.rowType === 'group_row' && r.section === tomato.section)!;

const NOW = Date.parse('2026-10-21T09:00:00Z'); // noon in Palestine
const TZ = 'Asia/Hebron';

/** hourly weather for [now-30 h, now+60 h]; et0 0.2 mm/h -> 4.8 mm/day; optional rain in the next 24 h */
function weather(opts: { rainMm?: number; skipHour?: number } = {}) {
  const out = [];
  for (let h = -30; h <= 60; h++) {
    if (opts.skipHour === h) continue;
    const t = NOW + h * 3_600_000;
    out.push({
      observed_at: new Date(t).toISOString(),
      air_temperature_c: 24,
      precipitation_mm: h === 6 ? (opts.rainMm ?? 0) : 0,
      rain_probability_pct: h === 6 && opts.rainMm ? 80 : 5,
      et0_mm: 0.2,
    });
  }
  return out;
}

const reading = (id: string, hoursAgo: number, moisture: number | null, status: string | null = 'measured') => ({
  sensorPointId: id,
  measuredAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  moisture,
  moistureStatus: status,
});

function input(over: Partial<DecideFieldInput> = {}): DecideFieldInput {
  return {
    field: { id: 'f1', name: 'Greenhouse 1', timezone: TZ, plantingDate: '2026-08-03', areaM2: 1000 }, // day 80 = mid season
    soil: { fieldCapacityPct: 30, wiltingPointPct: 15 }, // loam
    crop: {
      name: 'Tomato', kcRow: tomato, kcGroupRow: group,
      stages: { initialDays: 30, developmentDays: 40, midDays: 45, lateDays: 30 },
      rootDepthMinM: 0.7, depletionFractionP: 0.4,
    },
    points: [{ id: 's1', name: 'Sensor 1' }, { id: 's2', name: 'Sensor 2' }, { id: 's3', name: 'Sensor 3' }],
    readings: [reading('s1', 0.5, 22), reading('s2', 1, 28)], // s3 never reported
    weather: weather(),
    forecasts: [],
    nutrients: { n: null, p: null, k: null },
    nutrientReference: [],
    fertilizers: [],
    fertilizerHoldAirTempMaxC: null,
    nowMs: NOW,
    ...over,
  };
}

const codes = (d: ReturnType<typeof decideField>) => d.alerts.map((a) => a.code);

describe('decideField: dry day, no rain', () => {
  const d = decideField(input());
  it('computes the crop numbers from the curve, ET0 and soil', () => {
    expect(d.growthStage).toBe('mid');
    expect(d.dayOfSeason).toBe(80);
    expect(d.kc?.max).toBeCloseTo(1.15, 9);
    expect(d.et0MmDay).toBeCloseTo(4.8, 6);
    expect(d.etcUsedMmDay).toBeCloseTo(1.15 * 4.8, 6);
  });
  it('sensor 1 is dry enough to irrigate (Dr 56 mm >= RAW), sensor 2 is fine, sensor 3 has no reading', () => {
    // TAW = 1000 x 0.15 x 0.7 = 105 ; p = 0.4 + 0.04 (5 - 5.52) = 0.3792 ; RAW = 39.82
    const s1 = d.perPoint[0].result;
    expect(s1.status).toBe('recommend_irrigation');
    if (s1.status === 'recommend_irrigation') {
      expect(s1.numbers.tawMm).toBeCloseTo(105, 6);
      expect(s1.numbers.rawMm).toBeCloseTo(0.3792 * 105, 4);
      expect(s1.netDepthMm).toBeCloseTo(56, 6);
    }
    expect(d.perPoint[1].result).toMatchObject({ status: 'do_not_irrigate', reason: 'moisture_ok' });
    expect(d.perPoint[2].result).toMatchObject({ status: 'insufficient_data', fields: ['moisture'] });
  });
  it('field status and alerts come from the engine, one alert per kind', () => {
    expect(d.irrigation.status).toBe('recommend_irrigation');
    expect(d.irrigation.summaryEn).toContain('Sensor 1');
    expect(codes(d)).toEqual(['irrigate_now', 'no_recent_reading']);
    expect(d.alerts.find((a) => a.code === 'no_recent_reading')?.messageEn).toContain('Sensor 3');
    expect(d.saving).toMatchObject({ savedMm: 0 });
  });
  it('fertilization is honest: no NPK measured, so no need can be stated', () => {
    expect(d.fertilization.result).toMatchObject({ status: 'insufficient_data', reason: 'nutrients_not_measured' });
    expect(d.fertilization.text.en).toContain('not measured');
  });
});

describe('decideField: rain is coming', () => {
  const d = decideField(input({ weather: weather({ rainMm: 30 }) }));
  it('sensor 1 no longer needs irrigation: the rain keeps depletion below the stress limit', () => {
    // Dr 56 - rain 30 = 26 < RAW 39.8
    expect(d.perPoint[0].result).toMatchObject({ status: 'do_not_irrigate', reason: 'rain_expected' });
    expect(d.irrigation.status).toBe('do_not_irrigate');
  });
  it('the warning, the leaching warning and the saving all come from the same numbers', () => {
    expect(codes(d)).toEqual(['rain_expected', 'no_recent_reading', 'fertilizer_hold_leaching', 'estimated_saving']);
    // sensor 2: rain 30 - Dr 14 - ETc 5.52 > 0 -> water drains below the roots
    expect(d.alerts.find((a) => a.code === 'fertilizer_hold_leaching')?.messageEn).toContain('Sensor 2');
    // saving: sensor 1 saves min(30, 56) = 30 mm, sensor 2 had no irrigation to avoid = 0 -> mean 15 mm -> 15 m3 on 1000 m2
    expect(d.saving?.savedMm).toBeCloseTo(15, 6);
    expect(d.saving?.savedM3).toBeCloseTo(15, 6);
    expect(d.alerts.find((a) => a.code === 'estimated_saving')?.messageEn).toContain('forecast-based estimate');
  });
});

describe('decideField: missing pieces never become guesses', () => {
  it('no growth-stage lengths -> no decision, and the reason is stated', () => {
    const d = decideField(input({ crop: { ...input().crop!, stages: null } }));
    expect(d.irrigation.status).toBe('insufficient_data');
    expect(d.upstream.kc).toBe('stage_lengths_missing');
    expect(d.irrigation.summaryEn).toContain('growth-stage lengths');
    expect(codes(d)).toContain('cannot_decide');
  });
  it('no crop, no soil', () => {
    expect(decideField(input({ crop: null })).upstream.crop).toBe('no_crop');
    expect(decideField(input({ soil: null })).upstream.soil).toBe('no_soil');
  });
  it('an incomplete weather day blocks ET0, so no decision', () => {
    const d = decideField(input({ weather: weather({ skipHour: -2 }) }));
    expect(d.irrigation.status).toBe('insufficient_data');
    expect(d.upstream.et0).toBeDefined();
  });
  it('rain forecast with a missing hour is not trusted as "no rain": decision is made without it and says so', () => {
    const d = decideField(input({ weather: weather({ skipHour: 20 }) }));
    expect(d.perPoint[0].result.status).toBe('recommend_irrigation');
    expect(d.perPoint[0].text.en).toContain('No rain forecast');
  });
  it('a stale reading (older than 6 h) is not used', () => {
    const d = decideField(input({ readings: [reading('s1', 10, 22)] }));
    expect(d.perPoint[0].result.status).toBe('insufficient_data');
    expect(d.irrigation.status).toBe('insufficient_data');
  });
  it('a suspect or out-of-range value is ignored; a measured 0 is a real value', () => {
    expect(decideField(input({ readings: [reading('s1', 1, 55, 'suspect')] })).perPoint[0].moisturePct).toBeNull();
    expect(decideField(input({ readings: [reading('s1', 1, 0)] })).perPoint[0].result.status).toBe('recommend_irrigation');
  });
  it('a field without sensor points says so', () => {
    const d = decideField(input({ points: [], readings: [] }));
    expect(d.irrigation.status).toBe('insufficient_data');
    expect(codes(d)).toContain('no_sensor_points');
  });
  it('soil above field capacity -> do not irrigate, soil_saturated warning', () => {
    const d = decideField(input({ readings: [reading('s1', 0.5, 31), reading('s2', 0.5, 33), reading('s3', 0.5, 35)] }));
    expect(d.irrigation.status).toBe('do_not_irrigate');
    expect(codes(d)).toContain('soil_saturated');
    expect(codes(d)).toContain('fertilizer_hold_leaching');
  });
});

describe('decideField: ML forecast is only an input for a separate predictive alert', () => {
  const forecast = (over: Partial<ForecastInput> = {}): ForecastInput => ({
    sensorPointId: 's2', madeAt: new Date(NOW - 3_600_000).toISOString(), targetTime: new Date(NOW + 24 * 3_600_000).toISOString(),
    predictedMoisturePct: 20, modelName: 'moisture_forecast', modelVersion: 'v2', modelActive: true, ...over,
  });
  it('an active, fresh forecast that reaches the stress limit gives a predictive alert worded as an estimate', () => {
    const d = decideField(input({ forecasts: [forecast()] })); // Dr 70 >= RAW 39.8
    const a = d.alerts.find((x) => x.kind === 'forecast');
    expect(a?.code).toBe('predicted_stress');
    expect(a?.messageEn).toContain('model estimate');
    expect(a?.messageEn).toContain('v2');
    expect(d.perPoint[1].result).toMatchObject({ reason: 'moisture_ok' }); // the decision itself did not change
  });
  it('a model that is not active, a stale forecast, or one that stays safe gives nothing', () => {
    expect(decideField(input({ forecasts: [forecast({ modelActive: false })] })).alerts.some((a) => a.kind === 'forecast')).toBe(false);
    expect(decideField(input({ forecasts: [forecast({ madeAt: new Date(NOW - 20 * 3_600_000).toISOString() })] })).alerts.some((a) => a.kind === 'forecast')).toBe(false);
    expect(decideField(input({ forecasts: [forecast({ predictedMoisturePct: 28 })] })).alerts.some((a) => a.kind === 'forecast')).toBe(false);
  });
});

describe('decideField: sourced thresholds and measured NPK', () => {
  it('a stored heat limit (with its source) triggers the fertilizer hold; without one nothing is invented', () => {
    expect(codes(decideField(input()))).not.toContain('fertilizer_hold_heat');
    const d = decideField(input({ fertilizerHoldAirTempMaxC: { value: 24, sourceId: 'TEST' } }));
    expect(codes(d)).toContain('fertilizer_hold_heat');
  });
  it('measured NPK with reference tables gives a fertilizer decision', () => {
    const d = decideField(input({
      nutrients: { n: 5, p: 30, k: 300 },
      nutrientReference: [
        { nutrient: 'n', unit: 'mg/kg', lowBelow: 20, sourceId: 'T' },
        { nutrient: 'p', unit: 'mg/kg', lowBelow: 10, sourceId: 'T' },
        { nutrient: 'k', unit: 'mg/kg', lowBelow: 100, sourceId: 'T' },
      ],
      fertilizers: [{ name: 'Urea (test)', nPct: 46, p2o5Pct: null, k2oPct: null, sourceId: 'T' }],
    }));
    expect(d.fertilization.result).toMatchObject({ status: 'recommend_fertilization' });
    expect(d.fertilization.text.en).toContain('Urea (test)');
  });
});

describe('decideField: bilingual texts exist for every alert', () => {
  it('every alert has English and Arabic text', () => {
    const d = decideField(input({ weather: weather({ rainMm: 30 }), forecasts: [] }));
    for (const a of d.alerts) {
      expect(a.titleEn.length).toBeGreaterThan(3);
      expect(a.titleAr.length).toBeGreaterThan(3);
      expect(a.messageEn.length).toBeGreaterThan(10);
      expect(a.messageAr.length).toBeGreaterThan(10);
    }
    expect(d.explanation.ar.length).toBeGreaterThan(10);
  });
});
