import type { StoredFertilization } from './fertilization-view';
import type { LimitRow, MeasurementRow, MethodRow } from './nutrient-entry';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import type { Reading, SensorPoint, WeatherRow } from '@/lib/field-math';
import type { AlertRow } from '@/lib/alerts';

export interface FieldRow {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  area_m2: number | null;
  planting_date: string | null;
  crop_id: string | null;
  crop_name: string | null;
  soil: { soil_name: string; field_capacity_pct: number | null; wilting_point_pct: number | null } | null;
}

export interface StoredPointDecision {
  point_id: string;
  name: string;
  moisture_pct: number | null;
  measured_at: string | null;
  status: 'recommend_irrigation' | 'do_not_irrigate' | 'insufficient_data';
  reason: string | null;
  missing?: string[];
  net_depth_mm?: number;
  text_en: string;
  text_ar: string;
}

export interface LatestDecision {
  id: string;
  generated_at: string;
  irrigation_status: string | null;
  irrigation_decision: { status?: string; summary_en?: string; summary_ar?: string; points?: StoredPointDecision[] } | null;
  fertilization_decision: StoredFertilization | null;
  etc_mm: number | null;
  moisture_pct: number | null;
  growth_stage: string | null;
  details: { local_day?: string; day_of_season?: number; et0_mm_day?: number; kc?: { min: number; max: number }; upstream?: Record<string, string> } | null;
  explanation: string | null;
}

export interface SavingRow {
  local_day: string;
  saved_mm: number;
  saved_m3: number | null;
}

export interface DeviceRow {
  id: string;
  device_name: string | null;
  device_status: string | null;
  last_seen_at: string | null;
}

interface FieldData {
  signedIn: boolean;
  loading: boolean;
  error: string | null;
  fields: FieldRow[];
  field: FieldRow | null;
  selectField: (id: string) => void;
  points: SensorPoint[];
  readings: Reading[];
  weather: WeatherRow[];
  decision: LatestDecision | null;
  alerts: AlertRow[];
  savings: SavingRow[];
  devices: DeviceRow[];
  /** measured N, P, K (lab results and sensor values), newest first */
  nutrientMeasurements: MeasurementRow[];
  /** the stored limits of the crop of this environment (one per nutrient and method) and the names of the methods */
  nutrientLimits: LimitRow[];
  nutrientMethods: MethodRow[];
  refreshing: boolean;
  refreshError: string | null;
  /** fetch the weather and run the decision engine now, then reload everything */
  refreshDecision: () => Promise<void>;
  reload: () => void;
}

const FieldDataContext = createContext<FieldData | undefined>(undefined);

const HOUR = 3_600_000;
const STALE_DECISION_MS = 15 * 60_000;
const POLL_MS = 60_000;

/** the readable message of a failed Edge Function call */
async function functionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      /* fall through */
    }
  }
  return (error as { message?: string } | null)?.message ?? 'The request failed.';
}

