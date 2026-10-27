// Reads data/reference/fao56_table12_kc.csv (the source of truth) so tests run on the real data.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CropDbRow } from '../../src/lib/kc-repository';

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const num = (s: string): number | null => (s === '' ? null : Number(s));
const txt = (s: string): string | null => (s === '' ? null : s);

export function loadTable12(): { csv: Record<string, string>[]; db: CropDbRow[] } {
  const path = fileURLToPath(new URL('../../data/reference/fao56_table12_kc.csv', import.meta.url));
  const [head, ...body] = parseCsv(readFileSync(path, 'utf-8'));
  const csv = body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  const db = csv.map((r) => ({
    row_id: Number(r.row_id),
    source_id: 'test-source',
    section: r.section,
    crop: r.crop,
    variant: txt(r.variant),
    row_type: r.row_type as 'crop' | 'group_row',
    kc_ini_min: num(r.kc_ini_min), kc_ini_max: num(r.kc_ini_max), kc_ini_footnote: txt(r.kc_ini_footnote),
    kc_mid_min: num(r.kc_mid_min), kc_mid_max: num(r.kc_mid_max), kc_mid_footnote: txt(r.kc_mid_footnote),
    kc_end_min: num(r.kc_end_min), kc_end_max: num(r.kc_end_max), kc_end_footnote: txt(r.kc_end_footnote),
    crop_name_footnotes: txt(r.crop_name_footnotes),
  }));
  return { csv, db };
}
