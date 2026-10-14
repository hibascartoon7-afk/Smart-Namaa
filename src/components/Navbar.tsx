import { useEffect, useState } from 'react';
import { Menu, X, Leaf, LogOut, User as UserIcon, Sparkles } from 'lucide-react';
import { useAuth } from '@/lib/auth';

const LINKS = [
  { href: '#field', label: 'Field Map' },
  { href: '#dashboard', label: 'Dashboard' },
  { href: '#advisories', label: 'AI Alerts' },
  { href: '#savings', label: 'Sustainability' },
];

const AI_LINK = { label: 'AI Assistant' };

export default function Navbar({ onAskAI, onAuthClick, onNavigateToAI }: { onAskAI: () => void; onAuthClick: () => void; onNavigateToAI: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { user, signOut } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${scrolled ? 'glass shadow-md py-3' : 'py-5 bg-transparent'}`}>
      <nav className="max-w-7xl mx-auto px-5 sm:px-8 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-2.5 group">
          <span className="relative grid place-items-center w-10 h-10 rounded-2xl bg-forest-600 text-cream-100 shadow-lg shadow-forest-700/30 group-hover:scale-105 transition-transform">
            <Leaf className="w-5 h-5" strokeWidth={2.2} />
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-display text-xl font-semibold text-forest-700">NAMAA</span>
            <span className="text-[10px] tracking-[0.25em] text-moss-500 font-semibold uppercase">نماء</span>
          </span>
        </a>

        <div className="hidden md:flex items-center gap-1">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="px-4 py-2 rounded-full text-sm font-medium text-forest-700/80 hover:text-forest-700 hover:bg-white/50 transition-all">{l.label}</a>
          ))}
          <button onClick={onNavigateToAI} className="px-4 py-2 rounded-full text-sm font-medium text-forest-700/80 hover:text-forest-700 hover:bg-white/50 transition-all flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            {AI_LINK.label}
          </button>
          <button onClick={onAskAI} className="btn-primary !py-2.5 !px-5 ml-2 text-sm">Ask NAMAA AI</button>
          {user ? (
            <div className="flex items-center gap-2 ml-2">
              <span className="flex items-center gap-1.5 text-xs text-forest-700/60 bg-white/40 rounded-full px-3 py-1.5">
                <UserIcon className="w-3.5 h-3.5" />
                {user.email?.split('@')[0]}
              </span>
              <button onClick={() => void signOut()} className="grid place-items-center w-9 h-9 rounded-full bg-white/40 text-forest-700/60 hover:bg-white/70 transition" aria-label="Sign out">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button onClick={onAuthClick} className="btn-ghost !py-2.5 !px-5 ml-2 text-sm">Sign in</button>
          )}
        </div>

        <button className="md:hidden grid place-items-center w-10 h-10 rounded-xl glass" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu">
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </nav>

      {open && (
        <div className="md:hidden mt-3 mx-5 glass rounded-3xl p-4 flex flex-col gap-1 animate-fade-up">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="px-4 py-3 rounded-2xl text-sm font-medium text-forest-700 hover:bg-white/50">{l.label}</a>
          ))}
          <button onClick={() => { setOpen(false); onNavigateToAI(); }} className="flex items-center gap-1.5 px-4 py-3 rounded-2xl text-sm font-medium text-forest-700 hover:bg-white/50 mt-1">
            <Sparkles className="w-3.5 h-3.5" />
            AI Assistant
          </button>
          <button onClick={() => { setOpen(false); onAskAI(); }} className="btn-primary mt-2 text-sm">Ask NAMAA AI</button>
          {user ? (
            <button onClick={() => { setOpen(false); void signOut(); }} className="btn-ghost mt-1 text-sm">Sign out ({user.email?.split('@')[0]})</button>
          ) : (
            <button onClick={() => { setOpen(false); onAuthClick(); }} className="btn-ghost mt-1 text-sm">Sign in</button>
          )}
        </div>
      )}
    </header>
  );
}
