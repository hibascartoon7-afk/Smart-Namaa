import type {
  MeterReading,
  FieldMeter,
  WeatherForecast,
  Advisory,
  Savings,
  Persona,
} from './types';

export const PERSONAS: Record<Persona, { name: string; arabic: string; role: string; accent: string }> = {
  ghaith: { name: 'Ghaith', arabic: 'غيث', role: 'Irrigation & Water Strategist', accent: '#105666' },
  nada: { name: 'Nada', arabic: 'ندى', role: 'Nutrition & Soil Scientist', accent: '#D3968C' },
};

export const FIELD_METERS: FieldMeter[] = [
  { id: 'M1', label: 'Meter 1', x: 22, y: 28, elevation: 'high', slope: 4, aspect: 'SW', crop: 'Tomato' },
  { id: 'M2', label: 'Meter 2', x: 48, y: 18, elevation: 'mid', slope: 2, aspect: 'S', crop: 'Tomato' },
  { id: 'M3', label: 'Meter 3', x: 72, y: 32, elevation: 'low', slope: 1, aspect: 'E', crop: 'Tomato' },
  { id: 'M4', label: 'Meter 4', x: 30, y: 54, elevation: 'mid', slope: 3, aspect: 'SE', crop: 'Pepper' },
  { id: 'M5', label: 'Meter 5', x: 58, y: 62, elevation: 'low', slope: 0, aspect: 'Flat', crop: 'Pepper' },
  { id: 'M6', label: 'Meter 6', x: 80, y: 58, elevation: 'high', slope: 5, aspect: 'W', crop: 'Pepper' },
];

const baseReadings: Record<string, MeterReading> = {
  M1: { n: 42, p: 18, k: 165, ec: 2.1, temp: 22.4, ph: 6.8, vwc: 24, ts: Date.now() - 60000 },
  M2: { n: 58, p: 31, k: 210, ec: 3.4, temp: 23.1, ph: 7.0, vwc: 31, ts: Date.now() - 40000 },
  M3: { n: 22, p: 9, k: 120, ec: 7.2, temp: 24.8, ph: 7.6, vwc: 46, ts: Date.now() - 20000 },
  M4: { n: 51, p: 24, k: 188, ec: 2.8, temp: 22.9, ph: 6.9, vwc: 28, ts: Date.now() - 50000 },
  M5: { n: 64, p: 35, k: 232, ec: 4.1, temp: 23.6, ph: 7.2, vwc: 38, ts: Date.now() - 30000 },
  M6: { n: 38, p: 14, k: 142, ec: 1.9, temp: 21.8, ph: 6.7, vwc: 19, ts: Date.now() - 10000 },
};

export function getReadings(): Record<string, MeterReading> {
  return baseReadings;
}

export const WEATHER: WeatherForecast = {
  location: 'Field Alpha · 24.7136°N, 46.6753°E',
  now: { temp: 31, humidity: 38, wind: 12, condition: 'Clear', icon: 'sun' },
  rainProbability3h: 62,
  rainStartMinutes: 165,
  expectedRainfallMm: 8.4,
  evapotranspiration: 5.2,
  hourly: [
    { hour: '14:00', temp: 31, rain: 5 },
    { hour: '15:00', temp: 32, rain: 15 },
    { hour: '16:00', temp: 30, rain: 45 },
    { hour: '17:00', temp: 28, rain: 78 },
    { hour: '18:00', temp: 26, rain: 62 },
    { hour: '19:00', temp: 25, rain: 30 },
    { hour: '20:00', temp: 24, rain: 12 },
  ],
};

