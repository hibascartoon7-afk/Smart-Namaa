// The hourly cron: weather of every field + the decision engine, on a real Postgres (PGlite) with a fake Open-Meteo.
// The weather numbers below are TEST INPUTS only. The crop numbers come from the real FAO-56 tables loaded by the migrations.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, PgliteDb, readMigration } from './helpers/db';
import { refreshAllFields, rotate, type RefreshOptions } from '../src/engine/refresh-all';
import type { Db } from '../src/engine/db';
import { buildOpenMeteoUrl, parseOpenMeteoHourly } from '../supabase/functions/weather-sync/parse';

const file = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf-8');
const NOW = Date.parse('2026-10-24T08:07:00Z');
const OWNER = '11111111-1111-1111-1111-111111111111';

let pg: PGlite;
let db: PgliteDb;
let nablus = '';
let hebron = '';
let nowhere = '';

const payload = (baseTemp = 24) => {
  const t0 = Math.floor(NOW / 3_600_000) * 3_600 - 24 * 3_600;
  const time = Array.from({ length: 97 }, (_, i) => t0 + i * 3_600);
  return {
    hourly: {
      time,
      temperature_2m: time.map(() => baseTemp),
      precipitation: time.map(() => 0),
      precipitation_probability: time.map(() => 5),
      et0_fao_evapotranspiration: time.map(() => 0.2),
    },
  };
};

function run(over: Partial<RefreshOptions> & { urls?: string[]; clockAt?: number } = {}) {
  const urls = over.urls ?? [];
  return refreshAllFields({
    db,
    weather: { buildUrl: buildOpenMeteoUrl, parse: parseOpenMeteoHourly },
    fetchJson: async (u) => { urls.push(u); return payload(); },
    clock: () => over.clockAt ?? NOW,
    ...over,
  });
}
const count = async (sql: string, params: unknown[] = []) => (await pg.query<{ n: number }>(sql, params)).rows[0].n;
const weatherRows = (id: string) => count('select count(*)::int as n from public.weather_observations where field_id = $1', [id]);
const decisionRows = (id: string) => count('select count(*)::int as n from public.decisions where field_id = $1', [id]);
const reset = async () => { await pg.exec('delete from public.alerts; delete from public.decision_explanations; delete from public.water_savings; delete from public.decisions; delete from public.weather_observations;'); };

beforeAll(async () => {
  pg = await createDb();
  db = new PgliteDb(pg);
  await pg.query(`insert into auth.users (id, raw_user_meta_data) values ($1, '{}')`, [OWNER]);
  const soil = await pg.query<{ id: string }>(`insert into public.soil_types (soil_name, field_capacity_pct, wilting_point_pct, source_id) values ('Loam test values', 30, 15, 'FAO56_TABLE19') returning id`);
  const crop = await pg.query<{ id: string }>(`select id from public.crops where crop_name = 'Tomato'`);
  const mk = async (name: string, lat: number | null, lon: number | null, tz: string) => (await pg.query<{ id: string }>(
    `insert into public.fields (owner_user_id, name, latitude, longitude, timezone, area_m2, crop_id, planting_date, soil_type_id) values ($1,$2,$3,$4,$5,1000,$6,'2026-08-03',$7) returning id`,
    [OWNER, name, lat, lon, tz, crop.rows[0].id, soil.rows[0].id])).rows[0].id;
  nablus = await mk('Nablus field', 32.22, 35.26, 'Asia/Hebron');
  hebron = await mk('Hebron field', 31.53, 35.10, 'Asia/Hebron');
  nowhere = await mk('No location', null, null, 'Asia/Hebron');
  for (const f of [nablus, hebron, nowhere]) await pg.query(`insert into public.sensor_points (field_id, point_name) values ($1, '1')`, [f]);
}, 120_000);

