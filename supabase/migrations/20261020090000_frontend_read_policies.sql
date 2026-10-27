/*
  Frontend read access (step 1 of the frontend wiring).

  Why: sensor_points, sensor_readings, decisions, decision_explanations and soil_types have RLS ON and no
  policy, so the signed-in user could not read them (an RLS block returns EMPTY rows, not an error).
  What: read-only (SELECT) policies. A user reads only rows that belong to a field they own.
  Writes stay with the service role (ESP32 ingest / decision engine). Nothing is inserted or changed.
*/

alter table public.sensor_points         enable row level security;
alter table public.sensor_readings       enable row level security;
alter table public.decisions             enable row level security;
alter table public.decision_explanations enable row level security;
alter table public.soil_types            enable row level security;

drop policy if exists sensor_points_owner_read on public.sensor_points;
create policy sensor_points_owner_read on public.sensor_points
  for select to authenticated
  using (exists (
    select 1 from public.fields f
    where f.id = sensor_points.field_id and f.owner_user_id = auth.uid()
  ));

drop policy if exists sensor_readings_owner_read on public.sensor_readings;
create policy sensor_readings_owner_read on public.sensor_readings
  for select to authenticated
  using (exists (
    select 1
    from public.sensor_points sp
    join public.fields f on f.id = sp.field_id
    where sp.id = sensor_readings.sensor_point_id and f.owner_user_id = auth.uid()
  ));

drop policy if exists decisions_owner_read on public.decisions;
create policy decisions_owner_read on public.decisions
  for select to authenticated
  using (exists (
    select 1 from public.fields f
    where f.id = decisions.field_id and f.owner_user_id = auth.uid()
  ));

drop policy if exists decision_explanations_owner_read on public.decision_explanations;
create policy decision_explanations_owner_read on public.decision_explanations
  for select to authenticated
  using (exists (
    select 1
    from public.decisions d
    join public.fields f on f.id = d.field_id
    where d.id = decision_explanations.decision_id and f.owner_user_id = auth.uid()
  ));

-- Reference table (same as crops / crop_coefficients): any signed-in user may read.
drop policy if exists soil_types_read on public.soil_types;
create policy soil_types_read on public.soil_types
  for select to authenticated using (true);

-- The dashboard asks for "latest readings of these points": keep that query fast.
create index if not exists sensor_readings_point_time_idx
  on public.sensor_readings (sensor_point_id, measured_at desc);
