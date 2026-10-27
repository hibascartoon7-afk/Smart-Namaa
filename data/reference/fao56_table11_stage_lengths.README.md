# FAO-56 Table 11 - lengths of crop development stages (days)

Source: Allen, Pereira, Raes, Smith (1998), FAO Irrigation and Drainage Paper 56, Chapter 6, Table 11.
Read from: https://www.fao.org/4/x0490e/x0490e0b.htm (2026-10-23). Status: `unverified` until the owner checks the numbers against the printed book.

- `fao56_table11_stage_lengths.csv` is the WHOLE table (167 rows), typed from the web page. The columns `l_ini_days`, `l_dev_days`, `l_mid_days`, `l_late_days`, `total_days` are text on purpose: the table prints values like `25/30` and `var.`. Footnote digits glued to numbers on the web page (`202 602`, `103`, `2705`) are explained in the `note` column.
- The table has SEVERAL rows per crop (one per planting period and region). The engine reads ONE row per crop (`crop_growth_stages`, newest row wins), so the migration `20261023100000_growth_stages_table11.sql` seeds only the rows that pass this NAMAA rule (the rule is written in `value_basis` on every seeded row):
  1. the region is Mediterranean (the closest region of the table to the West Bank);
  2. it is the ONLY Mediterranean row of that crop (otherwise the planting season must be chosen by the owner);
  3. the four lengths are plain numbers and add up to the total printed in the table;
  4. the crop is an annual in the app crop list, with no variants that the row does not distinguish. Exception, added at the owner's request: **Olives** (perennial; see below).
- Seeded (13): Carrots, Celery, Onions - dry, Onions - green, Tomato, Pumpkin / Winter Squash, Sweet Melons, Sweet Potato, Beans (green), Groundnut, Sunflower, Maize (sweet), Olives.
- **Olives** = 30 / 90 / 60 / 90 days (270), planting period March, Mediterranean. Table 11 footnote 5: olive trees gain new leaves in March. The engine counts days from the field's planting date, so for an olive orchard set the planting date to the day the new leaves start (about 1 March) and update it every year. After day 270 the engine says the cycle has ended (`cycle_ended`) and gives no irrigation decision until the date is moved to the next season. Table 12 footnote 24 gives an off-season Kc of 0.50 for December-February: the engine does not use it.
- Not seeded, with the reason per row in the csv (`used_by_namaa`, `reason`):
  - several Mediterranean rows: Lettuce, Beets, Squash / Zucchini, Sugarbeet;
  - two values or two planting dates in one cell: Spinach, Sweet peppers, Rice;
  - printed total does not match the four lengths: **Egg plant** (total printed as 40, lengths add up to 140), **Green gram / cowpeas** (lengths add up to 100, total printed 110). Check the book, then add the row yourself;
  - several app variants: Faba bean, Peas, Winter wheat, Sorghum;
  - perennial (stage lengths restart each season, the engine counts days from one planting date): Asparagus, Banana, Citrus, Pistachios (Olives were added, see above);
  - no Mediterranean row in the table: Cucumber, Potato, Cantaloupe, Water melon, Broccoli, Cabbage, Cauliflower, Maize (grain), Cotton and others.
- The table says itself that its values are only a general guide and that local observation should be used where possible. A farmer's own observation of the stage dates replaces these rows (see `docs/ADDING_A_CROP.md`).
- The root depth column of `crop_growth_stages` is not filled: the engine reads root depth from `crop_water_params` (Table 22).
