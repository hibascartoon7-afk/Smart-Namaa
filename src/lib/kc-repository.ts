// Loads FAO-56 Table 12 rows for a crop from Supabase and maps them to the engine's KcRow type.
// No fallback values: if something is missing, we throw or return null.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { KcRow } from '../engine/kc';
import { dbRowToKcRow, KC_COLUMNS, type CropDbRow } from '../engine/kc-db';

export { dbRowToKcRow, type CropDbRow };

export type SourceStatus = 'verified' | 'secondary' | 'unverified';

export interface LoadedKc {
  row: KcRow;
  groupRow: KcRow | null;
  sourceStatus: SourceStatus | null;
}

/**
 * crops.crop_name -> crops.coefficient_id -> crop_coefficients (FAO-56 Table 12 row)
 * + the group row of the same section + the verification status of the source.
 * Returns null when the crop is unknown or has no coefficient row. Never invents a value.
 */
export async function loadKcForCrop(supabase: SupabaseClient, cropName: string): Promise<LoadedKc | null> {
  const crop = await supabase.from('crops').select('coefficient_id').eq('crop_name', cropName).maybeSingle();
  if (crop.error) throw new Error(`crops lookup failed: ${crop.error.message}`);
  if (!crop.data || crop.data.coefficient_id === null) return null;

  const rowRes = await supabase
    .from('crop_coefficients')
    .select(KC_COLUMNS)
    .eq('id', crop.data.coefficient_id)
    .maybeSingle();
  if (rowRes.error) throw new Error(`crop_coefficients lookup failed: ${rowRes.error.message}`);
  if (!rowRes.data) return null;
  const dbRow = rowRes.data as unknown as CropDbRow;

  const groupRes = await supabase
    .from('crop_coefficients')
    .select(KC_COLUMNS)
    .eq('section', dbRow.section)
    .eq('row_type', 'group_row')
    .maybeSingle();
  if (groupRes.error) throw new Error(`group row lookup failed: ${groupRes.error.message}`);

  const src = await supabase.from('sources').select('verification_status').eq('id', dbRow.source_id).maybeSingle();
  if (src.error) throw new Error(`sources lookup failed: ${src.error.message}`);

  return {
    row: dbRowToKcRow(dbRow),
    groupRow: groupRes.data ? dbRowToKcRow(groupRes.data as unknown as CropDbRow) : null,
    sourceStatus: (src.data?.verification_status as SourceStatus | null | undefined) ?? null,
  };
}
