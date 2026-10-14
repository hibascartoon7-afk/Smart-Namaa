import { Leaf, Radio, CloudRain, Cpu, ArrowUp } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="relative mt-12 pt-16 pb-8 bg-forest-700 text-cream-100 overflow-hidden">
      <div className="absolute inset-0 topo-lines opacity-20" />
      <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-24 rounded-full bg-moss-400/10 blur-3xl" />

      <div className="relative max-w-7xl mx-auto px-5 sm:px-8">
        <div className="grid md:grid-cols-4 gap-10 mb-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <span className="grid place-items-center w-10 h-10 rounded-2xl bg-cream-100/15 backdrop-blur">
                <Leaf className="w-5 h-5" strokeWidth={2.2} />
              </span>
              <div className="flex flex-col leading-none">
                <span className="font-display text-xl font-semibold">NAMAA</span>
                <span className="text-[10px] tracking-[0.25em] text-moss-200 font-semibold uppercase">نماء</span>
              </div>
            </div>
            <p className="text-sm text-cream-100/60 max-w-sm text-pretty">
              Precision agriculture driven by sub-surface soil intelligence. Empowering
              farmers with micro-localized, actionable insight — meter by meter.
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-moss-200 font-semibold mb-4">Platform</p>
            <ul className="space-y-2.5 text-sm text-cream-100/70">
              <li><a href="#field" className="hover:text-cream-100 transition">Field Map</a></li>
              <li><a href="#dashboard" className="hover:text-cream-100 transition">Sensor Dashboard</a></li>
              <li><a href="#advisories" className="hover:text-cream-100 transition">AI Advisories</a></li>
              <li><a href="#savings" className="hover:text-cream-100 transition">Sustainability</a></li>
            </ul>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-moss-200 font-semibold mb-4">Architecture</p>
            <ul className="space-y-2.5 text-sm text-cream-100/70">
              <li className="flex items-center gap-2"><Radio className="w-3.5 h-3.5 text-moss-300" /> LoRa mesh · offline</li>
              <li className="flex items-center gap-2"><Cpu className="w-3.5 h-3.5 text-moss-300" /> 7-in-1 sensor fusion</li>
              <li className="flex items-center gap-2"><CloudRain className="w-3.5 h-3.5 text-moss-300" /> Weather × GPS fusion</li>
              <li className="flex items-center gap-2"><Leaf className="w-3.5 h-3.5 text-moss-300" /> Topography-aware AI</li>
            </ul>
          </div>
        </div>

        <div className="pt-6 border-t border-cream-100/10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-cream-100/40">© 2026 NAMAA · نماء — Sub-Surface Soil Intelligence</p>
          <a href="#top" className="flex items-center gap-1.5 text-xs text-cream-100/60 hover:text-cream-100 transition">
            Back to top <ArrowUp className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </footer>
  );
}
