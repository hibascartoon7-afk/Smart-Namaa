-- NAMAA step 2: (A) link Table 12 to its source, (B) crops -> Kc, (C) fields.crop_id, (D) weather table rules
-- Written against the real schema (sources.id is TEXT; crop_coefficients has 134 rows and RLS on).
-- Run the whole file once in the SQL Editor. It is one transaction: if anything fails, nothing is changed.
-- It is safe to run again.

-- ---------------------------------------------------------------------------
-- A) sources: where to read the document + link crop_coefficients to its source
-- ---------------------------------------------------------------------------
alter table public.sources add column if not exists url text;

alter table public.crop_coefficients
  add column if not exists source_id text references public.sources(id);

do $$
declare
  v_n  integer;
  v_id text;
begin
  select count(*) into v_n from public.sources where title ilike '%Table 12%';
  if v_n <> 1 then
    raise exception 'Expected exactly one source whose title contains "Table 12" in public.sources, found %. Send me: select * from public.sources;', v_n;
  end if;

  select id into v_id from public.sources where title ilike '%Table 12%';

  update public.sources
     set url = 'https://www.fao.org/4/X0490E/x0490e0b.htm'
   where id = v_id and url is null;

  update public.crop_coefficients set source_id = v_id where source_id is null;
end $$;

alter table public.crop_coefficients alter column source_id set not null;

-- Table 12 integrity rules (the data already satisfies them)
alter table public.crop_coefficients alter column row_id   set not null;
alter table public.crop_coefficients alter column section  set not null;
alter table public.crop_coefficients alter column crop     set not null;
alter table public.crop_coefficients alter column row_type set not null;

alter table public.crop_coefficients drop constraint if exists crop_coefficients_row_id_key;
alter table public.crop_coefficients add  constraint crop_coefficients_row_id_key unique (row_id);

alter table public.crop_coefficients drop constraint if exists crop_coefficients_row_type_check;
alter table public.crop_coefficients add  constraint crop_coefficients_row_type_check
  check (row_type in ('crop', 'group_row'));

-- raw text and parsed numbers agree; blank cell = NULL (never 0); min <= max
alter table public.crop_coefficients drop constraint if exists crop_coefficients_kc_ini_ok;
alter table public.crop_coefficients add  constraint crop_coefficients_kc_ini_ok
  check ((kc_ini_raw is null) = (kc_ini_min is null and kc_ini_max is null)
         and (kc_ini_min is null or (kc_ini_min > 0 and kc_ini_min <= kc_ini_max)));
alter table public.crop_coefficients drop constraint if exists crop_coefficients_kc_mid_ok;
alter table public.crop_coefficients add  constraint crop_coefficients_kc_mid_ok
  check ((kc_mid_raw is null) = (kc_mid_min is null and kc_mid_max is null)
         and (kc_mid_min is null or (kc_mid_min > 0 and kc_mid_min <= kc_mid_max)));
alter table public.crop_coefficients drop constraint if exists crop_coefficients_kc_end_ok;
alter table public.crop_coefficients add  constraint crop_coefficients_kc_end_ok
  check ((kc_end_raw is null) = (kc_end_min is null and kc_end_max is null)
         and (kc_end_min is null or (kc_end_min > 0 and kc_end_min <= kc_end_max)));
alter table public.crop_coefficients drop constraint if exists crop_coefficients_height_ok;
alter table public.crop_coefficients add  constraint crop_coefficients_height_ok
  check ((max_height_raw is null) = (max_height_min_m is null and max_height_max_m is null)
         and (max_height_min_m is null or (max_height_min_m > 0 and max_height_min_m <= max_height_max_m)));

create index if not exists crop_coefficients_section_idx on public.crop_coefficients (section, row_type);

-- ---------------------------------------------------------------------------
-- B) crops (the list the user picks from) -> one Table 12 row
-- ---------------------------------------------------------------------------
alter table public.crops
  add column if not exists coefficient_id uuid references public.crop_coefficients(id);

