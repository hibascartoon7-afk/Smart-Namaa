# NAMAA (نماء)

Irrigation decision support for farmers. Soil sensors (moisture, soil temperature, EC) at several named points of a field send their readings through one ESP32 to Supabase. A **rule-based decision engine** (FAO-56) decides whether to irrigate. An ML model for forecasting soil moisture 24 h ahead is planned but switched off for now. The chatbot (Ghaith / Nada) only **explains** what the engine decided and never decides.

## What is in this folder

| Folder | What it is |
|---|---|
| `src/engine/` | The decision engine (pure TypeScript). **The only place to edit engine code.** |
| `supabase/functions/` | Edge Functions: `weather-sync`, `sensor-ingest`, `device-provision`, `decision-engine`, `namaa-chat`, `scheduled-refresh` (the hourly cron) |
| `supabase/migrations/` | All database changes, run in file-name order |
| `namaa-agritech/` | The web app (React + TypeScript + Vite + Tailwind) |
| `firmware/` | ESP32 hub (receives the readings of the field nodes and uploads them to `sensor-ingest`), a field-node template, and the tests of the hub logic |
| `tests/` | Backend tests (engine, migrations on a real Postgres, chat, import script) |
| `data/reference/` | FAO-56 tables as CSV (Table 12 Kc, Table 19 soil water, Table 22 root depth and p) |
| `data/templates/` | CSV template for growth-stage lengths (see `docs/ADDING_A_CROP.md`) |
| `knowledge/` | Reference texts for the chatbot (RAG) |
| `docs/` | Everything explained: guides, formulas, sources, status |

## Quick start

```bash
npm install                    # backend tests and scripts
npm test                       # all backend tests
npm run typecheck

cd namaa-agritech
npm install
cp .env.example .env           # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                    # the web app
npm test && npm run build      # web app tests and production build
```

Full setup, secrets and deployment: [guide 5](docs/guide-5-setup-deploy-and-tests.md).

## Read in this order

| # | File | Answers |
|---|---|---|
| 1 | [docs/guide-1-architecture.md](docs/guide-1-architecture.md) | How the pieces fit: sensor to farmer, who may call what |
| 2 | [docs/guide-2-decision-engine.md](docs/guide-2-decision-engine.md) | How a decision is made, step by step, and when it refuses to decide |
| 3 | [docs/guide-3-database-and-security.md](docs/guide-3-database-and-security.md) | Tables, migrations, row level security, units |
| 4 | [docs/guide-4-chatbot-and-knowledge.md](docs/guide-4-chatbot-and-knowledge.md) | How `namaa-chat` works and how to add knowledge |
| 5 | [docs/guide-5-setup-deploy-and-tests.md](docs/guide-5-setup-deploy-and-tests.md) | Install, secrets, deploy, scheduler, tests, ESP32 token |
| + | [docs/ADDING_A_CROP.md](docs/ADDING_A_CROP.md) | Making a crop other than Tomato work (CSV template + steps) |
| + | [docs/STATUS.md](docs/STATUS.md) | What is done and checked, what is pending (paste it at the start of an AI chat) |
| + | [docs/sources.md](docs/sources.md) | Every source, what it is used for, and whether it was checked |

## Formulas and their sources

Every formula, its units, the code and the test that proves it: **[docs/formulas.md](docs/formulas.md)**.

| Formula | What it gives | Source |
|---|---|---|
| F-001 ETc = Kc x ET0 | Water the crop uses today (mm/day) | [FAO-56 Chapter 6](https://www.fao.org/4/X0490E/x0490e0b.htm), Table 12 for Kc |
| F-002 daily ET0 | Sum of the hourly ET0 of the field's local day | [Open-Meteo docs](https://open-meteo.com/en/docs) and [FAO-56 Chapter 4](https://www.fao.org/3/x0490e/x0490e04.htm) |
| F-003 Penman-Monteith | Scientific basis of the ET0 we use | FAO-56 Chapter 4 (Allen et al., 1998) |
| F-004 TAW | Total available water in the root zone | [FAO-56 Chapter 8](https://www.fao.org/4/X0490e/x0490e0e.htm), soil values from [Table 19](https://www.fao.org/4/x0490e/x0490e0c.htm) |
| F-006 RAW and p | Water the crop can use before stress | FAO-56 Chapter 8, Table 22 |
| F-007 Dr and the rule | Irrigate when depletion reaches RAW | FAO-56 Chapter 8 |
| F-008 Kc curve | Kc for today from the planting date | FAO-56 Chapter 6 (Eq. 66), Table 11 for stage lengths |
| F-009 saving | Water not needed because rain is coming (estimate) | FAO-56 Chapter 8 |
| F-010 IDW | Value between sensors | Shepard (1968) |
| F-011 forecast alert | Warning from the ML forecast, using RAW (not produced while ML is off) | FAO-56 Chapter 8 |
| F-012 fertilizer hold | Do not fertilize when water will drain | FAO-56 Chapter 8 |

Sources and their status (verified or not): [docs/sources.md](docs/sources.md), notes per source in [docs/source_notes/](docs/source_notes/). Original FAO-56 as one PDF (NRCS copy): <https://www.wcc.nrcs.usda.gov/ftpref/wntsc/waterMgt/irrigation/fao56.pdf>. Soil-moisture ML data (training only, never for rules): [Jornada LTER](https://catalog.data.gov/dataset/jornada-basin-lter-wireless-meteorological-station-at-npp-p-coll-site-30-minute-soil-volum).

## Non-negotiable rules

- No fake data anywhere (test fixtures only inside `tests/`). A missing value is `NULL`, never 0, never filled in.
- No scientific constant without a source (`sources` table, `source_id`).
- Missing input means the answer is `insufficient_data` and it says which input is missing.
- Weather is per field (latitude, longitude, time zone of the field).
- Device tokens are stored as hashes. Row level security on every table. No secrets in the web app, the firmware or git.
- The chatbot explains; the engine decides.
