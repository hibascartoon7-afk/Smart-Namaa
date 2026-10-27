import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import { buildSql, parseCsv, readStages, MAX_STAGE_DAYS } from '../scripts/lib/growth-stages.mjs';
import { createDb } from './helpers/db';

const TEMPLATE = readFileSync(fileURLToPath(new URL('../data/templates/crop_growth_stages_template.csv', import.meta.url)), 'utf-8');
const HEADER = 'crop_name,initial_days,development_days,mid_days,late_days,source_id,value_basis\n';
// the numbers below are test numbers, only for these tests
const csv = (...lines: string[]) => HEADER + lines.join('\n') + '\n';

describe('parseCsv', () => {
  it('reads quotes, commas inside quotes, doubled quotes, CRLF and a BOM', () => {
    const rows = parseCsv('\uFEFFa,b\r\n"Beans, green","say ""hi"""\r\n');
    expect(rows).toEqual([['a', 'b'], ['Beans, green', 'say "hi"']]);
  });
  it('ignores empty lines', () => {
    expect(parseCsv('a\n\n\nb\n')).toEqual([['a'], ['b']]);
  });
});

describe('readStages', () => {
  it('accepts a filled row and ignores a crop whose four cells are empty', () => {
    const r = readStages(csv('Tomato,10,20,30,40,FAO56_TABLE11,test', 'Cabbage,,,,,FAO56_TABLE11,'));
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ crop_name: 'Tomato', initial_days: 10, development_days: 20, mid_days: 30, late_days: 40, source_id: 'FAO56_TABLE11', value_basis: 'test' }]);
    expect(r.skipped).toEqual(['Cabbage']);
  });
  it('allows 0 days for the initial and the mid-season stage (the engine allows it too)', () => {
    expect(readStages(csv('Tomato,0,20,0,40,FAO56_TABLE11,')).errors).toEqual([]);
  });
  it('rejects the same rules the engine rejects at run time', () => {
    expect(readStages(csv('Tomato,10,0,30,40,FAO56_TABLE11,')).errors[0]).toMatch(/development_days must be more than 0/);
    expect(readStages(csv('Tomato,10,20,30,0,FAO56_TABLE11,')).errors[0]).toMatch(/late_days must be more than 0/);
  });
  it('rejects half-filled rows, decimals, negatives, text and huge numbers', () => {
    expect(readStages(csv('Tomato,10,20,,40,FAO56_TABLE11,')).errors[0]).toMatch(/mid_days is empty/);
    expect(readStages(csv('Tomato,10.5,20,30,40,FAO56_TABLE11,')).errors[0]).toMatch(/whole number/);
    expect(readStages(csv('Tomato,-1,20,30,40,FAO56_TABLE11,')).errors[0]).toMatch(/whole number/);
    expect(readStages(csv('Tomato,ten,20,30,40,FAO56_TABLE11,')).errors[0]).toMatch(/whole number/);
    expect(readStages(csv(`Tomato,10,${MAX_STAGE_DAYS + 1},30,40,FAO56_TABLE11,`)).errors[0]).toMatch(/typo/);
  });
  it('needs a place the numbers come from: a source id, or a written basis (own observation)', () => {
    expect(readStages(csv('Tomato,10,20,30,40,,')).errors[0]).toMatch(/say where the numbers come from/);
    expect(readStages(csv("Tomato,10,20,30,40,x'; drop table crops;--,")).errors[0]).toMatch(/source_id must be an id/);
    const own = readStages(csv('Tomato,10,20,30,40,,observed on my field planting 2026-03-01'));
    expect(own.errors).toEqual([]);
    expect(own.rows[0]).toMatchObject({ source_id: null, value_basis: 'observed on my field planting 2026-03-01' });
  });
  it('rejects a crop that appears twice and a missing column', () => {
    expect(readStages(csv('Tomato,10,20,30,40,S,', 'tomato,10,20,30,40,S,')).errors.join()).toMatch(/twice/);
    expect(readStages('crop_name,initial_days\nTomato,1\n').errors[0]).toMatch(/missing column/);
    expect(readStages('').errors[0]).toMatch(/empty/);
  });
});

