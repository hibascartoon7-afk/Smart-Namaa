// Builds ChatFacts from what the engine already stored (latest decision, its alerts, savings). Nothing is recomputed here.

import { toNum, type Db } from './db';
import type { ChatFacts } from './chat';

const DAY = 86_400_000;

interface StoredPoint {
  name?: string;
  moisture_pct?: number | null;
  measured_at?: string | null;
  status?: string;
  reason?: string | null;
  net_depth_mm?: number | null;
  text_en?: string | null;
  text_ar?: string | null;
}

export async function loadChatFacts(db: Db, fieldId: string, nowMs: number): Promise<ChatFacts | null> {
  const [field] = await db.select<{ name: string; timezone: string | null; area_m2: unknown; planting_date: string | null; crop_id: string | null; soil_type_id: string | null }>('fields', {
    columns: 'name,timezone,area_m2,planting_date,crop_id,soil_type_id', eq: { id: fieldId }, limit: 1,
  });
  if (!field) return null;

  const crop = field.crop_id ? (await db.select<{ crop_name: string }>('crops', { columns: 'crop_name', eq: { id: field.crop_id }, limit: 1 }))[0] : undefined;
  const soil = field.soil_type_id ? (await db.select<{ soil_name: string }>('soil_types', { columns: 'soil_name', eq: { id: field.soil_type_id }, limit: 1 }))[0] : undefined;

  const [d] = await db.select<{
    id: string; generated_at: string; irrigation_decision: Record<string, unknown> | null; fertilization_decision: Record<string, unknown> | null;
    growth_stage: string | null; etc_mm: unknown; moisture_pct: unknown; details: Record<string, unknown> | null;
  }>('decisions', { columns: 'id,generated_at,irrigation_decision,fertilization_decision,growth_stage,etc_mm,moisture_pct,details', eq: { field_id: fieldId }, order: { column: 'generated_at', ascending: false }, limit: 1 });

  const irrigation = (d?.irrigation_decision ?? null) as { status?: string; summary_en?: string; summary_ar?: string; points?: StoredPoint[] } | null;
  const fert = (d?.fertilization_decision ?? null) as { status?: string; text_en?: string; text_ar?: string } | null;

  const alerts = d
    ? await db.select<{ kind: string; code: string; severity: string; message_en: string; message_ar: string }>('alerts', { columns: 'kind,code,severity,message_en,message_ar', eq: { decision_id: d.id }, order: { column: 'created_at', ascending: true } })
    : [];

  const sinceDay = new Date(nowMs - 30 * DAY).toISOString().slice(0, 10);
  const savingRows = await db.select<{ local_day: string; saved_mm: unknown; saved_m3: unknown }>('water_savings', {
    columns: 'local_day,saved_mm,saved_m3', eq: { field_id: fieldId }, gte: { local_day: sinceDay }, order: { column: 'local_day', ascending: false }, limit: 40,
  });
  const localDay = (d?.details as { local_day?: string } | null)?.local_day ?? null;
  const today = localDay ? savingRows.find((r) => String(r.local_day).slice(0, 10) === localDay) : undefined;
  const sumMm = savingRows.reduce((s, r) => s + (toNum(r.saved_mm) ?? 0), 0);
  const m3s = savingRows.map((r) => toNum(r.saved_m3));

  const points = irrigation?.points ?? [];
  const sensors = points.map((p) => ({
    name: p.name ?? '?',
    moisture_pct: p.moisture_pct ?? null,
    measured_at: p.measured_at ?? null,
    decision: p.status ?? 'unknown',
    reason: p.reason ?? null,
    net_irrigation_mm: p.net_depth_mm ?? null,
    text_en: p.text_en ?? null,
    text_ar: p.text_ar ?? null,
  }));

  // what is known to be missing today (fixed list: no NPK sensor exists yet; plus sensors with no usable reading)
  const notMeasured = ['nitrogen (N)', 'phosphorus (P)', 'potassium (K)', ...sensors.filter((s) => s.moisture_pct === null).map((s) => `soil moisture at sensor ${s.name}`)];

  return {
    field: { name: field.name, crop: crop?.crop_name ?? null, soil: soil?.soil_name ?? null, planting_date: field.planting_date ? String(field.planting_date).slice(0, 10) : null, area_m2: toNum(field.area_m2), timezone: field.timezone },
    decision: d
      ? {
          generated_at: new Date(d.generated_at).toISOString(),
          irrigation_status: irrigation?.status ?? null,
          irrigation_summary_en: irrigation?.summary_en ?? null,
          irrigation_summary_ar: irrigation?.summary_ar ?? null,
          fertilization_status: fert?.status ?? null,
          fertilization_text_en: fert?.text_en ?? null,
          fertilization_text_ar: fert?.text_ar ?? null,
          growth_stage: d.growth_stage,
          etc_mm_per_day: toNum(d.etc_mm),
          moisture_pct_mean: toNum(d.moisture_pct),
        }
      : null,
    sensors,
    alerts,
    savings: {
      today_mm: today ? toNum(today.saved_mm) : null,
      today_m3: today ? toNum(today.saved_m3) : null,
      last_30_days_mm: sumMm,
      last_30_days_m3: m3s.length && m3s.every((x) => x !== null) ? (m3s as number[]).reduce((s, v) => s + v, 0) : null,
      days_counted: savingRows.length,
    },
    not_measured: notMeasured,
    forecast_alerts_active: alerts.some((a) => a.kind === 'forecast'),
  };
}
