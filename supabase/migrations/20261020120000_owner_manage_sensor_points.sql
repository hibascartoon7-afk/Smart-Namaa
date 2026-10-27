/*
  Lets a signed-in user add / rename / remove the sensor points of THEIR OWN fields
  (needed by "Create environment" in the app).
  Readings are still written only by the ingest function (service role). Nothing is changed in existing rows.
*/

drop policy if exists sensor_points_owner_insert on public.sensor_points;
create policy sensor_points_owner_insert on public.sensor_points
  for insert to authenticated
  with check (exists (
    select 1 from public.fields f
    where f.id = sensor_points.field_id and f.owner_user_id = auth.uid()
  ));

drop policy if exists sensor_points_owner_update on public.sensor_points;
create policy sensor_points_owner_update on public.sensor_points
  for update to authenticated
  using (exists (
    select 1 from public.fields f
    where f.id = sensor_points.field_id and f.owner_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.fields f
    where f.id = sensor_points.field_id and f.owner_user_id = auth.uid()
  ));

drop policy if exists sensor_points_owner_delete on public.sensor_points;
create policy sensor_points_owner_delete on public.sensor_points
  for delete to authenticated
  using (exists (
    select 1 from public.fields f
    where f.id = sensor_points.field_id and f.owner_user_id = auth.uid()
  ));
