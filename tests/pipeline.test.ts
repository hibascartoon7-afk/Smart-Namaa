// The whole backend chain on a real Postgres: device token -> ingest -> readings -> decision engine -> decision,
// explanation, alerts, saving -> what the owner is allowed to read. Crop numbers come from the real FAO-56 tables
// loaded by the migrations; only the sensor values, weather and growth-stage lengths are test inputs.
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, PgliteDb } from './helpers/db';
import { handleIngest, provisionDevice, revokeDevice } from '../src/engine/ingest-run';
import { runDecisionForField } from '../src/engine/run-decision';

const NOW = Date.parse('2026-10-21T09:00:00Z');
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

let pg: PGlite;
let db: PgliteDb;
let fieldId = '';
let token = '';
let deviceId = '';

async function seedWeather(rainMm: number) {
  await pg.exec(`delete from public.weather_observations where field_id = '${fieldId}'`);
  for (let h = -30; h <= 60; h++) {
    await pg.query(
      `insert into public.weather_observations (field_id, observed_at, air_temperature_c, precipitation_mm, rain_probability_pct, et0_mm) values ($1, $2, 24, $3, $4, 0.2)`,
      [fieldId, new Date(NOW + h * 3_600_000).toISOString(), h === 6 ? rainMm : 0, h === 6 && rainMm > 0 ? 80 : 5],
    );
  }
}

beforeAll(async () => {
  pg = await createDb();
  db = new PgliteDb(pg);
  await pg.query(`insert into auth.users (id, raw_user_meta_data) values ($1, '{}'), ($2, '{}')`, [A, B]);
  const soil = await pg.query<{ id: string }>(`insert into public.soil_types (soil_name, field_capacity_pct, wilting_point_pct, source_id) values ('Loam test values', 30, 15, 'FAO56_TABLE19') returning id`);
  const crop = await pg.query<{ id: string }>(`select id from public.crops where crop_name = 'Tomato'`);
  await pg.query(`insert into public.crop_growth_stages (crop_id, initial_days, development_days, mid_days, late_days) values ($1, 30, 40, 45, 30)`, [crop.rows[0].id]);
  const f = await pg.query<{ id: string }>(
    `insert into public.fields (owner_user_id, name, timezone, area_m2, crop_id, planting_date, soil_type_id) values ($1, 'Greenhouse 1', 'Asia/Hebron', 1000, $2, '2026-08-03', $3) returning id`,
    [A, crop.rows[0].id, soil.rows[0].id],
  );
  fieldId = f.rows[0].id;
  await pg.query(`insert into public.sensor_points (field_id, point_name) values ($1,'1'), ($1,'2'), ($1,'left')`, [fieldId]);
  await seedWeather(0);
  ({ token, deviceId } = await provisionDevice(db, fieldId, '  ESP32   tomato  '));
}, 120_000);

