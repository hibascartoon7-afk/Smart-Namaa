// Daily reference evapotranspiration (ET0) from Open-Meteo hourly values.
//
//   ET0_day = sum of the 24 hourly ET0 values of the field's LOCAL day      (formula F-002, docs/formulas.md)
//
// Source for the rule: Open-Meteo documentation (https://open-meteo.com/en/docs). Its daily ET0 is "a simple
// 24 hour aggregation from hourly values", and each hourly ET0 is the sum of the preceding hour in mm.
// Like Open-Meteo, we assign every hourly value to the local date of its timestamp.
//
// Rules: never sum a partial day, never treat a missing hour as 0. A real 0 (night hour) is a value.

export interface HourlyEt0 {
  /** ISO-8601 instant (UTC) exactly as stored in weather_observations.observed_at */
  observedAt: string;
  /** mm for that hour; null = the API gave nothing */
  et0Mm: number | null;
}

export type DailyEt0Result =
  | { status: 'ok'; localDay: string; et0MmPerDay: number; hours: number }
  | {
      status: 'unavailable';
      localDay: string;
      reason: 'invalid_timezone' | 'no_data' | 'missing_hours' | 'null_values';
    };

const HOUR_MS = 3_600_000;

function parts(ms: number, timeZone: string): { day: string; hh: string; mm: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hh: p.hour, mm: p.minute };
}

/**
 * @param rows      hourly rows of ONE field (any order, any number of days)
 * @param localDay  'YYYY-MM-DD' in the field's time zone
 * @param timeZone  IANA name stored in fields.timezone
 *
 * A complete local day = hourly values (1 hour apart) from 00:00 to 23:00 local time, none null.
 * That is 24 values, or 23 / 25 on a daylight-saving change day: we check completeness, not the number 24.
 */
export function dailyEt0FromHourly(rows: HourlyEt0[], localDay: string, timeZone: string): DailyEt0Result {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
  } catch {
    return { status: 'unavailable', localDay, reason: 'invalid_timezone' };
  }

  const day = rows
    .map((r) => ({ ms: Date.parse(r.observedAt), et0: r.et0Mm }))
    .filter((r) => Number.isFinite(r.ms) && parts(r.ms, timeZone).day === localDay)
    .sort((a, b) => a.ms - b.ms);

  if (day.length === 0) return { status: 'unavailable', localDay, reason: 'no_data' };

  const first = parts(day[0].ms, timeZone);
  const last = parts(day[day.length - 1].ms, timeZone);
  const startsAtMidnight = first.hh === '00' && first.mm === '00';
  const endsAt2300 = last.hh === '23' && last.mm === '00';
  const consecutive = day.every((r, i) => i === 0 || r.ms - day[i - 1].ms === HOUR_MS);
  if (!startsAtMidnight || !endsAt2300 || !consecutive) {
    return { status: 'unavailable', localDay, reason: 'missing_hours' };
  }

  if (day.some((r) => r.et0 === null || !Number.isFinite(r.et0) || r.et0 < 0)) {
    return { status: 'unavailable', localDay, reason: 'null_values' };
  }

  const total = day.reduce((s, r) => s + (r.et0 as number), 0);
  return { status: 'ok', localDay, et0MmPerDay: total, hours: day.length };
}
