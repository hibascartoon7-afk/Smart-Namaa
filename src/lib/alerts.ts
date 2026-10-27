import type { Lang } from '@/lib/lang';

export interface AlertRow {
  id: string;
  sensor_point_id: string | null;
  kind: 'engine' | 'savings';
  code: string;
  severity: 'info' | 'warning' | 'action';
  title_en: string;
  title_ar: string;
  message_en: string;
  message_ar: string;
  created_at: string;
}

const RANK = { action: 0, warning: 1, info: 2 } as const;

/** most urgent first, then oldest first inside the same level (the engine writes them in a meaningful order) */
export function sortAlerts(alerts: AlertRow[]): AlertRow[] {
  return [...alerts].sort((a, b) => RANK[a.severity] - RANK[b.severity] || Date.parse(a.created_at) - Date.parse(b.created_at));
}

export function alertText(a: AlertRow, lang: Lang): { title: string; message: string } {
  return lang === 'ar' ? { title: a.title_ar, message: a.message_ar } : { title: a.title_en, message: a.message_en };
}

export const KIND_LABEL: Record<AlertRow['kind'], { en: string; ar: string }> = {
  engine: { en: 'Decision engine', ar: 'محرك القرار' },
  savings: { en: 'Estimated saving', ar: 'توفير مُقدَّر' },
};