describe('the shipped template', () => {
  it('has no invented numbers: every stage cell is empty until the owner fills it', () => {
    const r = readStages(TEMPLATE);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([]);
    expect(r.skipped.length).toBeGreaterThan(50);
  });
  it('lists exactly the crops that have Kc and root-depth values but NO stage lengths yet (the Table 11 migration already fills 13)', async () => {
    const db = await createDb();
    const need = await db.query<{ crop_name: string }>('select crop_name from public.crop_readiness where has_kc and has_water_params and not has_stage_lengths order by crop_name');
    expect(readStages(TEMPLATE).skipped.slice().sort()).toEqual(need.rows.map((x) => x.crop_name).sort());
    const seeded = await db.query<{ crop_name: string }>('select crop_name from public.crop_readiness where has_stage_lengths');
    expect(seeded.rows.length).toBeGreaterThan(0);
    for (const c of seeded.rows) expect(readStages(TEMPLATE).skipped).not.toContain(c.crop_name);
  }, 60_000);
});

describe('buildSql', () => {
  it('refuses to build with no rows', () => {
    expect(() => buildSql([])).toThrow(/nothing to store/);
  });
  it('escapes quotes so a note cannot break the SQL', () => {
    const sql = buildSql([{ crop_name: "O'Neil", initial_days: 1, development_days: 2, mid_days: 3, late_days: 4, source_id: 'S', value_basis: "it's a note" }]);
    expect(sql).toContain("'O''Neil'");
    expect(sql).toContain("'it''s a note'");
  });
  it('writes null for an own observation without a source id', () => {
    const sql = buildSql([{ crop_name: 'X', initial_days: 1, development_days: 2, mid_days: 3, late_days: 4, source_id: null, value_basis: 'observed' }]);
    expect(sql).toContain("4, null, 'observed')");
  });
});

describe('the SQL on a real Postgres (PGlite) with all migrations', () => {
  let db: PGlite;
  let A = '';
  let B = '';
  const stageRows = (a: string, b: string) => readStages(csv(`"${a}",30,40,45,30,FAO56_TABLE11,test numbers`, `"${b}",20,30,40,15,,observed on my field`)).rows;
  const ready = async () => (await db.query<{ crop_name: string; has_stage_lengths: boolean }>(
    'select crop_name, has_stage_lengths from public.crop_readiness where crop_name = any($1) order by crop_name', [[A, B]],
  )).rows;
  const count = async (crop: string) => (await db.query<{ n: number }>(
    'select count(*)::int as n from public.crop_growth_stages g join public.crops c on c.id = g.crop_id where c.crop_name = $1', [crop])).rows[0].n;

  beforeAll(async () => {
    db = await createDb();
    [A, B] = readStages(TEMPLATE).skipped;
  }, 60_000);

  it('the Table 11 migration provides the source (unverified) and the columns the importer fills', async () => {
    const s = await db.query<{ v: string }>("select verification_status as v from public.sources where id = 'FAO56_TABLE11'");
    expect(s.rows[0].v).toBe('unverified');
    const c = await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'crop_growth_stages' and column_name in ('source_id','value_basis')");
    expect(c.rows).toHaveLength(2);
  });

  it('stores the rows and the crops become ready for the engine', async () => {
    expect((await ready()).every((r) => !r.has_stage_lengths)).toBe(true);
    await db.exec(buildSql(stageRows(A, B)));
    expect((await ready()).every((r) => r.has_stage_lengths)).toBe(true);
    const row = await db.query<{ source_id: string | null; value_basis: string | null; initial_days: number }>(
      'select g.source_id, g.value_basis, g.initial_days from public.crop_growth_stages g join public.crops c on c.id = g.crop_id where c.crop_name = $1', [B]);
    expect(row.rows).toEqual([{ source_id: null, value_basis: 'observed on my field', initial_days: 20 }]);
  });

  it('can be run twice without adding the same row again', async () => {
    await db.exec(buildSql(stageRows(A, B)));
    expect(await count(A)).toBe(1);
    expect(await count(B)).toBe(1);
  });

  it('a changed number is added as a newer row (the engine reads the newest)', async () => {
    await db.exec(buildSql([{ ...stageRows(A, B)[0], initial_days: 35 }]));
    expect(await count(A)).toBe(2);
    const newest = await db.query<{ initial_days: number }>(
      'select g.initial_days from public.crop_growth_stages g join public.crops c on c.id = g.crop_id where c.crop_name = $1 order by g.created_at desc limit 1', [A]);
    expect(newest.rows).toEqual([{ initial_days: 35 }]);
  });

  it('adds a row for a crop the Table 11 migration already filled, without touching the old one', async () => {
    const before = await count('Tomato');
    await db.exec(buildSql(readStages(csv('Tomato,11,22,33,44,,observed on my field')).rows));
    expect(await count('Tomato')).toBe(before + 1);
  });

  it('stops and stores nothing when a crop name or a source id is unknown', async () => {
    const total = async () => (await db.query<{ n: number }>('select count(*)::int as n from public.crop_growth_stages')).rows[0].n;
    const before = await total();
    const good = stageRows(A, B);
    await expect(db.exec(buildSql([{ ...good[0], crop_name: 'Tomatoe' }, { ...good[1], initial_days: 99 }]))).rejects.toThrow(/Unknown crop name/);
    await db.exec('rollback;').catch(() => undefined);
    await expect(db.exec(buildSql([{ ...good[1], initial_days: 98, source_id: 'NO_SUCH_SOURCE' }]))).rejects.toThrow(/Unknown source id/);
    await db.exec('rollback;').catch(() => undefined);
    expect(await total()).toBe(before);
  });
});

