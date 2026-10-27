// Runs the real migrations on a real Postgres (PGlite, WASM) built from the schema of the project's Supabase database.
// What it proves: the SQL is valid, can be run twice, links crops correctly, and that Row Level Security really keeps
// every owner's data private. It does NOT replace running the migrations once on the real Supabase project.
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, MIGRATIONS, readMigration } from './helpers/db';

const read = readMigration;

let db: PGlite;
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
let fieldA = '';
let fieldB = '';

async function as(user: string | null, fn: () => Promise<unknown>) {
  await db.exec(user ? `set role authenticated; set request.jwt.claim.sub = '${user}';` : 'reset role;');
  try {
    return await fn();
  } finally {
    await db.exec('reset role;');
  }
}

beforeAll(async () => {
  db = await createDb();
  await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, '{"full_name":"  Nada Test "}'), ($2, '{}')`, [A, B]);
  const fa = await db.query<{ id: string }>(`insert into public.fields (owner_user_id, name) values ($1, 'A field') returning id`, [A]);
  const fb = await db.query<{ id: string }>(`insert into public.fields (owner_user_id, name) values ($1, 'B field') returning id`, [B]);
  fieldA = fa.rows[0].id;
  fieldB = fb.rows[0].id;
  await db.query(`insert into public.sensor_points (field_id, point_name) values ($1,'1'), ($2,'1')`, [fieldA, fieldB]);
}, 120_000);

describe('migrations', () => {
  it('can be run a second time without errors (idempotent)', async () => {
    for (const m of MIGRATIONS) await db.exec(read(m));
  }, 60_000);

  it('crops: Tomato kept and linked; every FAO crop with a name match is added with both links', async () => {
    const tomato = await db.query<{ crop_name: string; coefficient_id: string | null; water_params_id: string | null }>(`select crop_name, coefficient_id, water_params_id from public.crops where crop_name = 'Tomato'`);
    expect(tomato.rows).toHaveLength(1);
    expect(tomato.rows[0].coefficient_id).not.toBeNull();
    expect(tomato.rows[0].water_params_id).not.toBeNull();
    const all = await db.query<{ n: number; bad: number }>(`select count(*)::int as n, count(*) filter (where coefficient_id is null or water_params_id is null)::int as bad from public.crops`);
    expect(all.rows[0].n).toBeGreaterThan(90);
    expect(all.rows[0].bad).toBe(0);
  });

  it('a crop is linked to a Table 22 row with the same name (no wrong crop parameters)', async () => {
    const mismatch = await db.query<{ n: number }>(`
      select count(*)::int as n
        from public.crops c
        join public.crop_coefficients cc on cc.id = c.coefficient_id
        join public.crop_water_params w on w.id = c.water_params_id
       where public.norm_crop_name(cc.crop) <> public.norm_crop_name(w.crop)`);
    expect(mismatch.rows[0].n).toBe(0);
  });

  it('Tomato gets root depth 0.7-1.5 m and p = 0.40 from FAO-56 Table 22', async () => {
    const r = await db.query<{ root_depth_min_m: string; root_depth_max_m: string; depletion_fraction_p: string; source_id: string }>(
      `select w.root_depth_min_m, w.root_depth_max_m, w.depletion_fraction_p, w.source_id from public.crops c join public.crop_water_params w on w.id = c.water_params_id where c.crop_name = 'Tomato'`);
    expect(Number(r.rows[0].root_depth_min_m)).toBe(0.7);
    expect(Number(r.rows[0].root_depth_max_m)).toBe(1.5);
    expect(Number(r.rows[0].depletion_fraction_p)).toBe(0.4);
    expect(r.rows[0].source_id).toBe('FAO56_TABLE22');
  });

  it('Table 22 has all 104 rows and the source is marked unverified', async () => {
    expect((await db.query<{ n: number }>('select count(*)::int as n from public.crop_water_params')).rows[0].n).toBe(104);
    expect((await db.query<{ v: string }>(`select verification_status as v from public.sources where id = 'FAO56_TABLE22'`)).rows[0].v).toBe('unverified');
  });

  it('Table 11: 13 crops get their stage lengths, each with a source, and the source is marked unverified', async () => {
    const r = await db.query<{ n: number; no_source: number; bad_basis: number }>(
      `select count(*)::int as n,
              count(*) filter (where source_id is distinct from 'FAO56_TABLE11')::int as no_source,
              count(*) filter (where value_basis is null or plant_period is null or region is null)::int as bad_basis
         from public.crop_growth_stages`);
    expect(r.rows[0]).toEqual({ n: 13, no_source: 0, bad_basis: 0 });
    expect((await db.query<{ v: string }>(`select verification_status as v from public.sources where id = 'FAO56_TABLE11'`)).rows[0].v).toBe('unverified');
  });

  it('Table 11: Tomato = 30 / 40 / 45 / 30 days (Mediterranean, April/May) and is ready for the engine', async () => {
    const r = await db.query<{ initial_days: number; development_days: number; mid_days: number; late_days: number; has_stage_lengths: boolean }>(
      `select g.initial_days, g.development_days, g.mid_days, g.late_days, r.has_stage_lengths
         from public.crops c
         join public.crop_growth_stages g on g.crop_id = c.id
         join public.crop_readiness r on r.crop_id = c.id
        where c.crop_name = 'Tomato'`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toEqual({ initial_days: 30, development_days: 40, mid_days: 45, late_days: 30, has_stage_lengths: true });
  });

  it('Table 11: every seeded row adds up to the total printed in the table', async () => {
    const printed: Record<string, number> = {
      'Carrots': 150, 'Celery': 125, 'Onions - dry': 150, 'Onions - green': 70, 'Tomato': 145, 'Pumpkin, Winter Squash': 100,
      'Sweet Melons': 120, 'Sweet Potato': 150, 'Beans, green': 90, 'Groundnut (Peanut)': 140,
      'Sunflower': 130, 'Maize, Sweet (sweet corn)': 80,
      'Olives (40 to 60% ground coverage by canopy)': 270,
    };
    const r = await db.query<{ crop_name: string; total: number }>(
      `select c.crop_name, (g.initial_days + g.development_days + g.mid_days + g.late_days)::int as total
         from public.crop_growth_stages g join public.crops c on c.id = g.crop_id`);
    for (const row of r.rows) expect(row.total, row.crop_name).toBe(printed[row.crop_name]);
    expect(r.rows).toHaveLength(13);
  });

  it('Table 11: crops without one clear Mediterranean row, or whose printed total does not match, are NOT seeded (Lettuce, Cucumber, Peppers, Egg Plant, Green Gram, Asparagus, Banana) and stay not ready', async () => {
    for (const name of ['Lettuce', 'Cucumber - Fresh Market', 'Sweet Peppers (bell)', 'Egg Plant', 'Green Gram and Cowpeas', 'Asparagus', 'Banana - 1st year']) {
      const r = await db.query<{ has_stage_lengths: boolean }>(`select has_stage_lengths from public.crop_readiness where crop_name = $1`, [name]);
      expect(r.rows[0].has_stage_lengths, name).toBe(false);
    }
  });

  it('Table 11: running the migration again never changes or doubles a row, and never touches the owner\'s own values', async () => {
    await db.exec(`insert into public.crop_growth_stages (crop_id, initial_days, development_days, mid_days, late_days)
                   select id, 20, 30, 50, 25 from public.crops where crop_name = 'Lettuce'`);
    await db.exec(`update public.crop_growth_stages set initial_days = 31 where crop_id = (select id from public.crops where crop_name = 'Tomato')`);
    await db.exec(read('20261023100000_growth_stages_table11.sql'));
    const n = await db.query<{ n: number }>('select count(*)::int as n from public.crop_growth_stages');
    expect(n.rows[0].n).toBe(14); // 13 seeded + the owner's Lettuce row
    const tomato = await db.query<{ initial_days: number }>(`select g.initial_days from public.crop_growth_stages g join public.crops c on c.id = g.crop_id where c.crop_name = 'Tomato'`);
    expect(tomato.rows[0].initial_days).toBe(31); // not overwritten
    const lettuce = await db.query<{ initial_days: number; source_id: string | null }>(`select g.initial_days, g.source_id from public.crop_growth_stages g join public.crops c on c.id = g.crop_id where c.crop_name = 'Lettuce'`);
    expect(lettuce.rows[0]).toEqual({ initial_days: 20, source_id: null });
    // put the test data back
    await db.exec(`update public.crop_growth_stages set initial_days = 30 where crop_id = (select id from public.crops where crop_name = 'Tomato')`);
    await db.exec(`delete from public.crop_growth_stages where crop_id = (select id from public.crops where crop_name = 'Lettuce')`);
  });

  it('crop_readiness: a crop without stage lengths becomes ready as soon as the owner adds them', async () => {
    const before = await db.query<{ has_stage_lengths: boolean }>(`select has_stage_lengths from public.crop_readiness where crop_name = 'Lettuce'`);
    expect(before.rows[0].has_stage_lengths).toBe(false);
    await db.exec(`insert into public.crop_growth_stages (crop_id, initial_days, development_days, mid_days, late_days) select id, 20, 30, 15, 10 from public.crops where crop_name = 'Lettuce'`);
    const after = await db.query<{ has_stage_lengths: boolean }>(`select has_stage_lengths from public.crop_readiness where crop_name = 'Lettuce'`);
    expect(after.rows[0].has_stage_lengths).toBe(true);
    await db.exec(`delete from public.crop_growth_stages where crop_id = (select id from public.crops where crop_name = 'Lettuce')`);
  });

  it('Table 11: Olives = 30 / 90 / 60 / 90 days from March, with the perennial note, and the engine can use them', async () => {
    const r = await db.query<{ initial_days: number; development_days: number; mid_days: number; late_days: number; plant_period: string; value_basis: string; has_stage_lengths: boolean }>(
      `select g.initial_days, g.development_days, g.mid_days, g.late_days, g.plant_period, g.value_basis, r.has_stage_lengths
         from public.crops c join public.crop_growth_stages g on g.crop_id = c.id join public.crop_readiness r on r.crop_id = c.id
        where c.crop_name like 'Olives%'`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ initial_days: 30, development_days: 90, mid_days: 60, late_days: 90, plant_period: 'March', has_stage_lengths: true });
    expect(r.rows[0].value_basis).toContain('Perennial');
  });

  it('fertilization reference: FAO fertilizers, every row with a source and a content between 0 and 100 %', async () => {
    const r = await db.query<{ name: string; n_pct: string | null; p2o5_pct: string | null; k2o_pct: string | null; source_id: string }>(
      `select name, n_pct, p2o5_pct, k2o_pct, source_id from public.fertilizers order by name`);
    expect(r.rows).toHaveLength(10);
    for (const f of r.rows) {
      expect(f.source_id, f.name).toBe('FAO_FERT_SPECS');
      for (const v of [f.n_pct, f.p2o5_pct, f.k2o_pct]) if (v !== null) { expect(Number(v)).toBeGreaterThan(0); expect(Number(v)).toBeLessThanOrEqual(100); }
    }
    const by = Object.fromEntries(r.rows.map((x) => [x.name, x]));
    expect(Number(by['Urea'].n_pct)).toBe(46);
    expect(Number(by['Diammonium phosphate (DAP)'].n_pct)).toBe(18);
    expect(Number(by['Diammonium phosphate (DAP)'].p2o5_pct)).toBe(46);
    expect(Number(by['Potassium sulphate (SOP)'].k2o_pct)).toBe(50);
    expect(Object.keys(by).some((n) => /chloride|MOP/i.test(n))).toBe(false); // not stored on purpose (see the migration)
  });

  it('fertilization reference: limits for Tomato (soil P 15, K 130 ppm) and Olives (July leaf N 1.4, P 0.1, K 0.4 %), all with a source', async () => {
    const r = await db.query<{ crop_name: string; nutrient: string; unit: string; low_below: string; method: string; source_id: string }>(
      `select c.crop_name, s.nutrient, s.unit, s.low_below, s.method, s.source_id
         from public.crop_nutrient_sufficiency s join public.crops c on c.id = s.crop_id order by c.crop_name, s.nutrient`);
    expect(r.rows.map((x) => `${x.crop_name.slice(0, 6)} ${x.nutrient} ${Number(x.low_below)} ${x.source_id}`)).toEqual([
      'Olives k 0.4 CDFA_OLIVE_LEAF', 'Olives n 1.4 CDFA_OLIVE_LEAF', 'Olives p 0.1 CDFA_OLIVE_LEAF',
      'Tomato k 130 UCIPM_TOMATO_SOIL', 'Tomato p 15 UCIPM_TOMATO_SOIL',
    ]);
    for (const x of r.rows) { expect(x.unit).toBeTruthy(); expect(x.method.length).toBeGreaterThan(20); }
    const v = await db.query<{ id: string; verification_status: string }>(`select id, verification_status from public.sources where id in ('FAO_FERT_SPECS', 'CDFA_OLIVE_LEAF', 'UCIPM_TOMATO_SOIL') order by id`);
    expect(v.rows).toEqual([
      { id: 'CDFA_OLIVE_LEAF', verification_status: 'unverified' }, { id: 'FAO_FERT_SPECS', verification_status: 'unverified' }, { id: 'UCIPM_TOMATO_SOIL', verification_status: 'unverified' },
    ]);
  });

  it('heat limit: one row for all crops, 30 C, from the garden-guidance source (a precaution, marked unverified)', async () => {
    const r = await db.query<{ code: string; crop_id: string | null; value: string; unit: string; source_id: string; notes: string }>('select code, crop_id, value, unit, source_id, notes from public.alert_thresholds');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ code: 'fertilizer_hold_air_temp_max_c', crop_id: null, unit: 'C', source_id: 'HEAT_GUIDANCE' });
    expect(Number(r.rows[0].value)).toBe(30);
    expect(r.rows[0].notes).toContain('no field-crop trial');
    const s = await db.query<{ id: string; verification_status: string }>(`select id, verification_status from public.sources where id in ('HEAT_GUIDANCE', 'UIDAHO_BUL926') order by id`);
    expect(s.rows).toEqual([{ id: 'HEAT_GUIDANCE', verification_status: 'unverified' }, { id: 'UIDAHO_BUL926', verification_status: 'unverified' }]);
  });

  it('dose ceilings in kg of nutrient per dunum: Tomato P2O5 16.81, K2O 22.42; Olives N 4.48-11.21, K2O 11.21-16.81; no olive phosphorus', async () => {
    const r = await db.query<{ crop_name: string; nutrient: string; min: string | null; max: string; source_id: string; basis_en: string; basis_ar: string }>(
      `select c.crop_name, r.nutrient, r.min_kg_per_dunum as min, r.max_kg_per_dunum as max, r.source_id, r.basis_en, r.basis_ar
         from public.crop_nutrient_rates r join public.crops c on c.id = r.crop_id order by c.crop_name, r.nutrient`);
    expect(r.rows.map((x) => `${x.crop_name.slice(0, 6)} ${x.nutrient} ${x.min === null ? '-' : Number(x.min)} ${Number(x.max)} ${x.source_id}`)).toEqual([
      'Olives k 11.21 16.81 CDFA_OLIVE_LEAF', 'Olives n 4.48 11.21 CDFA_OLIVE_LEAF',
      'Tomato k - 22.42 UCIPM_TOMATO_SOIL', 'Tomato p - 16.81 UCIPM_TOMATO_SOIL',
    ]);
    for (const x of r.rows) { expect(x.basis_en.length).toBeGreaterThan(40); expect(x.basis_ar.length).toBeGreaterThan(20); }
    // 150 lb/acre x 0.45359237 kg/lb / 4.0468564224 dunum/acre
    expect(Number(r.rows.find((x) => x.crop_name === 'Tomato' && x.nutrient === 'p')!.max)).toBeCloseTo((150 * 0.45359237) / 4.0468564224, 2);
  });

  it('soil notes: urea and ammonium sulphate = caution on Sand / Loamy sand, better on silty and clay soils, nothing on Loam / Sandy loam; potassium sulphate better on sandy soils; every note has a source', async () => {
    const r = await db.query<{ fertilizer: string; soil: string | null; condition: string | null; rating: string; source_id: string; note_en: string; note_ar: string }>(
      `select f.name as fertilizer, s.soil_name as soil, n.condition, n.rating, n.source_id, n.note_en, n.note_ar
         from public.fertilizer_soil_notes n join public.fertilizers f on f.id = n.fertilizer_id left join public.soil_types s on s.id = n.soil_type_id`);
    const soils = (fert: string, rating: string) => r.rows.filter((x) => x.fertilizer === fert && x.soil && x.rating === rating).map((x) => x.soil!).sort();
    for (const fert of ['Urea', 'Ammonium sulphate']) {
      expect(soils(fert, 'caution')).toEqual(['Loamy sand', 'Sand']);
      expect(soils(fert, 'better')).toEqual(['Clay', 'Silt', 'Silt clay loam', 'Silt loam', 'Silty clay']);
    }
    expect(soils('Potassium sulphate (SOP)', 'better')).toEqual(['Loamy sand', 'Sand', 'Sandy loam']);
    for (const fert of ['Urea', 'Ammonium sulphate', 'Potassium sulphate (SOP)']) {
      const names = r.rows.filter((x) => x.fertilizer === fert && x.soil).map((x) => x.soil);
      expect(names).not.toContain('Loam');
    }
    expect(r.rows.some((x) => x.fertilizer === 'Urea' && x.soil === 'Sandy loam')).toBe(false); // not classified by the Idaho bulletin
    expect(r.rows.filter((x) => ['Diammonium phosphate (DAP)', 'Triple superphosphate (TSP)', 'Calcium ammonium nitrate (CAN)'].includes(x.fertilizer))).toHaveLength(0); // no source: no note
    expect(r.rows.filter((x) => x.condition).map((x) => x.fertilizer).sort()).toEqual(['Ammonium sulphate', 'Potassium sulphate (SOP)', 'Urea']);
    for (const x of r.rows) { expect(['UIDAHO_BUL926', 'CDFA_OLIVE_LEAF']).toContain(x.source_id); expect(x.note_en.length).toBeGreaterThan(30); expect(x.note_ar.length).toBeGreaterThan(20); }
    expect(r.rows).toHaveLength(2 * (2 + 5 + 1) + 3 + 1);
  });

  it('fertilization reference: running it again changes nothing and never overwrites a value the owner edited', async () => {
    await db.exec(`update public.fertilizers set n_pct = 45 where name = 'Urea'`);
    await db.exec(`update public.crop_nutrient_sufficiency set low_below = 20 where nutrient = 'p' and crop_id = (select id from public.crops where crop_name = 'Tomato')`);
    await db.exec(read('20261023110000_fertilization_reference.sql'));
    await db.exec(read('20261023120000_fertilization_doses_soil_notes.sql'));
    expect((await db.query<{ n: number }>('select count(*)::int as n from public.fertilizer_soil_notes')).rows[0].n).toBe(20);
    expect((await db.query<{ n: number }>('select count(*)::int as n from public.crop_nutrient_rates')).rows[0].n).toBe(4);
    expect((await db.query<{ n: number }>('select count(*)::int as n from public.alert_thresholds')).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>('select count(*)::int as n from public.fertilizers')).rows[0].n).toBe(10);
    expect((await db.query<{ n: number }>('select count(*)::int as n from public.crop_nutrient_sufficiency')).rows[0].n).toBe(5);
    expect(Number((await db.query<{ n_pct: string }>(`select n_pct from public.fertilizers where name = 'Urea'`)).rows[0].n_pct)).toBe(45);
    expect(Number((await db.query<{ low_below: string }>(`select s.low_below from public.crop_nutrient_sufficiency s join public.crops c on c.id = s.crop_id where c.crop_name = 'Tomato' and s.nutrient = 'p'`)).rows[0].low_below)).toBe(20);
    await db.exec(`update public.fertilizers set n_pct = 46 where name = 'Urea'`);
    await db.exec(`update public.crop_nutrient_sufficiency set low_below = 15 where nutrient = 'p' and crop_id = (select id from public.crops where crop_name = 'Tomato')`);
  });

  it('fertilization decision with the stored rows: Olive leaf K 0.3 % -> potassium sulphate; Tomato soil P 10 -> a 46 % phosphate; Tomato K 200 -> nothing needed', async () => {
    const load = async (cropLike: string) => {
      const ref = await db.query<{ nutrient: 'n' | 'p' | 'k'; unit: string; low_below: string; source_id: string }>(
        `select s.nutrient, s.unit, s.low_below, s.source_id from public.crop_nutrient_sufficiency s join public.crops c on c.id = s.crop_id where c.crop_name like $1`, [cropLike]);
      return ref.rows.map((r) => ({ nutrient: r.nutrient, unit: r.unit, lowBelow: Number(r.low_below), sourceId: r.source_id }));
    };
    const fert = (await db.query<{ name: string; n_pct: string | null; p2o5_pct: string | null; k2o_pct: string | null; source_id: string }>(
      `select name, n_pct, p2o5_pct, k2o_pct, source_id from public.fertilizers order by name`)).rows
      .map((f) => ({ name: f.name, nPct: f.n_pct === null ? null : Number(f.n_pct), p2o5Pct: f.p2o5_pct === null ? null : Number(f.p2o5_pct), k2oPct: f.k2o_pct === null ? null : Number(f.k2o_pct), sourceId: f.source_id }));
    const { decideFertilization } = await import('../src/engine/fertilization');

    const olive = decideFertilization({ n: 1.7, p: 0.2, k: 0.3 }, await load('Olives%'), fert);
    expect(olive.status).toBe('recommend_fertilization');
    if (olive.status === 'recommend_fertilization') {
      expect(olive.needed.map((x) => x.nutrient)).toEqual(['k']);
      expect(olive.fertilizer?.name).toBe('Potassium sulphate (SOP)');
      expect(olive.fertilizer?.sourceId).toBe('FAO_FERT_SPECS');
    }
    const tomatoP = decideFertilization({ n: null, p: 10, k: null }, await load('Tomato'), fert);
    expect(tomatoP.status).toBe('recommend_fertilization');
    if (tomatoP.status === 'recommend_fertilization') {
      expect(tomatoP.fertilizer?.contentPct).toBe(46);
      expect(tomatoP.fertilizer?.name).toBe('Diammonium phosphate (DAP)'); // same 46 % as TSP: the engine lists by name, so the tie is always settled the same way
    }
    expect(decideFertilization({ n: null, p: null, k: 200 }, await load('Tomato'), fert).status).toBe('no_fertilization_needed');
    // Tomato has no soil N limit: a measured N alone cannot be judged
    expect(decideFertilization({ n: 20, p: null, k: null }, await load('Tomato'), fert)).toMatchObject({ status: 'insufficient_data', reason: 'reference_missing' });
  });

  it('profiles: sign-up creates a profile with the trimmed name (and an empty one without a name)', async () => {
    const r = await db.query<{ id: string; display_name: string | null }>('select id, display_name from public.profiles order by display_name nulls last');
    expect(r.rows.find((x) => x.id === A)?.display_name).toBe('Nada Test');
    expect(r.rows.find((x) => x.id === B)?.display_name).toBeNull();
  });
});

describe('row level security: every owner sees only their own data', () => {
  it('fields-related reads', async () => {
    await db.query(`insert into public.decisions (field_id, irrigation_status) values ($1,'do_not_irrigate'), ($2,'recommend_irrigation')`, [fieldA, fieldB]);
    await db.query(`insert into public.alerts (field_id, kind, code, severity, title_en, title_ar, message_en, message_ar) values ($1,'engine','x','info','t','t','m','m'), ($2,'engine','y','info','t','t','m','m')`, [fieldA, fieldB]);
    await db.query(`insert into public.sensor_readings (sensor_point_id, measured_at, moisture) select id, now(), 30 from public.sensor_points`);
    for (const table of ['sensor_points', 'sensor_readings', 'decisions', 'alerts']) {
      const rows = (await as(A, () => db.query(`select * from public.${table}`))) as { rows: unknown[] };
      expect(rows.rows, table).toHaveLength(1);
    }
  });
  it('a signed-out visitor sees nothing', async () => {
    await db.exec('reset role; set role anon;');
    await expect(db.query('select * from public.alerts')).rejects.toThrow();
    await db.exec('reset role;');
  });
  it('the browser cannot write decisions, alerts, readings or forecasts', async () => {
    for (const sql of [
      `insert into public.alerts (field_id, kind, code, severity, title_en, title_ar, message_en, message_ar) values ('${fieldA}','engine','z','info','t','t','m','m')`,
      `insert into public.sensor_readings (sensor_point_id, measured_at, moisture) select id, now(), 1 from public.sensor_points limit 1`,
      `insert into public.decisions (field_id) values ('${fieldA}')`,
    ]) {
      await db.exec(`set role authenticated; set request.jwt.claim.sub = '${A}';`);
      await expect(db.exec(sql), sql).rejects.toThrow(/row-level security/);
      await db.exec('reset role;');
    }
  });
  it('an owner can add a sensor to their own environment but not to someone else\'s', async () => {
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${A}';`);
    await db.query(`insert into public.sensor_points (field_id, point_name) values ($1, 'left')`, [fieldA]);
    await expect(db.query(`insert into public.sensor_points (field_id, point_name) values ($1, 'hack')`, [fieldB])).rejects.toThrow(/row-level security/);
    await db.exec('reset role;');
  });
  it('sensor names are unique inside an environment', async () => {
    await expect(db.query(`insert into public.sensor_points (field_id, point_name) values ($1, 'LEFT')`, [fieldA])).rejects.toThrow(/duplicate|unique/);
  });
  it('reference data is readable by signed-in users', async () => {
    const r = (await as(A, () => db.query('select count(*)::int as n from public.crop_water_params'))) as { rows: { n: number }[] };
    expect(r.rows[0].n).toBe(104);
  });
  it('profiles are private to their owner', async () => {
    const r = (await as(A, () => db.query('select id from public.profiles'))) as { rows: { id: string }[] };
    expect(r.rows.map((x) => x.id)).toEqual([A]);
  });
});

