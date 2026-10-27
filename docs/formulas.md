# NAMAA formulas

Every formula lists its source, units, the code that implements it, and the test that proves it.
Status words: **verified** = checked against the source text; **to check** = taken from a secondary page, confirm in the book.

---

## F-001  Crop evapotranspiration

```
ETc = Kc x ET0
```

| Symbol | Meaning | Unit | Where it comes from |
|---|---|---|---|
| ET0 | Daily reference evapotranspiration | mm/day | F-002 (from Open-Meteo hourly values, stored per field in `weather_observations`) |
| Kc | Crop coefficient for a growth stage (ini / mid / end) | dimensionless | FAO-56 Table 12, table `crop_coefficients` |
| ETc | Crop evapotranspiration | mm/day | computed |

- **Source (verified):** FAO Irrigation and Drainage Paper 56 (Allen et al., 1998). The relation ETc = Kc ETo is Eq. 56 in Chapter 5 (printed p. 90) and Eq. 58 in Chapter 6 (printed p. 103). Kc values: Chapter 6, Table 12 (printed p. 110).
  https://www.fao.org/4/X0490E/x0490e0b.htm
- **Code:** `src/engine/kc.ts` -> `computeEtc`, `resolveKc`
- **Tests:** `tests/kc.test.ts`, `tests/et0.test.ts`
  - Chapter 6, Example 24: Kc ini 0.85 x ETo 4.0 mm/day = 3.4 mm/day
  - Chapter 6, Example 25: Kc ini 0.60 x ETo 5 mm/day = 3.0 mm/day

### Rules implemented
1. Table 12 gives some values as ranges (e.g. tomato Kc end 0.70-0.90). The engine returns a range and `isRange = true`; it never silently picks one end.
2. A blank Kc ini cell uses the **group row of the same section** only for Kc ini, because Chapter 6 states that for several groups one Kc ini is listed and represents the whole group. Mid and end are never inherited. The result is flagged `approximate` (Chapter 6: Kc ini values in Table 12 are approximations for planning).
3. Footnotes printed in Table 12 are returned as `reviewFootnotes` (tomato Kc mid: footnote 2, staked tall crops use a higher Kc).
4. Missing ET0 or Kc -> `unavailable` with a reason. Never 0.

### Not covered yet (needs more source data)
- Interpolating Kc between stages (Eq. 66) needs stage lengths (Table 11) and a planting date.
- Adjusting Kc mid / Kc end for local wind and humidity (Eq. 62, 65) needs u2 and RHmin.
- Adjusting Kc ini for wetting frequency (Figures 29-30, Eq. 59-61).

---

## F-002  Daily ET0 used by NAMAA

```
ET0_day = sum of the hourly ET0 values of the field's local day
```

| Symbol | Meaning | Unit | Where it comes from |
|---|---|---|---|
| ET0 hourly | Reference evapotranspiration of a well-watered grass field, FAO-56 Penman-Monteith, computed by the weather model | mm per hour | Open-Meteo `et0_fao_evapotranspiration`, stored hourly in `weather_observations.et0_mm` |
| ET0_day | Same, for one local day | mm/day | computed |

- **Source for the aggregation (verified in the Open-Meteo documentation):** Open-Meteo says its daily values are a simple 24-hour aggregation of the hourly values, and that daily ET0 is the daily sum. Each hourly ET0 is the sum over the preceding hour (the timestamp marks the end of the hour). We follow the same definition, so our daily number matches what Open-Meteo would return as daily ET0.
  https://open-meteo.com/en/docs
- **Source for what ET0 is:** FAO-56 Chapter 4 (the page Open-Meteo links for its ET0 variable).
  https://www.fao.org/3/x0490e/x0490e04.htm
  **To check:** the exact equation numbers of the daily and the hourly Penman-Monteith forms in the book (not verified yet; do not cite a number before checking).
- **Code:** `src/engine/et0.ts` -> `dailyEt0FromHourly`
- **Tests:** `tests/et0.test.ts` (complete day, real zeros, missing hour, NULL hour, no data, invalid time zone, daylight-saving days with 23 and 25 hours)