describe('refreshAllFields', () => {
  it('fetches the weather of every field with a location, runs the engine for ALL fields, and stores both', async () => {
    await reset();
    const urls: string[] = [];
    const s = await run({ urls });
    expect(s).toMatchObject({ total_fields: 3, processed: 3, not_reached: 0, weather: { ok: 2, cached: 0, skipped_no_location: 1, failed: 0 }, decisions: { ok: 3, failed: 0 }, failures: [] });
    expect(await weatherRows(nablus)).toBe(97);
    expect(await weatherRows(hebron)).toBe(97);
    expect(await weatherRows(nowhere)).toBe(0);
    for (const f of [nablus, hebron, nowhere]) expect(await decisionRows(f)).toBe(1);
    expect(urls).toHaveLength(2);
  });

  it('weather is per field: each call uses that field\'s own latitude, longitude and timezone', async () => {
    await reset();
    const urls: string[] = [];
    await run({ urls });
    const q = urls.map((u) => new URL(u).searchParams).map((p) => `${p.get('latitude')},${p.get('longitude')},${p.get('timezone')}`).sort();
    expect(q).toEqual(['31.53,35.1,Asia/Hebron', '32.22,35.26,Asia/Hebron']);
  });

  it('a field without a location gets no weather call and is not given invented weather, but its decision still runs', async () => {
    const d = await pg.query<{ irrigation_status: string }>('select irrigation_status from public.decisions where field_id = $1', [nowhere]);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].irrigation_status).toBe('insufficient_data');
    expect(await weatherRows(nowhere)).toBe(0);
  });

  it('respects the 10-minute rule: a recent fetch is reused (no new call), the decision still runs', async () => {
    await reset();
    await run({ clockAt: NOW });
    const urls: string[] = [];
    const s = await run({ urls, clockAt: NOW + 5 * 60_000 });
    expect(urls).toHaveLength(0);
    expect(s.weather).toMatchObject({ ok: 0, cached: 2, skipped_no_location: 1 });
    expect(s.decisions.ok).toBe(3);
    const again: string[] = [];
    await run({ urls: again, clockAt: NOW + 11 * 60_000 });
    expect(again).toHaveLength(2);
  });

  it('one field failing never stops the others, and a failed fetch stores nothing', async () => {
    await reset();
    const s = await run({
      fetchJson: async (u) => { if (new URL(u).searchParams.get('latitude') === '31.53') throw new Error('timeout'); return payload(); },
    });
    expect(s.weather).toMatchObject({ ok: 1, failed: 1 });
    expect(s.failures).toEqual([{ field_id: hebron, stage: 'weather', error: expect.stringContaining('open_meteo_unreachable') }]);
    expect(await weatherRows(hebron)).toBe(0);
    expect(await weatherRows(nablus)).toBe(97);
    expect(s.decisions.ok).toBe(3);
  });

  it('an unexpected Open-Meteo answer stores nothing and keeps the older rows', async () => {
    await reset();
    await run({ clockAt: NOW });
    const before = await weatherRows(nablus);
    const s = await run({ clockAt: NOW + 30 * 60_000, fetchJson: async () => ({ hourly: { time: [1, 2] } }) });
    expect(s.weather.failed).toBe(2);
    expect(s.failures[0].error).toMatch(/open_meteo_unexpected_response/);
    expect(await weatherRows(nablus)).toBe(before);
  });

  it('running again an hour later updates the same hourly rows (no duplicates)', async () => {
    await reset();
    await run({ clockAt: NOW });
    await run({ clockAt: NOW + 60 * 60_000 });
    expect(await weatherRows(nablus)).toBe(97);
  });

  it('a failing decision is reported and the other fields still get theirs', async () => {
    await reset();
    const flaky: Db = Object.assign(Object.create(db), {
      insert: (table: string, rows: Record<string, unknown>[], returning?: string) => {
        if (table === 'decisions' && rows[0]?.field_id === hebron) throw new Error('disk full');
        return db.insert(table, rows, returning);
      },
    });
    const s = await run({ db: flaky });
    expect(s.decisions).toEqual({ ok: 2, failed: 1 });
    expect(s.failures).toContainEqual({ field_id: hebron, stage: 'decision', error: expect.stringContaining('disk full') });
    expect(await decisionRows(nablus)).toBe(1);
    expect(await decisionRows(hebron)).toBe(0);
  });

  it('with many fields: the list is capped per run and rotated every hour, so every field comes first sometimes', async () => {
    await reset();
    const seen = new Set<string>();
    for (let h = 0; h < 3; h++) {
      const s = await run({ maxFields: 1, clockAt: NOW + h * 3_600_000, concurrency: 1 });
      expect(s.processed).toBe(1);
      expect(s.not_reached).toBe(2);
      const d = await pg.query<{ field_id: string }>('select distinct field_id from public.decisions');
      d.rows.forEach((r) => seen.add(r.field_id));
    }
    expect(seen.size).toBe(3);
    expect(rotate([1, 2, 3], 0)).toEqual([1, 2, 3]);
    expect(rotate([1, 2, 3], 3_600_000)).toEqual([2, 3, 1]);
    expect(rotate([], 5)).toEqual([]);
  });

  it('stops starting new fields when the time budget is used, and counts the ones not reached', async () => {
    await reset();
    let t = NOW;
    const s = await run({ concurrency: 1, budgetMs: 1_000, clock: () => { t += 600; return t; } });
    expect(s.processed).toBeGreaterThanOrEqual(1);
    expect(s.processed).toBeLessThan(3);
    expect(s.not_reached).toBe(3 - s.processed);
  });

  it('with no fields at all it does nothing and says so', async () => {
    const empty = await createDb();
    const s = await refreshAllFields({ db: new PgliteDb(empty), weather: { buildUrl: buildOpenMeteoUrl, parse: parseOpenMeteoHourly }, fetchJson: async () => payload(), clock: () => NOW });
    expect(s).toMatchObject({ total_fields: 0, processed: 0, not_reached: 0, failures: [] });
  }, 60_000);
});

