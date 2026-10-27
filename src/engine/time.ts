// Small date helpers shared by the engine. A "local day" is the calendar day in the FIELD's time zone.

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** 'YYYY-MM-DD' of an instant in the given time zone, or null when the time zone name is not valid. */
export function localDayString(ms: number, timeZone: string): string | null {
  if (!Number.isFinite(ms) || !isValidTimeZone(timeZone)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Whole days from one 'YYYY-MM-DD' to another (to - from). */
export function daysBetween(from: string, to: string): number {
  const f = from.split('-').map(Number);
  const t = to.split('-').map(Number);
  return Math.round((Date.UTC(t[0], t[1] - 1, t[2]) - Date.UTC(f[0], f[1] - 1, f[2])) / 86_400_000);
}
