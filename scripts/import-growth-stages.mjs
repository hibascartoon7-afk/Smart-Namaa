// Checks the growth-stage CSV and writes the SQL that stores it (nothing touches the database from here).
//   npm run import-growth-stages                          reads data/templates/crop_growth_stages_template.csv
//   npm run import-growth-stages -- my-crops.csv          reads another file
//   npm run import-growth-stages -- my-crops.csv --out stages.sql   writes the SQL to a file instead of the screen
//   npm run import-growth-stages -- --check               only checks the file (exit code 1 when a row is wrong)
// Then paste the SQL into the Supabase SQL editor. Steps and sources: docs/ADDING_A_CROP.md
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSql, readStages } from './lib/growth-stages.mjs';

const args = process.argv.slice(2);
const check = args.includes('--check');
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args[outAt + 1] : null;
const file = args.find((a, i) => !a.startsWith('--') && !(outAt >= 0 && i === outAt + 1))
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'templates', 'crop_growth_stages_template.csv');

const { rows, skipped, errors } = readStages(readFileSync(file, 'utf-8'));
console.error(`${file}\n  filled: ${rows.length}   left empty (ignored): ${skipped.length}   wrong: ${errors.length}`);
for (const e of errors) console.error(`  ERROR ${e}`);
if (errors.length) process.exit(1);
if (rows.length === 0) {
  console.error('  Nothing to store yet: fill the four stage lengths of at least one crop (see docs/ADDING_A_CROP.md).');
  process.exit(check ? 0 : 1);
}
if (check) process.exit(0);

const sql = buildSql(rows, file);
if (out) {
  writeFileSync(out, sql);
  console.error(`  SQL written to ${out}`);
} else {
  process.stdout.write(sql);
}