describe('the hourly schedule (migration 20261024090000_scheduled_refresh.sql)', () => {
  const sql = file('supabase/migrations/20261024090000_scheduled_refresh.sql');

  it('schedules a fixed-name job every hour that only calls the function (no secret in the file)', () => {
    expect(sql).toContain("cron.schedule('namaa-hourly-refresh', '7 * * * *', 'select public.run_scheduled_refresh();')");
    expect(sql).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|sb_secret|service_role_key\s*[:=]|Bearer [A-Za-z0-9]{20,}/);
    expect(sql).toMatch(/namaa_project_url/);
    expect(sql).toMatch(/namaa_cron_secret/);
  });

  it('calls the function that exists in the project, with the secret as a Bearer token', () => {
    expect(sql).toContain("'/functions/v1/scheduled-refresh'");
    expect(existsSync(fileURLToPath(new URL('../supabase/functions/scheduled-refresh/index.ts', import.meta.url)))).toBe(true);
    expect(sql).toMatch(/'Authorization', 'Bearer ' \|\| cron_secret/);
  });

  it('can be run again, and the function cannot be run by app users (anon / authenticated)', async () => {
    await pg.exec(readMigration('20261024090000_scheduled_refresh.sql'));
    const can = await pg.query<{ a: boolean; b: boolean }>(
      `select has_function_privilege('anon', 'public.run_scheduled_refresh()', 'execute') as a, has_function_privilege('authenticated', 'public.run_scheduled_refresh()', 'execute') as b`);
    expect(can.rows[0]).toEqual({ a: false, b: false });
  });

  it('does nothing until BOTH Vault secrets exist; then it posts once to the function with the secret', async () => {
    await pg.exec(`
      create schema if not exists vault; create table if not exists vault.decrypted_secrets (name text, decrypted_secret text);
      create schema if not exists net; create table if not exists net.calls (url text, headers jsonb, body jsonb, timeout int);
      create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds int default 5000)
        returns bigint language plpgsql as $f$ declare n bigint; begin insert into net.calls values (url, headers, body, timeout_milliseconds); select count(*) into n from net.calls; return n; end $f$;`);
    expect((await pg.query('select public.run_scheduled_refresh() as r')).rows[0]).toEqual({ r: null });
    await pg.exec(`insert into vault.decrypted_secrets values ('namaa_project_url', 'https://abc.supabase.co/')`);
    expect((await pg.query('select public.run_scheduled_refresh() as r')).rows[0]).toEqual({ r: null });
    expect((await pg.query<{ n: number }>('select count(*)::int as n from net.calls')).rows[0].n).toBe(0);
    await pg.exec(`insert into vault.decrypted_secrets values ('namaa_cron_secret', 'the-test-secret-the-test-secret-123')`);
    expect((await pg.query<{ r: string }>('select public.run_scheduled_refresh()::text as r')).rows[0].r).toBe('1');
    const call = (await pg.query<{ url: string; headers: Record<string, string> }>('select url, headers from net.calls')).rows;
    expect(call).toHaveLength(1);
    expect(call[0].url).toBe('https://abc.supabase.co/functions/v1/scheduled-refresh');
    expect(call[0].headers.Authorization).toBe('Bearer the-test-secret-the-test-secret-123');
  });
});

describe('the Edge Function scheduled-refresh', () => {
  const fn = file('supabase/functions/scheduled-refresh/index.ts');
  const http = file('supabase/functions/_shared/http.ts');

  it('only answers the scheduler: no secret (or a wrong one) gets 401, before anything runs', () => {
    expect(fn).toMatch(/if \(!isCronCall\(req\) && !isServiceCall\(req\)\) return json\(401/);
    expect(fn.indexOf('return json(401')).toBeLessThan(fn.indexOf('refreshAllFields({'));
  });
  it('compares the secret in constant time and refuses a short CRON_SECRET', () => {
    expect(http).toMatch(/secret\.length < 32/);
    expect(http).toMatch(/diff \|= token\.charCodeAt/);
  });
  it('is listed in config.toml with verify_jwt = false (pg_cron sends the cron secret, not a user JWT)', () => {
    expect(file('supabase/config.toml')).toMatch(/\[functions\.scheduled-refresh\]\s+enabled = true\s+verify_jwt = false/);
  });
  it('uses the same weather code as weather-sync (one place for the Open-Meteo URL and the checks)', () => {
    expect(fn).toContain("from '../weather-sync/parse.ts'");
  });
});
