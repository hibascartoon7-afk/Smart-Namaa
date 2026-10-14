import { useState } from 'react';
import { Leaf, X, Loader2, Mail, Lock } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export default function AuthModal({ onClose }: { onClose: () => void }) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const fn = mode === 'signin' ? signIn : signUp;
    const { error: fnError } = await fn(email.trim(), password);
    setLoading(false);
    if (fnError) {
      setError(fnError);
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-forest-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md glass rounded-3xl shadow-2xl p-7 animate-fade-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <span className="grid place-items-center w-10 h-10 rounded-2xl bg-forest-600 text-cream-100">
              <Leaf className="w-5 h-5" strokeWidth={2.2} />
            </span>
            <div>
              <p className="font-display text-lg font-semibold text-forest-700">NAMAA</p>
              <p className="text-[10px] tracking-[0.2em] text-moss-500 font-semibold uppercase">AI Agronomist</p>
            </div>
          </div>
          <button onClick={onClose} className="grid place-items-center w-9 h-9 rounded-full bg-white/50 text-forest-700/60 hover:bg-white transition" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-1 bg-white/40 rounded-full p-1 mb-5">
          {(['signin', 'signup'] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(''); }}
              className={`flex-1 rounded-full py-2 text-sm font-semibold transition ${mode === m ? 'bg-forest-600 text-cream-100 shadow' : 'text-forest-700/60 hover:text-forest-700'}`}
            >
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-forest-700/60 mb-1.5 block">Email</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-forest-700/40" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="farmer@namaa.ag"
                className="w-full bg-white/70 rounded-xl pl-10 pr-4 py-3 text-sm text-forest-700 outline-none focus:bg-white transition"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-forest-700/60 mb-1.5 block">Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-forest-700/40" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-white/70 rounded-xl pl-10 pr-4 py-3 text-sm text-forest-700 outline-none focus:bg-white transition"
              />
            </div>
          </div>

          {error && <p className="text-xs text-rose-500 bg-rose-50 rounded-lg px-3 py-2 border border-rose-200">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary justify-center disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (mode === 'signin' ? 'Sign in' : 'Create account')}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] text-forest-700/40">
          {mode === 'signin' ? 'New to NAMAA? Switch to Create account above.' : 'Already have an account? Switch to Sign in above.'}
        </p>
      </div>
    </div>
  );
}
