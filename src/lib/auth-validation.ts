// Checks of the sign-up / sign-in forms (pure functions, tested). The server (Supabase) checks again.

export interface SignUpForm { name: string; email: string; password: string; confirm: string }
export type SignUpErrors = Partial<Record<keyof SignUpForm, string>>;

export const MIN_PASSWORD_LENGTH = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function cleanName(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function validateEmail(email: string): string | null {
  const e = email.trim();
  if (!e) return 'Enter your email.';
  return EMAIL.test(e) ? null : 'This email does not look right.';
}

export function validateSignIn(email: string, password: string): { email?: string; password?: string } {
  const errors: { email?: string; password?: string } = {};
  const e = validateEmail(email);
  if (e) errors.email = e;
  if (!password) errors.password = 'Enter your password.';
  return errors;
}

export function validateSignUp(form: SignUpForm): SignUpErrors {
  const errors: SignUpErrors = {};
  const name = cleanName(form.name);
  if (name.length < 2) errors.name = 'Enter your name (at least 2 letters).';
  else if (name.length > 50) errors.name = 'Use at most 50 characters.';
  const e = validateEmail(form.email);
  if (e) errors.email = e;
  if (form.password.length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (form.confirm !== form.password) errors.confirm = 'The two passwords are different.';
  return errors;
}

/** name shown in the app: the name given at sign-up, else the part of the email before @ */
export function displayNameOf(user: { email?: string | null; user_metadata?: Record<string, unknown> | null } | null): string {
  if (!user) return '';
  const meta = user.user_metadata?.full_name;
  if (typeof meta === 'string' && cleanName(meta)) return cleanName(meta);
  return (user.email ?? '').split('@')[0];
}

/** Supabase error text -> a clear sentence for the person */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email or password is wrong.';
  if (m.includes('email not confirmed')) return 'Please open the confirmation link we sent to your email first.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'This email already has an account. Try signing in.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many tries. Please wait a minute and try again.';
  if (m.includes('password') && m.includes('characters')) return `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (m.includes('failed to fetch') || m.includes('network')) return 'Could not reach the server. Check your internet connection.';
  return message;
}