describe('command line (npm run import-growth-stages)', () => {
  const script = fileURLToPath(new URL('../scripts/import-growth-stages.mjs', import.meta.url));
  const run = (file: string, ...extra: string[]) => spawnSync(process.execPath, [script, file, ...extra], { encoding: 'utf-8' });
  const write = (text: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'namaa-stages-'));
    const f = join(dir, 'stages.csv');
    writeFileSync(f, text);
    return { dir, f };
  };

  it('reads the file given as an argument and prints the SQL', () => {
    const { dir, f } = write(csv('Tomato,10,20,30,40,FAO56_TABLE11,test only', 'Cabbage,,,,,FAO56_TABLE11,'));
    const r = run(f);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("('Tomato', 10, 20, 30, 40, 'FAO56_TABLE11', 'test only')");
    expect(r.stdout).not.toContain('Cabbage');
    rmSync(dir, { recursive: true });
  });
  it('writes the SQL to a file with --out', () => {
    const { dir, f } = write(csv('Tomato,10,20,30,40,FAO56_TABLE11,'));
    const out = join(dir, 'out.sql');
    expect(run(f, '--out', out).status).toBe(0);
    expect(readFileSync(out, 'utf-8')).toContain('create temporary table _new_stages');
    rmSync(dir, { recursive: true });
  });
  it('exits with an error and prints nothing to store when a row is wrong', () => {
    const { dir, f } = write(csv('Tomato,10,0,30,40,,'));
    const r = run(f);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/ERROR line 2 \(Tomato\)/);
    rmSync(dir, { recursive: true });
  });
});

describe('docs/ADDING_A_CROP.md: the SQL examples work', () => {
  const doc = readFileSync(fileURLToPath(new URL('../docs/ADDING_A_CROP.md', import.meta.url)), 'utf-8');
  const blocks = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);

  it('has the SQL examples (stage row, own source, nutrient limit)', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(3);
  });
  it('the "own source" example adds a source that a CSV row can then use', async () => {
    const own = blocks.find((b) => /OWN_/.test(b));
    expect(own).toBeTruthy();
    const db = await createDb();
    await db.exec(own as string);
    const id = /'(OWN_[A-Z0-9_]+)'/.exec(own as string)![1];
    const crop = readStages(TEMPLATE).skipped[0];
    await db.exec(buildSql(readStages(csv(`"${crop}",30,40,45,30,${id},own test numbers`)).rows));
    const r = await db.query<{ source_id: string }>('select g.source_id from public.crop_growth_stages g join public.crops c on c.id = g.crop_id where c.crop_name = $1', [crop]);
    expect(r.rows).toEqual([{ source_id: id }]);
  }, 60_000);
});
