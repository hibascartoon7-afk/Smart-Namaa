# Guide 3: Database and security

Run the migrations in `supabase/migrations/` **in file-name order**. Every file can be run twice without harm, and nothing existing is deleted.

## Migrations

| File | What it does |
|---|---|
| `20261016090000_link_kc_and_prepare_weather` | Links Kc rows to a source, `crops` to Kc, `fields.crop_id`, weather rules and first read policies |
| `20261020090000_frontend_read_policies` | Owners can read their sensor points, readings, decisions, explanations; soil types readable |
| `20261020120000_owner_manage_sensor_points` | Owners can add, rename and remove sensor points of their own environments |
| `20261021090000_crop_water_params` | FAO-56 Table 22 (root depth, p) with source `FAO56_TABLE22` (unverified) |
| `20261021100000_populate_crops` | Adds every FAO crop that has **both** a Kc row and a root-depth row to `crops` (exact name match, nothing guessed) |
| `20261021110000_profiles` | A profile (display name) for every user, created at sign-up |
| `20261021120000_engine_outputs` | `alerts`, `water_savings`, `ml_model_registry`, `moisture_forecasts`, reference tables (`crop_nutrient_sufficiency`, `fertilizers`, `alert_thresholds`, filled by later migrations), view `crop_readiness`, extra columns on `decisions` |
| `20261021130000_devices_ingest` | Owners can read their devices; a token hash can exist only once; sensor-point names are unique inside an environment (case ignored) |
| `20261021140000_rag` | `knowledge_chunks` (vector 1536) and the function `match_knowledge` |
| `20261023090000_soil_water_table19` | Source `FAO56_TABLE19` and the FAO-56 Table 19 soil values (min, max and the midpoint used by the engine) in `soil_types`, with `source_id` and `value_basis`. The engine ignores a soil without `source_id` |
| `20261023100000_growth_stages_table11` | Source `FAO56_TABLE11`; columns `plant_period`, `region`, `value_basis`, `source_id` on `crop_growth_stages`; stage lengths for 13 crops (a crop that already has any row is never touched) |
| `20261023110000_fertilization_reference` | Fills `fertilizers` (10 FAO products) and `crop_nutrient_sufficiency` (Tomato, Olives), with their sources (`unverified`) |
| `20261023120000_fertilization_doses_soil_notes` | The 30 C heat precaution row of `alert_thresholds` (source `HEAT_GUIDANCE`, unverified), dose ceilings per crop and nutrient (`crop_nutrient_rates`) and notes per fertilizer and soil (`fertilizer_soil_notes`), each with its source |
| `20261024100000_nutrient_measurements` | `nutrient_methods` (names of the measuring methods), column `method_code` on `crop_nutrient_sufficiency` (one limit per crop, nutrient and method), table `nutrient_measurements` (lab results and sensor values of N, P, K) with its row level security, and the columns `npk_unit` / `npk_method_code` on `devices` |
| `20261024110000_api_grants` | explicit privileges (GRANT) for the Data API roles: the browser (`authenticated`) gets exactly what the policies allow, the Edge Functions (`service_role`) get the tables of the public schema; `anon` gets nothing |
| `20261024090000_scheduled_refresh` | The function `run_scheduled_refresh()` (not callable by app users) and the hourly pg_cron job `namaa-hourly-refresh` that calls the Edge Function `scheduled-refresh`; no secret in the file (Vault holds `namaa_project_url` and `namaa_cron_secret`) |

Run them with `supabase db push`, or paste each file into the Supabase SQL editor. The tests (`tests/migrations.test.ts`) apply all of them on a real in-memory Postgres (PGlite), twice, and check that row level security works. This does **not** replace running them once on your real project.

## Tables