describe('device token and ingest', () => {
  it('the token is shown once and only its hash is stored', async () => {
    expect(token).toMatch(/^nmd_[0-9a-f]{64}$/);
    const rows = await pg.query<{ token_hash: string }>('select token_hash from public.device_tokens');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].token_hash).not.toContain(token);
    expect(rows.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    const dev = await pg.query<{ device_name: string }>('select device_name from public.devices');
    expect(dev.rows[0].device_name).toBe('ESP32 tomato');
  });

  it('rejects a missing, wrong or revoked token with the same answer', async () => {
    const body = { readings: [{ sensor: '1', moisture: 30 }] };
    expect((await handleIngest(db, null, body, NOW)).status).toBe(401);
    expect((await handleIngest(db, 'Bearer nmd_wrong', body, NOW)).status).toBe(401);
    expect((await handleIngest(db, `Bearer ${token}`.replace('Bearer', 'Basic'), body, NOW)).status).toBe(401);
  });

  it('stores readings by sensor NAME, keeps "not measured" as empty, reports unknown names', async () => {
    const res = await handleIngest(db, `Bearer ${token}`, {
      readings: [{ sensor: '1', moisture: 22, soil_temperature: 24.5 }, { sensor: ' LEFT ', moisture: 28, ec: null }, { sensor: 'ghost', moisture: 50 }],
    }, NOW);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stored: 2, unknown_sensors: ['ghost'], suspect_sensors: [] });
    const r = await pg.query<{ point_name: string; moisture: string; soil_temperature: string | null; ec: string | null; ec_status: string; moisture_status: string }>(
      `select p.point_name, r.moisture, r.soil_temperature, r.ec, r.ec_status, r.moisture_status from public.sensor_readings r join public.sensor_points p on p.id = r.sensor_point_id order by p.point_name`);
    expect(r.rows.map((x) => x.point_name)).toEqual(['1', 'left']);
    expect(r.rows[0].ec).toBeNull();
    expect(r.rows[0].ec_status).toBe('not_measured');
    expect(r.rows[0].moisture_status).toBe('measured');
    expect(Number(r.rows[1].moisture)).toBe(28);
    const dev = await pg.query<{ device_status: string; last_seen_at: string | null }>('select device_status, last_seen_at from public.devices');
    expect(dev.rows[0].device_status).toBe('online');
    expect(dev.rows[0].last_seen_at).not.toBeNull();
  });

  it('rejects bad payloads', async () => {
    const auth = `Bearer ${token}`;
    expect((await handleIngest(db, auth, 'nope', NOW)).status).toBe(400);
    expect((await handleIngest(db, auth, { readings: [] }, NOW)).status).toBe(400);
    expect((await handleIngest(db, auth, { readings: [{ moisture: 3 }] }, NOW)).status).toBe(400);
    expect((await handleIngest(db, auth, { readings: [{ sensor: '1' }, { sensor: ' 1 ' }] }, NOW)).status).toBe(400);
    expect((await handleIngest(db, auth, { measured_at: '2030-01-01T00:00:00Z', readings: [{ sensor: '1', moisture: 3 }] }, NOW)).status).toBe(400);
  });
});

describe('decision engine on stored data', () => {
  it('dry day: Sensor 1 irrigates (numbers from Table 22 Tomato and the loam soil), result is stored', async () => {
    const { decision, decisionId } = await runDecisionForField(db, fieldId, NOW);
    expect(decision.growthStage).toBe('mid');
    expect(decision.irrigation.status).toBe('recommend_irrigation');
    const s1 = decision.perPoint.find((p) => p.pointName === '1')!.result;
    expect(s1.status).toBe('recommend_irrigation');
    if (s1.status === 'recommend_irrigation') {
      expect(s1.numbers.tawMm).toBeCloseTo(105, 6); // 1000 (0.30 - 0.15) x 0.7 m (Table 22 tomato, smaller value)
      expect(s1.netDepthMm).toBeCloseTo(56, 6);
    }
    expect(decision.perPoint.find((p) => p.pointName === '2')!.result.status).toBe('insufficient_data'); // sensor 2 never reported

    const d = await pg.query<{ irrigation_status: string; engine_version: string; growth_stage: string; etc_mm: string }>('select irrigation_status, engine_version, growth_stage, etc_mm from public.decisions where id = $1', [decisionId]);
    expect(d.rows[0]).toMatchObject({ irrigation_status: 'recommend_irrigation', engine_version: 'engine-1.0.0', growth_stage: 'mid' });
    expect(Number(d.rows[0].etc_mm)).toBeCloseTo(1.15 * 4.8, 6);
    const e = await pg.query<{ explanation_text: string }>('select explanation_text from public.decision_explanations where decision_id = $1', [decisionId]);
    expect(e.rows[0].explanation_text).toContain('Irrigate');
    const alerts = await pg.query<{ code: string; kind: string }>('select code, kind from public.alerts where decision_id = $1 order by code', [decisionId]);
    expect(alerts.rows.map((a) => a.code)).toEqual(['irrigate_now', 'no_recent_reading']);
  });

  it('rain forecast: the same readings now give "do not irrigate", with a saving estimate (one row per day)', async () => {
    await seedWeather(30);
    const { decision, decisionId } = await runDecisionForField(db, fieldId, NOW);
    expect(decision.perPoint.find((p) => p.pointName === '1')!.result).toMatchObject({ status: 'do_not_irrigate', reason: 'rain_expected' });
    const codes = (await pg.query<{ code: string }>('select code from public.alerts where decision_id = $1', [decisionId])).rows.map((a) => a.code);
    expect(codes).toContain('rain_expected');
    expect(codes).toContain('estimated_saving');
    await runDecisionForField(db, fieldId, NOW + 60_000); // run again the same day
    const s = await pg.query<{ saved_mm: string; saved_m3: string; local_day: string }>('select saved_mm, saved_m3, local_day from public.water_savings where field_id = $1', [fieldId]);
    expect(s.rows).toHaveLength(1);
    expect(Number(s.rows[0].saved_mm)).toBeGreaterThan(0);
    expect(Number(s.rows[0].saved_m3)).toBeCloseTo(Number(s.rows[0].saved_mm), 6); // 1000 m2: 1 mm = 1 m3
  });

  it('an impossible reading is stored as suspect, flagged to the device, and ignored by the engine', async () => {
    await seedWeather(0);
    const res = await handleIngest(db, `Bearer ${token}`, { readings: [{ sensor: '1', moisture: 140 }] }, NOW);
    expect(res.status).toBe(200);
    expect(res.body.suspect_sensors).toEqual(['1']);
    const { decision } = await runDecisionForField(db, fieldId, NOW);
    // the newest reading of sensor 1 is suspect, so the engine falls back to the older valid one (22 %)
    expect(decision.perPoint.find((p) => p.pointName === '1')!.moisturePct).toBe(22);
  });

  it('a field with no sensor points or no crop never crashes: it explains', async () => {
    const empty = await pg.query<{ id: string }>(`insert into public.fields (owner_user_id, name, timezone) values ($1, 'Empty', 'Asia/Hebron') returning id`, [A]);
    const { decision } = await runDecisionForField(db, empty.rows[0].id, NOW);
    expect(decision.irrigation.status).toBe('insufficient_data');
    expect(decision.alerts.map((a) => a.code)).toContain('no_sensor_points');
  });

  it('an unknown field is an error, not an empty decision', async () => {
    await expect(runDecisionForField(db, '99999999-9999-9999-9999-999999999999', NOW)).rejects.toThrow(/not found/);
  });
});

