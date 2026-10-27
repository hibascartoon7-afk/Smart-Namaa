import { Droplets, Info } from 'lucide-react';
import { useFieldData } from '@/lib/field-data';
import { useLang } from '@/lib/lang';
import FieldStatus from './FieldStatus';

const r1 = (x: number) => (Math.round(x * 10) / 10).toString();

export default function Savings() {
  const { field, savings } = useFieldData();
  const { lang } = useLang();

  const totalMm = savings.reduce((s, r) => s + r.saved_mm, 0);
  const allM3 = savings.length > 0 && savings.every((r) => r.saved_m3 !== null);
  const totalM3 = allM3 ? savings.reduce((s, r) => s + (r.saved_m3 as number), 0) : null;
  const daysWithSaving = savings.filter((r) => r.saved_mm > 0).length;
  const maxMm = Math.max(0.0001, ...savings.map((r) => r.saved_mm));
  const chart = [...savings].reverse();

  return (
    <section id="savings" className="relative py-24 sm:py-32 bg-gradient-to-b from-transparent via-cream-200/20 to-transparent">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="max-w-2xl mb-10">
          <p className="section-eyebrow mb-3">Sustainability</p>
          <h2 className="font-display text-4xl sm:text-5xl font-semibold text-forest-700 text-balance">Estimated water saving</h2>
          <p className="mt-4 text-forest-700/60 text-pretty">
            When the engine postpones or reduces irrigation because rain is expected, the rain credit (never more than the water the soil was missing) is counted as saved.
            It is an estimate from the forecast, not a measurement.
          </p>
        </div>

        <FieldStatus needs="field" />

        {field && (
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="glass-card p-6">
              <Droplets className="w-6 h-6 text-forest-600 mb-3" />
              {savings.length === 0 ? (
                <p className="text-sm text-forest-700/60">No saving has been estimated yet. It is calculated each time the decision engine runs.</p>
              ) : (
                <>
                  <p className="text-xs uppercase tracking-wide text-forest-700/50 font-semibold">Last 30 days (estimate)</p>
                  <p className="font-display text-4xl font-semibold text-forest-700 mt-1">
                    {r1(totalMm)}<span className="text-lg text-forest-700/50 ms-1">mm</span>
                  </p>
                  <p className="text-sm text-forest-700/70 mt-1">
                    {totalM3 !== null ? `≈ ${r1(totalM3)} m³ of water on ${field.area_m2} m²` : 'Enter the area of the environment to see cubic metres.'}
                  </p>
                  <p className="text-xs text-forest-700/50 mt-3">{daysWithSaving} of {savings.length} days with a saving</p>
                </>
              )}
            </div>

            <div className="lg:col-span-2 glass-card p-6">
              <p className="text-xs uppercase tracking-wide text-forest-700/50 font-semibold mb-3">Daily estimate (mm)</p>
              {chart.length === 0 ? (
                <p className="text-sm text-forest-700/60">—</p>
              ) : (
                <div className="flex items-end gap-1.5 h-32" dir="ltr">
                  {chart.map((r) => (
                    <div key={r.local_day} className="flex-1 flex flex-col items-center gap-1" title={`${r.local_day}: ${r1(r.saved_mm)} mm`}>
                      <div className="w-full rounded-t-md bg-gradient-to-t from-forest-600 to-moss-300" style={{ height: `${Math.max(2, (r.saved_mm / maxMm) * 100)}%` }} />
                      <span className="text-[8px] text-forest-700/40">{r.local_day.slice(8)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="lg:col-span-3 glass-card p-6 text-sm text-forest-700/70">
              <div className="flex items-center gap-2 mb-2 text-forest-700 font-semibold"><Info className="w-4 h-4" /> {lang === 'ar' ? 'كيف يُحسب' : 'How it is calculated'}</div>
              {lang === 'ar' ? (
                <p>التوفير (مم) = الأقل بين المطر الفعّال المتوقع والنقص الحالي في ماء منطقة الجذور، ويُحتسب فقط عندما كان الري سيُطلب بدون المطر. الحجم (م³) = مم × المساحة (م²) ÷ 1000. المصدر: FAO-56، الفصل 8.</p>
              ) : (
                <p>
                  Saved depth (mm) = the smaller of the expected effective rain and the water the root zone is missing, counted only when irrigation would otherwise have been needed.
                  Volume (m³) = mm × area (m²) ÷ 1000. Source: FAO-56, Chapter 8 (<a className="underline hover:text-moss-600" href="https://www.fao.org/4/X0490e/x0490e0e.htm" target="_blank" rel="noreferrer">fao.org</a>).
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