alter table public.crops drop constraint if exists crops_crop_name_key;
alter table public.crops add  constraint crops_crop_name_key unique (crop_name);

insert into public.crops (crop_name, coefficient_id)
select 'Tomato', cc.id
from public.crop_coefficients cc
where cc.crop = 'Tomato' and cc.variant is null
on conflict (crop_name) do nothing;

-- ---------------------------------------------------------------------------
-- C) fields: the crop of the field + sane coordinates
-- ---------------------------------------------------------------------------
alter table public.fields
  add column if not exists crop_id uuid references public.crops(id);

alter table public.fields drop constraint if exists fields_latitude_check;
alter table public.fields add  constraint fields_latitude_check  check (latitude  between -90  and 90);
alter table public.fields drop constraint if exists fields_longitude_check;
alter table public.fields add  constraint fields_longitude_check check (longitude between -180 and 180);
alter table public.fields drop constraint if exists fields_timezone_check;
alter table public.fields add  constraint fields_timezone_check  check (length(btrim(timezone)) > 0);

-- ---------------------------------------------------------------------------
-- D) weather_observations: one row per field per hour, filled ONLY by the Edge Function
--    NULL = the API gave nothing (never 0).
-- ---------------------------------------------------------------------------
alter table public.weather_observations
  add column if not exists fetched_at timestamptz not null default now();

alter table public.weather_observations drop constraint if exists weather_observations_field_time_key;
alter table public.weather_observations add  constraint weather_observations_field_time_key unique (field_id, observed_at);

alter table public.weather_observations drop constraint if exists weather_air_temp_ok;
alter table public.weather_observations add  constraint weather_air_temp_ok
  check (air_temperature_c is null or air_temperature_c between -60 and 70);
alter table public.weather_observations drop constraint if exists weather_precip_ok;
alter table public.weather_observations add  constraint weather_precip_ok
  check (precipitation_mm is null or precipitation_mm >= 0);
alter table public.weather_observations drop constraint if exists weather_rain_prob_ok;
alter table public.weather_observations add  constraint weather_rain_prob_ok
  check (rain_probability_pct is null or rain_probability_pct between 0 and 100);
alter table public.weather_observations drop constraint if exists weather_et0_ok;
alter table public.weather_observations add  constraint weather_et0_ok
  check (et0_mm is null or et0_mm >= 0);

create index if not exists weather_observations_field_time_idx
  on public.weather_observations (field_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- E) RLS policies (RLS stays ON). Existing policies on these tables are replaced by the rules below.
--    Reference data: signed-in users read, nobody writes through the API.
--    Weather: the owner of the field reads, nobody writes through the API (the Edge Function uses the service role).
-- ---------------------------------------------------------------------------
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public'
             and tablename in ('sources', 'crop_coefficients', 'crops', 'weather_observations')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

alter table public.sources              enable row level security;
alter table public.crop_coefficients    enable row level security;
alter table public.crops                enable row level security;
alter table public.weather_observations enable row level security;

create policy sources_read           on public.sources           for select to authenticated using (true);
create policy crop_coefficients_read on public.crop_coefficients for select to authenticated using (true);
create policy crops_read             on public.crops             for select to authenticated using (true);

create policy weather_observations_owner_read on public.weather_observations
  for select to authenticated
  using (exists (select 1 from public.fields f
                 where f.id = weather_observations.field_id and f.owner_user_id = auth.uid()));

revoke all on public.sources, public.crop_coefficients, public.crops, public.weather_observations from anon;
revoke insert, update, delete, truncate
  on public.sources, public.crop_coefficients, public.crops, public.weather_observations from authenticated;

-- fields: the owner manages their own fields (added next to any existing policy; it only allows the owner)
alter table public.fields enable row level security;
drop policy if exists fields_owner_all on public.fields;
create policy fields_owner_all on public.fields
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
