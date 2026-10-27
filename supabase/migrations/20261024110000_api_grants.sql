-- Explicit privileges for the roles of the Data API (the browser app = authenticated, the Edge Functions = service_role).
--
-- Why: Supabase no longer grants new tables to these roles automatically (new projects since 2026-05-30; "permission denied for table X",
-- error 42501, which comes BEFORE row level security is even looked at). Every table the app or a function touches needs an explicit GRANT.
-- The earlier migrations never granted anything (they relied on the old default), so on a project without the old default the app could
-- not create an environment ("permission denied for table fields") and the functions could not write the tables made by later migrations.
--
-- The rule used here (least privilege): the browser gets EXACTLY what the existing row level security policies already allow, nothing more;
-- the functions (service_role, server side only, bypasses RLS) get full access to the tables of the public schema. anon gets nothing.
-- A table WITHOUT a policy for authenticated gets no browser privilege at all (device_tokens: the hashes of the ESP32 tokens).
-- Safe to run again. Nothing is removed from any role.

grant usage on schema public to authenticated, service_role;

-- A) the Edge Functions (service_role)
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
-- tables, sequences and functions created later by the owner role: the functions can use them without a new grant
-- (the browser never gets anything by default: a new table needs its own explicit grant for authenticated, see docs/guide-3)
alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public grant usage, select on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

-- B) the browser app (authenticated): only what the policies allow
-- read-only reference data and results
grant select on
  public.alert_thresholds, public.alerts, public.crop_coefficients, public.crop_growth_stages, public.crop_irrigation_rules,
  public.crop_nutrient_rates, public.crop_nutrient_sufficiency, public.crop_water_params, public.crops, public.decision_explanations,
  public.decisions, public.devices, public.fertilizer_soil_notes, public.fertilizers, public.knowledge_chunks, public.ml_model_registry,
  public.moisture_forecasts, public.nutrient_methods, public.sensor_readings, public.soil_types, public.sources, public.water_savings,
  public.weather_observations
  to authenticated;
-- the owner creates, changes and deletes her environments (policy fields_owner_all) and their sensor points
grant select, insert, update, delete on public.fields, public.sensor_points to authenticated;
-- lab results of N, P, K: read, add, delete (no update: delete and enter again)
grant select, insert, delete on public.nutrient_measurements to authenticated;
-- her profile: read and change the name
grant select, update on public.profiles to authenticated;
-- the view that says which crops the engine can decide
grant select on public.crop_readiness to authenticated;
