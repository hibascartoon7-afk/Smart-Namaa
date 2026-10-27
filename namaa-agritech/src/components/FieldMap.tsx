import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useFieldData } from '@/lib/field-data';
import { formatLocalTime, localDay, pointValueToday, projectPoints, projectionBounds, unprojectXY, type VariableKey } from '@/lib/field-math';
import { estimateBetweenSensors } from '@/lib/engine/idw';
import FieldStatus from './FieldStatus';
import MiddleZonePanel from './MiddleZonePanel';
import { middleZoneMarker } from '@/lib/middle-zone';
import { useMiddleZonePair } from '@/lib/use-middle-zone-pair';

const VARIABLES: { key: VariableKey; label: string; unit: string; digits: number }[] = [
  { key: 'moisture', label: 'Moisture', unit: '%', digits: 0 },
  { key: 'soil_temperature', label: 'Soil temp', unit: '°C', digits: 1 },
  { key: 'ec', label: 'EC', unit: 'dS/m', digits: 1 },
];

const NPK = ['Nitrogen', 'Phosphorus', 'Potassium'];

export default function FieldMap() {
  const { field, points, readings } = useFieldData();
  const [selected, setSelected] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ x: number; y: number; lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!points.some((p) => p.id === selected)) setSelected(points[0]?.id ?? null);
  }, [points, selected]);

  const tz = field?.timezone ?? null;
  const day = localDay(Date.now(), tz);
  const { placed, unplaced } = projectPoints(points);
  const point = points.find((p) => p.id === selected) ?? null;
  const bounds = projectionBounds(points);
  const [zonePair, setZonePair] = useMiddleZonePair(points);
  const zoneMarker = zonePair ? middleZoneMarker(points, zonePair) : null;

  // click on an empty spot of the map: estimate each variable there from the located sensors (IDW + leave-one-out error)
  const onMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button') || !bounds) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    setProbe({ x, y, ...unprojectXY(bounds, x, y) });
  };
  const estimateFor = (key: VariableKey) => {
    if (!probe) return null;
    const located = points
      .filter((p) => p.latitude !== null && p.longitude !== null)
      .flatMap((p) => {
        const v = pointValueToday(readings, p.id, key, day, tz);
        return v ? [{ id: p.id, lat: p.latitude as number, lng: p.longitude as number, value: v.value }] : [];
      });
    return estimateBetweenSensors(located, { lat: probe.lat, lng: probe.lng });
  };

  return (
    <section id="field" className="relative py-24 sm:py-32">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="max-w-2xl mb-12">
          <p className="section-eyebrow mb-3">Field Map</p>
          <h2 className="font-display text-4xl sm:text-5xl font-semibold text-forest-700 text-balance">
            Every sensor point, one tap away.
          </h2>
          <p className="mt-4 text-forest-700/60 text-pretty">
            Tap a point to see that sensor&apos;s own reading, not the field average.
          </p>
        </div>

        <FieldStatus needs="points" />

        {field && points.length > 0 && (
          <div className="grid lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3 glass-card p-5 sm:p-7 relative overflow-hidden">
              <div className="absolute inset-0 grid-paper opacity-40" />
              <div className="relative flex items-center gap-2 mb-4 text-sm font-semibold text-forest-700">
                <MapPin className="w-4 h-4 text-moss-500" />
                {field.name}
                {field.latitude !== null && field.longitude !== null && (
                  <span className="text-forest-700/50 font-normal">
                    · {field.latitude.toFixed(4)}, {field.longitude.toFixed(4)}
                  </span>
                )}
              </div>

              {placed.length > 0 && (
                <div onClick={onMapClick} className="relative aspect-[4/3] rounded-2xl bg-gradient-to-br from-cream-100/60 to-moss-50/40 border border-white/60 overflow-hidden cursor-crosshair">
                  {zoneMarker && (
                    <>
                      <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
                        <line x1={`${zoneMarker.from.x}%`} y1={`${zoneMarker.from.y}%`} x2={`${zoneMarker.to.x}%`} y2={`${zoneMarker.to.y}%`} stroke="#3F7A5A" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.6" />
                      </svg>
                      <span className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none grid place-items-center" style={{ left: `${zoneMarker.mid.x}%`, top: `${zoneMarker.mid.y}%` }}>
                        <span className="w-3.5 h-3.5 rotate-45 border-2 border-moss-500 bg-white/80" />
                        <span className="absolute top-5 text-[10px] font-bold whitespace-nowrap text-moss-600">Middle zone</span>
                      </span>
                    </>
                  )}
                  {probe && <span className="absolute -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-forest-700 bg-white/70" style={{ left: `${probe.x}%`, top: `${probe.y}%` }} />}
                  {placed.map((m) => {
                    const p = points.find((q) => q.id === m.id)!;
                    const isSel = selected === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setSelected(m.id)}
                        className="absolute -translate-x-1/2 -translate-y-1/2 group"
                        style={{ left: `${m.x}%`, top: `${m.y}%` }}
                      >
                        <span
                          className={`relative grid place-items-center w-10 h-10 rounded-full border-2 transition-all ${
                            isSel ? 'scale-125 border-forest-700 bg-white shadow-lg' : 'border-white bg-white/80 group-hover:scale-110'
                          }`}
                        >
                          <span className="w-3 h-3 rounded-full bg-moss-500" />
                        </span>
                        <span className={`absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-bold whitespace-nowrap ${isSel ? 'text-forest-700' : 'text-forest-700/50'}`}>
                          {p.point_name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="relative mt-4">
                <MiddleZonePanel points={points} readings={readings} pair={zonePair} onPairChange={setZonePair} day={day} tz={tz} />
              </div>

              {placed.length > 0 && (
                <div className="relative mt-4 rounded-2xl bg-white/50 border border-white/60 p-4 text-xs text-forest-700/70">
                  {!probe ? (
                    <p>Tap an empty spot on the map to estimate the values there from the sensors around it (no extra sensor needed).</p>
                  ) : (
                    <div className="space-y-1">
                      <p className="font-semibold text-forest-700">Estimate at this spot (not a measurement)</p>
                      {VARIABLES.map((v) => {
                        const r = estimateFor(v.key);
                        return (
                          <p key={v.key}>
                            {v.label}:{' '}
                            {r && r.status === 'ok'
                              ? `${r.value.toFixed(v.digits)} ${v.unit} ± ${r.looRmse.toFixed(v.digits)} (from ${r.sensors} sensors${r.outsideSensorArea ? ', outside the sensor area' : ''})`
                              : 'needs at least 3 sensors with coordinates and a reading today'}
                          </p>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {unplaced.length > 0 && (
                <div className="relative mt-5 flex flex-wrap gap-2">
                  {placed.length > 0 && <p className="w-full text-[11px] text-forest-700/50">Points without coordinates:</p>}
                  {unplaced.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelected(p.id)}
                      className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                        selected === p.id ? 'bg-forest-600 text-cream-100 shadow' : 'bg-white/60 text-forest-700/70 hover:bg-forest-600 hover:text-cream-100'
                      }`}
                    >
                      {p.point_name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-2 glass-card p-6 sm:p-7 flex flex-col">
              {point && (
                <>
                  <h3 className="font-display text-2xl font-semibold text-forest-700">{point.point_name}</h3>
                  <p className="text-sm text-forest-700/60">
                    {field.crop_name ?? 'Crop not set'}
                    {field.soil ? ` · ${field.soil.soil_name} soil` : ''}
                  </p>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    {VARIABLES.map((v) => {
                      const val = pointValueToday(readings, point.id, v.key, day, tz);
                      return (
                        <div key={v.key} className="rounded-2xl bg-white/50 border border-white/60 p-3">
                          <p className="text-[10px] uppercase tracking-wide text-forest-700/50 font-semibold">{v.label}</p>
                          {val ? (
                            <>
                              <p className="font-display text-xl font-semibold text-forest-700 mt-0.5">
                                {val.value.toFixed(v.digits)}
                                <span className="text-xs text-forest-700/40 ml-1">{v.unit}</span>
                              </p>
                              <p className="text-[10px] text-forest-700/50">last at {formatLocalTime(val.measuredAt, tz)}</p>
                            </>
                          ) : (
                            <p className="text-sm text-forest-700/50 mt-1">Not measured today</p>
                          )}
                        </div>
                      );
                    })}
                    {NPK.map((n) => (
                      <div key={n} className="rounded-2xl bg-white/30 border border-white/60 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-forest-700/50 font-semibold">{n}</p>
                        <p className="text-sm text-forest-700/50 mt-1">Not measured</p>
                      </div>
                    ))}
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
