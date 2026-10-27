# NAMAA (نماء)

Irrigation and fertilization decision support for farmers. Soil sensors (moisture, soil temperature, EC) at several named points of a field send their readings through an ESP32 hub to Supabase. A **rule-based decision engine** (FAO-56) decides whether to irrigate and, when nutrients are measured, whether to fertilize. The chatbot (Ghaith / Nada) only **explains** what the engine decided and never decides. An ML model for forecasting soil moisture is planned but **paused**: no decision or alert uses it.

Weather is fetched **every hour by itself** (cron) for each field's own location, and the engine runs right after, so the alerts are ready when the farmer opens the app.

## What is in this folder

| Folder | What it is |
|---|---|
| `src/engine/` | The decision engine (pure TypeScript). **The only place to edit engine code.** |
| `supabase/functions/` | Edge Functions: `weather-sync`, `sensor-ingest`, `device-provision`, `decision-engine`, `namaa-chat`, `scheduled-refresh` (the hourly cron) |
| `supabase/migrations/` | All database changes, run in file-name order |
| `namaa-agritech/` | The web app (React + TypeScript + Vite + Tailwind) |
| `firmware/` | ESP32 hub (receives the readings of the field nodes and uploads them to `sensor-ingest`), a field-node template, and the tests of the hub logic. **Written, not yet run on a real ESP32.** |
| `tests/` | Backend tests (engine, migrations on a real Postgres, chat, cron, import script, repo checks) |
| `data/reference/` | FAO-56 tables as CSV (Table 12 Kc, Table 19 soil water, Table 22 root depth and p) and the fertilization reference data |
| `data/templates/` | CSV template for growth-stage lengths (see `docs/ADDING_A_CROP.md`) |
| `knowledge/` | Reference texts for the chatbot (RAG) |
| `docs/` | Everything explained: guides, formulas, sources, status |

## Quick start

```bash
npm install                    # backend tests and scripts
npm test                       # all backend tests
npm run typecheck
npm run test:firmware          # the hub logic tests (needs bash)

cd namaa-agritech
npm install
cp .env.example .env           # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (the public anon key only)
npm run dev                    # the web app
npm test && npm run build      # web app tests and production build
```

Full setup, secrets, deployment and the cron: [guide 5](docs/guide-5-setup-deploy-and-tests.md).

## Deploying the web app (how it is done now)

The site is on **Netlify** by drag and drop of the `dist` folder. It is **not connected to GitHub**, so a change in the code reaches the site only after:

1. `.env` exists in `namaa-agritech/` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (a new zip has no `.env` and no `node_modules`: run `npm ci` and copy `.env` first),
2. `npm run build` inside `namaa-agritech/`,
3. the new `dist` folder is uploaded to Netlify.

A change in `src/engine/` or in the database is not part of the site: it needs `supabase functions deploy <name> --use-api` for the functions, or the SQL run in the Supabase SQL Editor.

## Read in this order

| # | File | Answers |
|---|---|---|
| 1 | [docs/guide-1-architecture.md](docs/guide-1-architecture.md) | How the pieces fit: sensor to farmer, who may call what |
| 2 | [docs/guide-2-decision-engine.md](docs/guide-2-decision-engine.md) | How a decision is made, step by step, and when it refuses to decide |
| 3 | [docs/guide-3-database-and-security.md](docs/guide-3-database-and-security.md) | Tables, migrations, row level security, grants, units |
| 4 | [docs/guide-4-chatbot-and-knowledge.md](docs/guide-4-chatbot-and-knowledge.md) | How `namaa-chat` works and how to add knowledge |
| 5 | [docs/guide-5-setup-deploy-and-tests.md](docs/guide-5-setup-deploy-and-tests.md) | Install, secrets, deploy, the hourly cron, tests, ESP32 token |
| + | [docs/ADDING_A_CROP.md](docs/ADDING_A_CROP.md) | Making a crop other than Tomato work (CSV template + steps) |
| + | [docs/STATUS.md](docs/STATUS.md) | What is done and checked, what is pending (paste it at the start of an AI chat) |
| + | [docs/sources.md](docs/sources.md) | Every source, what it is used for, and what was checked |

## What the app does today

- **Irrigation:** per sensor point, from the measured moisture, the crop, the soil and the weather forecast of the field (FAO-56). It says why, and when it cannot decide it says which input is missing.
- **Fertilization:** the owner types a **lab result** (N, P or K: value, unit, method, sampling date) for the environment. The engine compares it with the stored limit **only if it was measured the same way** (same unit, soil or leaf, same method). If the result is below the limit it shows fertilizer options and a **dose ceiling**; if not, it says no fertilizer is needed for what was measured. Nutrients not measured are listed as "Not measured": that is not the same as "enough".
- **An NPK probe:** there is none yet. The ingest and the engine are ready for one: its readings are stored with the unit and method it sends and decide something only after a limit with the same method (and a source) is stored.
- **Alerts:** irrigate now, rain expected, soil saturated, heat precaution before fertilizing, no recent reading, and others, in English and Arabic.
- **Chatbot:** explains the stored decision. It needs an `OPENAI_API_KEY` secret; without it the chat answers that it is not configured and the rest of the app works.

