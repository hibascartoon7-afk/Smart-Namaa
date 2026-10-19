import { Construction, TrendingUp } from 'lucide-react';

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
  <section
    id="savings"
    className="relative py-24 sm:py-32 bg-gradient-to-b from-transparent via-cream-200/20 to-transparent"
  >
    <div className="max-w-7xl mx-auto px-5 sm:px-8">

      <div className="max-w-2xl mb-12">
        <p className="section-eyebrow mb-3">
          Sustainability & ROI
        </p>

        <h2 className="font-display text-4xl sm:text-5xl font-semibold text-forest-700">
          Water Saving Analytics
        </h2>

        <p className="mt-4 text-forest-700/60">
          Water-saving calculations and sustainability metrics are currently
          being integrated with the NAMAA decision engine and real field data.
        </p>
      </div>

      <div className="glass-card p-10 text-center">

        <div className="text-6xl mb-4">
          🚧
        </div>

        <h3 className="font-display text-3xl font-semibold text-forest-700 mb-4">
          Under Development
        </h3>

        <p className="text-forest-700/60 max-w-2xl mx-auto">
          This module will calculate water savings, fertilizer optimization,
          sustainability indicators, and irrigation efficiency using ETc,
          weather observations, sensor readings, and historical irrigation
          records.
        </p>

        <div className="mt-6 text-sm text-forest-700/40">
          Based on FAO irrigation methodologies and crop-specific water demand models.
        </div>

      </div>
    </div>
  </section>
);