describe('ML plug-in and RAG tables', () => {
  it('a forecast needs a registered model, and its moisture must be 0-100', async () => {
    await expect(db.query(`insert into public.moisture_forecasts (field_id, target_time, predicted_moisture_pct, model_name, model_version) values ($1, now(), 20, 'nope', 'v0')`, [fieldA])).rejects.toThrow();
    await db.query(`insert into public.ml_model_registry (model_name, model_version, active) values ('moisture_forecast','v1', false)`);
    await expect(db.query(`insert into public.moisture_forecasts (field_id, target_time, predicted_moisture_pct, model_name, model_version) values ($1, now(), 140, 'moisture_forecast', 'v1')`, [fieldA])).rejects.toThrow();
    await db.query(`insert into public.moisture_forecasts (field_id, target_time, predicted_moisture_pct, model_name, model_version) values ($1, now(), 20, 'moisture_forecast', 'v1')`, [fieldA]);
  });
  it('a threshold or fertilizer row without a source is rejected (every number needs a source)', async () => {
    await expect(db.query(`insert into public.alert_thresholds (code, value, unit, source_id) values ('x', 1, 'c', null)`)).rejects.toThrow();
    await expect(db.query(`insert into public.fertilizers (name, n_pct, source_id) values ('Urea', 46, 'NO_SUCH_SOURCE')`)).rejects.toThrow();
  });
  it('match_knowledge returns the closest chunk first', async () => {
    const vec = (i: number) => `[${Array.from({ length: 1536 }, (_, k) => (k === i ? 1 : 0)).join(',')}]`;
    await db.query(`insert into public.knowledge_chunks (title, content, embedding) values ('near', 'about water balance', $1), ('far', 'about something else', $2)`, [vec(0), vec(1)]);
    const r = await db.query<{ title: string; similarity: number }>(`select title, similarity from public.match_knowledge($1::extensions.vector, 2, 0.0)`, [vec(0)]);
    expect(r.rows[0].title).toBe('near');
    expect(r.rows[0].similarity).toBeGreaterThan(0.99);
  });
});

