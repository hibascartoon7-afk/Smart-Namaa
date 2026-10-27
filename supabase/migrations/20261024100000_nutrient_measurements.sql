-- Measured N, P, K of a field: where they are stored and how the engine knows what a value means.
--   A) nutrient_methods         what each measuring method is called (label shown to the farmer)
--   B) crop_nutrient_sufficiency.method_code   the method a limit was set for; one crop and nutrient can have limits for several methods
--   C) nutrient_measurements    the measured values: a lab result typed in by the owner, or a value sent by an NPK sensor
--   D) devices.npk_unit / npk_method_code      what the NPK sensor of an ESP32 measures and in which unit (declared by the owner)
--
-- The rule behind it (src/engine/fertilization.ts, pickNutrientValues): a value is compared only with a limit set for the SAME method and the
-- SAME unit. A leaf value in % is not a soil value in ppm, and a sensor's number is not a lab number; nothing is converted and no method is
-- assumed equal to another. A value no limit fits is shown as "not comparable", never judged.
-- Safe to run again. Nothing is deleted. A row that already exists is never changed.

-- A) methods (labels only: the numbers stay in crop_nutrient_sufficiency, with their sources)
create table if not exists public.nutrient_methods (
  code        text primary key check (code ~ '^[a-z0-9_]{1,60}$'),
  label_en    text not null,
  label_ar    text not null,
  description text
);
alter table public.nutrient_methods enable row level security;
drop policy if exists nutrient_methods_read on public.nutrient_methods;
create policy nutrient_methods_read on public.nutrient_methods for select to authenticated using (true);

insert into public.nutrient_methods (code, label_en, label_ar, description) values
  ('soil_olsen_p',  'Soil test: Olsen phosphorus',            'فحص تربة: الفسفور بطريقة أولسن',
   'Sodium bicarbonate (Olsen) extractable phosphorus of the top foot of soil, lab result in ppm (mg/kg).'),
  ('soil_nh4oac_k', 'Soil test: ammonium-acetate potassium',  'فحص تربة: البوتاسيوم بخلات الأمونيوم',
   'Ammonium acetate extractable potassium of the top foot of soil, lab result in ppm (mg/kg).'),
  ('leaf_july',     'Leaf analysis in July (olive)',          'تحليل أوراق الزيتون في تموز',
   'Mature leaves from the middle of non-bearing current-season shoots, 80-100 leaves, sampled in July; lab result in % of leaf dry weight.')
on conflict (code) do nothing;

-- B) the method of each limit
alter table public.crop_nutrient_sufficiency add column if not exists method_code text;

update public.crop_nutrient_sufficiency s
   set method_code = case
     when s.nutrient = 'p' and s.unit ilike 'ppm%' and s.method ilike '%olsen%'    then 'soil_olsen_p'
     when s.nutrient = 'k' and s.unit ilike 'ppm%' and s.method ilike '%ammonium acetate%' then 'soil_nh4oac_k'
     when s.unit ilike '% of leaf dry weight%' and s.method ilike '%July leaf analysis%'  then 'leaf_july'
     else null end
 where s.method_code is null;
-- a limit the owner added without a method: it stays usable only for measurements that say 'unspecified' (see docs/guide-3)
update public.crop_nutrient_sufficiency set method_code = 'unspecified' where method_code is null;
alter table public.crop_nutrient_sufficiency alter column method_code set not null;

-- one limit per crop, nutrient AND method (was: per crop and nutrient)
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.crop_nutrient_sufficiency'::regclass
       and con.contype = 'u'
       and (select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid = con.conrelid and a.attnum = any (con.conkey)) = array['crop_id', 'nutrient']
  loop
    execute format('alter table public.crop_nutrient_sufficiency drop constraint %I', c.conname);
  end loop;
end $$;
create unique index if not exists crop_nutrient_sufficiency_key on public.crop_nutrient_sufficiency (crop_id, nutrient, method_code);

-- C) the measured values
create table if not exists public.nutrient_measurements (
  id          uuid primary key default gen_random_uuid(),
  field_id    uuid not null references public.fields(id) on delete cascade,
  nutrient    text not null check (nutrient in ('n', 'p', 'k')),
  value       numeric not null check (value >= 0 and value <> 'NaN'),
  unit        text not null check (length(btrim(unit)) between 1 and 40),
  method_code text not null check (length(btrim(method_code)) between 1 and 60),
  source_kind text not null check (source_kind in ('lab', 'sensor')),
  measured_at timestamptz not null default now(),
  note        text check (note is null or length(note) <= 300),
  entered_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists nutrient_measurements_latest on public.nutrient_measurements (field_id, nutrient, source_kind, measured_at desc);
alter table public.nutrient_measurements enable row level security;

-- the owner reads every value of her fields
drop policy if exists nutrient_measurements_owner_read on public.nutrient_measurements;
create policy nutrient_measurements_owner_read on public.nutrient_measurements for select to authenticated
  using (exists (select 1 from public.fields f where f.id = nutrient_measurements.field_id and f.owner_user_id = auth.uid()));
-- the owner can add LAB results only (a sensor value is written by the ingest function with the service role), not dated in the future
drop policy if exists nutrient_measurements_owner_insert on public.nutrient_measurements;
create policy nutrient_measurements_owner_insert on public.nutrient_measurements for insert to authenticated
  with check (
    source_kind = 'lab'
    and measured_at <= now() + interval '1 day'
    and entered_by = auth.uid()
    and exists (select 1 from public.fields f where f.id = nutrient_measurements.field_id and f.owner_user_id = auth.uid())
  );
-- she can delete a LAB result she entered by mistake; sensor values stay as the record of what the sensor sent. No update: delete and enter again.
drop policy if exists nutrient_measurements_owner_delete on public.nutrient_measurements;
create policy nutrient_measurements_owner_delete on public.nutrient_measurements for delete to authenticated
  using (source_kind = 'lab' and exists (select 1 from public.fields f where f.id = nutrient_measurements.field_id and f.owner_user_id = auth.uid()));

-- D) what the NPK sensor of a device measures (set by the owner with SQL or by the project owner, see docs/guide-5)
alter table public.devices
  add column if not exists npk_unit        text check (npk_unit is null or length(btrim(npk_unit)) between 1 and 40),
  add column if not exists npk_method_code text check (npk_method_code is null or npk_method_code ~ '^[a-z0-9_]{1,60}$');
