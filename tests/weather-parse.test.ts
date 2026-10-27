import { describe, it, expect } from 'vitest';
import { buildOpenMeteoUrl, parseOpenMeteoHourly } from '../supabase/functions/weather-sync/parse';

// TEST FIXTURE ONLY (shaped like the Open-Meteo hourly response documented at open-meteo.com/en/docs).
// These numbers are made up for testing and are never stored or shown anywhere.
const T0 = 1_760_000_000; // unix seconds
const fixture = (over: Record<string, unknown[]> = {}) => ({
  hourly: {
    time: [T0, T0 + 3600, T0 + 7200],
    temperature_2m: [20.1, 19.4, 18.8],
    precipitation: [0, 0.4, 1.2],
    precipitation_probability: [0, 35, 80],
    et0_fao_evapotranspiration: [0.21, 0.18, 0.05],
    ...over,
  },
});

describe('buildOpenMeteoUrl', () => {
  it('uses the field latitude / longitude / timezone and explicit units', () => {
    const u = new URL(buildOpenMeteoUrl({ latitude: 32.22, longitude: 35.26, timezone: 'Asia/Hebron' }));
    expect(u.hostname).toBe('api.open-meteo.com');
    expect(u.searchParams.get('latitude')).toBe('32.22');
    expect(u.searchParams.get('longitude')).toBe('35.26');
    expect(u.searchParams.get('timezone')).toBe('Asia/Hebron');
    expect(u.searchParams.get('timeformat')).toBe('unixtime');
    expect(u.searchParams.get('temperature_unit')).toBe('celsius');
    expect(u.searchParams.get('precipitation_unit')).toBe('mm');
    expect(u.searchParams.get('hourly')).toBe(
      'temperature_2m,precipitation,precipitation_probability,et0_fao_evapotranspiration',
    );
  });
  it('refuses an invalid location instead of guessing a default', () => {
    expect(() => buildOpenMeteoUrl({ latitude: 91, longitude: 0, timezone: 'UTC' })).toThrow();
    expect(() => buildOpenMeteoUrl({ latitude: 0, longitude: 181, timezone: 'UTC' })).toThrow();
    expect(() => buildOpenMeteoUrl({ latitude: Number.NaN, longitude: 0, timezone: 'UTC' })).toThrow();
    expect(() => buildOpenMeteoUrl({ latitude: 0, longitude: 0, timezone: '  ' })).toThrow();
  });
});

describe('parseOpenMeteoHourly', () => {
  it('maps hourly arrays to rows with UTC timestamps', () => {
    const r = parseOpenMeteoHourly(fixture());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(3);
    expect(r.rows[1]).toEqual({
      observed_at: new Date((T0 + 3600) * 1000).toISOString(),
      air_temperature_c: 19.4,
      precipitation_mm: 0.4,
      rain_probability_pct: 35,
      et0_mm: 0.18,
    });
    expect(r.rejected).toBe(0);
  });

  it('keeps a real 0 as 0 (dry hour) but a missing value as NULL', () => {
    const r = parseOpenMeteoHourly(fixture({ precipitation: [0, null, 1.2], precipitation_probability: [null, 35, 80] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].precipitation_mm).toBe(0);
    expect(r.rows[1].precipitation_mm).toBeNull();
    expect(r.rows[0].rain_probability_pct).toBeNull();
    expect(r.rejected).toBe(0);
  });

  it('turns unusable values into NULL and counts them (never 0)', () => {
    const r = parseOpenMeteoHourly(
      fixture({
        temperature_2m: [20.1, 999, 'warm'],
        precipitation: [-1, 0.4, 1.2],
        precipitation_probability: [0, 135, 80],
        et0_fao_evapotranspiration: [Number.NaN, 0.18, -0.2],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[1].air_temperature_c).toBeNull();
    expect(r.rows[2].air_temperature_c).toBeNull();
    expect(r.rows[0].precipitation_mm).toBeNull();
    expect(r.rows[1].rain_probability_pct).toBeNull();
    expect(r.rows[0].et0_mm).toBeNull();
    expect(r.rows[2].et0_mm).toBeNull();
    expect(r.rejected).toBe(6); // 999, "warm", -1, 135, NaN, -0.2
  });

  it('fails (nothing stored) when the response is not what we asked for', () => {
    expect(parseOpenMeteoHourly(null).ok).toBe(false);
    expect(parseOpenMeteoHourly({}).ok).toBe(false);
    expect(parseOpenMeteoHourly({ hourly: { time: [] } }).ok).toBe(false);
    expect(parseOpenMeteoHourly({ hourly: { ...fixture().hourly, time: ['2026-10-16T00:00'] } }).ok).toBe(false);
    expect(parseOpenMeteoHourly(fixture({ precipitation: [0, 0.4] })).ok).toBe(false); // length mismatch
    const { et0_fao_evapotranspiration: _omit, ...withoutEt0 } = fixture().hourly;
    expect(parseOpenMeteoHourly({ hourly: withoutEt0 }).ok).toBe(false); // variable missing
  });
});
