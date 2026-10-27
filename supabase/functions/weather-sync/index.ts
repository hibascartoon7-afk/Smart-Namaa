// weather-sync: fetch Open-Meteo for ONE field (its own latitude / longitude / timezone) and store hourly rows.
// - Needs a signed-in user (JWT). The user can only sync a field they own (RLS decides).
// - Writes with the service role, which never leaves the server.
// - If Open-Meteo fails or returns something unexpected, NOTHING is written.
// - At most one call to Open-Meteo per field every 10 minutes.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildOpenMeteoUrl, parseOpenMeteoHourly } from './parse.ts';

const MIN_INTERVAL_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'missing_authorization' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json(500, { error: 'server_not_configured' });

  let fieldId: unknown;
  try {
    fieldId = (await req.json())?.field_id;
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  if (typeof fieldId !== 'string' || !UUID.test(fieldId)) return json(400, { error: 'field_id_must_be_uuid' });

  // 1) who is calling, and do they own this field? (RLS on `fields` answers it)
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: 'invalid_token' });

  const { data: field, error: fieldErr } = await userClient
    .from('fields')
    .select('id, latitude, longitude, timezone')
    .eq('id', fieldId)
    .maybeSingle();
if (fieldErr) return json(500, { error: 'field_lookup_failed' });
  if (!field) return json(404, { error: 'field_not_found' });

  // 2) throttle (service role: the user cannot read/write weather rows directly)
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: last } = await admin
    .from('weather_observations')
    .select('fetched_at')
    .eq('field_id', field.id)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last && Date.now() - new Date(last.fetched_at).getTime() < MIN_INTERVAL_MS) {
    return json(200, { status: 'cached', fetched_at: last.fetched_at });
  }

  // 3) fetch
  let url: string;
  try {
    url = buildOpenMeteoUrl(field);
  } catch (e) {
    return json(422, { error: 'field_location_invalid', detail: (e as Error).message });
  }
  let payload: unknown;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return json(502, { error: 'open_meteo_http_error', status: res.status });
    payload = await res.json();
  } catch {
    return json(502, { error: 'open_meteo_unreachable' });
  }

  const parsed = parseOpenMeteoHourly(payload);
  if (!parsed.ok) return json(502, { error: 'open_meteo_unexpected_response', detail: parsed.error });

  // 4) store (upsert by field + hour)
  const fetchedAt = new Date().toISOString();
  const rows = parsed.rows.map((r) => ({ ...r, field_id: field.id, fetched_at: fetchedAt }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin
      .from('weather_observations')
      .upsert(rows.slice(i, i + 200), { onConflict: 'field_id,observed_at' });
if (error) return json(500, { error: 'store_failed' });
  }

  return json(200, { status: 'ok', rows: rows.length, rejected_values: parsed.rejected, fetched_at: fetchedAt });
});
