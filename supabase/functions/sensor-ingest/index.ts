// The ESP32 sends its readings here. It authenticates with its DEVICE TOKEN (not a user login), so this function is
// deployed with verify_jwt = false (see config.toml) and checks the token itself. All checks live in ../_shared/engine/ingest-run.ts.
import { handleIngest } from '../_shared/engine/ingest-run.ts';
import { adminClient, corsHeaders, json, preflight, readJson, SupabaseDb } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const body = await readJson(req);
  if (body === null) return json(400, { error: 'body must be JSON of at most 64 KB' });

  try {
    const result = await handleIngest(new SupabaseDb(adminClient()), req.headers.get('Authorization'), body, Date.now());
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('sensor-ingest failed', e);
    return json(500, { error: 'could not store the readings' });
  }
});