### Rules implemented
1. The local day comes from the field's IANA time zone. We request unix time from Open-Meteo, which its documentation recommends for daylight-saving-aware local times.
2. A complete day = hourly values one hour apart, from 00:00 to 23:00 local time (24 values, or 23 / 25 on a clock-change day).
3. **No partial sums.** A missing hour or a NULL value makes the day `unavailable`. A real 0 (night hour) is a value.
4. Each value belongs to the local date of its timestamp (same as Open-Meteo's daily aggregate). Strictly, the value stamped 00:00 covers the last hour of the previous day; the effect on ET0 is negligible because night-time ET0 is close to 0.

### Limits we must state when showing the number
- It is a weather-model estimate, not a measurement. Show ET0 and ETc as **estimates**.
- A sum of hourly ET0 is not identical to a daily-time-step FAO-56 calculation. Published comparisons report differences that depend on climate and method. Examples: a seven-site study found hourly FAO-56 values 5-8% lower than the hourly ASCE method (https://pure.psu.edu/en/publications/standardized-asce-penman-monteith-impact-of-sum-of-hourly-vs-24-h/); a station study in Iran found the hourly sum higher than the daily calculation by 5.8-44.6% depending on the month (https://jsw.um.ac.ir/article_29138.html). These studies compare calculation methods at stations; they do not test Open-Meteo.
- Real validation for NAMAA = compare predicted ETc / water need with the measured water used in the two-pot experiment (see `docs/validation.md`).

---

## Time meaning of the other Open-Meteo values (verified in the Open-Meteo documentation)
| Variable | Meaning of the value stamped T |
|---|---|
| `precipitation` (mm) | sum over the hour before T |
| `precipitation_probability` (%) | probability of more than 0.1 mm in the hour before T; based on ensemble models of about 27 km resolution |
| `temperature_2m` (C) | instant value at T |

Rule for the future "rain expected in the next 24 h": use the values stamped in the interval (now, now + 24 h], not "from now".

## Weather source and licence
Open-Meteo. Its documentation shows a licence choice (non-commercial, commercial, self-hosted) and says an API key is only needed for commercial use. Read https://open-meteo.com/en/licence before any commercial use (not read yet).

---

## F-003  Reference evapotranspiration, FAO-56 Penman-Monteith (basis of the ET0 we use)

```
u2  = uz x 4.87 / ln(67.8 z - 5.42)
es  = 0.6108 exp[17.27 T / (T + 237.3)]          ea = es x RH/100
D   = 4098 [0.6108 exp(17.27 T/(T+237.3))] / (T + 237.3)^2
g   = 0.000665 P ,   P = 101.3 [(293 - 0.0065 z)/293]^5.26
Rn  = Rns - Rnl ,    Rns = (1 - 0.23) Rs
ET0 = [0.408 D (Rn - G) + g (900/(T+273)) u2 (es - ea)] / [D + g (1 + 0.34 u2)]
```

- **Source:** Allen et al. (1998) FAO-56 (Eq. 47 wind at 2 m, Eq. 12 es, Eq. 13 slope D, Eq. 7-8 pressure and psychrometric constant, Eq. 38 Rns, Eq. 6 ET0); Penman (1948); Monteith (1965). **To check:** equation numbers against the book before citing them in the app.
- **How NAMAA uses it:** the server does not recompute ET0. Open-Meteo already returns the FAO-56 Penman-Monteith value (F-002). These equations are the scientific basis and the reference for any later local calculation.
- **Missing in the written form:** Rnl (net longwave radiation, FAO-56 Eq. 39) must be added if we ever compute ET0 ourselves; G = 0 for daily steps.
- **Units:** T in C, uz in m/s, z in m, RH in %, Rs, Rn, G in MJ m-2 day-1, ET0 in mm/day.

---

## F-004  Total available water in the root zone

```
TAW = 1000 x (theta_FC - theta_WP) x Zr          [mm]
```

| Symbol | Meaning | Unit | Where it comes from |
|---|---|---|---|
| theta_FC | water content at field capacity | m3/m3 (the table stores %, divide by 100) | `soil_types.field_capacity_pct` |
| theta_WP | water content at wilting point | m3/m3 (the table stores %, divide by 100) | `soil_types.wilting_point_pct` |
| Zr | root depth (the smaller value of the Table 22 range) | m | `crop_water_params.root_depth_min_m` (FAO-56 Table 22) |

- **Source:** FAO-56 Chapter 8 (Eq. 82). **To check:** equation number.
- **Status of the inputs:** FC / WP come from FAO-56 Table 19 (source `FAO56_TABLE19`, `unverified` until the owner checks the book; data in `data/reference/fao56_table19_soil_water.csv`, loaded by migration `20261023090000_soil_water_table19.sql`). The table gives ranges; the value used is the midpoint of each range, which is a NAMAA choice. The engine ignores a soil row that has no `source_id`.
- **Moisture unit decision:** sensor moisture is stored as volumetric water content in % (0-100), the same unit as `soil_types`. Values outside 0-100 are rejected by ingest.

---

## F-005  Middle zone between two sensors (a NAMAA rule, NOT from a source)

```
value(middle zone) = (reading A + reading B) / 2
position           = halfway between the coordinates of A and B
```

| Symbol | Meaning | Unit | Where it comes from |
|---|---|---|---|
| reading A, B | the latest usable reading of TODAY of each of the two sensor points, per variable (moisture, soil temperature, EC) | % / C / dS/m | `sensor_readings` |

- **Source:** none. It is the simplest estimate between two sensors; it equals inverse distance weighting (Shepard 1968, `src/engine/idw.ts`) halfway between two points, where the distances are equal. Code: `src/engine/middle-zone.ts`, screen: `MiddleZonePanel` (map and dashboard).
- **Limits shown to the user:** an estimate, not a measurement; never above the higher or below the lower reading, but the real soil can be (a wet patch, a leak, a dry spot between the sensors cannot be seen); with two sensors the error cannot be checked (the leave-one-out error of `idw.ts` needs 3 sensors), so both readings and their difference are shown beside it.
- **Missing data:** if one of the two readings is missing (none today, or flagged `suspect` / `sensor_error` / `not_measured`) there is NO estimate: it is never replaced by 0 or by the other sensor's value.
- **Not used for decisions:** display only. The irrigation decision still uses each sensor point's own reading.
- **N, P, K:** not estimated: they are not measured.

---

## F-006  Readily available water (RAW) and the adjusted depletion fraction

```
RAW = p x TAW                         [mm]
p   = p_table + 0.04 x (5 - ETc)      limited to 0.1 <= p <= 0.8       (ETc in mm/day)
```

| Symbol | Meaning | Unit | Where it comes from |
|---|---|---|---|
| TAW | Total available water in the root zone (F-004) | mm | computed |
| p_table | Fraction of TAW the crop can use before stress, for ETc of about 5 mm/day | - | FAO-56 Table 22, table `crop_water_params.depletion_fraction_p` |
| ETc | Crop evapotranspiration today (F-001, upper end of the Kc range) | mm/day | computed |

- **Source:** FAO-56 Chapter 8: RAW = p TAW (Eq. 83); Table 22, note 2 (the adjustment of p and its limits). https://www.fao.org/4/X0490e/x0490e0e.htm
- **Status:** the numbers 0.04, 5, 0.1 and 0.8 are written in the code with this source. **To check** against the book together with the Table 22 data (`sources.verification_status` of `FAO56_TABLE22` is `unverified`).
- **Code:** `src/engine/water-balance.ts` -> `adjustedDepletionFraction`. **Tests:** `tests/water-balance.test.ts`.

---

## F-007  Root-zone depletion and the irrigation rule

```
Dr = 1000 x (theta_FC - theta) x Zr                 [mm]   (Eq. 87, theta = measured moisture of ONE sensor point)
rain that counts = 0 when the 24 h forecast < 0.2 x ET0, otherwise the forecast
Dr_after_rain    = max(0, Dr - rain that counts)
```

Decision for each sensor point, checked in this order:

| Order | Condition | Result |
|---|---|---|
| 1 | a needed input is missing or impossible | `insufficient_data` and the list of what is missing |
| 2 | Dr <= 0 (at or above field capacity) | `do_not_irrigate` (`at_or_above_field_capacity`) |
| 3 | Dr < RAW | `do_not_irrigate` (`moisture_ok`) |
| 4 | Dr_after_rain < RAW | `do_not_irrigate` (`rain_expected`) |
| 5 | otherwise | `recommend_irrigation`, net depth = Dr_after_rain (never more than Dr) |

- **Source:** FAO-56 Chapter 8: Eq. 87 (depletion from a measured water content), the section "Forecasting or allocating irrigations" (irrigate before or when Dr reaches RAW; net depth not more than Dr), and the "Precipitation" section (rain below about 0.2 ETo per day is ignored). Zr: for irrigation scheduling the smaller value of the Table 22 range is used (Table 22, note 1). https://www.fao.org/4/X0490e/x0490e0e.htm
- **Moisture unit:** percent by volume (0-100), the same as `soil_types`. A value outside 0-100 is `invalid_inputs`, never converted.
- **The rain probability** is shown in the explanation but never changes the decision: no sourced threshold exists for it.
- **Code:** `src/engine/water-balance.ts` -> `decideIrrigation`. **Tests:** `tests/water-balance.test.ts`, `tests/decide-field.test.ts`.

---

## F-008  Kc along the season (single crop coefficient curve)

```
day i of the season = days since planting + 1            (planting day = day 1)
initial stage      (i <= L_ini)                : Kc = Kc ini
development stage                              : Kc = Kc ini + (i - L_ini) / L_dev x (Kc mid - Kc ini)
mid-season stage                               : Kc = Kc mid
late-season stage                              : Kc = Kc mid + (i - L_ini - L_dev - L_mid) / L_late x (Kc end - Kc mid)
after the last stage                           : unavailable (cycle ended)
```

- **Source:** FAO-56 Chapter 6: the four stages and the straight-line interpolation (Eq. 66). Kc values: Table 12 (`crop_coefficients`). Stage lengths L: Table 11 or the owner's own measured values, stored in `crop_growth_stages` with a `source_id` (see `docs/adding-a-crop.md`). https://www.fao.org/4/X0490e/x0490e0b.htm
- **Rules:** a range in Table 12 stays a range (both ends are interpolated). Any missing piece (planting date, stage lengths, Kc) gives `unavailable` and the reason; nothing is guessed. The decision uses the **upper end** of the ETc range to adjust p (cautious: a higher ETc lowers p, so irrigation starts earlier).
- **Limits we state:** Kc mid and Kc end are not corrected for local wind and humidity (Eq. 62), and Kc ini is an approximation (Chapter 6).
- **Code:** `src/engine/kc-curve.ts`. **Tests:** `tests/kc-curve.test.ts`.

---

## F-009  Estimated water saving when rain is expected

```
saved depth (mm)  = min( rain that counts , Dr )     only when the rain avoided or reduced an irrigation (Dr >= RAW)
saved volume (m3) = saved depth (mm) x area (m2) / 1000        (1 mm over 1 m2 = 1 litre)
field level       = mean of the sensor points that have a decision (each point stands for an equal share)
```

- **Source of the logic:** FAO-56 Chapter 8 (same sections as F-007): irrigation is due when Dr reaches RAW, expected rain reduces Dr, the net depth is at most Dr.
- **What it is NOT:** not a measured saving and not a comparison with a fixed timetable or a flood-irrigation habit (the farmer's baseline is unknown). It is shown everywhere as a forecast-based estimate (`basis = forecast`). Without the area of the environment no volume is given.
- **Code:** `src/engine/savings.ts`. **Tests:** `tests/engine-parts.test.ts` ("savings"). Stored per local day in `water_savings`.

---

## F-010  Estimate between sensor points (inverse distance weighting)

```
z(x) = sum( w_i z_i ) / sum( w_i ),     w_i = 1 / d_i^power
```

- **Source:** Shepard, D. (1968). A two-dimensional interpolation function for irregularly-spaced data. Proceedings of the 23rd ACM National Conference, 517-524. Distances: haversine on the Earth radius 6 371 008.8 m (mean radius).
- **Power:** chosen from 2, 1, 3 by leave-one-out cross-validation; the cross-validation error (RMSE) is returned with every estimate so the person sees how far to trust it. Needs at least 3 sensors with values. The result can never be above the highest or below the lowest sensor, and it cannot see a leak or a wet patch between sensors.
- **Where it is used:** tapping an empty spot of the field map. It is an estimate and is labelled as one.
- **Code:** `src/engine/idw.ts` (copy in the web app: `namaa-agritech/src/lib/engine/idw.ts`). **Tests:** `tests/engine-parts.test.ts` ("IDW"), `namaa-agritech/tests/map.test.ts`.

---

## F-011  Predictive alert from an ML moisture forecast

```
Dr_forecast = 1000 x (theta_FC - theta_forecast) x Zr         (same as F-007)
alert       when Dr_forecast >= RAW (F-006)
```

- **ML is paused (since 2026-10-23):** the engine loads no forecasts, so this alert is not produced yet. The rule below is implemented and tested for when a model is switched on.
- The ML model (trained on Jornada LTER data, ML only) estimates a soil-moisture value. It never decides. This rule turns the estimate into a warning with the same physics as the irrigation decision, worded as an estimate with the model name and version.
- Used only if the model is marked active in `ml_model_registry`, the forecast is not older than 12 hours and its target time is within the next 36 hours (operational settings, not scientific constants).
- **Code:** `src/engine/forecast-alert.ts`. **Tests:** `tests/engine-parts.test.ts` ("forecast alert"), `tests/decide-field.test.ts`.

---

## F-012  Do not fertilize when water will drain

- **Rule:** the alert `fertilizer_hold_leaching` appears when a sensor point is at or above field capacity (Dr <= 0) or when the rain that counts is larger than Dr plus today's ETc, so water is expected to drain below the root zone and can wash nutrients out.
- **Source:** FAO-56 Chapter 8, Eq. 88 (deep percolation). **To check:** the equation number against the book.
- **Heat precaution:** the alert `fertilizer_hold_heat` appears when the highest air temperature forecast for the next 24 hours is at or above the limit stored in `alert_thresholds` (code `fertilizer_hold_air_temp_max_c`). The stored limit is **30 C** for every crop, from garden and lawn guidance (source `HEAT_GUIDANCE`, `unverified`, weak: about 29-32 C = 85-90 F; NC State Extension only says granular fertilizer can burn plants in hot weather, with no number). It is a precaution, not a trial result on field crops, and the alert says so. It never changes the irrigation decision. A limit for one crop can be stored as another row with that crop's id; it wins for that crop. See `docs/sources.md`.
- **Fertilizer amounts:** only from **measured** N, P, K compared with the limits in `crop_nutrient_sufficiency` (each row with `source_id`, unit and method; Tomato soil P and K, Olives July-leaf N, P, K), the products in `fertilizers` (FAO specifications), the dose **ceilings** in `crop_nutrient_rates` (kg per dunum, never a target) and the notes per soil in `fertilizer_soil_notes`. No N, P, K sensor or lab-result form exists yet, so the answer is `insufficient_data`. Details: `data/reference/fertilization_reference.README.md`.
- **Code:** `src/engine/decide-field.ts`, `src/engine/fertilization.ts`. **Tests:** `tests/decide-field.test.ts`, `tests/engine-parts.test.ts`.

---

## Other references given for later steps (not implemented yet)

- Topp, Davis, Annan (1980): dielectric constant to volumetric water content. Needed only if the probe returns a dielectric value instead of VWC.
- Richards (1954) USDA Handbook 60 and Ayers and Westcot (1985) FAO-29: soil and water salinity classes, for EC rules and EC warnings.

---

## Other references given for later steps (not implemented yet)

- Topp, Davis, Annan (1980): dielectric constant to volumetric water content. Needed only if the probe returns a dielectric value instead of VWC.
- Richards (1954) USDA Handbook 60 and Ayers and Westcot (1985) FAO-29: soil and water salinity classes, for EC rules and EC warnings.