describe('measured N, P, K: methods, limits per method, and who can enter what', () => {
  const asA = (fn: () => Promise<unknown>) => as(A, fn);
  const lab = (field: string, extra = '') =>
    `insert into public.nutrient_measurements (field_id, nutrient, value, unit, method_code, source_kind, measured_at${extra ? ', ' + extra.split('=')[0] : ''}) values ('${field}', 'p', 10, 'ppm (mg/kg)', 'soil_olsen_p', 'lab', now()${extra ? ', ' + extra.split('=')[1] : ''})`;

  it('every stored limit has a method and every method has a label', async () => {
    const r = await db.query<{ crop: string; nutrient: string; method_code: string; label_en: string | null }>(
      `select c.crop_name as crop, s.nutrient, s.method_code, m.label_en
         from public.crop_nutrient_sufficiency s join public.crops c on c.id = s.crop_id left join public.nutrient_methods m on m.code = s.method_code order by c.crop_name, s.nutrient`);
    expect(r.rows.map((x) => `${x.crop.slice(0, 6)} ${x.nutrient} ${x.method_code}`)).toEqual([
      'Olives k leaf_july', 'Olives n leaf_july', 'Olives p leaf_july',
      'Tomato k soil_nh4oac_k', 'Tomato p soil_olsen_p',
    ]);
    expect(r.rows.every((x) => x.label_en)).toBe(true);
  });

  it('a crop can have limits for several methods of the same nutrient, but only one per method', async () => {
    await db.exec(`insert into public.crop_nutrient_sufficiency (crop_id, nutrient, unit, low_below, method, source_id, method_code)
                   select crop_id, 'p', 'mg/kg', 20, 'another method', source_id, 'sensor_x' from public.crop_nutrient_sufficiency where method_code = 'soil_olsen_p'`);
    await expect(db.exec(`insert into public.crop_nutrient_sufficiency (crop_id, nutrient, unit, low_below, method, source_id, method_code)
                          select crop_id, 'p', 'mg/kg', 25, 'again', source_id, 'sensor_x' from public.crop_nutrient_sufficiency where method_code = 'sensor_x'`)).rejects.toThrow(/duplicate|unique/);
    await db.exec(`delete from public.crop_nutrient_sufficiency where method_code = 'sensor_x'`);
  });

  it('an owner enters a lab result for her own field; the row records who entered it', async () => {
    await asA(() => db.exec(lab(fieldA)));
    const r = await db.query<{ source_kind: string; entered_by: string }>(`select source_kind, entered_by from public.nutrient_measurements where field_id = '${fieldA}'`);
    expect(r.rows).toEqual([{ source_kind: 'lab', entered_by: A }]);
  });

  it('she cannot enter one for someone else\'s field, as a sensor value, for another user, dated far in the future, or with an impossible value', async () => {
    await asA(async () => {
      await expect(db.exec(lab(fieldB))).rejects.toThrow(/row-level security/);
      await expect(db.exec(lab(fieldA).replace("'lab'", "'sensor'"))).rejects.toThrow(/row-level security/);
      await expect(db.exec(lab(fieldA, `entered_by=${"'" + B + "'"}`))).rejects.toThrow(/row-level security/);
      await expect(db.exec(lab(fieldA).replace('now())', "now() + interval '3 days')"))).rejects.toThrow(/row-level security/);
    });
    for (const [what, sql] of [
      ['negative', lab(fieldA).replace(', 10,', ', -1,')],
      ['NaN', lab(fieldA).replace(', 10,', ", 'NaN',")],
      ['empty unit', lab(fieldA).replace("'ppm (mg/kg)'", "' '")],
      ['unknown nutrient', lab(fieldA).replace("'p', 10", "'z', 10")],
    ] as const) {
      await expect(db.exec(sql), what).rejects.toThrow(/check constraint|violates/);
    }
  });

  it('only the owner reads her measurements; a signed-out visitor reads none', async () => {
    await expect(as(B, () => db.query('select * from public.nutrient_measurements'))).resolves.toMatchObject({ rows: [] });
    const mine = (await as(A, () => db.query('select * from public.nutrient_measurements'))) as { rows: unknown[] };
    expect(mine.rows).toHaveLength(1);
    await db.exec('reset role; set role anon;');
    await expect(db.query('select * from public.nutrient_measurements')).rejects.toThrow();
    await db.exec('reset role;');
  });

  it('she can delete a lab result she entered, but not change it, and never delete what a sensor sent', async () => {
    await db.exec(`insert into public.nutrient_measurements (field_id, nutrient, value, unit, method_code, source_kind) values ('${fieldA}', 'k', 80, 'mg/kg', 'sensor_unspecified', 'sensor')`);
    await asA(async () => {
      await db.exec(`update public.nutrient_measurements set value = 999 where field_id = '${fieldA}'`); // no update policy: changes nothing
      await db.exec(`delete from public.nutrient_measurements where source_kind = 'sensor'`); // not allowed: deletes nothing
    });
    const after = await db.query<{ source_kind: string; value: string }>(`select source_kind, value from public.nutrient_measurements where field_id = '${fieldA}' order by source_kind`);
    expect(after.rows.map((x) => `${x.source_kind} ${Number(x.value)}`)).toEqual(['lab 10', 'sensor 80']);
    await asA(() => db.exec(`delete from public.nutrient_measurements where source_kind = 'lab'`));
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.nutrient_measurements where field_id = '${fieldA}'`)).rows[0].n).toBe(1);
    await db.exec(`delete from public.nutrient_measurements`);
  });

  it('the NPK sensor of a device: unit and method are set on the device, the method code has a safe format', async () => {
    const d = await db.query<{ id: string }>(`insert into public.devices (field_id, device_name) values ('${fieldA}', 'ESP32 test') returning id`);
    await db.exec(`update public.devices set npk_unit = 'mg/kg', npk_method_code = 'sensor_x' where id = '${d.rows[0].id}'`);
    await expect(db.exec(`update public.devices set npk_method_code = 'Not Allowed!' where id = '${d.rows[0].id}'`)).rejects.toThrow(/check constraint|violates/);
    await db.exec(`delete from public.devices where id = '${d.rows[0].id}'`);
  });
});
