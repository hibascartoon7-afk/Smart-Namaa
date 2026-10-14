/*
# NAMAA precision agriculture dataset tables

1. Overview
Creates the tables that hold the NAMAA field dataset so an operator can load
real sensor data, weather forecasts, advisories, and sustainability savings
into the database. The app is single-tenant (no sign-in screen), so all tables
are readable and writable by the anon-key frontend.

2. New Tables
- `field_meters` — one row per physical sub-surface 7-in-1 sensor in the field.
  - `id` (text, primary key, e.g. 'M1')
  - `label` (text, display name, e.g. 'Meter 1')
  - `x` (numeric, horizontal map position 0–100)
  - `y` (numeric, vertical map position 0–100)
  - `elevation` (text, 'high' | 'mid' | 'low')
  - `slope` (numeric, slope degrees)
  - `aspect` (text, compass aspect, e.g. 'SW', 'Flat')
  - `crop` (text, crop name)
  - `created_at` (timestamptz)

- `meter_readings` — time-series of 7-in-1 sensor values per meter.
  - `id` (uuid, primary key)
  - `meter_id` (text, references field_meters.id ON DELETE CASCADE)
  - `n` (numeric, nitrogen mg/kg)
  - `p` (numeric, phosphorus mg/kg)
  - `k` (numeric, potassium mg/kg)
  - `ec` (numeric, electrical conductivity mS/cm)
  - `temp` (numeric, soil temperature °C)
  - `ph` (numeric, soil pH)
  - `vwc` (numeric, volumetric water content %)
  - `ts` (timestamptz, reading timestamp)
  - `created_at` (timestamptz)

- `weather_forecasts` — latest weather forecast for the field.
  - `id` (uuid, primary key)
  - `location` (text, location label / coordinates)
  - `now_temp` (numeric)
  - `now_humidity` (numeric)
  - `now_wind` (numeric)
  - `now_condition` (text)
  - `now_icon` (text)
  - `rain_probability_3h` (numeric, %)
  - `rain_start_minutes` (numeric, minutes until rain starts)
  - `expected_rainfall_mm` (numeric)
  - `evapotranspiration` (numeric)
  - `hourly` (jsonb, array of { hour, temp, rain })
  - `created_at` (timestamptz)

- `advisories` — actionable alerts tied to a meter.
  - `id` (text, primary key)
  - `meter_id` (text, references field_meters.id ON DELETE CASCADE)
  - `severity` (text, 'high' | 'warning' | 'info')
  - `title` (text)
  - `body` (text)
  - `action` (text)
  - `eta` (text)
  - `icon` (text, lucide icon name)
  - `created_at` (timestamptz)

- `savings` — sustainability / cost savings metrics (single-row table).
  - `id` (int, primary key, always 1)
  - `fertilizer_saved_kg_ha` (numeric)
  - `fertilizer_baseline_kg_ha` (numeric)
  - `water_saved_m3` (numeric)
  - `water_baseline_m3` (numeric)
  - `co2e_reduced_kg` (numeric)
  - `co2e_baseline_kg` (numeric)
  - `yield_uplift_pct` (numeric)
  - `cost_saved_usd` (numeric)
  - `updated_at` (timestamptz)

3. Security
- RLS enabled on every table.
- All tables allow anon + authenticated CRUD because this is a single-tenant
  no-auth app and the data is intentionally shared across the dashboard.

4. Indexes
- `meter_readings` indexed on (meter_id, ts) for time-series queries.
- `advisories` indexed on meter_id.
*/

