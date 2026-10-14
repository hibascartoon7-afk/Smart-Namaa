-- Add latitude/longitude to field_meters for real weather API queries
-- Also add a field_metadata table for field-level coordinates and settings

ALTER TABLE field_meters ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE field_meters ADD COLUMN IF NOT EXISTS longitude numeric;

-- Set the field coordinates (Riyadh, Saudi Arabia — NAMAA's operating region)
UPDATE field_meters SET latitude = 24.7136, longitude = 46.6753 WHERE latitude IS NULL;

-- Create a field_settings table for field-wide configuration
CREATE TABLE IF NOT EXISTS field_settings (
  id int PRIMARY KEY DEFAULT 1,
  field_name text NOT NULL DEFAULT 'Field Alpha',
  latitude numeric NOT NULL DEFAULT 24.7136,
  longitude numeric NOT NULL DEFAULT 46.6753,
  timezone text NOT NULL DEFAULT 'Asia/Riyadh',
  weather_provider text NOT NULL DEFAULT 'open-meteo',
  weather_last_sync timestamptz,
  weather_cache_minutes int NOT NULL DEFAULT 30,
  sensor_stale_threshold_minutes int NOT NULL DEFAULT 30,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO field_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE field_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_field_settings" ON field_settings;
CREATE POLICY "anon_select_field_settings" ON field_settings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_update_field_settings" ON field_settings;
CREATE POLICY "anon_update_field_settings" ON field_settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_insert_field_settings" ON field_settings;
CREATE POLICY "anon_insert_field_settings" ON field_settings FOR INSERT TO anon, authenticated WITH CHECK (true);