## Known limits (read before trusting a number)

- **Fertilizer dose is a ceiling, not a calculation.** For Tomato phosphorus the source (UC IPM, California) gives "up to 150 lb P2O5/acre for soils testing Low" = 16.81 kg per dunum for the whole season. The measured value decides **whether** fertilizer is needed, not **how much**. A proportional dose needs a sourced recommendation table.
- **All fertilization numbers come from California or FAO documents, not from Palestine.** They are guidance, not a prescription: confirm with an agronomist.
- **Nitrogen is not judged:** the source gives no "Low" limit for soil nitrogen, so an N result is stored but decides nothing.
- **The heat limit (30 C) is a precaution** from garden and lawn guidance, not from a field-crop trial.
- **No priority between zones yet.** Irrigation is decided per sensor point, but the points are not ranked. Fertilizer cannot be ranked by zone: a lab result describes the whole field.
- **Duplicate readings are not removed:** a device that re-sends a reading stores it twice (decisions are not affected, the table grows).
- **Source checks are partial.** See "Sources and their status" below.
- ML is paused. The firmware has not been run on a real ESP32.

## Formulas and their sources

Every formula, its units, the code and the test that proves it: **[docs/formulas.md](docs/formulas.md)**.

| Formula | What it gives | Source |
|---|---|---|
| F-001 ETc = Kc x ET0 | Water the crop uses today (mm/day) | [FAO-56 Chapter 6](https://www.fao.org/4/X0490E/x0490e0b.htm), Table 12 for Kc |
| F-002 daily ET0 | Sum of the hourly ET0 of the field's local day | [Open-Meteo docs](https://open-meteo.com/en/docs) and [FAO-56 Chapter 4](https://www.fao.org/3/x0490e/x0490e04.htm) |
| F-003 Penman-Monteith | Scientific basis of the ET0 we use | FAO-56 Chapter 4 (Allen et al., 1998) |
| F-004 TAW | Total available water in the root zone | [FAO-56 Chapter 8](https://www.fao.org/4/X0490e/x0490e0e.htm), soil values from [Table 19](https://www.fao.org/4/x0490e/x0490e0c.htm) |
| F-005 middle zone | Value halfway between two sensors | A NAMAA rule, not from a source |
| F-006 RAW and p | Water the crop can use before stress | FAO-56 Chapter 8, Table 22 |
| F-007 Dr and the rule | Irrigate when depletion reaches RAW | FAO-56 Chapter 8 |
| F-008 Kc curve | Kc for today from the planting date | FAO-56 Chapter 6 (Eq. 66), Table 11 for stage lengths |
| F-009 saving | Water not needed because rain is coming (estimate) | FAO-56 Chapter 8 |
| F-010 IDW | Value between sensors | Shepard (1968) |
| F-011 forecast alert | Warning from the ML forecast, using RAW (not produced while ML is paused) | FAO-56 Chapter 8 |
| F-012 fertilizer warnings | Do not fertilize when water will drain; heat precaution; measured N, P, K against the stored limits | FAO-56 Chapter 8; UC IPM and CDFA for the limits (see `docs/sources.md`) |

### Sources and their status

Full list, what each is used for and the verification log: [docs/sources.md](docs/sources.md); notes per source in [docs/source_notes/](docs/source_notes/).

`verified` in the database means **checked by the team, with the scope written in the source title**. No source was compared as a whole:

| Source | Scope of the check |
|---|---|
| FAO-56 Table 11 (stage lengths) | Tomato row only (2026-10-26) |
| FAO-56 Table 22 (root depth, p) | Tomato row only (2026-10-26) |
| FAO-56 Table 19 (soil water) | all 9 soil classes, with a screenshot (2026-10-27); one uncertain cell (Silty clay, lower field capacity) |
| FAO-56 Table 12 (Kc) | 24 rows including Tomato, with a screenshot (2026-10-27); the import was also checked by tests |

The fertilization sources (FAO fertilizer specifications, CDFA, UC IPM, University of Idaho) and the heat guidance are `unverified`. Original FAO-56 as one PDF (NRCS copy): <https://www.wcc.nrcs.usda.gov/ftpref/wntsc/waterMgt/irrigation/fao56.pdf>. Soil-moisture ML data (training only, never for rules): [Jornada LTER](https://catalog.data.gov/dataset/jornada-basin-lter-wireless-meteorological-station-at-npp-p-coll-site-30-minute-soil-volum).

## Non-negotiable rules

- No fake data anywhere (test fixtures only inside `tests/`). A missing value is `NULL`, never 0, never filled in. A typed 0 is a real measurement.
- No scientific constant without a source (`sources` table, `source_id`).
- A measured value is compared only with a limit measured the same way (unit, sample type, method). Otherwise it is kept and shown, but decides nothing.
- Missing input means the answer is `insufficient_data` and it says which input is missing.
- Weather is per field (latitude, longitude, time zone of the field).
- Device tokens are stored as hashes. Row level security on every table. No secrets in the web app, the firmware or git.
- The chatbot explains; the engine decides.