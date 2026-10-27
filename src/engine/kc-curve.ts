// Crop coefficient for TODAY along the FAO-56 single-Kc curve.
// Source: Allen et al. (1998) FAO-56, Chapter 6 "Crop evapotranspiration - single crop coefficient", https://www.fao.org/4/X0490e/x0490e0b.htm
//   - four stages: initial (Kc ini, constant), crop development (linear Kc ini -> Kc mid),
//     mid-season (Kc mid, constant), late season (linear Kc mid -> Kc end)
//   - Eq. 66:  Kc_i = Kc_prev + [(i - sum(L_prev)) / L_stage] x (Kc_next - Kc_prev)
//   - i is the day number of the growing season (planting day = day 1)
// Stage lengths come from the database (crop_growth_stages, FAO-56 Table 11 or the owner's own values).
// Limits, stated honestly: Kc mid / Kc end are NOT corrected for local humidity and wind (FAO-56 Eq. 62),
// and Kc ini is an approximation (Chapter 6). Nothing is guessed: any missing piece gives "unavailable" and why.

import { resolveKc, type KcRow, type Range } from './kc';
import { daysBetween, isIsoDate, localDayString } from './time';

export interface StageLengths {
  initialDays: number;
  developmentDays: number;
  midDays: number;
  lateDays: number;
}

export type GrowthStage = 'initial' | 'development' | 'mid' | 'late';

export type KcCurveResult =
  | {
      status: 'ok';
      dayOfSeason: number;
      stage: GrowthStage;
      kc: Range;
      isRange: boolean;
      /** footnotes of Table 12 the owner should read for this crop */
      reviewFootnotes: string[];
      kcIniApproximate: boolean;
    }
  | {
      status: 'unavailable';
      reason:
        | 'planting_date_missing'
        | 'planting_date_invalid'
        | 'planting_in_future'
        | 'invalid_time_zone'
        | 'kc_row_missing'
        | 'kc_missing'
        | 'stage_lengths_missing'
        | 'stage_lengths_invalid'
        | 'cycle_ended';
      detail?: string;
    };

const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

const lerp = (a: Range, b: Range, t: number): Range => ({
  min: a.min + t * (b.min - a.min),
  max: a.max + t * (b.max - a.max),
});

export function stageAndKc(
  dayOfSeason: number,
  lengths: StageLengths,
  kc: { ini: Range; mid: Range; end: Range },
): { stage: GrowthStage; kc: Range } | null {
  const i = dayOfSeason;
  const a = lengths.initialDays;
  const b = a + lengths.developmentDays;
  const c = b + lengths.midDays;
  const d = c + lengths.lateDays;
  if (i <= a) return { stage: 'initial', kc: kc.ini };
  if (i <= b) return { stage: 'development', kc: lerp(kc.ini, kc.mid, (i - a) / lengths.developmentDays) };
  if (i <= c) return { stage: 'mid', kc: kc.mid };
  if (i <= d) return { stage: 'late', kc: lerp(kc.mid, kc.end, (i - c) / lengths.lateDays) };
  return null;
}

export function resolveCropKcToday(args: {
  kcRow: KcRow | null;
  kcGroupRow: KcRow | null;
  lengths: StageLengths | null;
  plantingDate: string | null;
  nowMs: number;
  timeZone: string;
}): KcCurveResult {
  const { kcRow, kcGroupRow, lengths, plantingDate, nowMs, timeZone } = args;

  if (!kcRow) return { status: 'unavailable', reason: 'kc_row_missing' };
  if (!plantingDate) return { status: 'unavailable', reason: 'planting_date_missing' };
  if (!isIsoDate(plantingDate)) return { status: 'unavailable', reason: 'planting_date_invalid' };
  const today = localDayString(nowMs, timeZone);
  if (!today) return { status: 'unavailable', reason: 'invalid_time_zone' };

  if (!lengths) return { status: 'unavailable', reason: 'stage_lengths_missing' };
  const l = lengths;
  if (![l.initialDays, l.developmentDays, l.midDays, l.lateDays].every(ok) || l.initialDays < 0 || l.midDays < 0 || l.developmentDays <= 0 || l.lateDays <= 0) {
    return { status: 'unavailable', reason: 'stage_lengths_invalid' };
  }

  const daysSincePlanting = daysBetween(plantingDate, today);
  if (daysSincePlanting < 0) return { status: 'unavailable', reason: 'planting_in_future' };
  const dayOfSeason = daysSincePlanting + 1;

  const ini = resolveKc(kcRow, kcGroupRow, 'ini');
  const mid = resolveKc(kcRow, kcGroupRow, 'mid');
  const end = resolveKc(kcRow, kcGroupRow, 'end');
  if (ini.status !== 'ok' || mid.status !== 'ok' || end.status !== 'ok') {
    const missing = [ini, mid, end].filter((r) => r.status !== 'ok').map((r) => r.stage).join(',');
    return { status: 'unavailable', reason: 'kc_missing', detail: missing };
  }

  const at = stageAndKc(dayOfSeason, l, { ini: ini.kc, mid: mid.kc, end: end.kc });
  if (!at) return { status: 'unavailable', reason: 'cycle_ended' };

  const stageInfo = at.stage === 'initial' ? ini : at.stage === 'mid' ? mid : at.stage === 'late' ? end : null;
  return {
    status: 'ok',
    dayOfSeason,
    stage: at.stage,
    kc: at.kc,
    isRange: at.kc.min !== at.kc.max,
    reviewFootnotes: [...new Set([...ini.reviewFootnotes, ...mid.reviewFootnotes, ...end.reviewFootnotes, ...(stageInfo ? stageInfo.reviewFootnotes : [])])],
    kcIniApproximate: ini.approximate,
  };
}