export function FieldDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [points, setPoints] = useState<SensorPoint[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [weather, setWeather] = useState<WeatherRow[]>([]);
  const [decision, setDecision] = useState<LatestDecision | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [savings, setSavings] = useState<SavingRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [nutrientMeasurements, setNutrientMeasurements] = useState<MeasurementRow[]>([]);
  const [nutrientLimits, setNutrientLimits] = useState<LimitRow[]>([]);
  const [nutrientMethods, setNutrientMethods] = useState<MethodRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailLoaded, setDetailLoaded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const autoTried = useRef<Set<string>>(new Set());
  // the detail effect below needs the crop of the selected environment without re-running whenever the list object changes
  const fieldsRef = useRef<FieldRow[]>([]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  fieldsRef.current = fields;

  // 1) the user's environments (RLS: owner only)
  useEffect(() => {
    if (!user) {
      setFields([]);
      setSelectedId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data: f, error: fe } = await supabase
        .from('fields')
        .select('id,name,latitude,longitude,timezone,area_m2,planting_date,crop_id,soil_type_id')
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (fe) {
        setError(fe.message);
        setLoading(false);
        return;
      }
      const rows = f ?? [];
      const cropIds = [...new Set(rows.map((r) => r.crop_id).filter(Boolean))] as string[];
      const soilIds = [...new Set(rows.map((r) => r.soil_type_id).filter(Boolean))] as string[];
      const [crops, soils] = await Promise.all([
        cropIds.length ? supabase.from('crops').select('id,crop_name').in('id', cropIds) : Promise.resolve({ data: [], error: null }),
        soilIds.length
          ? supabase.from('soil_types').select('id,soil_name,field_capacity_pct,wilting_point_pct').in('id', soilIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (cancelled) return;
      const cropName = new Map((crops.data ?? []).map((c) => [c.id, c.crop_name as string]));
      const soilById = new Map((soils.data ?? []).map((s) => [s.id, s]));
      const mapped: FieldRow[] = rows.map((r) => {
        const s = r.soil_type_id ? soilById.get(r.soil_type_id) : undefined;
        return {
          id: r.id,
          name: r.name,
          latitude: r.latitude,
          longitude: r.longitude,
          timezone: r.timezone,
          area_m2: r.area_m2 === null ? null : Number(r.area_m2),
          planting_date: r.planting_date,
          crop_id: r.crop_id ?? null,
          crop_name: r.crop_id ? cropName.get(r.crop_id) ?? null : null,
          soil: s ? { soil_name: s.soil_name, field_capacity_pct: s.field_capacity_pct, wilting_point_pct: s.wilting_point_pct } : null,
        };
      });
      setFields(mapped);
      setSelectedId((cur) => (cur && mapped.some((m) => m.id === cur) ? cur : mapped[0]?.id ?? null));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, tick]);

  // 2) everything about the selected environment
  useEffect(() => {
    if (!selectedId) {
      setPoints([]); setReadings([]); setWeather([]); setDecision(null); setAlerts([]); setSavings([]); setDevices([]); setNutrientMeasurements([]); setNutrientLimits([]); setNutrientMethods([]);
      setDetailLoaded(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const now = Date.now();
      const since = new Date(now - 36 * HOUR).toISOString();
      const until = new Date(now + 60 * HOUR).toISOString();
      const sinceDay = new Date(now - 30 * 24 * HOUR).toISOString().slice(0, 10);

      const [pts, wx, dec, sav, dev] = await Promise.all([
        supabase.from('sensor_points').select('id,point_name,latitude,longitude').eq('field_id', selectedId).order('point_name'),
        supabase
          .from('weather_observations')
          .select('observed_at,air_temperature_c,precipitation_mm,rain_probability_pct,et0_mm')
          .eq('field_id', selectedId).gte('observed_at', since).lte('observed_at', until).order('observed_at', { ascending: true }),
        supabase
          .from('decisions')
          .select('id,generated_at,irrigation_status,irrigation_decision,fertilization_decision,etc_mm,moisture_pct,growth_stage,details')
          .eq('field_id', selectedId).order('generated_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('water_savings').select('local_day,saved_mm,saved_m3').eq('field_id', selectedId).gte('local_day', sinceDay).order('local_day', { ascending: false }),
        supabase.from('devices').select('id,device_name,device_status,last_seen_at').eq('field_id', selectedId).order('created_at', { ascending: true }),
      ]);
      if (cancelled) return;

      const firstError = pts.error ?? wx.error ?? dec.error ?? sav.error ?? dev.error;
      if (firstError) setError(firstError.message);

      const pointRows = (pts.data ?? []) as SensorPoint[];
      setPoints(pointRows);
      setWeather((wx.data ?? []) as WeatherRow[]);
      setSavings((sav.data ?? []).map((r) => ({ local_day: String(r.local_day).slice(0, 10), saved_mm: Number(r.saved_mm), saved_m3: r.saved_m3 === null ? null : Number(r.saved_m3) })));
      setDevices((dev.data ?? []) as DeviceRow[]);

      // measured N, P, K, the stored limits of this crop and the method names (a failure here never hides the rest of the page)
      const cropId = fieldsRef.current.find((f) => f.id === selectedId)?.crop_id ?? null;
      const [nm, nl, mt] = await Promise.all([
        supabase.from('nutrient_measurements').select('id,nutrient,value,unit,method_code,source_kind,measured_at,note').eq('field_id', selectedId).order('measured_at', { ascending: false }).limit(30),
        cropId ? supabase.from('crop_nutrient_sufficiency').select('nutrient,unit,low_below,method_code,source_id').eq('crop_id', cropId) : Promise.resolve({ data: [], error: null }),
        supabase.from('nutrient_methods').select('code,label_en,label_ar'),
      ]);
      if (cancelled) return;
      setNutrientMeasurements((nm.data ?? []) as MeasurementRow[]);
      setNutrientLimits((nl.data ?? []) as LimitRow[]);
      setNutrientMethods((mt.data ?? []) as MethodRow[]);

      if (pointRows.length) {
        const rd = await supabase
          .from('sensor_readings')
          .select('sensor_point_id,measured_at,moisture,soil_temperature,ec,moisture_status,soil_temperature_status,ec_status')
          .in('sensor_point_id', pointRows.map((p) => p.id)).gte('measured_at', since).order('measured_at', { ascending: false }).limit(5000);
        if (cancelled) return;
        if (rd.error) setError(rd.error.message);
        setReadings((rd.data ?? []) as Reading[]);
      } else {
        setReadings([]);
      }

      if (dec.data) {
        const [ex, al] = await Promise.all([
          supabase.from('decision_explanations').select('explanation_text').eq('decision_id', dec.data.id).order('generated_at', { ascending: false }).limit(1).maybeSingle(),
          supabase
            .from('alerts')
            .select('id,sensor_point_id,kind,code,severity,title_en,title_ar,message_en,message_ar,created_at')
            .eq('decision_id', dec.data.id)
            .in('kind', ['engine', 'savings']),
        ]);
        if (cancelled) return;
        setDecision({ ...(dec.data as unknown as Omit<LatestDecision, 'explanation'>), explanation: ex.data?.explanation_text ?? null });
        setAlerts((al.data ?? []) as AlertRow[]);
      } else {
        setDecision(null);
        setAlerts([]);
      }
      setDetailLoaded(selectedId);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, tick]);

  const refreshDecision = useCallback(async () => {
    if (!selectedId) return;
    setRefreshing(true);
    setRefreshError(null);
    // weather first (best effort: the engine says what is missing if it fails), then the decision
    await supabase.functions.invoke('weather-sync', { body: { field_id: selectedId } });
    const res = await supabase.functions.invoke('decision-engine', { body: { field_id: selectedId } });
    if (res.error) setRefreshError(await functionError(res.error));
    setRefreshing(false);
    reload();
  }, [selectedId, reload]);

  // when an environment is opened and its last decision is missing or old, run the engine once
  useEffect(() => {
    if (!selectedId || detailLoaded !== selectedId || autoTried.current.has(selectedId)) return;
    const stale = !decision || Date.now() - Date.parse(decision.generated_at) > STALE_DECISION_MS;
    if (stale) {
      autoTried.current.add(selectedId);
      void refreshDecision();
    }
  }, [selectedId, detailLoaded, decision, refreshDecision]);

  // keep the screen fresh while it is open (readings arrive from the ESP32 all the time)
  useEffect(() => {
    if (!selectedId) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [selectedId, reload]);

  const value = useMemo<FieldData>(
    () => ({
      signedIn: !!user, loading, error, fields,
      field: fields.find((f) => f.id === selectedId) ?? null,
      selectField: setSelectedId,
      points, readings, weather, decision, alerts, savings, devices, nutrientMeasurements, nutrientLimits, nutrientMethods,
      refreshing, refreshError, refreshDecision, reload,
    }),
    [user, loading, error, fields, selectedId, points, readings, weather, decision, alerts, savings, devices, nutrientMeasurements, nutrientLimits, nutrientMethods, refreshing, refreshError, refreshDecision, reload],
  );

  return <FieldDataContext.Provider value={value}>{children}</FieldDataContext.Provider>;
}

export function useFieldData(): FieldData {
  const ctx = useContext(FieldDataContext);
  if (!ctx) throw new Error('useFieldData must be used inside FieldDataProvider');
  return ctx;
}
