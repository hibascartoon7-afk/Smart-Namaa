import { Diamond } from 'lucide-react';
import type { Reading, SensorPoint, VariableKey } from '@/lib/field-math';
import { middleZoneValues, type Pair } from '@/lib/middle-zone';

const ROWS: { key: VariableKey; label: string; unit: string; digits: number }[] = [
  { key: 'moisture', label: 'Moisture', unit: '%', digits: 0 },
  { key: 'soil_temperature', label: 'Soil temp', unit: '°C', digits: 1 },
  { key: 'ec', label: 'EC', unit: 'dS/m', digits: 1 },
];

export default function MiddleZonePanel({
  points, readings, pair, onPairChange, day, tz,
}: {
  points: SensorPoint[];
  readings: Reading[];
  pair: Pair | null;
  onPairChange: (p: Pair) => void;
  day: string;
  tz: string | null;
}) {
  if (!pair) {
    return (
      <div className="rounded-2xl bg-white/50 border border-white/60 p-4 text-xs text-forest-700/70">
        <p className="font-semibold text-forest-700 flex items-center gap-1.5"><Diamond className="w-3.5 h-3.5 text-moss-500" /> Middle zone (estimate)</p>
        <p className="mt-1">Needs at least two sensor points in this environment.</p>
      </div>
    );
  }
  const name = (id: string) => points.find((p) => p.id === id)?.point_name ?? '?';
  const values = middleZoneValues(points, readings, pair, day, tz);
  return (
    <div className="rounded-2xl bg-white/50 border border-white/60 p-4 text-xs text-forest-700/70">
      <p className="font-semibold text-forest-700 flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <Diamond className="w-3.5 h-3.5 text-moss-500" />
        Middle zone between
        {points.length > 2 ? (
          <>
            <select aria-label="First sensor point" value={pair[0]} onChange={(e) => onPairChange([e.target.value, pair[1]])} className="rounded-md border border-forest-100 bg-white/80 px-1 py-0.5">
              {points.filter((p) => p.id !== pair[1]).map((p) => <option key={p.id} value={p.id}>{p.point_name}</option>)}
            </select>
            and
            <select aria-label="Second sensor point" value={pair[1]} onChange={(e) => onPairChange([pair[0], e.target.value])} className="rounded-md border border-forest-100 bg-white/80 px-1 py-0.5">
              {points.filter((p) => p.id !== pair[0]).map((p) => <option key={p.id} value={p.id}>{p.point_name}</option>)}
            </select>
          </>
        ) : (
          <>{name(pair[0])} and {name(pair[1])}</>
        )}
        <span className="font-normal text-forest-700/50">(estimate, not a measurement)</span>
      </p>

      <div className="mt-2 space-y-1">
        {ROWS.map((r) => {
          const z = values[r.key];
          return (
            <p key={r.key}>
              {r.label}:{' '}
              {z.status === 'ok' ? (
                <>
                  <span className="font-semibold text-forest-700">≈ {z.value.toFixed(r.digits)} {r.unit}</span>
                  {` · mean of ${z.low.value.toFixed(r.digits)} (${z.low.name}) and ${z.high.value.toFixed(r.digits)} (${z.high.name}) · difference ${z.difference.toFixed(r.digits)} ${r.unit}`}
                </>
              ) : (
                `not available: no usable reading today at ${z.missing.join(' and ')}`
              )}
            </p>
          );
        })}
        <p>Nitrogen, Phosphorus, Potassium: not measured.</p>
      </div>

      <p className="mt-2 text-[11px] text-forest-700/50 text-pretty">
        The mean of the two readings. The real value between the sensors can be higher or lower (a wet patch or a dry spot between them cannot be seen), and with two sensors the error cannot be checked. It is shown for information only: the irrigation decision uses each sensor point&apos;s own reading.
      </p>
    </div>
  );
}
