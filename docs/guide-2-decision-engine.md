# Guide 2: The decision engine

Code: `src/engine/decide-field.ts` (the whole decision), `water-balance.ts` (the irrigation rule), `kc-curve.ts` (Kc of today), `et0.ts` (daily ET0). Every formula with its source: [formulas.md](formulas.md).

## Inputs (for one environment)

| Input | From | If it is missing |
|---|---|---|
| Moisture of each sensor point | latest reading **not older than 6 hours**, status not `not_measured` / `suspect` | that point gets no decision; the alert `no_recent_reading` names it |
| Field capacity and wilting point (%) | `soil_types` of the environment (FAO-56 Table 19, midpoint of the range). The row **must have a `source_id`**; a soil without one is treated as missing | `insufficient_data`, reason "no soil type" / soil data missing |
| Root depth Zr and depletion fraction p | FAO-56 Table 22 (`crop_water_params`) | `insufficient_data` |
| Kc ini / mid / end | FAO-56 Table 12 (`crop_coefficients`) | `insufficient_data`, reason names what is missing |
| Growth-stage lengths | `crop_growth_stages` (FAO-56 Table 11 for 13 crops, loaded by migration; the newest row of a crop is used) | `insufficient_data`, reason "growth-stage lengths are not stored" ([how to add them](ADDING_A_CROP.md)) |
| Planting date | the environment | `insufficient_data` |
| ET0 of today | sum of the 24 hourly values of the field's local day (F-002) | `insufficient_data`; a day with a missing hour is never summed partially |
| Rain forecast, next 24 h | `weather_observations` | used only if all 24 hours exist (a partial sum could hide rain) |

## Steps

1. **Day of the season** = days since planting + 1. Find the growth stage (initial, development, mid, late) and Kc of today by straight-line interpolation (F-008).
2. **ETc** = Kc x ET0 (F-001). A Kc range gives an ETc range; the **upper end** is used next.
3. **TAW** = 1000 x (FC - WP)/100 x Zr (F-004). Zr is the smaller value of Table 22.
4. **p** = p_table + 0.04 x (5 - ETc), limited to 0.1 .. 0.8, and **RAW** = p x TAW (F-006).
5. For each sensor point: **Dr** = 1000 x (FC - moisture)/100 x Zr (F-007).
6. Rain that counts: the 24 h forecast, or 0 when it is below 0.2 x ET0.
7. Rule per point (first match wins):

| Condition | Result |
|---|---|
| an input is missing or impossible | `insufficient_data` + which input |
| Dr <= 0 | `do_not_irrigate`: soil at or above field capacity |
| Dr < RAW | `do_not_irrigate`: moisture is enough |
| Dr minus rain < RAW | `do_not_irrigate`: rain is expected |
| otherwise | `recommend_irrigation` with a net depth in mm (never more than Dr) |

8. **Field status**: `recommend_irrigation` if any point needs irrigation; `insufficient_data` if no point could be decided; otherwise `do_not_irrigate`.

## Alerts it can write

| Code | Severity | When |
|---|---|---|
| `irrigate_now` | action | at least one point needs irrigation |
| `rain_expected` | warning | irrigation skipped because of expected rain |
| `soil_saturated` | warning | soil at field capacity |
| `fertilizer_hold_leaching` | warning | water is expected to drain below the roots (F-012) |
| `fertilizer_hold_heat` | warning | the highest air temperature forecast for the next 24 h is at or above the stored limit (30 C for every crop, from garden and lawn guidance: a precaution, the alert says so). Never changes the irrigation decision (F-012) |
| `predicted_stress` | warning (kind `forecast`) | an **active** ML model's forecast reaches RAW (F-011). **Not produced for now:** ML is switched off and `run-decision.ts` passes no forecasts |
| `estimated_saving` | info (kind `savings`) | rain replaced or reduced an irrigation (F-009) |
| `cannot_decide` | info | no point could be decided; the message says why |
| `no_recent_reading` | info | some points have no usable reading |
| `no_sensor_points` | info | the environment has no sensor points |

Every alert has an English and an Arabic title and message (a test checks this).

## Fertilization

The engine returns `{ status: "insufficient_data" }` until nitrogen, phosphorus and potassium are **measured**, and says which ones. A measured value comes from the table `nutrient_measurements`: a **lab result** typed by the owner (card "Soil and leaf test results") or a value from an **NPK sensor** (none exists yet; the ingest is ready, see guide 5).

**Which value is judged.** Each stored limit (`crop_nutrient_sufficiency`) was set for one **method** (`method_code`, e.g. `soil_olsen_p`) in one **unit**. A measurement is compared only with a limit of the SAME nutrient, method and unit (`pickNutrientValues` in `src/engine/fertilization.ts`): a leaf value in % is not a soil value in ppm, and a sensor's number is not a lab number, so nothing is converted and no method is assumed equal to another. Among the comparable values the **newest** wins. There is no age limit (no source gives one): the decision says how many days old the value is. A value no limit fits is reported as "not comparable" with the reason (and, if nothing else was measured, the answer is `measurements_not_comparable`, not "not measured"). A value dated in the future or a negative one is never used.

**What the decision says.** The decision text and `result.measurements` / `result.rejected` say what it is based on: the nutrient, value, unit, method name, lab test or sensor, and the age. A decision from a **sensor** value always carries the warning to confirm it with a lab test before applying fertilizer. For a new sensor, the owner declares its unit and method on the device and a limit for that method must be stored with a source; until then its values are "not comparable".

The reference data is stored with a `source_id` on every row: `fertilizers` (10 FAO products) and `crop_nutrient_sufficiency` (Tomato soil P and K, Olives July-leaf N, P, K; California values, not Palestinian, `unverified`), dose ceilings in `crop_nutrient_rates` and soil notes in `fertilizer_soil_notes`. With measured values the engine compares them with the crop's limit and lists every stored product that carries the missing nutrient (highest content first), each with its amount, the dose ceiling and the soil notes. Details: `data/reference/fertilization_reference.README.md`. The code contains no nutrient number. If the table of measurements is not available (migration not run) the engine logs it, irrigation is decided as usual and fertilization says "not measured".

## What it does not do (stated honestly)

- Kc mid and Kc end are not corrected for local wind and humidity.
- Rain probability is shown but never changes a decision (no sourced threshold).
- Moisture comes from the sensor as volumetric water content (%). No conversion from other units.
- Estimates between sensors (map) and saving numbers are estimates and are labelled so.

## Tests

`tests/decide-field.test.ts` (dry day, rain coming, missing pieces, ML forecast, bilingual texts), `tests/water-balance.test.ts` (checked against worked values of the book), `tests/kc-curve.test.ts`, `tests/et0.test.ts` (including 23- and 25-hour clock-change days), `tests/pipeline.test.ts` (the whole path on a real Postgres, including a lab result and the NPK sensor path), `tests/nutrient-measurements.test.ts` (which stored value is judged, and the texts).
