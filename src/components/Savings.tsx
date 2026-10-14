import { useEffect, useState } from 'react';
import { Sprout, Droplets, Leaf, TrendingUp, DollarSign } from 'lucide-react';
import { SAVINGS } from '@/data';

function useCountUp(target: number, duration = 1400) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start: number | null = null;
    let raf = 0;
    const step = (t: number) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(target * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function StatCard({
  icon: Icon, label, value, unit, baseline, color, sublabel,
}: {
  icon: typeof Sprout; label: string; value: number; unit: string; baseline: string; color: string; sublabel: string;
}) {
  const animated = useCountUp(value);
  const display = value < 100 ? animated.toFixed(1) : Math.round(animated).toString();
  return (
    <div className="glass-card glass-card-hover p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="grid place-items-center w-12 h-12 rounded-2xl" style={{ background: `${color}22` }}>
          <Icon className="w-6 h-6" style={{ color }} strokeWidth={1.8} />
        </div>
        <span className="text-[10px] uppercase tracking-wide text-forest-700/40 font-semibold">{baseline}</span>
      </div>
      <p className="font-display text-4xl font-semibold text-forest-700">
        {display}<span className="text-lg text-forest-700/50 ml-1">{unit}</span>
      </p>
      <p className="text-sm font-semibold text-forest-700/70 mt-1">{label}</p>
      <p className="text-xs text-forest-700/40 mt-0.5">{sublabel}</p>
    </div>
  );
}

export default function Savings() {
  return (
    <section id="savings" className="relative py-24 sm:py-32 bg-gradient-to-b from-transparent via-cream-200/20 to-transparent">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="max-w-2xl mb-12">
          <p className="section-eyebrow mb-3">Sustainability &amp; ROI</p>
          <h2 className="font-display text-4xl sm:text-5xl font-semibold text-forest-700 text-balance">
            Less input, more yield, lighter footprint.
          </h2>
          <p className="mt-4 text-forest-700/60 text-pretty">
            Live counters comparing NAMAA-managed application against blanket conventional
            baselines — fertilizer, water, and carbon all tracked per hectare.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <StatCard icon={Sprout} label="Fertilizer saved" value={SAVINGS.fertilizerSavedKgHa} unit="kg/ha" baseline={`vs ${SAVINGS.fertilizerBaselineKgHa} kg/ha blanket`} color="#839958" sublabel="N-P-K precision dosing" />
          <StatCard icon={Droplets} label="Water saved" value={SAVINGS.waterSavedM3} unit="m³" baseline={`vs ${SAVINGS.waterBaselineM3} m³ blanket`} color="#105666" sublabel="Rain-aware irrigation" />
          <StatCard icon={Leaf} label="CO₂e reduced" value={SAVINGS.co2eReducedKg} unit="kg" baseline={`vs ${SAVINGS.co2eBaselineKg} kg baseline`} color="#3F7A5A" sublabel="Avoided N₂O emissions" />
          <StatCard icon={DollarSign} label="Cost saved" value={SAVINGS.costSavedUsd} unit="USD" baseline="season to date" color="#D3968C" sublabel="Input + energy" />
        </div>

        {/* Yield uplift banner */}
        <div className="mt-6 glass-card p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-6">
          <div className="grid place-items-center w-16 h-16 rounded-3xl bg-forest-600 text-cream-100 shrink-0">
            <TrendingUp className="w-8 h-8" strokeWidth={1.8} />
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h3 className="font-display text-2xl font-semibold text-forest-700">
              +{SAVINGS.yieldUpliftPct}% yield uplift this season
            </h3>
            <p className="text-sm text-forest-700/60 mt-1">
              Measured against the same field's 3-year conventional average. Driven by
              micro-topography-adjusted irrigation and rain-aware nutrient timing.
            </p>
          </div>
          <div className="flex gap-6 text-center">
            <div>
              <p className="font-display text-2xl font-semibold text-moss-500">{Math.round(SAVINGS.fertilizerSavedKgHa / SAVINGS.fertilizerBaselineKgHa * 100)}%</p>
              <p className="text-[10px] uppercase tracking-wide text-forest-700/40">fert cut</p>
            </div>
            <div>
              <p className="font-display text-2xl font-semibold text-forest-600">{Math.round(SAVINGS.waterSavedM3 / SAVINGS.waterBaselineM3 * 100)}%</p>
              <p className="text-[10px] uppercase tracking-wide text-forest-700/40">water cut</p>
            </div>
            <div>
              <p className="font-display text-2xl font-semibold text-rose-400">{Math.round(SAVINGS.co2eReducedKg / SAVINGS.co2eBaselineKg * 100)}%</p>
              <p className="text-[10px] uppercase tracking-wide text-forest-700/40">CO₂e cut</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
