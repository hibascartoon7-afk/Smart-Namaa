# Adding stage lengths for a crop (why the app says "No crop is ready")

A crop can be decided only when it has: a Kc row (FAO-56 Table 12), root depth and p (Table 22) and the lengths of its four growth stages.
The view `crop_readiness` shows which of the three each crop has. Table 11 is already loaded for 13 crops by the migration (see `data/reference/fao56_table11_stage_lengths.README.md`). For any other crop you add one row, or many rows at once from a CSV (next section).

1. Pick the numbers. Best: what you observed on your own field (days from planting to the end of each stage). Otherwise a row of `data/reference/fao56_table11_stage_lengths.csv` for your planting season. Check the sum against the printed total.
2. Find the crop id: `select id, crop_name from public.crops where crop_name = 'Lettuce';`
3. Insert the row. A row without `source_id` is accepted, but then say where the numbers come from in `value_basis`:

```sql
insert into public.crop_growth_stages
  (crop_id, initial_days, development_days, mid_days, late_days, plant_period, region, value_basis, source_id)
select id, 20, 30, 15, 10, 'April', 'Mediterranean',
       'FAO-56 Table 11, Lettuce, April, Mediterranean (row chosen by the owner)', 'FAO56_TABLE11'
  from public.crops where crop_name = 'Lettuce';
```

For numbers from your own field use `source_id = null` and `value_basis = 'observed on my field, planting 2026-03-01'`.

The engine uses the NEWEST row of a crop, so a row you add later wins over a seeded one. The migration never changes or removes a row that already exists.
Initial, development and late days must be greater than 0 (mid may be 0 only if the crop has no mid-season); otherwise `crop_readiness.has_stage_lengths` stays false.

Own numbers need their own source row first (a row without `source_id` is also accepted, with `value_basis` saying where it comes from). Example:

```sql
insert into public.sources (id, title, source_type, verification_status, url)
select 'OWN_FIELD_2026', 'Own observation of stage lengths on my field, season 2026', source_type, 'unverified', null
  from public.sources where id = 'FAO56_TABLE11';
```

## Many crops at once (CSV template)

`data/templates/crop_growth_stages_template.csv` lists the crops that have Kc and root-depth values but **no** stage lengths yet (the 13 crops filled by the Table 11 migration are not in it). All number cells are empty on purpose: the numbers must come from the book (FAO-56 Chapter 6, Table 11: https://www.fao.org/4/x0490e/x0490e0b.htm) or from your own field. Never type a number you did not read.

| Column | What to write |
|---|---|
| `crop_name` | exactly as in the template |
| `initial_days`, `development_days`, `mid_days`, `late_days` | whole days; development and late more than 0; leave **all four** empty for crops you do not use |
| `source_id` | `FAO56_TABLE11` (pre-filled), your own source id, or empty for your own observation |
| `value_basis` | which row you used (climate, planting month, page), or "observed on my field, planting 2026-03-01". Required when `source_id` is empty |

```bash
npm run import-growth-stages -- data/templates/crop_growth_stages_template.csv --check          # only checks, shows every wrong line
npm run import-growth-stages -- data/templates/crop_growth_stages_template.csv --out stages.sql  # writes the SQL
```

Paste `stages.sql` into the Supabase SQL editor (after the Table 11 migration `20261023100000_growth_stages_table11.sql`). It stops and stores nothing when a crop name or a source id is unknown. Running it twice is safe (same numbers are not added again). A changed number is added as a newer row, which the engine then uses; old rows stay. At the end it prints `crop_readiness`: the crops you filled must show `has_stage_lengths = true`. Then create an environment with that crop and a planting date.

## Nutrient limits (fertilization)
Fertilization limits are stored per crop in `crop_nutrient_sufficiency` (Tomato and Olives are filled, see `data/reference/fertilization_reference.README.md`). A row needs a `source_id`, the unit and the method:

```sql
insert into public.crop_nutrient_sufficiency (crop_id, nutrient, unit, low_below, method, source_id, method_code)
select id, 'k', 'ppm (mg/kg)', 130, 'soil test, ammonium acetate, top foot', 'UCIPM_TOMATO_SOIL', 'soil_nh4oac_k'
  from public.crops where crop_name = 'Tomato';
```

Without a row for a crop and nutrient the engine says "no reference limits are stored" instead of guessing.

Dose ceilings and soil notes (kg of nutrient per dunum, and a note per fertilizer and soil type) are stored in `crop_nutrient_rates` and `fertilizer_soil_notes`. They also need a `source_id`; the engine shows no amount for a crop and nutrient that has no row in `crop_nutrient_rates`.

A limit belongs to one **method** (`method_code`, named in `nutrient_methods`: `soil_olsen_p`, `soil_nh4oac_k`, `leaf_july`). The owner picks the test by this name when she enters a lab result, and the engine compares a result only with a limit of the same nutrient, method and unit. A new method needs a row in `nutrient_methods` (code, English and Arabic name) and a limit with a source for each crop and nutrient it will judge. A crop and nutrient can have limits for several methods.
