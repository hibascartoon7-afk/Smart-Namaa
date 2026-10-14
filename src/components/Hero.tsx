import { ArrowRight, Radio, CloudRain, Cpu, Sparkles } from 'lucide-react';
import HeroBotanical from './HeroBotanical';

export default function Hero() {
  return (
    <section id="top" className="relative min-h-screen flex items-center pt-28 pb-16 overflow-hidden">
      {/* Background layers */}
      <div className="absolute inset-0 topo-lines opacity-60" />
      <div className="absolute -top-32 -right-32 w-[40rem] h-[40rem] rounded-full bg-moss-200/30 blur-3xl animate-float-slow" />
      <div className="absolute -bottom-40 -left-32 w-[36rem] h-[36rem] rounded-full bg-forest-200/20 blur-3xl animate-float-med" />

      <div className="relative max-w-7xl mx-auto px-5 sm:px-8 grid lg:grid-cols-2 gap-12 items-center w-full">
        {/* Copy */}
        <div className="animate-fade-up">
          <span className="pill bg-moss-100 text-moss-600 mb-5">
            <Sparkles className="w-3.5 h-3.5" />
            Sub-Surface Soil Intelligence
          </span>
          <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-semibold leading-[1.05] text-balance text-forest-700">
            Precision agriculture,{' '}
            <span className="heading-gradient">rooted in the soil.</span>
          </h1>
          <p className="mt-6 text-lg text-forest-700/70 max-w-xl text-pretty">
            NAMAA fuses 7-in-1 sub-surface IoT sensors with micro-topography and live
            weather into plain-language instructions — so every drop of water and every
            gram of fertilizer lands exactly where the roots need it.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#field" className="btn-primary">
              View live field
              <ArrowRight className="w-4 h-4" />
            </a>
            <a href="#chat" className="btn-ghost">
              Talk to Ghaith &amp; Nada
            </a>
          </div>

          <div className="mt-10 flex flex-wrap gap-x-8 gap-y-4 text-sm text-forest-700/60">
            <span className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-moss-500" /> LoRa mesh · offline-ready
            </span>
            <span className="flex items-center gap-2">
              <CloudRain className="w-4 h-4 text-forest-500" /> Rain-aware advisories
            </span>
            <span className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-rose-400" /> 7-in-1 sensor fusion
            </span>
          </div>
        </div>

        {/* 3D botanical */}
        <div className="relative animate-fade-up animate-delay-300">
          <div className="relative aspect-square max-w-lg mx-auto">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-moss-100/40 to-forest-100/30 blur-2xl" />
            <HeroBotanical className="relative w-full h-full" />
            <div className="absolute top-6 right-2 glass rounded-2xl px-4 py-3 text-xs animate-float-med">
              <p className="text-moss-500 font-semibold">2nd Soil Layer</p>
              <p className="text-forest-700/70">Shallow root absorption zone</p>
            </div>
            <div className="absolute bottom-8 left-0 glass rounded-2xl px-4 py-3 text-xs animate-float-slow animate-delay-1000">
              <p className="text-forest-600 font-semibold">6 Meters · Live</p>
              <p className="text-forest-700/70">N · P · K · EC · T · pH · VWC</p>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll cue */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-forest-700/40">
        <span className="text-[10px] tracking-[0.3em] uppercase">Scroll</span>
        <span className="w-px h-8 bg-forest-700/30 animate-pulse" />
      </div>
    </section>
  );
}