describe('what the owner may read, and revoking a device', () => {
  it('the owner sees their alerts, savings and decisions; another user sees none', async () => {
    for (const [user, expected] of [[A, true], [B, false]] as const) {
      await pg.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
      for (const t of ['alerts', 'water_savings', 'decisions', 'decision_explanations']) {
        const n = (await pg.query<{ n: number }>(`select count(*)::int as n from public.${t}`)).rows[0].n;
        expect(n > 0, `${t} for ${user}`).toBe(expected);
      }
      await pg.exec('reset role;');
    }
  });

  it('a revoked token stops working immediately', async () => {
    await revokeDevice(db, deviceId, NOW);
    expect((await handleIngest(db, `Bearer ${token}`, { readings: [{ sensor: '1', moisture: 30 }] }, NOW)).status).toBe(401);
  });
});

describe('soil values need a source', () => {
  it('a soil without source_id is not used: the engine says the soil data is missing instead of deciding', async () => {
    const where = `id = (select soil_type_id from public.fields where id = '${fieldId}')`;
    await pg.exec(`update public.soil_types set source_id = null where ${where}`);
    const { decision } = await runDecisionForField(db, fieldId, NOW);
    expect(decision.irrigation.status).toBe('insufficient_data');
    await pg.exec(`update public.soil_types set source_id = 'FAO56_TABLE19' where ${where}`);
  });

  it('Table 19 is loaded with a source: 9 texture classes, midpoints inside the printed ranges', async () => {
    const r = await pg.query<{ n: number; bad: number }>(`
      select count(*)::int as n,
             count(*) filter (where field_capacity_pct not between field_capacity_min_pct and field_capacity_max_pct
                                or wilting_point_pct not between wilting_point_min_pct and wilting_point_max_pct
                                or wilting_point_pct >= field_capacity_pct)::int as bad
        from public.soil_types where source_id = 'FAO56_TABLE19' and value_basis is not null`);
    expect(r.rows[0].n).toBeGreaterThanOrEqual(9);
    expect(r.rows[0].bad).toBe(0);
    const loam = await pg.query<{ fc: string; wp: string }>(`select field_capacity_pct as fc, wilting_point_pct as wp from public.soil_types where soil_name = 'Loam' and source_id = 'FAO56_TABLE19'`);
    expect(Number(loam.rows[0].fc)).toBeCloseTo(25, 6);
    expect(Number(loam.rows[0].wp)).toBeCloseTo(12, 6);
  });
});

