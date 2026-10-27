# Fertilization reference data (migration `20261023110000_fertilization_reference.sql`)

Read on 2026-10-23. Every source is `unverified` until the owner has checked it. The tables were empty before, so the fertilization answer could only be `insufficient_data`.

## Fertilizers (`fertilizers`, 10 rows, `fertilizers_fao_specs.csv`)
- Source `FAO_FERT_SPECS`: FAO Plant Production and Protection Division, "Fertilizer Specifications" (https://www.fao.org/agriculture/crops/core-themes/theme/spi/plantnutrition/fertspecs/en/).
- The numbers are the **guaranteed minimum** content of the FAO purchasing specification (% by weight of N, P2O5, K2O). A commercial grade can be a little higher (ammonium sulphate is sold as 21 % N).
- **Potassium chloride (MOP, 60 % K2O) is in the FAO list but is not stored.** The engine suggests the product with the highest content of the missing nutrient and knows nothing about chloride. The olive guideline warns that KCl can cause chloride toxicity on sandy, poorly drained or saline soils and calls potassium sulphate safer there. With MOP absent the engine proposes potassium sulphate (50 % K2O). Add MOP yourself when the engine can take the soil into account.
- Potassium nitrate and monoammonium phosphate are not in the FAO list and are not stored (no FAO source for them).
- The engine now lists ALL fertilizers that carry the missing nutrient (not only the best one), highest content first, ties by name: for phosphorus DAP and TSP (both 46 %) come first, DAP before TSP. The NPK products appear too, with the other nutrients they add at the dose.

## Nutrient limits (`crop_nutrient_sufficiency`, 5 rows, `crop_nutrient_limits.csv`)
`low_below` is the value below which the crop needs the nutrient. **The unit and the method are part of the number**: leaf % and soil ppm are different measurements, and the value you give the engine must be measured the same way.
- **Tomato**, source `UCIPM_TOMATO_SOIL` (UC IPM Pest Management Guidelines: Tomato, Fertilization, https://ipm.ucanr.edu/agriculture/tomato/fertilization/): soil test of the top foot before planting, "Low" class: phosphorus (Olsen) below 15 ppm, potassium (ammonium acetate) below 130 ppm. Nitrogen is not stored: the guideline says a pre-plant soil nitrogen test is not recommended and gives no "low" limit, so a measured N alone gives `reference_missing`. The values are for processing tomato in California; the Olsen method is not appropriate for soil pH below 6.5.
- **Olives**, source `CDFA_OLIVE_LEAF` (CDFA FREP / UC Davis California Crop Fertilization Guidelines, Olives, https://www.cdfa.ca.gov/is/ffldrs/frep/FertilizationGuidelines/Olives.html): July leaf analysis (mature leaves from the middle of non-bearing current-season shoots, 80-100 leaves), "Deficient" column: N below 1.4 %, P below 0.1 %, K below 0.4 % of leaf dry weight. The guideline calls 1.5-2.0 % N and more than 0.8 % K sufficient; the values in between are not classified, so only a clearly deficient value triggers a recommendation. It also says that true P deficiency is very rare and low leaf P is mostly a drainage problem, and that leaf analysis is more reliable than soil analysis for olives.
- Both sets are California values, not measurements from Palestinian soils or varieties.

## Heat limit (`alert_thresholds`, migration `20261023120000`)
- `fertilizer_hold_air_temp_max_c` = **30 C** for all crops, source `HEAT_GUIDANCE`. A precaution: garden and lawn guidance says to avoid fertilizing above about 29-32 C (85-90 F); NC State Extension says granular fertilizer can burn plants in hot weather but gives no number. No field-crop trial was found. The engine compares it with the forecast maximum air temperature of the next 24 hours and warns "do not apply fertilizer: heat" (the message says it is a precaution). Replace it with a local value when you have one.

## Dose ceilings (`crop_nutrient_rates`, `crop_nutrient_rates.csv`)
Kilograms of NUTRIENT per dunum (1 dunum = 1000 m2) for the whole season, converted from the pounds per acre of the sources: kg/dunum = lb/acre x 0.45359237 / 4.0468564224. They are a **ceiling, never a target**: the engine shows them with "do not exceed it, split it over several applications".
- Tomato (UC IPM, soil testing Low): up to 16.81 kg P2O5 (150 lb/acre) and up to 22.42 kg K2O (200 lb/acre) per dunum.
- Olives (CDFA / UC): N 4.48 to 11.21 kg per dunum per year (40-100 lb/acre); K2O 11.21 to 16.81 kg per dunum (200-300 lb K2SO4/acre x 50 % K2O). No phosphorus dose: the guideline says P fertilization will not normally improve olive yield.
- Where no dose is stored the engine shows NO amount and says so.
- The kg of product per dunum = kg of nutrient / (content % / 100), and for the field x its area (`fields.area_m2` / 1000 dunum). Compound fertilizers (NPK, DAP) also list the other nutrients they add at that dose.

## Soil notes (`fertilizer_soil_notes`, 20 rows)
Only what a source says is stored. A fertilizer or soil with no row means "no information stored", **not** "suitable".
- Urea and ammonium sulphate (UIDAHO_BUL926): Sand and Loamy sand = caution (more ammonia loss, work it in or irrigate it in); Silt loam, Silt, Silt clay loam, Silty clay, Clay = suits better (less ammonia loss); Sandy loam and Loam not classified by the bulletin. Condition to check: soil pH above 7.
- Potassium sulphate (CDFA olive guideline): Sand, Loamy sand, Sandy loam = suits better than potassium chloride (chloride toxicity). Condition to check: saline soil, poor drainage or a chloride-sensitive variety.
- DAP, TSP, SSP, CAN, NPK: no soil note, no source found.
- Soil pH, salinity and drainage are not recorded in the app, so those notes are shown as conditions to check.
- The texture groups are a NAMAA reading of the sources (the bulletin says "sandy" and "silty or clay", not our class names).

## Not stored
- Other crops: no limits and no doses stored. Add rows from a source (see `docs/ADDING_A_CROP.md`).

## Important
The engine still has no input for measured N, P and K (no sensor and no lab-result form), so the fertilization answer stays `insufficient_data` / "not measured" until such an input is built. This step only filled the reference tables.
