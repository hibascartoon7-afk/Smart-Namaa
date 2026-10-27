// Validation for "create environment" (one field = one crop = one ESP32 unit with several sensor points).
// Pure functions: no network, no React. Rule: an empty box is "missing", never 0.

export interface NewEnvironmentForm {
  name: string;
  cropId: string;
  soilTypeId: string;
  plantingDate: string; // YYYY-MM-DD
  latitude: string;
  longitude: string;
  timezone: string;
  areaM2: string; // optional
  sensorNames: string[];
}

export interface NewEnvironment {
  name: string;
  cropId: string;
  soilTypeId: string;
  plantingDate: string;
  latitude: number;
  longitude: number;
  timezone: string;
  areaM2: number | null;
  sensorNames: string[];
}

export type FormErrors = Partial<Record<keyof NewEnvironmentForm, string>>;

export type ValidationResult = { ok: true; value: NewEnvironment } | { ok: false; errors: FormErrors };

export const MAX_SENSORS = 30;
export const MAX_NAME_LENGTH = 50;

/** '' -> null (missing). Anything that is not a plain finite number -> NaN. */
export function parseNumber(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return Number.NaN;
  return Number(t);
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "  Left   side " -> "Left side" */
export function cleanName(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function validateNewEnvironment(form: NewEnvironmentForm, todayLocal: string): ValidationResult {
  const errors: FormErrors = {};

  const name = cleanName(form.name);
  if (!name) errors.name = 'Enter a name for this environment.';
  else if (name.length > MAX_NAME_LENGTH) errors.name = `Use at most ${MAX_NAME_LENGTH} characters.`;

  if (!form.cropId) errors.cropId = 'Choose the crop.';
  if (!form.soilTypeId) errors.soilTypeId = 'Choose the soil type.';

  if (!form.plantingDate) errors.plantingDate = 'Enter the planting date.';
  else if (!isRealDate(form.plantingDate)) errors.plantingDate = 'Not a valid date.';
  else if (form.plantingDate > todayLocal) errors.plantingDate = 'The planting date cannot be in the future.';

  const lat = parseNumber(form.latitude);
  if (lat === null) errors.latitude = 'Enter the latitude (needed for weather).';
  else if (Number.isNaN(lat) || lat < -90 || lat > 90) errors.latitude = 'Latitude must be a number between -90 and 90.';

  const lng = parseNumber(form.longitude);
  if (lng === null) errors.longitude = 'Enter the longitude (needed for weather).';
  else if (Number.isNaN(lng) || lng < -180 || lng > 180) errors.longitude = 'Longitude must be a number between -180 and 180.';

  const tz = form.timezone.trim();
  if (!isValidTimeZone(tz)) errors.timezone = 'Use a time zone name such as Asia/Hebron.';

  const area = parseNumber(form.areaM2);
  if (area !== null && (Number.isNaN(area) || area <= 0)) errors.areaM2 = 'Area must be a number greater than 0, or leave it empty.';

  const names = form.sensorNames.map(cleanName).filter((n) => n !== '');
  if (names.length === 0) errors.sensorNames = 'Add at least one sensor name.';
  else if (names.length > MAX_SENSORS) errors.sensorNames = `At most ${MAX_SENSORS} sensors.`;
  else if (names.some((n) => n.length > MAX_NAME_LENGTH)) errors.sensorNames = `Each sensor name: at most ${MAX_NAME_LENGTH} characters.`;
  else if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) errors.sensorNames = 'Two sensors have the same name.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      cropId: form.cropId,
      soilTypeId: form.soilTypeId,
      plantingDate: form.plantingDate,
      latitude: lat as number,
      longitude: lng as number,
      timezone: tz,
      areaM2: area,
      sensorNames: names,
    },
  };
}
