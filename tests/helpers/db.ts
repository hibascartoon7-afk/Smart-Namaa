// Shared by the database tests: a real in-memory Postgres (PGlite) with the schema of the project's Supabase database,
// the FAO-56 Table 12 data, and ALL migrations applied.
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db, Scalar, SelectOptions } from '../../src/engine/db';
import { loadTable12 } from '../fixtures/table12';

export const MIGRATIONS = [
  '20261020090000_frontend_read_policies.sql',
  '20261020120000_owner_manage_sensor_points.sql',
  '20261021090000_crop_water_params.sql',
  '20261021100000_populate_crops.sql',
  '20261021110000_profiles.sql',
  '20261021120000_engine_outputs.sql',
  '20261021130000_devices_ingest.sql',
  '20261021140000_rag.sql',
  '20261023090000_soil_water_table19.sql',
  '20261023100000_growth_stages_table11.sql',
  '20261023110000_fertilization_reference.sql',
  '20261023120000_fertilization_doses_soil_notes.sql',
  '20261024090000_scheduled_refresh.sql',
  '20261024100000_nutrient_measurements.sql',
  '20261024110000_api_grants.sql',
];
export const readMigration = (f: string) => readFileSync(fileURLToPath(new URL(`../../supabase/migrations/${f}`, import.meta.url)), 'utf-8');

// the tables that already exist in the real database (from information_schema), reduced to what the migrations touch
export const BASE_SCHEMA = `
create schema if not exists auth; create schema if not exists extensions;
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create table auth.users (id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.sources (id text primary key, title text, source_type text, verification_status text, created_at timestamptz default now(), url text);
create table public.crop_coefficients (id uuid primary key default gen_random_uuid(), row_id int, section text, crop text, variant text, row_type text, kc_ini_min numeric, kc_ini_max numeric, kc_ini_footnote text, kc_mid_min numeric, kc_mid_max numeric, kc_mid_footnote text, kc_end_min numeric, kc_end_max numeric, kc_end_footnote text, crop_name_footnotes text, source_id text, created_at timestamptz default now());
create table public.crops (id uuid primary key default gen_random_uuid(), crop_name text, created_at timestamptz default now(), coefficient_id uuid references public.crop_coefficients(id));
create table public.crop_growth_stages (id uuid primary key default gen_random_uuid(), crop_id uuid references public.crops(id), initial_days int, development_days int, mid_days int, late_days int, root_depth_m numeric, created_at timestamptz default now());
create table public.crop_irrigation_rules (crop_id uuid, moisture_min numeric, moisture_max numeric, created_at timestamptz default now());
create table public.soil_types (id uuid primary key default gen_random_uuid(), soil_name text, created_at timestamptz default now(), field_capacity_pct numeric, wilting_point_pct numeric);
create table public.fields (id uuid primary key default gen_random_uuid(), owner_user_id uuid references auth.users(id), name text, latitude double precision, longitude double precision, timezone text, area_m2 numeric, created_at timestamptz default now(), crop_id uuid references public.crops(id), planting_date date, soil_type_id uuid references public.soil_types(id));
create table public.devices (id uuid primary key default gen_random_uuid(), field_id uuid references public.fields(id), device_name text, firmware_version text, device_status text, last_seen_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.device_tokens (id uuid primary key default gen_random_uuid(), device_id uuid references public.devices(id), token_hash text, created_at timestamptz default now(), revoked_at timestamptz);
create table public.sensor_points (id uuid primary key default gen_random_uuid(), field_id uuid references public.fields(id), point_name text, latitude double precision, longitude double precision, created_at timestamptz default now());
create table public.sensor_readings (id uuid primary key default gen_random_uuid(), sensor_point_id uuid references public.sensor_points(id), measured_at timestamptz, moisture numeric, soil_temperature numeric, ec numeric, moisture_status text, soil_temperature_status text, ec_status text, created_at timestamptz default now());
create table public.weather_observations (id uuid primary key default gen_random_uuid(), field_id uuid references public.fields(id), observed_at timestamptz, air_temperature_c numeric, precipitation_mm numeric, rain_probability_pct numeric, et0_mm numeric, created_at timestamptz default now(), fetched_at timestamptz, constraint weather_observations_field_time_key unique (field_id, observed_at));
create table public.decisions (id uuid primary key default gen_random_uuid(), field_id uuid references public.fields(id), generated_at timestamptz default now(), irrigation_decision jsonb, fertilization_decision jsonb, created_at timestamptz default now(), etc_mm numeric, moisture_pct numeric, growth_stage text);
create table public.decision_explanations (id uuid primary key default gen_random_uuid(), decision_id uuid references public.decisions(id), explanation_text text, generated_at timestamptz default now(), created_at timestamptz default now());
insert into public.sources (id, title, source_type, verification_status) values ('FAO56_TABLE1', 'FAO-56 Table 12 Kc values', 'book', 'verified');
`;

