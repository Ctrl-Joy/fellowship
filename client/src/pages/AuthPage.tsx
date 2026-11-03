import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../api';
import { useSession } from '../store/session';
import type { User } from '../types';

/** Brand panel + form card shared by every sign-in screen. */
export function AuthShell({ children, onSubmit }: { children: ReactNode; onSubmit?: (e: React.FormEvent) => void }) {
  return (
    <div className="auth">
      <div className="auth-brand">
        <Link to="/" className="auth-home" aria-label="Fellowship home">
          <svg width="26" height="23" viewBox="4 3 56 50" fill="none" stroke="#FA4C0D" strokeWidth="6" aria-hidden="true">
            <circle cx="32" cy="20" r="11" /><circle cx="23" cy="36" r="11" /><circle cx="41" cy="36" r="11" />
          </svg>
          FELLOWSHIP
        </Link>
        <div className="auth-words">
          <span className="auth-ghost" aria-hidden="true">Fellowship</span>
          <h1>Fellowship</h1>
          <span className="auth-ghost" aria-hidden="true">Fellowship</span>
        </div>
        <p>Where your community gathers. Channels, threads, huddles and workflows in one place.</p>
      </div>
      <form className="auth-card" onSubmit={onSubmit ?? ((e) => e.preventDefault())}>{children}</form>
    </div>
  );
}

/** `?email=…&next=…` for links between the auth screens. */
export function authQuery(email: string, next: string | null, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ ...(email ? { email } : {}), ...(next ? { next } : {}), ...extra });
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const [params] = useSearchParams();
  const nextParam = params.get('next');
  const next = nextParam || '/workspaces';
  const navigate = useNavigate();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [busy, setBusy] = useState(false);

  const toVerify = (extra: Record<string, string> = {}) => navigate(`/verify${authQuery(email.trim(), nextParam, extra)}`);

  /** Email a code, then go to the code screen. A cooldown 429 just means one is already on its way. */
  const sendCode = async (extra: Record<string, string> = {}) => {
    if (!email.trim()) { setError('Enter your email first'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/resend', { email: email.trim() });
      toVerify(extra);
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'rate_limited') toVerify(extra);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    try {
      if (mode === 'login') {
        const r = await api.post<{ user: User }>('/api/auth/login', { email, password });
        useSession.getState().setMe(r.user);
        navigate(next, { replace: true });
      } else {
        const r = await api.post<{ email: string; emailSent: boolean }>('/api/auth/signup', {
          email, password, fullName, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        navigate(`/verify${authQuery(r.email, nextParam, r.emailSent ? {} : { unsent: '1' })}`);
      }
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'email_unverified') setUnverified(true);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const other = mode === 'login' ? '/signup' : '/login';
  return (
    <AuthShell onSubmit={submit}>
      <h2>{mode === 'login' ? 'Sign in to Fellowship' : 'Create your account'}</h2>
      {mode === 'signup' && (
        <label className="field"><span>Full name</span>
          <input className="input" autoFocus required value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
        </label>
      )}
      <label className="field"><span>Email</span>
        <input className="input" type="email" autoFocus={mode === 'login'} required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" />
      </label>
      <label className="field">
        <span className="row" style={{ justifyContent: 'space-between' }}>
          Password
          {mode === 'login' && <Link className="link small" to={`/forgot-password${authQuery(email.trim(), nextParam)}`}>Forgot password?</Link>}
        </span>
        <input className="input" type="password" required minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'signup' ? 'At least 8 characters' : ''} />
      </label>
      {error && <div className="form-error" role="alert">{error}</div>}
      {unverified && (
        <div className="auth-notice" role="alert">
          <strong>Verify your email to sign in.</strong>
          <span>We need to confirm {email.trim() || 'your address'} belongs to you. We'll email you a 6-digit code.</span>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => sendCode()}>Send verification code</button>
        </div>
      )}
      <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      {mode === 'login' && (
        <button type="button" className="btn btn-lg" disabled={busy} onClick={() => sendCode({ signin: '1' })}>Email me a sign-in code</button>
      )}
      <p className="muted center">
        {mode === 'login' ? 'New to Fellowship? ' : 'Already have an account? '}
        <Link to={`${other}${nextParam ? `?next=${encodeURIComponent(next)}` : ''}`}>{mode === 'login' ? 'Create an account' : 'Sign in'}</Link>
      </p>
    </AuthShell>
  );
}
