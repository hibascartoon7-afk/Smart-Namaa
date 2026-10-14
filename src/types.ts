export type Persona = 'ghaith' | 'nada';

export type Elevation = 'high' | 'mid' | 'low';

export interface FieldMeter {
  id: string;
  label: string;
  x: number;
  y: number;
  elevation: Elevation;
  slope: number;
  aspect: string;
  crop: string;
}

export interface MeterReading {
  n: number;
  p: number;
  k: number;
  ec: number;
  temp: number;
  ph: number;
  vwc: number;
  ts: number;
}

export interface WeatherForecast {
  location: string;
  now: { temp: number; humidity: number; wind: number; condition: string; icon: string };
  rainProbability3h: number;
  rainStartMinutes: number;
  expectedRainfallMm: number;
  evapotranspiration: number;
  hourly: { hour: string; temp: number; rain: number }[];
}

export type Severity = 'high' | 'warning' | 'info';

export interface Advisory {
  id: string;
  meterId: string;
  severity: Severity;
  title: string;
  body: string;
  action: string;
  eta: string;
  icon: string;
}

export interface Savings {
  fertilizerSavedKgHa: number;
  fertilizerBaselineKgHa: number;
  waterSavedM3: number;
  waterBaselineM3: number;
  co2eReducedKg: number;
  co2eBaselineKg: number;
  yieldUpliftPct: number;
  costSavedUsd: number;
}

export interface ChatMessage {
  id: string;
  persona: Persona;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
}
