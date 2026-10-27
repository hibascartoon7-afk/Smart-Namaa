import { Droplet, Activity, AlertTriangle, Clock, RefreshCw, Loader2, Info, CircleAlert, Sprout } from 'lucide-react';
import { useFieldData, type StoredPointDecision } from '@/lib/field-data';
import { useLang } from '@/lib/lang';
import { alertText, KIND_LABEL, sortAlerts, type AlertRow } from '@/lib/alerts';
import { formatLocalTime, normalizeIrrigationStatus } from '@/lib/field-math';
import FieldStatus from './FieldStatus';
import FertilizationCard from './FertilizationCard';
import NutrientEntry from './NutrientEntry';

const SEVERITY_UI = {
  action: { style: 'bg-rose-50 border-rose-200 text-rose-500', icon: Droplet },
  warning: { style: 'bg-moss-50 border-moss-200 text-moss-600', icon: CircleAlert },
  info: { style: 'bg-forest-50 border-forest-100 text-forest-600', icon: Info },
} as const;

const POINT_UI = {
  recommend_irrigation: { en: 'Irrigate', ar: 'اسقِ', style: 'bg-rose-50 text-rose-500 border-rose-200' },
  do_not_irrigate: { en: 'Do not irrigate', ar: 'لا تروِ', style: 'bg-forest-50 text-forest-600 border-forest-100' },
  insufficient_data: { en: 'Not enough data', ar: 'بيانات غير كافية', style: 'bg-moss-50 text-moss-600 border-moss-200' },
} as const;

function AlertCard({ a, lang }: { a: AlertRow; lang: 'en' | 'ar' }) {
  const ui = SEVERITY_UI[a.severity];
  const Icon = a.kind === 'savings' ? Sprout : ui.icon;
  const t = alertText(a, lang);
  return (
    <article dir={lang === 'ar' ? 'rtl' : 'ltr'} className={`glass-card p-5 border-s-4 ${ui.style}`}>
      <div className="flex items-start gap-4">
        <div className={`grid place-items-center w-10 h-10 rounded-2xl border shrink-0 ${ui.style}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <span className={`pill border !py-0.5 text-[10px] ${ui.style}`}>{KIND_LABEL[a.kind][lang]}</span>
          <h3 className="font-display text-base font-semibold text-forest-700 mt-1.5">{t.title}</h3>
          <p className="mt-1 text-sm text-forest-700/70 text-pretty">{t.message}</p>
        </div>
      </div>
    </article>
  );
}

export default function Advisories() {
  const { field, decision, alerts, refreshing, refreshError, refreshDecision } = useFieldData();
  const { lang } = useLang();
  const tz = field?.timezone ?? null;

  const status = normalizeIrrigationStatus(decision?.irrigation_status ?? decision?.irrigation_decision?.status);
  const sorted = sortAlerts(alerts);
  const points: StoredPointDecision[] = decision?.irrigation_decision?.points ?? [];
  const summary = lang === 'ar' ? decision?.irrigation_decision?.summary_ar : decision?.irrigation_decision?.summary_en;

  return (
    <section id="advisories" className="relative py-24 sm:py-32">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="max-w-2xl mb-10">
          <p className="section-eyebrow mb-3">Alerts</p>
          <h2 className="font-display text-4xl sm:text-5xl font-semibold text-forest-700 text-balance">Decisions come from the engine.</h2>
          <p className="mt-4 text-forest-700/60 text-pretty">
            Every warning here, such as &quot;do not irrigate, rain is coming&quot;, is produced by the decision engine from your sensors, weather, crop and soil.
          </p>
        </div>

        <FieldStatus needs="field" />

        {field && (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <button onClick={() => void refreshDecision()} disabled={refreshing} className="btn-ghost !py-2 !px-4 text-sm disabled:opacity-50">
                {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Run the engine now
              </button>
              {decision && (
                <span className="text-xs text-forest-700/50 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> decision at {formatLocalTime(decision.generated_at, tz)}
                  {decision.growth_stage ? ` · stage: ${decision.growth_stage}` : ''}
                  {decision.details?.day_of_season ? ` · day ${decision.details.day_of_season}` : ''}
                  {decision.etc_mm !== null ? ` · ETc ${Number(decision.etc_mm).toFixed(1)} mm/day (estimate)` : ''}
                </span>
              )}
              {refreshError && <span className="text-xs text-rose-500">{refreshError}</span>}
            </div>

            {!decision ? (
              <div className="glass-card p-8 text-sm text-forest-700/70">{refreshing ? 'Running the decision engine…' : 'No decision has been generated for this environment yet.'}</div>
            ) : (
              <div className="max-w-4xl space-y-4">
                <div className="space-y-4">
                  <article dir={lang === 'ar' ? 'rtl' : 'ltr'} className="glass-card p-5 sm:p-6">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="w-5 h-5 text-forest-600" />
                      <h3 className="font-display text-lg font-semibold text-forest-700">
                        {status === 'recommend_irrigation' ? (lang === 'ar' ? 'يُنصح بالري' : 'Irrigation recommended') : status === 'do_not_irrigate' ? (lang === 'ar' ? 'لا ري الآن' : 'No irrigation now') : lang === 'ar' ? 'لا يمكن اتخاذ قرار' : 'No decision possible'}
                      </h3>
                    </div>
                    <p className="text-sm text-forest-700/75 text-pretty">{summary ?? decision.explanation}</p>

                    {points.length > 0 && (
                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-forest-700/50 text-start">
                              <th className="font-semibold py-1.5 pe-3 text-start">Sensor</th>
                              <th className="font-semibold py-1.5 pe-3 text-start">Moisture</th>
                              <th className="font-semibold py-1.5 pe-3 text-start">Decision</th>
                              <th className="font-semibold py-1.5 text-start">Irrigation (net)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {points.map((p) => {
                              const ui = POINT_UI[p.status] ?? POINT_UI.insufficient_data;
                              return (
                                <tr key={p.point_id} className="border-t border-forest-700/10" title={lang === 'ar' ? p.text_ar : p.text_en}>
                                  <td className="py-2 pe-3 font-semibold text-forest-700">{p.name}</td>
                                  <td className="py-2 pe-3 text-forest-700/70">{p.moisture_pct !== null ? `${p.moisture_pct}%` : 'not measured'}</td>
                                  <td className="py-2 pe-3"><span className={`pill border !py-0.5 text-[10px] ${ui.style}`}>{ui[lang]}</span></td>
                                  <td className="py-2 text-forest-700/70">{p.net_depth_mm !== undefined ? `${p.net_depth_mm.toFixed(1)} mm` : '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </article>

                  {sorted.map((a) => <AlertCard key={a.id} a={a} lang={lang} />)}

                  <FertilizationCard decision={decision?.fertilization_decision} lang={lang} />
                  <NutrientEntry />
                </div>

                <p className="text-[11px] text-forest-700/40 flex items-start gap-1.5 px-1">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Estimates (ETc, savings) are labelled as estimates. Nothing here is a measurement unless it says so.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
