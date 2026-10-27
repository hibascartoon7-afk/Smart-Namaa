import { describe, it, expect } from 'vitest';
import {
  localDay, pointValueToday, summarizeVariable, summarizeWeather, projectPoints,
  normalizeIrrigationStatus, type Reading, type SensorPoint, type WeatherRow,
} from '../src/lib/field-math';

const TZ = 'Asia/Hebron';
const pts: SensorPoint[] = [
  { id: 'p1', point_name: 'Sensor 1', latitude: 32.22, longitude: 35.26 },
  { id: 'p2', point_name: 'Sensor 2', latitude: null, longitude: null },
];
const r = (id: string, at: string, moisture: number | null, status: string | null = 'measured'): Reading => ({
  sensor_point_id: id, measured_at: at, moisture, soil_temperature: null, ec: null,
  moisture_status: status, soil_temperature_status: 'not_measured', ec_status: 'not_measured',
});

describe('summarizeVariable', () => {
  const day = '2026-10-20';
  it('averages each point\'s latest usable value of the day', () => {
    const rows = [
      r('p1', '2026-10-20T06:00:00Z', 30), r('p1', '2026-10-20T08:00:00Z', 40),
      r('p2', '2026-10-20T07:00:00Z', 20),
    ];
    const s = summarizeVariable(pts, rows, 'moisture', day, TZ);
    expect(s).toMatchObject({ status: 'measured', average: 30, pointsMeasured: 2, pointsTotal: 2 });
  });
  it('says not measured when everything is null or flagged (never 0)', () => {
    const rows = [r('p1', '2026-10-20T06:00:00Z', null, 'not_measured'), r('p2', '2026-10-20T06:00:00Z', 55, 'suspect')];
    expect(summarizeVariable(pts, rows, 'moisture', day, TZ)).toEqual({ status: 'not_measured_today' });
  });
  it('ignores readings from other days', () => {
    expect(summarizeVariable(pts, [r('p1', '2026-10-19T08:00:00Z', 40)], 'moisture', day, TZ).status).toBe('not_measured_today');
  });
  it('a single sensor returns its own value, not the average', () => {
    const rows = [r('p1', '2026-10-20T08:00:00Z', 40), r('p2', '2026-10-20T08:00:00Z', 20)];
    expect(pointValueToday(rows, 'p1', 'moisture', day, TZ)?.value).toBe(40);
  });
  it('keeps a legacy status word such as "normal" as usable', () => {
    expect(pointValueToday([r('p1', '2026-10-20T08:00:00Z', 42, 'normal')], 'p1', 'moisture', day, TZ)?.value).toBe(42);
  });
});

describe('localDay', () => {
  it('uses the field time zone', () => {
    expect(localDay(Date.parse('2026-10-20T22:30:00Z'), 'Asia/Hebron')).toBe('2026-10-21');
  });
});

describe('summarizeWeather', () => {
  const now = Date.parse('2026-10-20T10:00:00Z');
  const hour = (h: number, p: number | null, prob: number | null): WeatherRow => ({
    observed_at: new Date(now + h * 3_600_000).toISOString(),
    air_temperature_c: 20, precipitation_mm: p, rain_probability_pct: prob, et0_mm: 0.1,
  });
  it('uses (now, now+24h] only and finds the first rain hour', () => {
    const rows = [hour(0, 9, 90), hour(1, 0, 10), hour(2, 1.5, 70), hour(24, 2, 50), hour(25, 99, 99)];
    const w = summarizeWeather(rows, now).next24h;
    expect(w.precipitationMm).toBeCloseTo(3.5);
    expect(w.maxRainProbabilityPct).toBe(70);
    expect(w.firstRainAt).toBe(rows[2].observed_at);
    expect(w.precipitationComplete).toBe(false);
  });
  it('returns null (not 0) when there is no forecast', () => {
    expect(summarizeWeather([], now).next24h.precipitationMm).toBeNull();
  });
});

describe('projectPoints / status words', () => {
  it('separates points without coordinates', () => {
    const { placed, unplaced } = projectPoints(pts);
    expect(placed).toHaveLength(1);
    expect(unplaced.map((p) => p.id)).toEqual(['p2']);
  });
  it('maps both engine vocabularies', () => {
    expect(normalizeIrrigationStatus('irrigate')).toBe('recommend_irrigation');
    expect(normalizeIrrigationStatus('wait')).toBe('do_not_irrigate');
    expect(normalizeIrrigationStatus('x')).toBe('unknown');
  });
});