| Group | Tables | Notes |
|---|---|---|
| Account | `auth.users` (Supabase), `profiles` | name copied from sign-up metadata |
| Field | `fields`, `sensor_points`, `devices`, `device_tokens` | a sensor point has no depth column (one 3-in-1 sensor per point) |
| Measurements | `sensor_readings`, `weather_observations`, `nutrient_measurements` | readings: `moisture`, `soil_temperature`, `ec`, each with a status; weather: one row per field per hour; nutrient measurements: one row per nutrient, value, unit, method and source (`lab` entered by the owner, `sensor` written by the ingest) |
| Reference (readable by any signed-in user) | `sources`, `crop_coefficients` (Table 12, 134 rows), `crop_water_params` (Table 22), `crops`, `crop_growth_stages`, `soil_types`, `crop_nutrient_sufficiency`, `nutrient_methods`, `fertilizers`, `alert_thresholds` | every constant carries a `source_id` |
| Engine output | `decisions`, `decision_explanations`, `alerts`, `water_savings` | written only by the service role |
| ML (switched off for now) | `ml_model_registry`, `moisture_forecasts` | a model is used only when `active`; the engine currently loads no forecasts |
| Chatbot | `knowledge_chunks` | public reference text and its embedding |
| View | `crop_readiness` | per crop: `has_kc`, `has_water_params`, `has_stage_lengths` (a crop is fully usable only when all three are true) |

`docs/database-schema-v1.md` is the first plan and is kept for history; this guide and the migrations are the current truth.

## Units and missing values

| Variable | Unit | Range accepted by ingest |
|---|---|---|
| Moisture | volumetric water content, % (0-100) | outside it = `suspect` |
| Soil temperature | degrees C | -50 .. 100 |
| EC | dS/m | 0 .. 100 |

Status per variable: `measured`, `not_measured` (value `NULL`), `suspect` (sent but impossible, value `NULL`). **A missing value is `NULL`, never 0 and never imputed.** The limits (`LIMITS` in `src/engine/ingest.ts`) are physical limits of a sensor, not agronomic limits. A request is rejected when `measured_at` is older than 24 hours or more than 5 minutes in the future, or when it holds more than 50 readings. **Known gap:** the database has no unique rule on (sensor point, time), so a device that sends the same reading twice stores it twice (the engine only uses the newest usable reading, so decisions are not affected, but the table grows). Adding that rule is on the pending list in `STATUS.md`.

## Row level security (who sees what)

| Data | Read | Write |
|---|---|---|
| Own environments, sensor points, readings, weather, decisions, alerts, savings, devices | the owner only | readings, weather, decisions, alerts: Edge Functions (service role) only; environments and sensor points: the owner |
| Reference tables and `knowledge_chunks` | any signed-in user | nobody from the app |
| `device_tokens` | **nobody** (no policy) | Edge Functions only |

An RLS block returns **empty rows, not an error**. If a screen is empty after a new table, check its policy first.

### Two locks, not one: GRANT and RLS
A browser request must pass **both**: (1) the table privilege (`GRANT`) of the role, then (2) the row level security policy. Supabase no longer grants new tables to the API roles automatically (new projects since 2026-05-30), so a table without a `GRANT` fails with **`permission denied for table X` (42501)**, *before* any policy is looked at; an RLS block, by contrast, returns empty rows. `20261024110000_api_grants.sql` grants, to the browser, exactly what the policies allow (and nothing on `device_tokens`), and gives `service_role` the public tables. `tests/api-grants.test.ts` revokes everything first and checks the result table by table.

**A new table needs three things:** `enable row level security`, a policy, and an explicit `grant select (, insert, update, delete) on public.<table> to authenticated` for exactly the operations the policy allows. `service_role` gets the table by default privilege. When you add a table, add it to `tests/api-grants.test.ts` too: the test fails for a table nobody decided about.

## Secrets

| Secret | Where it lives | Never put it in |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function environment (set by Supabase), your own shell for scripts | the web app, firmware, git |
| `OPENAI_API_KEY` | Edge Function secret (`supabase secrets set`), shell for `ingest-knowledge` | the web app, firmware, git |
| `VITE_SUPABASE_ANON_KEY` | the web app `.env` (it is public by design; RLS protects the data) | - |
| Device token | the ESP32 only; shown once by `device-provision` | the database (only its hash is stored) |

`tests/hygiene.test.ts` fails if the web app mentions the service-role key.
