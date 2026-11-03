import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../api';
import { useSession } from '../store/session';
import type { User } from '../types';
import { AuthShell, authQuery } from './AuthPage';

/** Seconds left before another code may be requested. */
function useCooldown(initial: number) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft] as const;
}

function CodeInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <input className="input code-input" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
      required autoFocus={autoFocus} placeholder="000000" aria-label="6-digit code"
      value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} />
  );
}

/** Resend button with cooldown; `send` posts and returns the server's `resendAfter`. */
function ResendButton({ send, initialCooldown, onError, onSent }: {
  send: () => Promise<{ resendAfter?: number }>; initialCooldown: number;
  onError: (m: string) => void; onSent: () => void;
}) {
  const [left, setLeft] = useCooldown(initialCooldown);
  const [busy, setBusy] = useState(false);
  const click = async () => {
    setBusy(true);
    try {
      const r = await send();
      setLeft(r.resendAfter ?? 60);
      onSent();
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'rate_limited') {
        const retry = Number(err.details?.retryAfter) || 60;
        setLeft(retry);
      }
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="btn btn-ghost" disabled={busy || left > 0} onClick={click}>
      {left > 0 ? `Resend code in ${left}s` : busy ? 'Sending…' : 'Resend code'}
    </button>
  );
}

function finishSignIn(user: User, navigate: ReturnType<typeof useNavigate>, next: string) {
  useSession.getState().setMe(user);
  navigate(next, { replace: true });
}

/** `/verify?email=` (code entry) or `/verify?token=` (magic-link landing). */
export function VerifyPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const nextParam = params.get('next');
  const next = nextParam || '/workspaces';
  const token = params.get('token');
  const email = params.get('email') ?? '';
  const signin = params.get('signin') === '1';
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(params.get('unsent') ? 'We could not send the email. Try resending in a moment.' : null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const linkTried = useRef(false);

  useEffect(() => {
    if (!token || linkTried.current) return;
    linkTried.current = true;
    api.post<{ user: User }>('/api/auth/verify', { token })
      .then((r) => finishSignIn(r.user, navigate, next))
      .catch((err) => setError(err.message));
  }, [token, navigate, next]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const r = await api.post<{ user: User }>('/api/auth/verify', { email, code });
      finishSignIn(r.user, navigate, next);
    } catch (err: any) {
      setError(err.message);
      if (err instanceof ApiError && (err.code === 'too_many_attempts' || err.code === 'code_expired')) setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (token) {
    return (
      <AuthShell>
        <h2>Confirming your email</h2>
        {error ? (
          <>
            <div className="form-error" role="alert">{error}</div>
            <p className="muted">Sign in to get a fresh code, or open the newest email we sent.</p>
            <Link className="btn btn-primary btn-lg" to={`/login${authQuery('', nextParam)}`}>Back to sign in</Link>
          </>
        ) : (
          <div className="loading-block"><span className="spinner" /> Signing you in…</div>
        )}
      </AuthShell>
    );
  }

  if (!email) {
    return (
      <AuthShell>
        <h2>Check your email</h2>
        <p className="muted">Open the link in the email we sent, or sign in to get a new code.</p>
        <Link className="btn btn-primary btn-lg" to={`/login${authQuery('', nextParam)}`}>Back to sign in</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell onSubmit={submit}>
      <h2>{signin ? 'Enter your sign-in code' : 'Check your email'}</h2>
      <p className="muted auth-lead">
        We sent a 6-digit code to <strong className="auth-email">{email}</strong>. Enter it below, or click the link in the
        email. It expires in 15 minutes.
      </p>
      <CodeInput value={code} onChange={setCode} autoFocus />
      {error && <div className="form-error" role="alert">{error}</div>}
      {info && <div className="auth-info" role="status">{info}</div>}
      <button className="btn btn-primary btn-lg" disabled={busy || code.length !== 6}>
        {busy ? 'Checking…' : signin ? 'Sign in' : 'Verify and continue'}
      </button>
      <div className="row auth-actions">
        <ResendButton initialCooldown={params.get('unsent') ? 0 : 60}
          send={() => api.post('/api/auth/resend', { email })}
          onError={(m) => { setInfo(null); setError(m); }}
          onSent={() => { setError(null); setInfo(`New code sent to ${email}.`); setCode(''); }} />
        <Link className="link small" to={`/login${authQuery(email, nextParam)}`}>Use a different email</Link>
      </div>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const nextParam = params.get('next');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/password/forgot', { email: email.trim() });
      navigate(`/reset-password${authQuery(email.trim(), nextParam)}`);
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'rate_limited') navigate(`/reset-password${authQuery(email.trim(), nextParam)}`);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell onSubmit={submit}>
      <h2>Reset your password</h2>
      <p className="muted auth-lead">Enter your account's email and we'll send you a code to choose a new password.</p>
      <label className="field"><span>Email</span>
        <input className="input" type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" />
      </label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Sending…' : 'Send reset code'}</button>
      <p className="muted center"><Link to={`/login${authQuery(email.trim(), nextParam)}`}>Back to sign in</Link></p>
    </AuthShell>
  );
}

/** `/reset-password?email=` (code + new password) or `?token=` (from the emailed link). */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const nextParam = params.get('next');
  const token = params.get('token');
  const email = params.get('email') ?? '';
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: User }>('/api/auth/password/reset', token ? { token, password } : { email, code, password });
      finishSignIn(r.user, navigate, nextParam || '/workspaces');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!token && !email) {
    return (
      <AuthShell>
        <h2>Reset your password</h2>
        <p className="muted">This page needs the link from your reset email.</p>
        <Link className="btn btn-primary btn-lg" to="/forgot-password">Request a reset code</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell onSubmit={submit}>
      <h2>Choose a new password</h2>
      {!token && (
        <>
          <p className="muted auth-lead">If <strong className="auth-email">{email}</strong> has an account, we sent it a 6-digit code.</p>
          <CodeInput value={code} onChange={setCode} autoFocus />
        </>
      )}
      <label className="field"><span>New password</span>
        <input className="input" type="password" required minLength={8} autoFocus={!!token} value={password}
          onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" />
      </label>
      {error && <div className="form-error" role="alert">{error}</div>}
      {info && <div className="auth-info" role="status">{info}</div>}
      <button className="btn btn-primary btn-lg" disabled={busy || (!token && code.length !== 6)}>{busy ? 'Saving…' : 'Set password and sign in'}</button>
      {!token && (
        <div className="row auth-actions">
          <ResendButton initialCooldown={60}
            send={() => api.post('/api/auth/password/forgot', { email })}
            onError={(m) => { setInfo(null); setError(m); }}
            onSent={() => { setError(null); setInfo(`New code sent to ${email}.`); setCode(''); }} />
          <Link className="link small" to={`/login${authQuery(email, nextParam)}`}>Back to sign in</Link>
        </div>
      )}
    </AuthShell>
  );
}
