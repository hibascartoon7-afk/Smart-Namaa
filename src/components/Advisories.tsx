import { Droplet, FlaskConical, AlertTriangle, Activity, CheckCircle, Clock, ArrowRight, ListOrdered } from 'lucide-react';
import { ADVISORIES } from '@/data';
import type { Severity } from '@/types';

const ICONS: Record<string, typeof Droplet> = {
  'droplet': Droplet,
  'flask-conical': FlaskConical,
  'alert-triangle': AlertTriangle,
  'activity': Activity,
  'check-circle': CheckCircle,
};

const SEVERITY_STYLE: Record<Severity, { bg: string; border: string; text: string; dot: string; label: string }> = {
  high: { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-500', dot: 'bg-rose-400', label: 'Urgent' },
  warning: { bg: 'bg-moss-50', border: 'border-moss-200', text: 'text-moss-600', dot: 'bg-moss-400', label: 'Warning' },
  info: { bg: 'bg-forest-50', border: 'border-forest-100', text: 'text-forest-600', dot: 'bg-forest-400', label: 'Info' },
};

const PRIORITY = [
  { rank: 1, meter: 'M6', reason: '19% VWC · high elevation · dries fastest', pct: 92 },
  { rank: 2, meter: 'M1', reason: '24% VWC · SW slope · below threshold', pct: 74 },
  { rank: 3, meter: 'M3', reason: 'Low P + high EC · but saturated — hold', pct: 38 },
];

export default function Advisories() {
  return (
    <section id="advisories" className="relative py-24 sm:py-32">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="max-w-2xl mb-12">
          <p className="section-eyebrow mb-3">AI Action Center</p>
          <h2 className="font-display text-4xl sm:text-5xl font-semibold text-forest-700 text-balance">
            Raw sensors, plain-language instructions.
          </h2>
          <p className="mt-4 text-forest-700/60 text-pretty">
            NAMAA's advisory engine translates 7-in-1 readings, topography, and weather into
            exact actions — meter by meter, minute by minute.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Advisory feed */}
          <div className="lg:col-span-2 space-y-4">
            {ADVISORIES.map((a, i) => {
              const s = SEVERITY_STYLE[a.severity];
              const Icon = ICONS[a.icon] ?? Activity;
              return (
                <article
                  key={a.id}
                  className={`glass-card glass-card-hover p-5 sm:p-6 border-l-4 ${s.border} ${s.bg} animate-fade-up`}
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="flex items-start gap-4">
                    <div className={`grid place-items-center w-11 h-11 rounded-2xl ${s.bg} border ${s.border} shrink-0`}>
                      <Icon className={`w-5 h-5 ${s.text}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`pill ${s.bg} ${s.text} border ${s.border} !py-0.5`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                          {s.label}
                        </span>
                        <span className="font-semibold text-forest-700 text-sm">{a.meterId}</span>
                        <span className="text-xs text-forest-700/40 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {a.eta}
                        </span>
                      </div>
                      <h3 className="font-display text-lg font-semibold text-forest-700">{a.title}</h3>
                      <p className="mt-1.5 text-sm text-forest-700/70 text-pretty">{a.body}</p>
                      <button className={`mt-3 inline-flex items-center gap-1.5 text-xs font-semibold ${s.text} hover:gap-2.5 transition-all`}>
                        {a.action} <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Priority ranking */}
          <div className="glass-card p-6 sm:p-7 h-fit lg:sticky lg:top-28">
            <div className="flex items-center gap-2 mb-5">
              <ListOrdered className="w-5 h-5 text-forest-600" />
              <h3 className="font-display text-lg font-semibold text-forest-700">Scarcity Priority</h3>
            </div>
            <p className="text-xs text-forest-700/50 mb-5">
              If water or fertilizer supply is limited, the AI ranks meters by critical urgency.
            </p>
            <div className="space-y-4">
              {PRIORITY.map((p) => (
                <div key={p.meter} className="flex items-center gap-3">
                  <span className="grid place-items-center w-7 h-7 rounded-full bg-forest-600 text-cream-100 text-xs font-bold shrink-0">
                    {p.rank}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-forest-700 text-sm">{p.meter}</span>
                      <span className="text-xs text-forest-700/40">{p.pct}% urgency</span>
                    </div>
                    <p className="text-[11px] text-forest-700/50 mb-1.5">{p.reason}</p>
                    <div className="h-1.5 rounded-full bg-forest-700/10 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-moss-400 to-forest-600" style={{ width: `${p.pct}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 pt-5 border-t border-forest-700/10">
              <p className="text-xs text-forest-700/60 italic">
                "Allocate to M6 first, then M1. Hold M3 until post-rain drainage."
              </p>
              <p className="text-[10px] text-moss-500 font-semibold mt-1">— NAMAA AI Engine</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
