// Explicit privileges of the Data API roles (migration 20261024110000_api_grants.sql). The test database normally grants everything to
// `authenticated` at the end of setup, which would hide a missing GRANT: here every privilege is revoked first, as on a Supabase project
// where new tables are not exposed automatically, and only the migration file gives them back.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { createDb } from './helpers/db';

const FILE = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20261024110000_api_grants.sql'), 'utf8');
type Cmd = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
const ALL: Cmd[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

// what the browser may do with each table (the row level security policies decide WHICH rows). Anything not listed: nothing.
const BROWSER: Record<string, Cmd[]> = {
  fields: ALL,
  sensor_points: ALL,
  nutrient_measurements: ['SELECT', 'INSERT', 'DELETE'],
  profiles: ['SELECT', 'UPDATE'],
};
const READ_ONLY = [
  'alert_thresholds', 'alerts', 'crop_coefficients', 'crop_growth_stages', 'crop_irrigation_rules', 'crop_nutrient_rates', 'crop_nutrient_sufficiency',
  'crop_water_params', 'crops', 'decision_explanations', 'decisions', 'devices', 'fertilizer_soil_notes', 'fertilizers', 'knowledge_chunks',
  'ml_model_registry', 'moisture_forecasts', 'nutrient_methods', 'sensor_readings', 'soil_types', 'sources', 'water_savings', 'weather_observations', 'crop_readiness',
];
for (const t of READ_ONLY) BROWSER[t] = ['SELECT'];

describe('API grants', () => {
  let db: PGlite;
  const can = async (role: string, table: string, cmd: Cmd) =>
    (await db.query<{ ok: boolean }>(`select has_table_privilege('${role}', 'public.${table}', '${cmd}') as ok`)).rows[0].ok;

  beforeAll(async () => {
    db = (await createDb()) as unknown as PGlite;
    await db.exec('revoke all on all tables in schema public from authenticated, service_role, anon; revoke all on all sequences in schema public from authenticated, service_role, anon;');
    await db.exec(FILE);
  }, 120000);

  it('the browser gets exactly what is listed and nothing else, on every table and view of the public schema', async () => {
    const rels = (await db.query<{ t: string }>(`select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v') order by 1`)).rows.map((r) => r.t);
    for (const t of rels) for (const cmd of ALL) expect(await can('authenticated', t, cmd), `${t} ${cmd}`).toBe((BROWSER[t] ?? []).includes(cmd));
    // every table of the project is decided on purpose: either listed above, or deliberately closed to the browser
    expect(rels.filter((t) => !(t in BROWSER)).sort()).toEqual(['device_tokens']);
  });

  it('the hashes of the ESP32 tokens are not readable or writable from the browser, and a signed-out visitor has nothing', async () => {
    for (const cmd of ALL) expect(await can('authenticated', 'device_tokens', cmd), cmd).toBe(false);
    const rels = (await db.query<{ t: string }>(`select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')`)).rows.map((r) => r.t);
    for (const t of rels) for (const cmd of ALL) expect(await can('anon', t, cmd), `${t} ${cmd}`).toBe(false);
  });

  it('the Edge Functions (service role) can use every table, the sequences and the functions', async () => {
    const rels = (await db.query<{ t: string }>(`select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`)).rows.map((r) => r.t);
    for (const t of rels) for (const cmd of ALL) expect(await can('service_role', t, cmd), `${t} ${cmd}`).toBe(true);
    expect((await db.query<{ ok: boolean }>(`select has_sequence_privilege('service_role', 'public.knowledge_chunks_id_seq', 'USAGE') as ok`)).rows[0].ok).toBe(true);
    expect((await db.query<{ ok: boolean }>(`select has_function_privilege('service_role', 'public.match_knowledge(extensions.vector, integer, double precision)', 'EXECUTE') as ok`)).rows[0].ok).toBe(true);
  });

  it('every privilege the row level security policies describe is granted (a policy without a grant is dead)', async () => {
    const pol = (await db.query<{ tablename: string; cmd: string }>(`select tablename, cmd from pg_policies where schemaname = 'public' and 'authenticated' = any (roles)`)).rows;
    expect(pol.length).toBeGreaterThan(20);
    for (const p of pol) {
      const cmds = p.cmd === 'ALL' ? ALL : [p.cmd as Cmd];
      for (const cmd of cmds) expect(await can('authenticated', p.tablename, cmd), `${p.tablename} ${cmd}`).toBe(true);
    }
  });

  it('a table created later by the owner is usable by the functions at once, and closed to the browser until it is granted', async () => {
    await db.exec(`create table public.zz_later (id int)`);
    expect(await can('service_role', 'zz_later', 'INSERT')).toBe(true);
    expect(await can('authenticated', 'zz_later', 'SELECT')).toBe(false);
    await db.exec(`drop table public.zz_later`);
  });

  it('running the file again changes nothing', async () => {
    await db.exec(FILE);
    expect(await can('authenticated', 'fields', 'INSERT')).toBe(true);
    expect(await can('authenticated', 'device_tokens', 'SELECT')).toBe(false);
  });
});
