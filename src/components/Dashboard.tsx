import { Droplets, Thermometer, FlaskConical, Activity, Gauge, Beaker, CloudRain, Wind, Sun, Clock } from 'lucide-react';
import { getReadings, fieldAverages, WEATHER, statusFor } from '@/data';

const STATUS_COLOR: Record<string, string> = {
  optimal: '#3F7A5A',
  warning: '#D3968C',
  critical: '#B97568',
};

function Ring({ value, max, color, label, sublabel, icon: Icon }: {
  value: number; max: number; color: string; label: string; sublabel: string; icon: typeof Droplets;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="glass-card glass-card-hover p-5 flex flex-col items-center text-center">
      <div className="relative w-24 h-24">
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(${color} ${pct}%, rgba(255,255,255,0.35) 0)`,
          }}
        />
        <div className="absolute inset-2 rounded-full bg-cream-100 grid place-items-center">
          <Icon className="w-7 h-7" style={{ color }} strokeWidth={1.8} />
        </div>
      </div>
      <p className="mt-3 font-display text-2xl font-semibold text-forest-700">
        {value.toFixed(label === 'EC' || label === 'pH' ? 1 : 0)}
      </p>
      <p className="text-xs font-semibold text-forest-700/70">{label}</p>
      <p className="text-[10px] text-forest-700/40">{sublabel}</p>
    </div>
  );
}

export default function Dashboard() {
  const readings = getReadings();
  const avg = fieldAverages(readings);

  return (
    <section id="dashboard" className="relative py-24 sm:py-32 bg-gradient-to-b from-transparent via-moss-50/30 to-transparent">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="max-w-2xl mb-12">
          <p className="section-eyebrow mb-3">Sensor Dashboard</p>
          <h2 className="font-display text-4xl sm:text-5xl font-semibold text-forest-700 text-balance">
            High-level health, granular truth underneath.
          </h2>
          <p className="mt-4 text-forest-700/60 text-pretty">
            Averaged metrics give you the field pulse. Granular per-meter values stay in the
            background for the AI engine — and a tap away for deep-dive inspection.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Metric rings */}
          <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Ring value={avg.vwc} max={50} color={STATUS_COLOR[statusFor('vwc', avg.vwc)]} label="VWC" sublabel="Avg moisture %" icon={Droplets} />
            <Ring value={avg.ec} max={6} color={STATUS_COLOR[statusFor('ec', avg.ec)]} label="EC" sublabel="Avg salinity mS/cm" icon={Activity} />
            <Ring value={avg.temp} max={32} color={STATUS_COLOR[statusFor('temp', avg.temp)]} label="Temp" sublabel="Avg soil °C" icon={Thermometer} />
            <Ring value={avg.ph} max={8} color={STATUS_COLOR[statusFor('ph', avg.ph)]} label="pH" sublabel="Avg acidity" icon={Beaker} />
            <Ring value={avg.n} max={80} color={STATUS_COLOR[statusFor('n', avg.n)]} label="Nitrogen" sublabel="Avg mg/kg" icon={FlaskConical} />
            <Ring value={avg.p} max={45} color={STATUS_COLOR[statusFor('p', avg.p)]} label="Phosphorus" sublabel="Avg mg/kg" icon={Gauge} />
            <Ring value={avg.k} max={300} color={STATUS_COLOR[statusFor('k', avg.k)]} label="Potassium" sublabel="Avg mg/kg" icon={FlaskConical} />
            <div className="glass-card p-5 flex flex-col justify-center items-center text-center">
              <p className="font-display text-2xl font-semibold text-forest-700">6/6</p>
              <p className="text-xs font-semibold text-forest-700/70">Meters online</p>
              <p className="text-[10px] text-forest-700/40">LoRa mesh · 100%</p>
            </div>
          </div>

          {/* Weather fusion */}
          <div className="glass-card p-6 flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <CloudRain className="w-5 h-5 text-forest-600" />
              <h3 className="font-display text-lg font-semibold text-forest-700">Weather × GPS Fusion</h3>
            </div>
            <p className="text-xs text-forest-700/50 mb-4">{WEATHER.location}</p>

            <div className="flex items-center gap-4 mb-5">
              <div className="grid place-items-center w-14 h-14 rounded-2xl bg-forest-100/60">
                <Sun className="w-7 h-7 text-forest-600" />
              </div>
              <div>
                <p className="font-display text-3xl font-semibold text-forest-700">{WEATHER.now.temp}°</p>
                <p className="text-xs text-forest-700/60">{WEATHER.now.condition} · {WEATHER.now.humidity}% humid</p>
              </div>
              <div className="ml-auto text-right">
                <Wind className="w-4 h-4 text-moss-500 inline" />
                <span className="text-xs text-forest-700/60 ml-1">{WEATHER.now.wind} km/h</span>
              </div>
            </div>

            {/* Rain alert */}
            <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-rose-400" />
                <span className="text-xs font-bold text-rose-500 uppercase tracking-wide">Rain incoming</span>
              </div>
              <p className="text-sm text-forest-700/80">
                {WEATHER.rainProbability3h}% chance in {Math.floor(WEATHER.rainStartMinutes / 60)}h {WEATHER.rainStartMinutes % 60}m · {WEATHER.expectedRainfallMm} mm expected
              </p>
            </div>

            {/* Hourly */}
            <div className="flex-1">
              <p className="text-[10px] uppercase tracking-wide text-forest-700/40 font-semibold mb-2">Rain probability</p>
              <div className="flex items-end gap-1.5 h-24">
                {WEATHER.hourly.map((h) => (
                  <div key={h.hour} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full rounded-t-md bg-gradient-to-t from-forest-600 to-moss-300 transition-all" style={{ height: `${h.rain}%` }} />
                    <span className="text-[8px] text-forest-700/40">{h.hour}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-forest-700/10 text-xs text-forest-700/60">
              <span className="font-semibold text-forest-700">EVT:</span> {WEATHER.evapotranspiration} mm/day — irrigation offset applied
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