describe('fertilization: heat limit, doses and options from the stored reference data', () => {
  it('forecast of 36 C: the engine raises "do not apply fertilizer: heat" with the stored 30 C limit and its source; 24 C: no such alert', async () => {
    await seedWeather(0);
    await pg.query(`update public.weather_observations set air_temperature_c = 36 where field_id = $1 and observed_at = $2`, [fieldId, new Date(NOW + 5 * 3_600_000).toISOString()]);
    const hot = await runDecisionForField(db, fieldId, NOW);
    const a = await pg.query<{ code: string; details: { limitC: number; sourceId: string }; message_en: string }>('select code, details, message_en from public.alerts where decision_id = $1 and code = $2', [hot.decisionId, 'fertilizer_hold_heat']);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].details).toMatchObject({ limitC: 30, sourceId: 'HEAT_GUIDANCE' });
    expect(a.rows[0].message_en).toContain('precaution');
    await seedWeather(0);
    const mild = await runDecisionForField(db, fieldId, NOW + 120_000);
    const codes = (await pg.query<{ code: string }>('select code from public.alerts where decision_id = $1', [mild.decisionId])).rows.map((x) => x.code);
    expect(codes).not.toContain('fertilizer_hold_heat');
  });

  it('the engine loads the stored doses and soil notes; with a measured low nutrient it gives the dose, the options and the field soil note', async () => {
    const { loadFieldInput } = await import('../src/engine/run-decision');
    const { decideField } = await import('../src/engine/decide-field');
    // the test field has a made-up soil name: use a real Table 19 soil for this check
    const sandy = await pg.query<{ id: string }>(`select id from public.soil_types where soil_name = 'Sand' and source_id = 'FAO56_TABLE19'`);
    await pg.query('update public.fields set soil_type_id = $1 where id = $2', [sandy.rows[0].id, fieldId]);
    const input = await loadFieldInput(db, fieldId, NOW);
    expect(input.fertilizationContext!.soilName).toBe('Sand');
    expect(input.fertilizationContext!.rates.map((r) => r.nutrient).sort()).toEqual(['k', 'p']); // Tomato
    expect(input.fertilizationContext!.soilNotes.length).toBe(20);
    // the app has no nutrient input yet: here the lab value is set by hand to see what the engine does with it (soil K 100 ppm < 130)
    const d = decideField({ ...input, nutrients: { n: null, p: null, k: 100 } });
    const f = d.fertilization.result;
    if (f.status !== 'recommend_fertilization') throw new Error('expected a recommendation');
    expect(f.plans[0].nutrient).toBe('k');
    expect(f.plans[0].dose).toMatchObject({ maxKgPerDunum: 22.42, sourceId: 'UCIPM_TOMATO_SOIL' });
    expect(f.area).toEqual({ dunum: 1 }); // 1000 m2
    // the compound NPK products carry K2O too, but at this dose they would also deliver the same kg of N and P2O5: the option says so
    expect(f.plans[0].options.map((o) => o.name)).toEqual(['Potassium sulphate (SOP)', 'NPK 19-19-19', 'NPK 17-17-17', 'NPK 15-15-15']);
    expect(f.plans[0].options[0].alsoSupplies).toEqual([]);
    expect(f.plans[0].options[1].alsoSupplies).toEqual([{ nutrient: 'n', kgPerDunum: 22.4 }, { nutrient: 'p', kgPerDunum: 22.4 }]);
    expect(f.plans[0].options[0].productKgPerDunum).toEqual({ min: null, max: 44.8 }); // 22.42 / 0.50
    expect(f.plans[0].options[0].productKgForField).toEqual({ min: null, max: 44.8 });
    expect(f.plans[0].options[0].fieldSoil).toMatchObject({ rating: 'better', sourceId: 'CDFA_OLIVE_LEAF' }); // Sand
    expect(d.fertilization.text.en).toContain('44.8 kg of Potassium sulphate (SOP) per dunum');
    // measured P low on the same field: DAP and TSP both listed, DAP first (same 46 %, by name)
    const p = decideField({ ...input, nutrients: { n: null, p: 10, k: null } }).fertilization.result;
    if (p.status !== 'recommend_fertilization') throw new Error('expected a recommendation');
    expect(p.plans[0].options.map((o) => o.name)).toEqual(['Diammonium phosphate (DAP)', 'Triple superphosphate (TSP)', 'NPK 19-19-19', 'NPK 17-17-17', 'Single superphosphate (SSP)', 'NPK 15-15-15']);
    expect(p.plans[0].options[0].alsoSupplies).toEqual([{ nutrient: 'n', kgPerDunum: 6.6 }]); // DAP also carries 18 % N: 16.81 / 0.46 x 0.18
    expect(p.plans[0].options[1].alsoSupplies).toEqual([]); // TSP is phosphate only
    expect(p.plans[0].options[0].productKgPerDunum!.max).toBe(36.5); // 16.81 / 0.46
  });
});

