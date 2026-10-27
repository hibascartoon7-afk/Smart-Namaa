import { useState } from 'react';
import { X, Loader2, MailCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { friendlyAuthError, validateEmail, validateSignIn, validateSignUp, MIN_PASSWORD_LENGTH } from '@/lib/auth-validation';

type Mode = 'signin' | 'signup' | 'reset';

const INPUT = 'w-full bg-white/70 rounded-xl px-4 py-3 text-sm text-forest-700 outline-none focus:bg-white transition';

function Err({ text }: { text?: string }) {
  return text ? <p className="text-[11px] text-rose-500 mt-1">{text}</p> : null;
}

export default function AuthModal({ open = true, onClose }: { open?: boolean; onClose: () => void }) {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const switchMode = (m: Mode) => {
    setMode(m);
    setErrors({});
    setMessage(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (mode === 'reset') {
      const err = validateEmail(email);
      setErrors({ email: err ?? undefined });
      if (err) return;
      setBusy(true);
      const { error } = await resetPassword(email.trim());
      setBusy(false);
      setMessage(error ? { kind: 'error', text: friendlyAuthError(error) } : { kind: 'info', text: 'If this email has an account, a link to choose a new password was sent.' });
      return;
    }

    if (mode === 'signup') {
      const errs = validateSignUp({ name, email, password, confirm });
      setErrors(errs);
      if (Object.keys(errs).length) return;
      setBusy(true);
      const { error, needsConfirmation } = await signUp(name, email.trim(), password);
      setBusy(false);
      if (error) return setMessage({ kind: 'error', text: friendlyAuthError(error) });
      if (needsConfirmation) {
        setPassword('');
        setConfirm('');
        setMode('signin');
        return setMessage({ kind: 'info', text: `Your account was created. We sent a confirmation link to ${email.trim()}. Open it, then sign in here.` });
      }
      return onClose(); // signed in already
    }

    const errs = validateSignIn(email, password);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error) return setMessage({ kind: 'error', text: friendlyAuthError(error) });
    onClose();
  };

  const title = mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Welcome back';

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-forest-900/40 backdrop-blur-sm p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-md glass rounded-3xl shadow-2xl p-7 my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-display text-2xl font-semibold text-forest-700">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="grid place-items-center w-9 h-9 rounded-full bg-white/50 text-forest-700/60 hover:bg-forest-600 hover:text-cream-100 transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4" noValidate>
          {mode === 'signup' && (
            <div>
              <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
              <Err text={errors.name} />
            </div>
          )}
          <div>
            <input className={INPUT} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="email" />
            <Err text={errors.email} />
          </div>
          {mode !== 'reset' && (
            <div>
              <input
                className={INPUT} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? `Password (at least ${MIN_PASSWORD_LENGTH} characters)` : 'Password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
              <Err text={errors.password} />
            </div>
          )}
          {mode === 'signup' && (
            <div>
              <input className={INPUT} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat the password" autoComplete="new-password" />
              <Err text={errors.confirm} />
            </div>
          )}

          {message && (
            <p className={`text-xs rounded-lg px-3 py-2 border flex gap-2 items-start ${message.kind === 'error' ? 'text-rose-600 bg-rose-50 border-rose-200' : 'text-forest-700 bg-moss-50 border-moss-200'}`}>
              {message.kind === 'info' && <MailCheck className="w-4 h-4 shrink-0 mt-0.5" />}
              <span>{message.text}</span>
            </p>
          )}

          <button type="submit" disabled={busy} className="w-full btn-primary disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
          </button>
        </form>

        <div className="mt-5 flex flex-col items-center gap-2 text-sm text-forest-700/70">
          {mode === 'signin' && (
            <>
              <button onClick={() => switchMode('signup')} className="font-semibold text-forest-600 hover:text-moss-600 hover:underline">New here? Create an account</button>
              <button onClick={() => switchMode('reset')} className="text-xs hover:text-moss-600 hover:underline">Forgot your password?</button>
            </>
          )}
          {mode !== 'signin' && (
            <button onClick={() => switchMode('signin')} className="font-semibold text-forest-600 hover:text-moss-600 hover:underline">Back to sign in</button>
          )}
        </div>
      </div>
    </div>
  );
}
