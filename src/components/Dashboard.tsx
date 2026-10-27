import { Droplets, Thermometer, Activity, FlaskConical, CloudRain, Clock } from 'lucide-react';
import { useFieldData } from '@/lib/field-data';
import {
  formatLocalTime,
  localDay,
  pointValueToday,
  summarizeVariable,
  summarizeWeather,
  type VariableKey,
} from '@/lib/field-math';
import { dailyEt0FromHourly } from '@/lib/engine/et0';
import { spreadAcrossSensors } from '@/lib/engine/stats';
import FieldStatus from './FieldStatus';
import MiddleZonePanel from './MiddleZonePanel';
import { useMiddleZonePair } from '@/lib/use-middle-zone-pair';

function Metric({
  label, unit, icon: Icon, summary, digits, max,
}: {
  label: string;
  unit: string;
  icon: typeof Droplets;
  summary: ReturnType<typeof summarizeVariable> | null;
  digits: number;
  max: number;
}) {
  const measured = summary?.status === 'measured' ? summary : null;
  const pct = measured ? Math.max(0, Math.min(100, (measured.average / max) * 100)) : 0;
  return (
    <div className="glass-card p-5 flex flex-col items-center text-center">
      <div className="relative w-24 h-24">
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: `conic-gradient(#3F7A5A ${pct}%, rgba(255,255,255,0.35) 0)` }}
        />
        <div className="absolute inset-2 rounded-full bg-cream-100 grid place-items-center">
          <Icon className="w-7 h-7 text-forest-600" strokeWidth={1.8} />
        </div>
      </div>
      {measured ? (
        <p className="mt-3 font-display text-2xl font-semibold text-forest-700">
          {measured.average.toFixed(digits)}
          <span className="text-sm text-forest-700/50 ml-1">{unit}</span>
        </p>
      ) : (
        <p className="mt-3 text-sm font-semibold text-forest-700/60">Not measured today</p>
      )}
      <p className="text-xs font-semibold text-forest-700/70">{label}</p>
      <p className="text-[10px] text-forest-700/40">
        {measured
          ? `avg of ${measured.pointsMeasured}/${measured.pointsTotal} points`
          : 'no usable reading today'}
      </p>
    </div>
  );
}

function NotMeasured({ label }: { label: string }) {
  return (
    <div className="glass-card p-5 flex flex-col items-center justify-center text-center">
      <FlaskConical className="w-6 h-6 text-forest-700/30 mb-2" />
      <p className="text-xs font-semibold text-forest-700/70">{label}</p>
      <p className="text-[11px] text-forest-700/50 mt-1">Not measured</p>
    </div>
  );
}

