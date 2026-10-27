// scheduled-refresh: the hourly job. For EVERY environment: fetch the weather of its own location (Open-Meteo), then run the
// decision engine, so the alerts are ready when the farmer opens the app.
// Who may call it: the scheduler only (pg_cron through pg_net), with the secret CRON_SECRET (or the service-role key). Nobody else.
// The logic is in ../_shared/engine/refresh-all.ts (synced from src/engine, tested there).
//   supabase secrets set CRON_SECRET=<a random text of at least 32 characters>
import { refreshAllFields } from '../_shared/engine/refresh-all.ts';
import { adminClient, isCronCall, isServiceCall, json, preflight, SupabaseDb } from '../_shared/http.ts';
import { buildOpenMeteoUrl, parseOpenMeteoHourly } from '../weather-sync/parse.ts';

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`open-meteo answered ${res.status}`);
  return await res.json();
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!isCronCall(req) && !isServiceCall(req)) return json(401, { error: 'not allowed' });

  try {
    const summary = await refreshAllFields({
      db: new SupabaseDb(adminClient()),
      weather: { buildUrl: buildOpenMeteoUrl, parse: parseOpenMeteoHourly },
      fetchJson,
    });
    console.log('scheduled-refresh', JSON.stringify({ ...summary, failures: summary.failures.length }));
    return json(200, summary);
  } catch (e) {
    console.error('scheduled-refresh failed', e);
    return json(500, { error: 'the scheduled refresh failed; see the function logs' });
  }
});