describe('measured N, P, K: a lab result or an NPK sensor gives the fertilization decision', () => {
  const DAY = 86_400_000;
  let npkToken = '';
  let npkDeviceId = '';

  async function fertilization(at = NOW) {
    const d = await runDecisionForField(db, fieldId, at);
    const r = await pg.query<{ fertilization_decision: any }>('select fertilization_decision from public.decisions where id = $1', [d.decisionId]); // eslint-disable-line @typescript-eslint/no-explicit-any
    return r.rows[0].fertilization_decision;
  }
  async function enterLab(nutrient: string, value: number, unit: string, method: string, daysAgo: number) {
    await pg.exec(`set role authenticated; set request.jwt.claim.sub = '${A}';`);
    try {
      await pg.query(
        `insert into public.nutrient_measurements (field_id, nutrient, value, unit, method_code, source_kind, measured_at) values ($1, $2, $3, $4, $5, 'lab', $6)`,
        [fieldId, nutrient, value, unit, method, new Date(NOW - daysAgo * DAY).toISOString()],
      );
    } finally {
      await pg.exec('reset role;');
    }
  }

  beforeAll(async () => {
    await pg.exec('delete from public.nutrient_measurements');
    ({ token: npkToken, deviceId: npkDeviceId } = await provisionDevice(db, fieldId, 'ESP32 NPK'));
  });

  it('nothing measured: the decision says so (and irrigation is not affected)', async () => {
    const f = await fertilization();
    expect(f).toMatchObject({ status: 'insufficient_data', result: { reason: 'nutrients_not_measured' } });
    expect(f.text_en).toContain('not measured');
  });

  it('the owner enters a lab result: the decision uses it, with its method, source, age, dose and options', async () => {
    await enterLab('p', 10, 'ppm (mg/kg)', 'soil_olsen_p', 12);
    const f = await fertilization();
    expect(f.status).toBe('recommend_fertilization');
    expect(f.result.measurements).toHaveLength(1);
    expect(f.result.measurements[0]).toMatchObject({ nutrient: 'p', value: 10, sourceKind: 'lab', ageDays: 12, methodLabelEn: 'Soil test: Olsen phosphorus' });
    expect(f.text_en).toContain('Based on: phosphorus (P) 10 ppm (mg/kg) (Soil test: Olsen phosphorus, lab test, 12 days ago)');
    expect(f.text_en).not.toContain('confirm it with a lab test');
    const plan = f.result.plans[0];
    expect(plan.nutrient).toBe('p');
    expect(plan.dose.maxKgPerDunum).toBe(16.81);
    expect(plan.options[0]).toMatchObject({ name: 'Diammonium phosphate (DAP)', productKgPerDunum: { min: null, max: 36.5 }, productKgForField: { min: null, max: 36.5 } }); // 1000 m2 = 1 dunum
  });

  it('a result in a unit no limit uses is reported and not judged; the usable one still decides', async () => {
    await enterLab('k', 0.01, '%', 'soil_nh4oac_k', 1);
    const f = await fertilization();
    expect(f.status).toBe('recommend_fertilization');
    expect(f.result.needed.map((x: { nutrient: string }) => x.nutrient)).toEqual(['p']);
    expect(f.result.rejected).toEqual([expect.objectContaining({ nutrient: 'k', unit: '%', reason: 'unit_mismatch' })]);
    expect(f.text_en).toContain('Not used (a stored limit does not fit its method or unit): potassium (K) 0.01 % (soil_nh4oac_k, lab test)');
  });

  it('a good result means no fertilizer is needed, and says what that is based on', async () => {
    await pg.exec('delete from public.nutrient_measurements');
    await enterLab('k', 200, 'ppm (mg/kg)', 'soil_nh4oac_k', 3);
    const f = await fertilization();
    expect(f.status).toBe('no_fertilization_needed');
    expect(f.text_en).toContain('Based on: potassium (K) 200 ppm (mg/kg)');
  });

  it('NPK sensor, method not declared yet: the values are stored but NOT judged, and the decision says why', async () => {
    await pg.exec('delete from public.nutrient_measurements');
    const res = await handleIngest(db, `Bearer ${npkToken}`, {
      measured_at: new Date(NOW).toISOString(),
      readings: [
        { sensor: '1', moisture: 30, nitrogen: 5, phosphorus: 12, potassium: 100 },
        { sensor: '2', moisture: 31, nitrogen: 7, phosphorus: 16, potassium: 120 },
        { sensor: 'left', phosphorus: -5 }, // impossible: reported, not stored
      ],
    }, NOW);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stored: 3, nutrient_values_stored: 3, suspect_nutrient_sensors: ['left'] });
    const rows = await pg.query<{ nutrient: string; value: string; unit: string; method_code: string; source_kind: string; note: string | null }>(
      'select nutrient, value, unit, method_code, source_kind, note from public.nutrient_measurements order by nutrient');
    expect(rows.rows.map((r) => `${r.nutrient} ${Number(r.value)} ${r.unit} ${r.method_code} ${r.source_kind} ${r.note}`)).toEqual([
      'k 110 unspecified sensor_unspecified sensor mean of 2 sensor points',
      'n 6 unspecified sensor_unspecified sensor mean of 2 sensor points',
      'p 14 unspecified sensor_unspecified sensor mean of 2 sensor points',
    ]);
    const f = await fertilization();
    expect(f).toMatchObject({ status: 'insufficient_data', result: { reason: 'measurements_not_comparable' } });
    expect(f.text_en).toContain('was measured, but the stored limits cannot judge it');
    expect(f.text_en).toContain('sensor_unspecified');
  });

  it('the owner declares what the sensor measures, but no limit exists for that method yet: still not judged', async () => {
    await pg.query(`update public.devices set npk_unit = 'mg/kg', npk_method_code = 'sensor_test' where id = $1`, [npkDeviceId]);
    await handleIngest(db, `Bearer ${npkToken}`, { readings: [{ sensor: '1', phosphorus: 12 }, { sensor: '2', phosphorus: 16 }] }, NOW + 60_000);
    const f = await fertilization(NOW + 120_000);
    expect(f.result.reason).toBe('measurements_not_comparable');
    expect(f.text_en).toContain('sensor_test');
  });

  it('a limit with a source is stored for that sensor method: the sensor now gives the decision, with the lab-test warning', async () => {
    await pg.query(`insert into public.sources (id, title, source_type, verification_status)
                    select 'TEST_SENSOR_LIMIT', 'test limit for the sensor', source_type, 'unverified' from public.sources where title ilike '%Table 12%' limit 1`);
    await pg.query(`insert into public.crop_nutrient_sufficiency (crop_id, nutrient, unit, low_below, method, source_id, method_code)
                    select id, 'p', 'mg/kg', 20, 'test sensor limit', 'TEST_SENSOR_LIMIT', 'sensor_test' from public.crops where crop_name = 'Tomato'`);
    await pg.exec('delete from public.nutrient_measurements');
    const res = await handleIngest(db, `Bearer ${npkToken}`, { readings: [{ sensor: '1', phosphorus: 12 }, { sensor: '2', phosphorus: 16 }] }, NOW + 180_000);
    expect(res.body).toMatchObject({ nutrient_values_stored: 1 });
    const f = await fertilization(NOW + 200_000);
    expect(f.status).toBe('recommend_fertilization');
    expect(f.result.measurements[0]).toMatchObject({ nutrient: 'p', value: 14, unit: 'mg/kg', methodCode: 'sensor_test', sourceKind: 'sensor' });
    expect(f.result.needed[0]).toMatchObject({ lowBelow: 20, sourceId: 'TEST_SENSOR_LIMIT' });
    expect(f.text_en).toContain('sensor, not from a lab test: confirm it with a lab test before applying fertilizer');
    expect(f.text_ar).toContain('مجس وليست من تحليل مخبري');
    expect(f.result.plans[0].options.length).toBeGreaterThan(0);
  });

  it('a device that sends no NPK values stores none and never needs the NPK settings', async () => {
    await pg.exec('delete from public.nutrient_measurements');
    const res = await handleIngest(db, `Bearer ${npkToken}`, { readings: [{ sensor: '1', moisture: 29 }] }, NOW + 240_000);
    expect(res.body).toMatchObject({ stored: 1, nutrient_values_stored: 0, suspect_nutrient_sensors: [] });
    expect((await pg.query<{ n: number }>('select count(*)::int as n from public.nutrient_measurements')).rows[0].n).toBe(0);
  });
});