export const ADVISORIES: Advisory[] = [
  {
    id: 'a1',
    meterId: 'M1',
    severity: 'high',
    title: 'Water in 20 minutes',
    body: 'VWC at 24% is below the 28% threshold for this SW-facing slope. Apply 3.2 m³ within 20 min. Do NOT fertilize yet — 2nd-layer moisture is still adequate for nutrient uptake.',
    action: 'Irrigate now',
    eta: '20 min',
    icon: 'droplet',
  },
  {
    id: 'a2',
    meterId: 'M3',
    severity: 'warning',
    title: 'Add Potassium — hold Nitrogen',
    body: 'Potassium is low (120 mg/kg) but Phosphorus is critically depleted (9 mg/kg). Rain is 2h45m away — delay any P-application to prevent runoff to non-absorptive deep layers. Apply KCl only after drainage.',
    action: 'Queue K-only',
    eta: 'After rain',
    icon: 'flask-conical',
  },
  {
    id: 'a3',
    meterId: 'M6',
    severity: 'high',
    title: 'Critical moisture deficit',
    body: 'VWC at 19% on a high-elevation W-facing zone dries fastest. Priority rank #1 for irrigation. Estimated 4.1 m³ needed. Skip fertilizer — EC is already low and uptake will recover with water.',
    action: 'Priority irrigate',
    eta: '15 min',
    icon: 'alert-triangle',
  },
  {
    id: 'a4',
    meterId: 'M5',
    severity: 'info',
    title: 'Saturation watch',
    body: 'Low-elevation flat zone at 38% VWC. No action needed now, but with 8.4 mm rain incoming, expect temporary saturation. Drainage is adequate — monitor only.',
    action: 'Monitor',
    eta: 'Ongoing',
    icon: 'activity',
  },
  {
    id: 'a5',
    meterId: 'M2',
    severity: 'info',
    title: 'Balanced — maintain schedule',
    body: 'All 7 parameters within optimal range for mid-elevation south-facing tomato. Next routine check in 2 hours. EC trending up slightly — watch salinity.',
    action: 'No action',
    eta: '2h check',
    icon: 'check-circle',
  },
];

export const SAVINGS: Savings = {
  fertilizerSavedKgHa: 38.6,
  fertilizerBaselineKgHa: 120.0,
  waterSavedM3: 214,
  waterBaselineM3: 620,
  co2eReducedKg: 412,
  co2eBaselineKg: 980,
  yieldUpliftPct: 14.2,
  costSavedUsd: 1284,
};

export function fieldAverages(readings: Record<string, MeterReading>) {
  const vals = Object.values(readings);
  const n = vals.length;
  return {
    n: vals.reduce((s, r) => s + r.n, 0) / n,
    p: vals.reduce((s, r) => s + r.p, 0) / n,
    k: vals.reduce((s, r) => s + r.k, 0) / n,
    ec: vals.reduce((s, r) => s + r.ec, 0) / n,
    temp: vals.reduce((s, r) => s + r.temp, 0) / n,
    ph: vals.reduce((s, r) => s + r.ph, 0) / n,
    vwc: vals.reduce((s, r) => s + r.vwc, 0) / n,
  };
}

export function statusFor(metric: string, value: number): 'optimal' | 'warning' | 'critical' {
  const ranges: Record<string, [number, number, number]> = {
    n: [30, 60, 80],
    p: [15, 30, 45],
    k: [150, 220, 300],
    ec: [1.5, 3.5, 6],
    temp: [18, 26, 32],
    ph: [6.2, 7.0, 7.8],
    vwc: [26, 38, 50],
  };
  const r = ranges[metric];
  if (!r) return 'optimal';
  if (value < r[0] || value > r[2]) return 'critical';
  if (value < r[1] * 0.85 || value > r[2] * 0.92) return 'warning';
  return 'optimal';
}

export const SUGGESTED_PROMPTS: Record<Persona, string[]> = {
  ghaith: [
    'Which meter needs water most urgently?',
    'How does the incoming rain change my irrigation plan?',
    'If water is limited, what is the priority order?',
    'أي عداد يحتاج الري أولاً؟',
    'كيف يؤثر المطر القادم على خطة الري؟',
  ],
  nada: [
    'Why hold fertilizer on Meter 3?',
    'What is the salinity status across the field?',
    'When should I apply Potassium?',
    'لماذا تأجيل التسميد على العداد ٣؟',
    'ما هي حالة الملوحة في الحقل؟',
  ],
};