export default function Dashboard() {
  const { field, points, readings, weather } = useFieldData();
  const [zonePair, setZonePair] = useMiddleZonePair(points);
  const tz = field?.timezone ?? null;
  const now = Date.now();
  const day = localDay(now, tz);

  const summary = (key: VariableKey) => summarizeVariable(points, readings, key, day, tz);
  const wx = summarizeWeather(weather, now);
  const et0 = field?.timezone
    ? dailyEt0FromHourly(weather.map((w) => ({ observedAt: w.observed_at, et0Mm: w.et0_mm })), day, field.timezone)
    : null;
  const nextHours = weather
    .filter((w) => Date.parse(w.observed_at) > now)
    .slice(0, 12);

  const spread = (key: VariableKey) =>
    spreadAcrossSensors(
      points.flatMap((p) => {
        const v = pointValueToday(readings, p.id, key, day, tz);
        return v ? [{ pointId: p.id, name: p.point_name, value: v.value }] : [];
      }),
    );

  const lastMeasured = (() => {
    const times = (['moisture', 'soil_temperature', 'ec'] as VariableKey[])
      .map((k) => summary(k))
      .flatMap((s) => (s.status === 'measured' ? [s.lastMeasuredAt] : []));
    return times.length ? times.sort()[times.length - 1] : null;
  })();

  return (
    <section id="dashboard" className="relative py-24 sm:py-32 bg-gradient-to-b from-transparent via-moss-50/30 to-transparent">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="max-w-2xl mb-12">
          <p className="section-eyebrow mb-3">Sensor Dashboard</p>
          <h2 className="font-display text-4xl sm:text-5xl font-semibold text-forest-700 text-balance">
            What was measured today, and what was not.
          </h2>
          <p className="mt-4 text-forest-700/60 text-pretty">
            Values are the average of each point&apos;s latest reading today. A variable with no usable reading is
            shown as not measured, never as zero.
          </p>
        </div>

        <FieldStatus needs="points" />

        {field && points.length > 0 && (
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-4 content-start">
              <Metric label="Moisture" unit="%" icon={Droplets} summary={summary('moisture')} digits={0} max={100} />
              <Metric label="Soil temp" unit="°C" icon={Thermometer} summary={summary('soil_temperature')} digits={1} max={50} />
              <Metric label="EC" unit="dS/m" icon={Activity} summary={summary('ec')} digits={1} max={10} />
              <NotMeasured label="Nitrogen" />
              <NotMeasured label="Phosphorus" />
              <NotMeasured label="Potassium" />
              <div className="col-span-2 sm:col-span-3 rounded-2xl bg-white/40 border border-white/60 p-4 text-xs text-forest-700/70">
                <p className="font-semibold text-forest-700 mb-1">Spread between sensors today</p>
                {([['moisture', 'Moisture', '%', 0], ['soil_temperature', 'Soil temp', '°C', 1], ['ec', 'EC', 'dS/m', 1]] as [VariableKey, string, string, number][]).map(([key, label, unit, digits]) => {
                  const sp = spread(key);
                  return (
                    <p key={key}>
                      {label}:{' '}
                      {sp.status === 'ok'
                        ? sp.count === 1
                          ? `one sensor (${sp.min.name}) at ${sp.mean.toFixed(digits)} ${unit}`
                          : `lowest ${sp.min.value.toFixed(digits)} ${unit} (${sp.min.name}) · highest ${sp.max.value.toFixed(digits)} ${unit} (${sp.max.name}) · difference ${sp.range.toFixed(digits)} ${unit}`
                        : 'not measured today'}
                    </p>
                  );
                })}
              </div>
              <div className="col-span-2 sm:col-span-3">
                <MiddleZonePanel points={points} readings={readings} pair={zonePair} onPairChange={setZonePair} day={day} tz={tz} />
              </div>
              <div className="col-span-2 sm:col-span-3 text-xs text-forest-700/50">
                {field.crop_name ?? 'Crop not set'}
                {field.soil &&
                  ` · ${field.soil.soil_name} soil` +
                    (field.soil.field_capacity_pct !== null && field.soil.wilting_point_pct !== null
                      ? ` · wilting point ${field.soil.wilting_point_pct}% · field capacity ${field.soil.field_capacity_pct}%`
                      : '')}
                {lastMeasured && ` · last reading ${formatLocalTime(lastMeasured, tz)}`}
              </div>
            </div>

            <div className="glass-card p-6 flex flex-col">
              <div className="flex items-center gap-2 mb-4">
                <CloudRain className="w-5 h-5 text-forest-600" />
                <h3 className="font-display text-lg font-semibold text-forest-700">Weather (this field)</h3>
              </div>

              {weather.length === 0 ? (
                <p className="text-sm text-forest-700/60">No weather data stored for this field yet.</p>
              ) : (
                <>
                  <p className="font-display text-3xl font-semibold text-forest-700">
                    {wx.airTemperatureC !== null ? `${wx.airTemperatureC.toFixed(1)}°C` : '—'}
                    <span className="text-xs text-forest-700/50 ml-2 font-sans">air temperature</span>
                  </p>

                  <div className="rounded-2xl bg-forest-50 border border-forest-100 p-4 my-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="w-4 h-4 text-forest-600" />
                      <span className="text-xs font-bold text-forest-600 uppercase tracking-wide">Next 24 h</span>
                    </div>
                    <p className="text-sm text-forest-700/80">
                      {wx.next24h.maxRainProbabilityPct !== null
                        ? `Max rain probability ${wx.next24h.maxRainProbabilityPct}%`
                        : 'Rain probability not available'}
                      {' · '}
                      {wx.next24h.precipitationMm !== null
                        ? `${wx.next24h.precipitationMm.toFixed(1)} mm forecast${wx.next24h.precipitationComplete ? '' : ' (incomplete data)'}`
                        : 'precipitation not available'}
                    </p>
                    {wx.next24h.firstRainAt && (
                      <p className="text-xs text-forest-700/60 mt-1">
                        First rain around {formatLocalTime(wx.next24h.firstRainAt, tz)}
                      </p>
                    )}
                  </div>

                  <p className="text-[10px] uppercase tracking-wide text-forest-700/40 font-semibold mb-2">
                    Rain probability, next hours
                  </p>
                                   <div className="flex items-end gap-1.5">
                    {nextHours.map((h) => (
                      <div key={h.observed_at} className="flex-1 flex flex-col items-center gap-1">
                        <div className="relative w-full h-20 border-b border-forest-700/10">
                          <div
                            className="absolute bottom-0 inset-x-0 rounded-t-md bg-gradient-to-t from-forest-600 to-moss-300"
                            style={{ height: `${h.rain_probability_pct ?? 0}%` }}
                            title={h.rain_probability_pct === null ? 'not available' : `${h.rain_probability_pct}%`}
                          />
                        </div>
                        <span className="text-[8px] text-forest-700/40">{formatLocalTime(h.observed_at, tz).slice(0, 2)}</span>
                      </div>
                    ))}
                  </div>
                  

                  <div className="mt-4 pt-4 border-t border-forest-700/10 text-xs text-forest-700/60">
                    <span className="font-semibold text-forest-700">ET₀ today:</span>{' '}
                    {et0 && et0.status === 'ok'
                      ? `${et0.et0MmPerDay.toFixed(1)} mm/day (estimate)`
                      : 'not available (incomplete day)'}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
