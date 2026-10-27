/*
  Hourly refresh (cron): every hour the database calls the Edge Function `scheduled-refresh`, which fetches the weather of EVERY
  environment (its own location) and runs the decision engine, so the alerts are ready when the farmer opens the app.

  How it works: pg_cron runs public.run_scheduled_refresh() at minute 7 of every hour; that function reads two secrets from
  Supabase Vault and asks pg_net to POST to <project url>/functions/v1/scheduled-refresh with  Authorization: Bearer <cron secret>.
  NO secret is written in this file. After running it you create the two Vault secrets once (see docs/guide-5-setup-deploy-and-tests.md):
      namaa_project_url   https://<project-ref>.supabase.co
      namaa_cron_secret   the same text as the Edge Function secret CRON_SECRET (at least 32 characters)
  Until both exist, the job does nothing (it only writes a notice), so running this migration early is safe.

  If pg_cron is not available (a local test database, or the extension is not enabled yet) the function is still created and the
  schedule is skipped with a notice: enable pg_cron and pg_net in the Supabase dashboard (Integrations) and run this file again.
  Safe to run again: the job has a fixed name and is replaced, not duplicated. Nothing existing is changed or deleted.
  Stop it any time:  select cron.unschedule('namaa-hourly-refresh');
*/

create or replace function public.run_scheduled_refresh()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  project_url text;
  cron_secret text;
  request_id  bigint;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'namaa_project_url';
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'namaa_cron_secret';
  if project_url is null or cron_secret is null then
    raise notice 'run_scheduled_refresh: the Vault secrets namaa_project_url and namaa_cron_secret are not both set yet; nothing was called';
    return null;
  end if;
  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/scheduled-refresh',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || cron_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into request_id;
  return request_id;
end;
$$;

-- only the database owner (and so pg_cron) may run it: it reads secrets
revoke all on function public.run_scheduled_refresh() from public;
revoke all on function public.run_scheduled_refresh() from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    begin
      create extension if not exists pg_cron;
      create extension if not exists pg_net;
      perform cron.schedule('namaa-hourly-refresh', '7 * * * *', 'select public.run_scheduled_refresh();');
    exception when others then
      raise notice 'scheduled refresh: the schedule was NOT created (%). Enable pg_cron and pg_net in the dashboard, then run this file again.', sqlerrm;
    end;
  else
    raise notice 'scheduled refresh: pg_cron or pg_net is not available here, the schedule was NOT created (the function run_scheduled_refresh exists)';
  end if;
end $$;
