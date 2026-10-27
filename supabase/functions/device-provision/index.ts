// The owner connects an ESP32 to an environment. Returns a secret token ONCE: only its SHA-256 hash is stored.
//   { "action": "create", "field_id": "<uuid>", "device_name": "ESP32 tomato" }  ->  { device_id, token, endpoint }
//   { "action": "revoke", "device_id": "<uuid>" }                                  ->  the token stops working
import { provisionDevice, revokeDevice } from '../_shared/engine/ingest-run.ts';
import { adminClient, json, ownsField, preflight, readJson, SupabaseDb, userOf, UUID } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const admin = adminClient();
  const user = await userOf(req, admin);
  if (!user) return json(401, { error: 'sign in first' });

  const body = (await readJson(req)) as { action?: unknown; field_id?: unknown; device_id?: unknown; device_name?: unknown } | null;
  if (!body) return json(400, { error: 'JSON body required' });
  const db = new SupabaseDb(admin);

  try {
    if (body.action === 'create') {
      if (typeof body.field_id !== 'string' || !UUID.test(body.field_id)) return json(400, { error: 'field_id (uuid) is required' });
      if (!(await ownsField(admin, user.id, body.field_id))) return json(404, { error: 'environment not found' });
      const { deviceId, token } = await provisionDevice(db, body.field_id, typeof body.device_name === 'string' ? body.device_name : 'ESP32');
      return json(200, { device_id: deviceId, token, endpoint: `${Deno.env.get('SUPABASE_URL')}/functions/v1/sensor-ingest` });
    }
    if (body.action === 'revoke') {
      if (typeof body.device_id !== 'string' || !UUID.test(body.device_id)) return json(400, { error: 'device_id (uuid) is required' });
      const { data: device } = await admin.from('devices').select('field_id').eq('id', body.device_id).maybeSingle();
      if (!device || !device.field_id || !(await ownsField(admin, user.id, device.field_id))) return json(404, { error: 'device not found' });
      await revokeDevice(db, body.device_id, Date.now());
      return json(200, { revoked: true });
    }
    return json(400, { error: 'action must be "create" or "revoke"' });
  } catch (e) {
    console.error('device-provision failed', e);
    return json(500, { error: 'could not complete the request' });
  }
});
