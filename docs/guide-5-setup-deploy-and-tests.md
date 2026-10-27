# Guide 5: Setup, deployment and tests

## 1. Install

Needs Node 20 or newer. For `npm run check-functions` also [Deno](https://deno.com).

```bash
npm install                       # project root: backend tests and scripts
cd namaa-agritech && npm install  # the web app
```

## 2. Database (once, then after every new migration)

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push                  # runs supabase/migrations in file-name order
```

Or open each file of `supabase/migrations/` in the Supabase SQL editor, in order. Then check the view `crop_readiness`: it lists which crops the engine can fully handle ([ADDING_A_CROP.md](ADDING_A_CROP.md)).

**`permission denied for table <name>` in the app** (for example when creating an environment): the table privilege is missing, not a policy. Run `20261024110000_api_grants.sql` (it is safe to run again), then check:

```sql
select table_name, string_agg(privilege_type, ', ' order by privilege_type) as authenticated_can
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'authenticated' and table_name in ('fields', 'sensor_points', 'nutrient_measurements')
group by table_name order by table_name;
-- fields: DELETE, INSERT, SELECT, UPDATE; sensor_points: the same; nutrient_measurements: DELETE, INSERT, SELECT
```

The time zone of an environment is an IANA name (`Asia/Hebron`); there is no `Asia/Ramallah`: Asia/Hebron is the zone of the whole West Bank. The place of the environment is its latitude and longitude (used for the weather).

## 3. Edge Functions

```bash
supabase secrets set OPENAI_API_KEY=sk-...            # for namaa-chat
supabase secrets set CRON_SECRET=<random text, 32 characters or more>   # for scheduled-refresh (section 6)
supabase functions deploy weather-sync
supabase functions deploy sensor-ingest
supabase functions deploy device-provision
supabase functions deploy decision-engine
supabase functions deploy namaa-chat
supabase functions deploy scheduled-refresh
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions by Supabase. In `supabase/config.toml` five functions have `verify_jwt = false` because they check who is calling by themselves (device token, user session, service key or the cron secret). `weather-sync` keeps the default and needs a signed-in user.

After changing anything in `src/engine/`:

```bash
npm run sync-engine               # copies the engine to the functions and the web app
npm run check-sync                # fails if a copy is out of date (also run by the tests)
npm run check-functions           # type-checks the functions with Deno
```

## 4. Web app

```bash
cd namaa-agritech
cp .env.example .env              # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (the anon key only)
npm run dev                       # development
npm run build                     # production files in dist/
```

Deploy the `dist/` folder to any static host. In Supabase, add the web address to Authentication -> URL configuration, so the sign-up confirmation link returns to the app.

## 5. Connecting an ESP32

1. In the app, open the environment tools and create a device. `device-provision` shows the **token once**; only its SHA-256 hash is stored. Copy it into the firmware settings. Lost token = create a new one and revoke the old one.
2. The device posts to the `endpoint` shown (`https://<project>.supabase.co/functions/v1/sensor-ingest`) with the header `Authorization: Bearer <token>`:

```json
{ "measured_at": "2026-10-21T09:00:00Z",
  "readings": [ { "sensor": "1", "moisture": 31.2, "soil_temperature": 24.1, "ec": 1.3 },
                { "sensor": "left", "moisture": null } ] }
```

`sensor` is the **name of a sensor point** of that environment (case ignored). `null` or a missing field means "not measured". At most 50 readings per request. `measured_at` is optional (server time is used), but not older than 24 hours.

The firmware that sends this is in `firmware/` (see `firmware/README.md`): an ESP32 hub that receives the readings of the field nodes over its own Wi-Fi and uploads them every few minutes. It is written but has not been run on a real ESP32 yet.

### An NPK sensor (when one exists)

A reading may also carry `nitrogen`, `phosphorus`, `potassium` (numbers, never negative):

```json
{ "readings": [ { "sensor": "1", "moisture": 31.2, "nitrogen": 14, "phosphorus": 12, "potassium": 110 } ] }
```

The device does **not** send the unit or the method: the owner declares them on the device, once, with SQL in the Supabase SQL editor (the project owner can do it; the app has no screen for it yet):

```sql
update public.devices set npk_unit = 'mg/kg', npk_method_code = 'sensor_<model>' where id = '<device id>';
```

Then, for the fertilization decision to judge the sensor's numbers, a limit for that method must exist with a **source** (a sensor's number is not a lab number, so no lab limit is used for it):

```sql
insert into public.crop_nutrient_sufficiency (crop_id, nutrient, unit, low_below, method, source_id, method_code)
select id, 'p', 'mg/kg', 20, 'how this limit was set', '<source id>', 'sensor_<model>' from public.crops where crop_name = 'Tomato';
```

