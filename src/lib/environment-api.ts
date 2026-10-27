import { supabase } from '@/lib/supabase';
import type { NewEnvironment } from '@/lib/new-environment';

export interface CreateResult {
  fieldId: string | null;
  error: string | null;
  /** weather could not be fetched right now (the environment itself was created) */
  weatherNote: string | null;
}

/** Creates the field and its sensor points. If the sensor points fail, the field is removed again. */
export async function createEnvironment(userId: string, env: NewEnvironment): Promise<CreateResult> {
  const { data: field, error: fe } = await supabase
    .from('fields')
    .insert({
      owner_user_id: userId,
      name: env.name,
      latitude: env.latitude,
      longitude: env.longitude,
      timezone: env.timezone,
      area_m2: env.areaM2,
      crop_id: env.cropId,
      soil_type_id: env.soilTypeId,
      planting_date: env.plantingDate,
    })
    .select('id')
    .single();
  if (fe || !field) return { fieldId: null, error: fe?.message ?? 'Could not create the environment.', weatherNote: null };

  const { error: pe } = await supabase
    .from('sensor_points')
    .insert(env.sensorNames.map((n) => ({ field_id: field.id, point_name: n })));
  if (pe) {
    await supabase.from('fields').delete().eq('id', field.id);
    return { fieldId: null, error: `Sensors could not be saved: ${pe.message}`, weatherNote: null };
  }

  // Best effort: fetch weather for the new field now (the function checks ownership itself).
  let weatherNote: string | null = null;
  const { error: we } = await supabase.functions.invoke('weather-sync', { body: { field_id: field.id } });
  if (we) weatherNote = 'Weather could not be fetched yet. It will appear after the next sync.';

  return { fieldId: field.id, error: null, weatherNote };
}