export async function createDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { vector } });
  await db.exec(BASE_SCHEMA);
  for (const r of loadTable12().db) {
    await db.query(
      `insert into public.crop_coefficients (row_id, section, crop, variant, row_type, kc_ini_min, kc_ini_max, kc_ini_footnote, kc_mid_min, kc_mid_max, kc_mid_footnote, kc_end_min, kc_end_max, kc_end_footnote, crop_name_footnotes, source_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'FAO56_TABLE1')`,
      [r.row_id, r.section, r.crop, r.variant, r.row_type, r.kc_ini_min, r.kc_ini_max, r.kc_ini_footnote, r.kc_mid_min, r.kc_mid_max, r.kc_mid_footnote, r.kc_end_min, r.kc_end_max, r.kc_end_footnote, r.crop_name_footnotes],
    );
  }
  // the project already had Tomato in crops, linked to its Table 12 row
  await db.exec(`insert into public.crops (crop_name, coefficient_id) select 'Tomato', id from public.crop_coefficients where crop = 'Tomato' and row_type = 'crop'`);
  for (const m of MIGRATIONS) await db.exec(readMigration(m));
  await db.exec('grant usage on schema public, extensions to authenticated; grant all on all tables in schema public to authenticated; grant execute on all functions in schema public to authenticated;');
  return db;
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`bad identifier ${s}`);
  return `"${s}"`;
};
const roundTrip = <T,>(rows: unknown[]): T[] => JSON.parse(JSON.stringify(rows)) as T[]; // Dates -> ISO strings, like PostgREST

/** The same small interface the Edge Functions use, on PGlite (runs as the database owner, like the service role). */
export class PgliteDb implements Db {
  constructor(private readonly db: PGlite) {}

  async select<T = Record<string, unknown>>(table: string, o: SelectOptions = {}): Promise<T[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
    for (const [c, v] of Object.entries(o.eq ?? {})) where.push(v === null ? `${ident(c)} is null` : `${ident(c)}::text = ${add(String(v))}::text`);
    for (const [c, v] of Object.entries(o.in ?? {})) where.push(`${ident(c)}::text = any(${add(v.map(String))}::text[])`);
    for (const [c, v] of Object.entries(o.gte ?? {})) where.push(`${ident(c)} >= ${add(v)}`);
    for (const [c, v] of Object.entries(o.lte ?? {})) where.push(`${ident(c)} <= ${add(v)}`);
    const cols = o.columns ?? '*';
    if (!/^[a-z0-9_,\s*]+$/i.test(cols)) throw new Error('bad column list');
    const sql = `select ${cols} from ${ident(table)}${where.length ? ` where ${where.join(' and ')}` : ''}` +
      (o.order ? ` order by ${ident(o.order.column)} ${o.order.ascending === false ? 'desc' : 'asc'}` : '') +
      (o.limit ? ` limit ${Math.floor(o.limit)}` : '');
    return roundTrip<T>((await this.db.query(sql, params)).rows);
  }

  async insert<T = Record<string, unknown>>(table: string, rows: Record<string, unknown>[], returning?: string): Promise<T[]> {
    const out: unknown[] = [];
    for (const row of rows) {
      const keys = Object.keys(row);
      const params: unknown[] = [];
      const vals = keys.map((k) => {
        const v = row[k];
        const isJson = v !== null && typeof v === 'object';
        params.push(isJson ? JSON.stringify(v) : v);
        return `$${params.length}${isJson ? '::jsonb' : ''}`;
      });
      const ret = returning ? ` returning ${returning}` : '';
      const r = await this.db.query(`insert into ${ident(table)} (${keys.map(ident).join(',')}) values (${vals.join(',')})${ret}`, params);
      out.push(...r.rows);
    }
    return roundTrip<T>(out);
  }

  async upsert(table: string, row: Record<string, unknown>, onConflict: string): Promise<void> {
    const keys = Object.keys(row);
    const params = keys.map((k) => (row[k] !== null && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]));
    const conflict = onConflict.split(',').map((c) => ident(c.trim()));
    const set = keys.filter((k) => !onConflict.split(',').map((c) => c.trim()).includes(k)).map((k) => `${ident(k)} = excluded.${ident(k)}`);
    await this.db.query(
      `insert into ${ident(table)} (${keys.map(ident).join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) on conflict (${conflict.join(',')}) do update set ${set.join(',')}`,
      params,
    );
  }

  async upsertMany(table: string, rows: Record<string, unknown>[], onConflict: string): Promise<void> {
    for (const row of rows) await this.upsert(table, row, onConflict);
  }

  async update(table: string, values: Record<string, unknown>, where: Record<string, Scalar>): Promise<void> {
    const params: unknown[] = [];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const set = Object.entries(values).map(([k, v]) => `${ident(k)} = ${add(v)}`);
    const cond = Object.entries(where).map(([k, v]) => `${ident(k)}::text = ${add(String(v))}::text`);
    await this.db.query(`update ${ident(table)} set ${set.join(',')} where ${cond.join(' and ')}`, params);
  }
}
