export interface FieldMeter {
  id: string;
  label: string;
  x: number;
  y: number;
  elevation: "high" | "mid" | "low";
  slope: number;
  aspect: string;
  crop: string;
}

export interface MeterReading {
  meter_id: string;
  n: number;
  p: number;
  k: number;
  ec: number;
  temp: number;
  ph: number;
  vwc: number;
  ts: string;
}

export interface WeatherForecast {
  location: string;
  now_temp: number;
  now_humidity: number;
  now_wind: number;
  now_condition: string;
  now_icon: string;
  rain_probability_3h: number;
  rain_start_minutes: number;
  expected_rainfall_mm: number;
  evapotranspiration: number;
  hourly: { hour: string; temp: number; rain: number }[];
}

export interface Advisory {
  id: string;
  meter_id: string;
  severity: "high" | "warning" | "info";
  title: string;
  body: string;
  action: string;
  eta: string;
  icon: string;
}

export interface Savings {
  fertilizer_saved_kg_ha: number;
  fertilizer_baseline_kg_ha: number;
  water_saved_m3: number;
  water_baseline_m3: number;
  co2e_reduced_kg: number;
  co2e_baseline_kg: number;
  yield_uplift_pct: number;
  cost_saved_usd: number;
}

export interface ValidatedReading extends MeterReading {
  is_stale: boolean;
  age_minutes: number;
  warnings: string[];
}

export interface IrrigationPriorityResult {
  meter_id: string;
  priority_score: number;
  rank: number;
  vwc: number;
  elevation: string;
  slope: number;
  deficit_mm: number;
  recommended_dose_m3: number;
  reason: string;
}

export interface FertilizerPriorityResult {
  meter_id: string;
  nutrient: "N" | "P" | "K";
  urgency: "critical" | "low" | "moderate" | "high";
  value: number;
  threshold: number;
  ec: number;
  reason: string;
  rain_warning: boolean;
}
