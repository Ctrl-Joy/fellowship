import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api';
import { useSession } from '../store/session';
import { LogoMark } from '../components/Logo';
import type { User } from '../types';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const [params] = useSearchParams();
  const next = params.get('next') || '/workspaces';
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = mode === 'login'
        ? await api.post<{ user: User }>('/api/auth/login', { email, password })
        : await api.post<{ user: User }>('/api/auth/signup', { email, password, fullName, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      useSession.getState().setMe(r.user);
      navigate(next, { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const other = mode === 'login' ? '/signup' : '/login';
  return (
    <div className="auth">
      <div className="auth-brand">
        <LogoMark size={56} />
        <h1>Fellowship</h1>
        <p>Where your team talks, decides and gets things done — together.</p>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Sign in to Fellowship' : 'Create your account'}</h2>
        {mode === 'signup' && (
          <label className="field"><span>Full name</span>
            <input className="input" autoFocus required value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
          </label>
        )}
        <label className="field"><span>Email</span>
          <input className="input" type="email" autoFocus={mode === 'login'} required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" />
        </label>
        <label className="field"><span>Password</span>
          <input className="input" type="password" required minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'signup' ? 'At least 8 characters' : ''} />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <p className="muted center">
          {mode === 'login' ? 'New to Fellowship? ' : 'Already have an account? '}
          <Link to={`${other}${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}>{mode === 'login' ? 'Create an account' : 'Sign in'}</Link>
        </p>
      </form>
    </div>
  );
}
