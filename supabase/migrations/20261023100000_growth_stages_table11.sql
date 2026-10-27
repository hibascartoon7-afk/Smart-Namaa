-- Lengths of the four crop growth stages from FAO-56 Table 11 (initial, development, mid-season, late season; days).
-- The decision engine needs them to build the Kc curve (FAO-56 Eq. 66). A crop with no stage row cannot be decided
-- (view crop_readiness shows has_stage_lengths = false and the app says "No crop is ready").
-- Source: Allen et al. (1998) FAO-56, Chapter 6, Table 11. Marked 'unverified' until the owner has checked it against the book.
--
-- Table 11 has several rows per crop (one per planting period and region). The engine reads ONE row per crop, so the rows
-- below are chosen by a NAMAA rule, written in value_basis: the crop's ONLY row for a Mediterranean region, and only when the
-- four lengths add up to the total printed in the table. NOT seeded (the owner chooses their row): crops with several
-- Mediterranean rows, a value like "25/30", several app variants (Fresh / Dry), rows whose printed total does not match
-- (Egg plant, Green gram) and perennials, EXCEPT Olives (added at the owner's request: the cycle starts with the new leaves in March). See data/reference/fao56_table11_stage_lengths.README.md; the whole table is in the csv.
--
-- Safe to run again. A crop that already has ANY stage row (for example the owner's own local values) is never touched.
-- Nothing is deleted. The root depth column is not filled here: the engine reads root depth from crop_water_params (Table 22).

-- A) the source (copies source_type from the existing Table 12 source so any allowed-value rule still holds)
insert into public.sources (id, title, source_type, verification_status, url)
select 'FAO56_TABLE11',
       'FAO-56 (Allen et al., 1998) Table 11: lengths of crop development stages for various planting periods and climatic regions',
       s.source_type,
       'unverified',
       'https://www.fao.org/4/x0490e/x0490e0b.htm'
from public.sources s
where s.title ilike '%Table 12%'
limit 1
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from public.sources where id = 'FAO56_TABLE11') then
    raise exception 'Source FAO56_TABLE11 was not created: no source with "Table 12" in its title was found in public.sources.';
  end if;
end $$;

-- B) where the row came from (the four engine columns already exist in the real database)
alter table public.crop_growth_stages
  add column if not exists plant_period text,
  add column if not exists region       text,
  add column if not exists value_basis  text,
  add column if not exists source_id    text references public.sources(id);

-- C) the selected Table 11 rows, by the crop_name used in public.crops
drop table if exists pg_temp._table11;
create temporary table _table11 (crop_name text, l_ini int, l_dev int, l_mid int, l_late int, plant_period text, region text, extra text);
insert into _table11 values
  ('Carrots', 30, 40, 60, 20, 'Feb/Mar', 'Mediterranean', ''),
  ('Celery', 25, 40, 45, 15, 'April', 'Mediterranean', ''),
  ('Onions - dry', 15, 25, 70, 40, 'April', 'Mediterranean', ''),
  ('Onions - green', 25, 30, 10, 5, 'April/May', 'Mediterranean', ''),
  ('Tomato', 30, 40, 45, 30, 'April/May', 'Mediterranean', ''),
  ('Pumpkin, Winter Squash', 20, 30, 30, 20, 'Mar, Aug', 'Mediterranean', ''),
  ('Sweet Melons', 25, 35, 40, 20, 'May', 'Mediterranean', ''),
  ('Sweet Potato', 20, 30, 60, 40, 'April', 'Mediterranean', ''),
  ('Beans, green', 20, 30, 30, 10, 'Feb/Mar', 'Calif., Mediterranean', ''),
  ('Groundnut (Peanut)', 35, 45, 35, 25, 'May/June', 'Mediterranean', ''),
  ('Sunflower', 25, 35, 45, 25, 'April/May', 'Medit.; California', ''),
  ('Maize, Sweet (sweet corn)', 20, 25, 25, 10, 'May/June', 'Mediterranean', ''),
  ('Olives (40 to 60% ground coverage by canopy)', 30, 90, 60, 90, 'March', 'Mediterranean', 'Perennial: the cycle starts when the trees gain new leaves (March, Table 11 footnote 5). Set the field planting date to that day every year; after the last day of the cycle the engine reports the cycle as ended. The off-season Kc of Table 12 footnote 24 is not used.');

-- D) one row per crop that has none yet
insert into public.crop_growth_stages (crop_id, initial_days, development_days, mid_days, late_days, plant_period, region, value_basis, source_id)
select c.id, t.l_ini, t.l_dev, t.l_mid, t.l_late, t.plant_period, t.region,
       'FAO-56 Table 11, the only Mediterranean row of this crop (planting ' || t.plant_period || '; ' || t.region
         || '). A typical value for that region, not observed on this field: replace it with local observation when you have it.'
         || case when t.extra <> '' then ' ' || t.extra else '' end,
       'FAO56_TABLE11'
  from _table11 t
  join public.crops c on c.crop_name = t.crop_name
 where not exists (select 1 from public.crop_growth_stages g where g.crop_id = c.id);

drop table pg_temp._table11;
