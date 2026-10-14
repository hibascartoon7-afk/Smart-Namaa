import { useState } from 'react';
import { Mountain, ArrowUp, ArrowDown, Minus, MapPin, Radio } from 'lucide-react';
import { FIELD_METERS, getReadings, statusFor } from '@/data';
import type { FieldMeter, MeterReading } from '@/types';

const ELEVATION_STYLE: Record<string, { label: string; icon: typeof Mountain; cls: string }> = {
  high: { label: 'High', icon: ArrowUp, cls: 'bg-forest-100 text-forest-700 border-forest-200' },
  mid: { label: 'Mid', icon: Minus, cls: 'bg-moss-100 text-moss-600 border-moss-200' },
  low: { label: 'Low', icon: ArrowDown, cls: 'bg-rose-100 text-rose-400 border-rose-200' },
};

const STATUS_COLOR: Record<string, string> = {
  optimal: '#3F7A5A',
  warning: '#D3968C',
  critical: '#B97568',
};

function statusDot(readings: MeterReading) {
  const metrics: (keyof MeterReading)[] = ['n', 'p', 'k', 'ec', 'temp', 'ph', 'vwc'];
  let worst = 'optimal';
  for (const m of metrics) {
    const s = statusFor(m as string, readings[m] as number);
    if (s === 'critical') return 'critical';
    if (s === 'warning' && worst === 'optimal') worst = 'warning';
  }
  return worst;
}

export default function FieldMap() {
  const [selected, setSelected] = useState<string>('M1');
  const readings = getReadings();
  const meter = FIELD_METERS.find((m) => m.id === selected) as FieldMeter;
  const reading = readings[selected];

  return (
    <section id="field" className="relative py-24 sm:py-32">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="max-w-2xl mb-12">
          <p className="section-eyebrow mb-3">Real-Time Field Grid</p>
          <h2 className="font-display text-4xl sm:text-5xl font-semibold text-forest-700 text-balance">
            Every meter, every slope, every root zone.
          </h2>
          <p className="mt-4 text-forest-700/60 text-pretty">
            Sensors live in the 2nd soil layer where shallow absorption roots feed. Tap any
            node to inspect its 7 parameters and how micro-topography shifts its thresholds.
          </p>
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          {/* Map */}
          <div className="lg:col-span-3 glass-card p-5 sm:p-7 relative overflow-hidden">
            <div className="absolute inset-0 grid-paper opacity-40" />
            <div className="absolute inset-0 topo-lines opacity-50" />

            <div className="relative flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-forest-700">
                <MapPin className="w-4 h-4 text-moss-500" />
                Field Alpha · 24.7136°N, 46.6753°E
              </div>
              <span className="pill bg-moss-100 text-moss-600">
                <Radio className="w-3 h-3 animate-pulse" /> LoRa mesh online
              </span>
            </div>

            <div className="relative aspect-[4/3] rounded-2xl bg-gradient-to-br from-cream-100/60 to-moss-50/40 border border-white/60 overflow-hidden">
              {/* Elevation contour hints */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 75" preserveAspectRatio="none">
                <path d="M0 55 Q30 40 50 50 T100 45" stroke="#1F5C42" strokeOpacity="0.08" fill="none" strokeWidth="0.4" />
                <path d="M0 40 Q30 28 50 35 T100 30" stroke="#1F5C42" strokeOpacity="0.06" fill="none" strokeWidth="0.4" />
                <path d="M0 65 Q30 55 50 62 T100 58" stroke="#1F5C42" strokeOpacity="0.06" fill="none" strokeWidth="0.4" />
              </svg>

              {FIELD_METERS.map((m) => {
                const st = statusDot(readings[m.id]);
                const elev = ELEVATION_STYLE[m.elevation];
                const ElevIcon = elev.icon;
                const isSel = selected === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelected(m.id)}
                    className="absolute -translate-x-1/2 -translate-y-1/2 group"
                    style={{ left: `${m.x}%`, top: `${m.y}%` }}
                  >
                    <span
                      className="absolute inset-0 rounded-full blur-md transition-all"
                      style={{ background: STATUS_COLOR[st], opacity: isSel ? 0.5 : 0.25 }}
                    />
                    <span
                      className={`relative grid place-items-center w-10 h-10 rounded-full border-2 transition-all duration-300 ${
                        isSel ? 'scale-125 border-forest-700 bg-white shadow-lg' : 'border-white bg-white/80 group-hover:scale-110'
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ background: STATUS_COLOR[st] }}
                      />
                    </span>
                    <span className={`absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-bold whitespace-nowrap ${isSel ? 'text-forest-700' : 'text-forest-700/50'}`}>
                      {m.label}
                    </span>
                    <span className={`absolute -top-5 left-1/2 -translate-x-1/2 ${isSel ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                      <span className={`pill text-[9px] border ${elev.cls} !px-1.5 !py-0.5`}>
                        <ElevIcon className="w-2.5 h-2.5" />
                        {elev.label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative mt-6 flex flex-wrap gap-4 text-xs text-forest-700/60">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLOR.optimal }} /> Optimal</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLOR.warning }} /> Warning</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLOR.critical }} /> Critical</span>
            </div>
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-2 glass-card p-6 sm:p-7 flex flex-col">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-display text-2xl font-semibold text-forest-700">{meter.label}</h3>
                <p className="text-sm text-forest-700/60">{meter.crop} · {meter.aspect}-facing · {meter.slope}° slope</p>
              </div>
              <span className={`pill border ${ELEVATION_STYLE[meter.elevation].cls}`}>
                {(() => { const I = ELEVATION_STYLE[meter.elevation].icon; return <I className="w-3 h-3" />; })()}
                {ELEVATION_STYLE[meter.elevation].label} elevation
              </span>
            </div>

            <p className="mt-3 text-xs text-forest-700/50 italic">
              {meter.elevation === 'high' && 'Dries fastest — thresholds tightened for irrigation.'}
              {meter.elevation === 'low' && 'Traps moisture & runoff — thresholds relaxed, saturation watch.'}
              {meter.elevation === 'mid' && 'Standard thresholds apply for this slope.'}
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3 flex-1">
              {([
                ['Nitrogen', 'n', 'mg/kg'],
                ['Phosphorus', 'p', 'mg/kg'],
                ['Potassium', 'k', 'mg/kg'],
                ['EC (Salinity)', 'ec', 'mS/cm'],
                ['Soil Temp', 'temp', '°C'],
                ['pH', 'ph', ''],
                ['Moisture (VWC)', 'vwc', '%'],
              ] as const).map(([label, key, unit]) => {
                const val = reading[key] as number;
                const st = statusFor(key, val);
                return (
                  <div key={key} className="rounded-2xl bg-white/50 border border-white/60 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-forest-700/50 font-semibold">{label}</p>
                    <p className="font-display text-xl font-semibold text-forest-700 mt-0.5">
                      {typeof val === 'number' ? val.toFixed(key === 'ec' || key === 'ph' || key === 'temp' ? 1 : 0) : val}
                      <span className="text-xs text-forest-700/40 ml-1">{unit}</span>
                    </p>
                    <span
                      className="mt-1 inline-block w-full h-1 rounded-full"
                      style={{ background: STATUS_COLOR[st] }}
                    />
                  </div>
                );
              })}
            </div>

            <div className="mt-4 rounded-2xl bg-forest-700/5 border border-forest-700/10 p-3 text-xs text-forest-700/60">
              <span className="font-semibold text-forest-700">Topography factor:</span> thresholds adjusted ±12% for {meter.elevation} elevation zone.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
