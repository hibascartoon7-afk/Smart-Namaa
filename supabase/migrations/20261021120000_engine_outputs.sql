/*
  Everything the decision engine, the ML plug-in and the app need beyond the base tables.
  Reads: owners read their own rows. Writes: only the service role (Edge Functions), never the browser.
  Reference tables (fertilizers, nutrient limits, thresholds) are created EMPTY on purpose: every row needs a source_id.
*/

-- ---- readable reference data (FAO tables and crop data are not private)
do $$
declare t text;
begin
  foreach t in array array['crops', 'crop_coefficients', 'crop_growth_stages', 'crop_irrigation_rules', 'sources'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read_signed_in', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read_signed_in', t);
  end loop;
end $$;

-- ---- decisions: what the new engine stores besides the old columns
alter table public.decisions add column if not exists engine_version    text;
alter table public.decisions add column if not exists irrigation_status text;
alter table public.decisions add column if not exists details           jsonb;
create index if not exists decisions_field_time_idx on public.decisions (field_id, generated_at desc);

-- ---- alerts: one feed for engine warnings, ML forecasts and saving notices
create table if not exists public.alerts (
  id              uuid primary key default gen_random_uuid(),
  field_id        uuid not null references public.fields(id) on delete cascade,
  decision_id     uuid references public.decisions(id) on delete cascade,
  sensor_point_id uuid references public.sensor_points(id) on delete set null,
  kind            text not null check (kind in ('engine', 'forecast', 'savings')),
  code            text not null,
  severity        text not null check (severity in ('info', 'warning', 'action')),
  title_en        text not null,
  title_ar        text not null,
  message_en      text not null,
  message_ar      text not null,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists alerts_field_time_idx on public.alerts (field_id, created_at desc);
alter table public.alerts enable row level security;
drop policy if exists alerts_owner_read on public.alerts;
create policy alerts_owner_read on public.alerts for select to authenticated
  using (exists (select 1 from public.fields f where f.id = alerts.field_id and f.owner_user_id = auth.uid()));

-- ---- water_savings: the latest estimate of each local day (formula in docs/formulas.md, F-009)
create table if not exists public.water_savings (
  id          uuid primary key default gen_random_uuid(),
  field_id    uuid not null references public.fields(id) on delete cascade,
  decision_id uuid references public.decisions(id) on delete set null,
  local_day   date not null,
  saved_mm    numeric not null check (saved_mm >= 0),
  saved_m3    numeric check (saved_m3 is null or saved_m3 >= 0),
  basis       text not null default 'forecast',
  created_at  timestamptz not null default now(),
  unique (field_id, local_day)
);
alter table public.water_savings enable row level security;
drop policy if exists water_savings_owner_read on public.water_savings;
create policy water_savings_owner_read on public.water_savings for select to authenticated
  using (exists (select 1 from public.fields f where f.id = water_savings.field_id and f.owner_user_id = auth.uid()));

-- ---- ML plug-in: forecasts and the registry that decides whether a model may be used
create table if not exists public.ml_model_registry (
  model_name     text not null,
  model_version  text not null,
  active         boolean not null default false,
  beats_baseline boolean,
  notes          text,
  updated_at     timestamptz not null default now(),
  primary key (model_name, model_version)
);
alter table public.ml_model_registry enable row level security;
drop policy if exists ml_model_registry_read on public.ml_model_registry;
create policy ml_model_registry_read on public.ml_model_registry for select to authenticated using (true);

create table if not exists public.moisture_forecasts (
  id                    uuid primary key default gen_random_uuid(),
  field_id              uuid not null references public.fields(id) on delete cascade,
  sensor_point_id       uuid references public.sensor_points(id) on delete cascade,
  made_at               timestamptz not null default now(),
  target_time           timestamptz not null,
  depth_cm              integer,
  predicted_moisture_pct numeric not null check (predicted_moisture_pct >= 0 and predicted_moisture_pct <= 100),
  model_name            text not null,
  model_version         text not null,
  created_at            timestamptz not null default now(),
  foreign key (model_name, model_version) references public.ml_model_registry (model_name, model_version)
);
create index if not exists moisture_forecasts_field_time_idx on public.moisture_forecasts (field_id, made_at desc);
alter table public.moisture_forecasts enable row level security;
drop policy if exists moisture_forecasts_owner_read on public.moisture_forecasts;
create policy moisture_forecasts_owner_read on public.moisture_forecasts for select to authenticated
  using (exists (select 1 from public.fields f where f.id = moisture_forecasts.field_id and f.owner_user_id = auth.uid()));

-- ---- fertilization reference tables (EMPTY: every row needs a source)
create table if not exists public.crop_nutrient_sufficiency (
  id        uuid primary key default gen_random_uuid(),
  crop_id   uuid not null references public.crops(id) on delete cascade,
  nutrient  text not null check (nutrient in ('n', 'p', 'k')),
  unit      text not null,
  low_below numeric not null check (low_below >= 0),
  method    text,
  source_id text not null references public.sources(id),
  unique (crop_id, nutrient)
);
create table if not exists public.fertilizers (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique,
  n_pct     numeric check (n_pct is null or (n_pct >= 0 and n_pct <= 100)),
  p2o5_pct  numeric check (p2o5_pct is null or (p2o5_pct >= 0 and p2o5_pct <= 100)),
  k2o_pct   numeric check (k2o_pct is null or (k2o_pct >= 0 and k2o_pct <= 100)),
  source_id text not null references public.sources(id)
);
-- thresholds for warnings that need a number (e.g. code 'fertilizer_hold_air_temp_max_c'); a row without a source is not allowed
create table if not exists public.alert_thresholds (
  id        uuid primary key default gen_random_uuid(),
  code      text not null,
  crop_id   uuid references public.crops(id) on delete cascade,
  value     numeric not null,
  unit      text not null,
  source_id text not null references public.sources(id),
  notes     text
);
create unique index if not exists alert_thresholds_code_crop_key
  on public.alert_thresholds (code, coalesce(crop_id, '00000000-0000-0000-0000-000000000000'::uuid));

do $$
declare t text;
begin
  foreach t in array array['crop_nutrient_sufficiency', 'fertilizers', 'alert_thresholds'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
  end loop;
end $$;

-- ---- which crops the engine can fully handle
create or replace view public.crop_readiness with (security_invoker = true) as
select c.id as crop_id,
       c.crop_name,
       (c.coefficient_id is not null)  as has_kc,
       (c.water_params_id is not null) as has_water_params,
       exists (
         select 1 from public.crop_growth_stages g
          where g.crop_id = c.id and g.initial_days >= 0 and g.development_days > 0 and g.mid_days >= 0 and g.late_days > 0
       ) as has_stage_lengths
  from public.crops c;
grant select on public.crop_readiness to authenticated;