Until both exist, the values are stored but the decision says they cannot be judged (and asks for a lab result). One value per nutrient and request is stored: the mean of the sensor points that sent a usable one. A decision from a sensor value says to confirm it with a lab test. Without any NPK sensor, the owner enters a lab result in the app (card "Soil and leaf test results").


## 6. When do decisions run

- **Every hour, by itself (the cron).** At minute 7 of every hour the database (pg_cron) calls the Edge Function `scheduled-refresh`. For **every environment** it fetches the weather of that environment's own location (Open-Meteo) and runs the decision engine, so the alerts are ready when the farmer opens the app.
- When the owner presses refresh in the app: it calls `weather-sync`, then `decision-engine` for that environment (same code, immediately).

### Setting up the cron (once)

1. **Deploy** the function and set its secret (section 3): `CRON_SECRET` is a random text of 32 characters or more. Example to make one: `openssl rand -hex 24`.
2. **Enable the extensions** in the Supabase dashboard: Integrations -> `pg_cron` and `pg_net` (Vault is on by default).
3. **Run the migration** `20261024090000_scheduled_refresh.sql` (`supabase db push`). It creates the function `public.run_scheduled_refresh()` and the job `namaa-hourly-refresh`. It contains no secret. If the extensions were not enabled yet it says so in a notice and skips the schedule: enable them and run the file again.
4. **Store the two secrets in Vault** (SQL editor, once; use your own values, never commit them):

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'namaa_project_url');
select vault.create_secret('<the same text as CRON_SECRET>', 'namaa_cron_secret');
```

Until both exist the job only writes a notice and calls nothing.

5. **Check it worked** (after the next minute 7):

```sql
select jobname, schedule, active from cron.job;                                   -- namaa-hourly-refresh | 7 * * * * | true
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
select status_code, content::text from net._http_response order by created desc limit 3;   -- 200 and a JSON summary
```

To try it now, without waiting: `select public.run_scheduled_refresh();` in the SQL editor, or from a terminal:

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/scheduled-refresh -H "Authorization: Bearer <CRON_SECRET>"
```

The answer is a summary: `total_fields`, `processed`, `not_reached`, `weather` (`ok`, `cached`, `skipped_no_location`, `failed`), `decisions` (`ok`, `failed`) and up to 20 `failures` (which environment, which step, what went wrong). A wrong or missing secret gets 401.

**Stop it:** `select cron.unschedule('namaa-hourly-refresh');`

### What the cron does and does not do

- Weather is per environment (its own latitude, longitude and timezone). An environment without a location gets no weather call (and no invented weather); its decision still runs and says what is missing.
- At most one Open-Meteo call per environment every 10 minutes (the same rule as `weather-sync`), so a manual refresh and the cron never double-call.
- If Open-Meteo fails or answers something unexpected, nothing is stored for that environment, the older weather rows stay, and the decision still runs. One environment failing never stops the others.
- Each run stores one decision per environment (24 per day per environment). The app shows the newest.
- **Limits:** a run handles at most 400 environments and stops starting new ones after 100 seconds; the list is rotated every hour so the same environments are not always last, and `not_reached` tells you how many were left. Open-Meteo's free use is non-commercial and limited per day (24 calls per environment per day here): check its terms before a commercial launch, and for many hundreds of environments use a paid plan.
- It does not read or write sensor readings (the ESP32 pushes those) and it does not change any rule of the engine.

## 7. Tests

| Command | What it proves |
|---|---|
| `npm test` (root) | 240+ backend tests: engine rules, FAO worked examples, ET0 on clock-change days, migrations on a real Postgres (PGlite) run twice, row level security, the whole pipeline, the hourly cron (weather + engine for every field, throttle, failures, schedule), chat prompt rules, growth-stage import, repo hygiene |
| `npm run typecheck` (root) | types of the engine and the tests |
| `cd namaa-agritech && npm test` | web app logic: sign-up checks, new-environment checks, map projection and estimates, alerts, field maths, and `sendChat` calling `namaa-chat` |
| `cd namaa-agritech && npm run build` | the production build works |
| `npm run check-sync` | the three copies of the engine are identical |
| `npm run check-functions` | the Edge Functions type-check (needs Deno) |
| `node --env-file=.env scripts/test-weather-sync.mjs <field_id>` | the deployed `weather-sync` on a real field (needs the `.env` shown at the top of that script) |

The tests use PGlite, so they do **not** replace running the migrations and the functions once on your real Supabase project.

## 8. Before you hand it over

```bash
npm test && npm run typecheck && npm run check-sync
cd namaa-agritech && npm test && npm run typecheck && npm run build
```
