# Guide 1: Architecture (how the pieces fit)

## The path of one number

```
soil sensors (several points) ──> one ESP32 ──> sensor-ingest ──> sensor_readings ─┐
Open-Meteo (per field location) ──> weather-sync ──> weather_observations ─────────┤
                                                                                   v
planting date, crop (Kc, root depth, p, stage lengths), soil (FC, WP) ──> decision-engine
                                                                                   │
                         decisions, decision_explanations, alerts, water_savings <─┘
                                         │
                web app (reads with the user's login, row level security)
                                         │
                      namaa-chat (Ghaith / Nada) explains the stored decision
```

| Part | Where | Job | Who may call it |
|---|---|---|---|
| ESP32 hub firmware | `firmware/namaa_hub` (written, not yet run on hardware) | Opens its own Wi-Fi, takes the readings of the field nodes, buffers them on the flash, posts them to `sensor-ingest` over https | holds a device token |
| `sensor-ingest` | `supabase/functions/sensor-ingest` | Checks the device token, stores readings (missing = `NULL`, impossible = `suspect`) | a device (token), not a user |
| `device-provision` | `supabase/functions/device-provision` | Creates a device for an environment and shows its token **once** (only the SHA-256 hash is stored); can revoke | the owner of the environment |
| `weather-sync` | `supabase/functions/weather-sync` | Fetches hourly weather from Open-Meteo for **one field** and stores it; max one call per field per 10 minutes | the owner (signed in) |
| `scheduled-refresh` | `supabase/functions/scheduled-refresh` | The hourly job: for every environment, weather then decision (see guide 5, section 6) | the scheduler only (pg_cron with the secret `CRON_SECRET`) |
| `decision-engine` | `supabase/functions/decision-engine` | Loads everything about one field, runs the engine, stores decision, explanation, alerts, saving | the owner, or the scheduler with the service-role key |
| `namaa-chat` | `supabase/functions/namaa-chat` | Builds an answer from the stored decision and the reference texts | the owner (signed in) |
| Web app | `namaa-agritech/` | Map, dashboard, alerts, savings, chat; creates environments and sensor points | a signed-in user |

## Terms

- **Environment** = one row of `fields`: one crop, one ESP32 unit, several named **sensor points** (`sensor_points`). The app says "environment", the database says "field".
- **Decision** = the engine's output for one environment at one moment.
- **Alert** = a bilingual (English and Arabic) message stored with the decision. Kinds: `engine`, `forecast` (ML), `savings`.

## One engine, three copies

`src/engine/` is the only place to edit engine code. `npm run sync-engine` copies it to:

1. `supabase/functions/_shared/engine/` (Deno needs `.ts` at the end of every import; the script adds it),
2. `namaa-agritech/src/lib/engine/` (only the few pure files the app uses: ET0, IDW, stats, time, weather summary).

Every copy starts with a "GENERATED" line. `npm run check-sync` (also run by the tests) fails when a copy differs from the original.

## Why the engine is pure

`decideField()` in `src/engine/decide-field.ts` takes rows in and returns a decision out. No network, no database. `run-decision.ts` loads the rows and stores the result. This is why the rules can be tested without a server and why the Edge Function stays small.

## Who decides what

| Question | Answered by |
|---|---|
| Irrigate or not, and how much | The rule-based engine (FAO-56). Always. |
| What will the soil moisture be tomorrow | The ML model, **switched off for now** (the engine passes no forecasts, so no forecast alert is produced). When it is switched on it only estimates; the engine turns the estimate into a **separate** warning with the same physics. |
| Why was this decided, in words | The chatbot. It rephrases the stored decision and cites reference texts; it never invents a field number. |

## Security in one paragraph

Row level security is on for every table. A user reads only rows of environments they own. Writes of readings, weather, decisions and alerts are done only by Edge Functions with the service role, which never reaches the browser. Device tokens are stored as hashes. Details: [guide 3](guide-3-database-and-security.md).
