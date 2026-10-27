import { FlaskConical } from 'lucide-react';
import type { StoredFertilization } from '@/lib/fertilization-view';
import { fertilizationView } from '@/lib/fertilization-view';

const TONE = {
  better: 'bg-forest-50 text-forest-600 border-forest-100',
  caution: 'bg-moss-50 text-moss-600 border-moss-200',
} as const;

export default function FertilizationCard({ decision, lang }: { decision: StoredFertilization | null | undefined; lang: 'en' | 'ar' }) {
  const v = fertilizationView(decision, lang);
  return (
    <article dir={lang === 'ar' ? 'rtl' : 'ltr'} className="glass-card p-5 sm:p-6 border-s-4 bg-moss-50 border-moss-200">
      <div className="flex items-start gap-4">
        <div className="grid place-items-center w-10 h-10 rounded-2xl border bg-moss-50 border-moss-200 shrink-0"><FlaskConical className="w-5 h-5 text-moss-600" /></div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-base font-semibold text-forest-700">{lang === 'ar' ? 'التسميد' : 'Fertilization'}</h3>
          <p className="mt-1 text-sm text-forest-700/70 text-pretty">{v.summary ?? '—'}</p>

          {v.plans.map((p) => (
            <div key={p.nutrient} className="mt-4">
              <h4 className="text-sm font-semibold text-forest-700">{p.nutrient}</h4>
              {p.dose ? <p className="text-sm text-forest-700/80 mt-0.5">{p.dose}</p> : null}
              {p.doseBasis ? <p className="text-[11px] text-forest-700/50 mt-0.5 text-pretty">{p.doseBasis}</p> : null}
              <ul className="mt-2 space-y-2">
                {p.options.map((o) => (
                  <li key={o.name} className="rounded-xl border border-forest-100 bg-white/60 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm font-semibold text-forest-700">{o.name}</span>
                      <span className="text-xs text-forest-700/60">{o.content}</span>
                    </div>
                    {o.amount ? <p className="text-sm text-forest-700/80 mt-1">{o.amount}{o.fieldAmount ? ` · ${o.fieldAmount}` : ''}</p> : null}
                    {o.also ? <p className="text-xs text-forest-700/60 mt-0.5">{o.also}</p> : null}
                    {o.fieldSoil ? (
                      <p className={`mt-2 text-xs rounded-lg border px-2 py-1 ${TONE[o.fieldSoil.tone]}`}>
                        <strong>{lang === 'ar' ? 'لتربة حقلك: ' : 'For your soil: '}{o.fieldSoil.label}.</strong> {o.fieldSoil.text}
                      </p>
                    ) : null}
                    {o.soilLines.length > 0 ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-forest-700/60">{lang === 'ar' ? 'أنواع التربة' : 'Soil types'}</summary>
                        <ul className="mt-1 space-y-1">
                          {o.soilLines.map((s, i) => (
                            <li key={i} className="text-xs text-forest-700/70">
                              <span className={`pill border !py-0 text-[10px] ${TONE[s.tone]}`}>{s.label}</span> <strong>{s.soils}</strong>: {s.text}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <p className="mt-2 text-[11px] text-forest-700/40">{lang === 'ar' ? 'لا توجد معلومات مخزّنة عن أنواع التربة لهذا السماد.' : 'No soil-type information is stored for this fertilizer.'}</p>
                    )}
                    <p className="mt-1 text-[10px] text-forest-700/40">{lang === 'ar' ? 'المصدر' : 'Source'}: {o.source}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {v.disclaimer ? <p className="mt-3 text-[11px] text-forest-700/50 text-pretty">{v.disclaimer}</p> : null}
        </div>
      </div>
    </article>
  );
}