CREATE TABLE IF NOT EXISTS field_meters (
  id text PRIMARY KEY,
  label text NOT NULL,
  x numeric NOT NULL DEFAULT 0,
  y numeric NOT NULL DEFAULT 0,
  elevation text NOT NULL DEFAULT 'mid',
  slope numeric NOT NULL DEFAULT 0,
  aspect text NOT NULL DEFAULT 'Flat',
  crop text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meter_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id text NOT NULL REFERENCES field_meters(id) ON DELETE CASCADE,
  n numeric NOT NULL DEFAULT 0,
  p numeric NOT NULL DEFAULT 0,
  k numeric NOT NULL DEFAULT 0,
  ec numeric NOT NULL DEFAULT 0,
  temp numeric NOT NULL DEFAULT 0,
  ph numeric NOT NULL DEFAULT 0,
  vwc numeric NOT NULL DEFAULT 0,
  ts timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS weather_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location text NOT NULL DEFAULT '',
  now_temp numeric NOT NULL DEFAULT 0,
  now_humidity numeric NOT NULL DEFAULT 0,
  now_wind numeric NOT NULL DEFAULT 0,
  now_condition text NOT NULL DEFAULT '',
  now_icon text NOT NULL DEFAULT '',
  rain_probability_3h numeric NOT NULL DEFAULT 0,
  rain_start_minutes numeric NOT NULL DEFAULT 0,
  expected_rainfall_mm numeric NOT NULL DEFAULT 0,
  evapotranspiration numeric NOT NULL DEFAULT 0,
  hourly jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS advisories (
  id text PRIMARY KEY,
  meter_id text NOT NULL REFERENCES field_meters(id) ON DELETE CASCADE,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  action text NOT NULL DEFAULT '',
  eta text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT 'activity',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS savings (
  id int PRIMARY KEY DEFAULT 1,
  fertilizer_saved_kg_ha numeric NOT NULL DEFAULT 0,
  fertilizer_baseline_kg_ha numeric NOT NULL DEFAULT 0,
  water_saved_m3 numeric NOT NULL DEFAULT 0,
  water_baseline_m3 numeric NOT NULL DEFAULT 0,
  co2e_reduced_kg numeric NOT NULL DEFAULT 0,
  co2e_baseline_kg numeric NOT NULL DEFAULT 0,
  yield_uplift_pct numeric NOT NULL DEFAULT 0,
  cost_saved_usd numeric NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_meter_readings_meter_ts ON meter_readings (meter_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_advisories_meter ON advisories (meter_id);

-- RLS
ALTER TABLE field_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE advisories ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings ENABLE ROW LEVEL SECURITY;

-- field_meters policies
DROP POLICY IF EXISTS "anon_select_field_meters" ON field_meters;
CREATE POLICY "anon_select_field_meters" ON field_meters FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_field_meters" ON field_meters;
CREATE POLICY "anon_insert_field_meters" ON field_meters FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_field_meters" ON field_meters;
CREATE POLICY "anon_update_field_meters" ON field_meters FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_field_meters" ON field_meters;
CREATE POLICY "anon_delete_field_meters" ON field_meters FOR DELETE TO anon, authenticated USING (true);

-- meter_readings policies
DROP POLICY IF EXISTS "anon_select_meter_readings" ON meter_readings;
CREATE POLICY "anon_select_meter_readings" ON meter_readings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_meter_readings" ON meter_readings;
CREATE POLICY "anon_insert_meter_readings" ON meter_readings FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_meter_readings" ON meter_readings;
CREATE POLICY "anon_update_meter_readings" ON meter_readings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_meter_readings" ON meter_readings;
CREATE POLICY "anon_delete_meter_readings" ON meter_readings FOR DELETE TO anon, authenticated USING (true);

-- weather_forecasts policies
DROP POLICY IF EXISTS "anon_select_weather" ON weather_forecasts;
CREATE POLICY "anon_select_weather" ON weather_forecasts FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_weather" ON weather_forecasts;
CREATE POLICY "anon_insert_weather" ON weather_forecasts FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_weather" ON weather_forecasts;
CREATE POLICY "anon_update_weather" ON weather_forecasts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_weather" ON weather_forecasts;
CREATE POLICY "anon_delete_weather" ON weather_forecasts FOR DELETE TO anon, authenticated USING (true);

-- advisories policies
DROP POLICY IF EXISTS "anon_select_advisories" ON advisories;
CREATE POLICY "anon_select_advisories" ON advisories FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_advisories" ON advisories;
CREATE POLICY "anon_insert_advisories" ON advisories FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_advisories" ON advisories;
CREATE POLICY "anon_update_advisories" ON advisories FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_advisories" ON advisories;
CREATE POLICY "anon_delete_advisories" ON advisories FOR DELETE TO anon, authenticated USING (true);

-- savings policies
DROP POLICY IF EXISTS "anon_select_savings" ON savings;
CREATE POLICY "anon_select_savings" ON savings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_savings" ON savings;
CREATE POLICY "anon_insert_savings" ON savings FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_savings" ON savings;
CREATE POLICY "anon_update_savings" ON savings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_savings" ON savings;
CREATE POLICY "anon_delete_savings" ON savings FOR DELETE TO anon, authenticated USING (true);
