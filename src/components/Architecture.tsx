import { Radio, Wifi, Cloud, Satellite, ArrowRight } from 'lucide-react';

const LAYERS = [
  {
    icon: Radio,
    title: 'Sub-Surface Sensors',
    desc: '3-in-1 probes measure moisture, soil temperature and EC at several points of the field.',
    detail: 'Moisture · Soil temp · EC',
    color: '#839958',
  },
  {
    icon: Wifi,
    title: 'ESP32 Field Unit',
    desc: 'One ESP32 per crop collects the probe values and sends them to the cloud.',
    detail: 'One unit per crop',
    color: '#105666',
  },
  {
    icon: Satellite,
    title: 'Cloud Sync',
    desc: 'Readings are stored in the database. A value that was not measured stays empty, never 0.',
    detail: 'Missing value = empty',
    color: '#3F7A5A',
  },
  {
    icon: Cloud,
    title: 'Decision Engine',
    desc: 'A rule-based engine combines readings, weather, crop and soil type using FAO-56 equations.',
    detail: 'FAO-56 · explainable',
    color: '#D3968C',
  },
];

export default function Architecture() {
  return (
    <section className="relative py-24 sm:py-32 bg-gradient-to-b from-transparent via-moss-50/20 to-transparent">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="max-w-2xl mb-12">
          <p className="section-eyebrow mb-3">Hardware &amp; AI Pipeline</p>
          <h2 className="font-display text-4xl sm:text-5xl font-semibold text-forest-700 text-balance">
            From soil layer to cloud to farmer.
          </h2>
          <p className="mt-4 text-forest-700/60 text-pretty">
            A resilient offline-first pipeline: sensors talk over a local mesh, the gateway
            syncs when a link is available, and the AI engine fuses everything with
            micro-topography and live weather.
          </p>
        </div>

        {/* Pipeline */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {LAYERS.map((l, i) => {
            const Icon = l.icon;
            return (
              <div key={l.title} className="relative">
                <div className="glass-card glass-card-hover p-6 h-full">
                  <div className="grid place-items-center w-12 h-12 rounded-2xl mb-4" style={{ background: `${l.color}22` }}>
                    <Icon className="w-6 h-6" style={{ color: l.color }} strokeWidth={1.8} />
                  </div>
                  <span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: l.color }}>
                    Step {i + 1}
                  </span>
                  <h3 className="font-display text-lg font-semibold text-forest-700 mt-1">{l.title}</h3>
                  <p className="text-sm text-forest-700/60 mt-1.5 text-pretty">{l.desc}</p>
                  <p className="text-xs text-forest-700/40 mt-3 font-medium">{l.detail}</p>
                </div>
                {i < LAYERS.length - 1 && (
                  <div className="hidden lg:flex absolute top-1/2 -right-3 -translate-y-1/2 z-10">
                    <span className="grid place-items-center w-6 h-6 rounded-full bg-white/80 border border-forest-700/10 text-forest-600">
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Topography callout */}      </div>
    </section>
  );
}
