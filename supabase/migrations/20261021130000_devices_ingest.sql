/*
  ESP32 devices. A device belongs to one environment (field); it proves who it is with a secret token whose SHA-256 hash
  is stored in device_tokens (the token itself is shown to the owner ONCE when it is created).
  Owners can see their devices; only the service role writes tokens and readings.
*/

alter table public.devices       enable row level security;
alter table public.device_tokens enable row level security;

drop policy if exists devices_owner_read on public.devices;
create policy devices_owner_read on public.devices for select to authenticated
  using (exists (select 1 from public.fields f where f.id = devices.field_id and f.owner_user_id = auth.uid()));

create unique index if not exists device_tokens_hash_key on public.device_tokens (token_hash);

-- Sensor names must be unique inside one environment ("sensor 1" must mean one thing). Skipped with a notice if old data has duplicates.
do $$
begin
  create unique index if not exists sensor_points_field_name_key on public.sensor_points (field_id, lower(point_name));
exception when unique_violation then
  raise notice 'sensor_points has duplicate names inside a field: unique index not created. Rename the duplicates and run this again.';
end $$;
