import { Radio, Wifi, Cloud, Satellite, Mountain, Layers, Cpu, ArrowRight } from 'lucide-react';

const LAYERS = [
  {
    icon: Radio,
    title: 'Sub-Surface Sensors',
    desc: '7-in-1 probes planted in the 2nd soil layer — the shallow absorption root zone.',
    detail: 'N · P · K · EC · Temp · pH · VWC',
    color: '#839958',
  },
  {
    icon: Wifi,
    title: 'Local Field Mesh',
    desc: 'Sensors relay to a central gateway via LoRa / RS485 — no farmland Wi-Fi required.',
    detail: 'Offline-tolerant · low-power',
    color: '#105666',
  },
  {
    icon: Satellite,
    title: 'Cloud Sync',
    desc: 'Gateway transmits aggregated packets over cellular or satellite uplink.',
    detail: 'Store-and-forward · resilient',
    color: '#3F7A5A',
  },
  {
    icon: Cloud,
    title: 'AI Advisory Engine',
    desc: 'Raw readings fused with topography & weather into plain-language instructions.',
    detail: 'FAO-grounded · meter-specific',
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

        {/* Topography callout */}
        <div className="glass-card p-6 sm:p-8 grid md:grid-cols-3 gap-6 items-center">
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <Mountain className="w-5 h-5 text-forest-600" />
              <h3 className="font-display text-xl font-semibold text-forest-700">Dynamic Elevation Factor</h3>
            </div>
            <p className="text-sm text-forest-700/60 text-pretty">
              Fields are non-uniform. Low zones trap moisture and runoff; high zones dry
              fastest. NAMAA adjusts every threshold and recommendation by slope, aspect,
              and elevation — blanket formulas are strictly prohibited.
            </p>
          </div>
          <div className="md:col-span-2 grid grid-cols-3 gap-3">
            {[
              { label: 'High zone', note: 'Tighten irrigation thresholds', icon: ArrowRight, color: '#1F5C42' },
              { label: 'Mid zone', note: 'Standard thresholds apply', icon: Layers, color: '#839958' },
              { label: 'Low zone', note: 'Relax thresholds · watch saturation', icon: Cpu, color: '#D3968C' },
            ].map((z) => {
              const ZI = z.icon;
              return (
                <div key={z.label} className="rounded-2xl bg-white/50 border border-white/60 p-4 text-center">
                  <ZI className="w-5 h-5 mx-auto mb-2" style={{ color: z.color }} />
                  <p className="font-semibold text-sm text-forest-700">{z.label}</p>
                  <p className="text-[11px] text-forest-700/50 mt-0.5">{z.note}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
