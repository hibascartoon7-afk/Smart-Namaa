// The logic behind the sensor-ingest and device-provision Edge Functions, on top of the small Db interface.
// HTTP-like results ({ status, body }) so the Edge Function only has to forward them.

import type { Db } from './db';
import { bearerToken, generateDeviceToken, hashToken, matchSensors, parseIngestPayload } from './ingest';

export interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

/** What a device may do: send readings for the sensor points of ITS environment, nothing else. */
export async function handleIngest(db: Db, authorization: string | null, body: unknown, nowMs: number): Promise<HttpResult> {
  const token = bearerToken(authorization);
  if (!token) return { status: 401, body: { error: 'missing device token (Authorization: Bearer <token>)' } };

  const hash = await hashToken(token);
  const [tokenRow] = await db.select<{ device_id: string; revoked_at: string | null }>('device_tokens', { columns: 'device_id,revoked_at', eq: { token_hash: hash }, limit: 1 });
  // same answer for "unknown" and "revoked": a caller learns nothing about which tokens exist
  if (!tokenRow || tokenRow.revoked_at) return { status: 401, body: { error: 'invalid device token' } };

  const [device] = await db.select<{ id: string; field_id: string | null }>('devices', { columns: 'id,field_id', eq: { id: tokenRow.device_id }, limit: 1 });
  if (!device || !device.field_id) return { status: 409, body: { error: 'this device is not attached to an environment' } };

  const parsed = parseIngestPayload(body, nowMs);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

  const points = await db.select<{ id: string; point_name: string }>('sensor_points', { columns: 'id,point_name', eq: { field_id: device.field_id } });
  const { matched, unknown } = matchSensors(parsed.readings, points);

  if (matched.length > 0) {
    await db.insert('sensor_readings', matched.map(({ pointId, reading }) => ({
      sensor_point_id: pointId,
      measured_at: parsed.measuredAt,
      moisture: reading.moisture,
      soil_temperature: reading.soil_temperature,
      ec: reading.ec,
      moisture_status: reading.moisture_status,
      soil_temperature_status: reading.soil_temperature_status,
      ec_status: reading.ec_status,
    })));
  }
  // NPK sensor values: one field-level value per nutrient = the mean of the sensor points that sent a usable one. The unit and the method
  // are the ones the OWNER declared on the device; when she did not, they are stored as 'unspecified' / 'sensor_unspecified' and the
  // engine will not judge them (no limit fits). Only read the device's NPK columns when a value was sent, so devices without an NPK
  // sensor never depend on them.
  let nutrientValuesStored = 0;
  const sentNutrients = matched.some(({ reading }) => (['n', 'p', 'k'] as const).some((k) => reading.nutrients[k].status === 'measured'));
  if (sentNutrients) {
    const [cfg] = await db.select<{ npk_unit: string | null; npk_method_code: string | null }>('devices', { columns: 'npk_unit,npk_method_code', eq: { id: device.id }, limit: 1 });
    const rows = (['n', 'p', 'k'] as const).flatMap((nutrient) => {
      const values = matched.map(({ reading }) => reading.nutrients[nutrient]).filter((x) => x.status === 'measured' && x.value !== null).map((x) => x.value as number);
      if (values.length === 0) return [];
      const mean = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000;
      return [{
        field_id: device.field_id, nutrient, value: mean,
        unit: cfg?.npk_unit ?? 'unspecified', method_code: cfg?.npk_method_code ?? 'sensor_unspecified',
        source_kind: 'sensor', measured_at: parsed.measuredAt,
        note: values.length > 1 ? `mean of ${values.length} sensor points` : null,
      }];
    });
    if (rows.length > 0) await db.insert('nutrient_measurements', rows);
    nutrientValuesStored = rows.length;
  }
  await db.update('devices', { last_seen_at: new Date(nowMs).toISOString(), device_status: 'online' }, { id: device.id });

  const suspect = matched.filter(({ reading: r }) => [r.moisture_status, r.soil_temperature_status, r.ec_status].includes('suspect')).map(({ reading }) => reading.sensor);
  const suspectNutrients = matched.filter(({ reading: r }) => (['n', 'p', 'k'] as const).some((k) => r.nutrients[k].status === 'suspect')).map(({ reading }) => reading.sensor);
  return { status: 200, body: { stored: matched.length, unknown_sensors: unknown, suspect_sensors: suspect, suspect_nutrient_sensors: suspectNutrients, nutrient_values_stored: nutrientValuesStored, measured_at: parsed.measuredAt } };
}

/** Creates a device for an environment the CALLER ALREADY PROVED THEY OWN, and returns the token (shown once). */
export async function provisionDevice(db: Db, fieldId: string, deviceName: string): Promise<{ deviceId: string; token: string }> {
  const name = deviceName.replace(/\s+/g, ' ').trim().slice(0, 50) || 'ESP32';
  const [device] = await db.insert<{ id: string }>('devices', [{ field_id: fieldId, device_name: name, device_status: 'offline' }], 'id');
  const token = generateDeviceToken();
  await db.insert('device_tokens', [{ device_id: device.id, token_hash: await hashToken(token) }]);
  return { deviceId: device.id, token };
}

export async function revokeDevice(db: Db, deviceId: string, nowMs: number): Promise<void> {
  await db.update('device_tokens', { revoked_at: new Date(nowMs).toISOString() }, { device_id: deviceId });
  await db.update('devices', { device_status: 'revoked' }, { id: deviceId });
}
