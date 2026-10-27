// Pure mapping of a crop_coefficients row (FAO-56 Table 12) to the engine's KcRow. No network, no Supabase import.
import type { KcRow, Range } from './kc';

/** One row of public.crop_coefficients (FAO-56 Table 12) as returned by PostgREST. source_id is TEXT (sources.id). */
export interface CropDbRow {
  row_id: number;
  source_id: string;
  section: string;
  crop: string;
  variant: string | null;
  row_type: 'crop' | 'group_row';
  kc_ini_min: number | null;
  kc_ini_max: number | null;
  kc_ini_footnote: string | null;
  kc_mid_min: number | null;
  kc_mid_max: number | null;
  kc_mid_footnote: string | null;
  kc_end_min: number | null;
  kc_end_max: number | null;
  kc_end_footnote: string | null;
  crop_name_footnotes: string | null;
}

const toRange = (min: number | null, max: number | null): Range | null =>
  min === null || max === null ? null : { min, max };

const toIds = (s: string | null): string[] =>
  s ? s.split(',').map((x) => x.trim()).filter(Boolean) : [];

export function dbRowToKcRow(r: CropDbRow): KcRow {
  return {
    rowId: r.row_id,
    sourceId: r.source_id,
    section: r.section,
    crop: r.crop,
    variant: r.variant,
    rowType: r.row_type,
    kc: {
      ini: toRange(r.kc_ini_min, r.kc_ini_max),
      mid: toRange(r.kc_mid_min, r.kc_mid_max),
      end: toRange(r.kc_end_min, r.kc_end_max),
    },
    footnotes: {
      ini: toIds(r.kc_ini_footnote),
      mid: toIds(r.kc_mid_footnote),
      end: toIds(r.kc_end_footnote),
      cropName: toIds(r.crop_name_footnotes),
    },
  };
}

export const KC_COLUMNS =
  'row_id, source_id, section, crop, variant, row_type, kc_ini_min, kc_ini_max, kc_ini_footnote, ' +
  'kc_mid_min, kc_mid_max, kc_mid_footnote, kc_end_min, kc_end_max, kc_end_footnote, crop_name_footnotes';
