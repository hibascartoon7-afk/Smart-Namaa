-- Soil water characteristics from FAO-56 Table 19 (typical theta_FC and theta_WP for each soil texture).
-- The decision engine needs theta_FC and theta_WP of the soil to turn a measured moisture into a depletion in mm
-- (TAW = 1000 (theta_FC - theta_WP) Zr, FAO-56 Eq. 82). Until now those two numbers had no source. From now on the engine
-- only uses a soil whose row has a source_id (see src/engine/run-decision.ts).
-- Source: Allen et al. (1998) FAO-56, Table 19. Marked 'unverified' until the owner has checked it against the book.
-- Table 19 gives RANGES. min / max are stored as printed; field_capacity_pct / wilting_point_pct (what the engine reads) are the
-- MIDPOINT of each range, in % by volume. That midpoint is a NAMAA choice, said so in value_basis.
-- Safe to run again. A row that already has a source_id is never touched. Nothing is deleted.

-- A) the source (copies source_type from the existing Table 12 source so any allowed-value rule still holds)
insert into public.sources (id, title, source_type, verification_status, url)
select 'FAO56_TABLE19',
       'FAO-56 (Allen et al., 1998) Table 19: typical soil water characteristics for different soil types',
       s.source_type,
       'unverified',
       'https://www.fao.org/4/x0490e/x0490e0c.htm'
from public.sources s
where s.title ilike '%Table 12%'
limit 1
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from public.sources where id = 'FAO56_TABLE19') then
    raise exception 'Source FAO56_TABLE19 was not created: no source with "Table 12" in its title was found in public.sources.';
  end if;
end $$;

-- B) columns (the two engine columns may already exist in the real database: then nothing happens)
alter table public.soil_types
  add column if not exists field_capacity_pct     numeric,
  add column if not exists wilting_point_pct      numeric,
  add column if not exists field_capacity_min_pct numeric,
  add column if not exists field_capacity_max_pct numeric,
  add column if not exists wilting_point_min_pct  numeric,
  add column if not exists wilting_point_max_pct  numeric,
  add column if not exists value_basis            text,
  add column if not exists source_id              text references public.sources(id);

-- C) Table 19 (m3/m3 as printed). alias = another common spelling of the same texture class, used only to find an existing row.
drop table if exists pg_temp._table19;
create temporary table _table19 (name text, alias text, fc_min numeric, fc_max numeric, wp_min numeric, wp_max numeric);
insert into _table19 values
  ('Sand',           null,              0.07, 0.17, 0.02, 0.07),
  ('Loamy sand',     null,              0.11, 0.19, 0.03, 0.10),
  ('Sandy loam',     null,              0.18, 0.28, 0.06, 0.16),
  ('Loam',           null,              0.20, 0.30, 0.07, 0.17),
  ('Silt loam',      null,              0.22, 0.36, 0.09, 0.21),
  ('Silt',           null,              0.28, 0.36, 0.12, 0.22),
  ('Silt clay loam', 'Silty clay loam', 0.30, 0.37, 0.17, 0.24),
  ('Silty clay',     null,              0.30, 0.42, 0.17, 0.29),
  ('Clay',           null,              0.32, 0.40, 0.20, 0.24);

-- D) existing soils with the same name and no source yet get the sourced values
update public.soil_types s
   set field_capacity_min_pct = t.fc_min * 100,
       field_capacity_max_pct = t.fc_max * 100,
       wilting_point_min_pct  = t.wp_min * 100,
       wilting_point_max_pct  = t.wp_max * 100,
       field_capacity_pct     = round((t.fc_min + t.fc_max) / 2 * 100, 2),
       wilting_point_pct      = round((t.wp_min + t.wp_max) / 2 * 100, 2),
       value_basis            = 'FAO-56 Table 19 typical range; the value used is the midpoint of the range (not measured on this field)',
       source_id              = 'FAO56_TABLE19'
  from _table19 t
 where s.source_id is null
   and lower(trim(regexp_replace(coalesce(s.soil_name, ''), '\s+', ' ', 'g'))) in (lower(t.name), lower(coalesce(t.alias, t.name)));

-- E) the texture classes that are not in the table yet
insert into public.soil_types (soil_name, field_capacity_min_pct, field_capacity_max_pct, wilting_point_min_pct, wilting_point_max_pct,
                               field_capacity_pct, wilting_point_pct, value_basis, source_id)
select t.name, t.fc_min * 100, t.fc_max * 100, t.wp_min * 100, t.wp_max * 100,
       round((t.fc_min + t.fc_max) / 2 * 100, 2), round((t.wp_min + t.wp_max) / 2 * 100, 2),
       'FAO-56 Table 19 typical range; the value used is the midpoint of the range (not measured on this field)',
       'FAO56_TABLE19'
  from _table19 t
 where not exists (
   select 1 from public.soil_types s
    where lower(trim(regexp_replace(coalesce(s.soil_name, ''), '\s+', ' ', 'g'))) in (lower(t.name), lower(coalesce(t.alias, t.name)))
 );

drop table pg_temp._table19;
