// Runs the decision engine for ONE environment and stores the result (decision, explanation, alerts, saving estimate).
// Who may call it: the owner of the environment (user JWT) or the scheduler (service-role key). Nobody else.
// All rules live in ../_shared/engine (synced from src/engine, tested there).
import { runDecisionForField, FieldNotFoundError } from '../_shared/engine/run-decision.ts';
import { adminClient, isServiceCall, json, ownsField, preflight, readJson, SupabaseDb, userOf, UUID } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const body = (await readJson(req)) as { field_id?: unknown } | null;
  if (!body || typeof body.field_id !== 'string' || !UUID.test(body.field_id)) return json(400, { error: 'field_id (uuid) is required' });
  const fieldId = body.field_id;

  try {
    const admin = adminClient();
    if (!isServiceCall(req)) {
      const user = await userOf(req, admin);
      if (!user) return json(401, { error: 'sign in first' });
      if (!(await ownsField(admin, user.id, fieldId))) return json(404, { error: 'environment not found' });
    }
    const { decisionId, decision } = await runDecisionForField(new SupabaseDb(admin), fieldId, Date.now());
    return json(200, {
      decision_id: decisionId,
      irrigation_status: decision.irrigation.status,
      growth_stage: decision.growthStage,
      alerts: decision.alerts.length,
      upstream: decision.upstream,
    });
  } catch (e) {
    if (e instanceof FieldNotFoundError) return json(404, { error: 'environment not found' });
    console.error('decision-engine failed', e);
    return json(500, { error: 'the decision engine failed; see the function logs' });
  }
});
