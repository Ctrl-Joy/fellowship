import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { useSession } from '../store/session';
import { loadWorkspaces, logout } from '../store/actions';
import { Wordmark } from '../components/Logo';
import { initials } from '../components/Avatar';
import type { Workspace } from '../types';

/** Pick, create or join a workspace. */
export function WorkspacesPage() {
  const me = useSession((s) => s.me)!;
  const workspaces = useSession((s) => s.workspaces);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => { loadWorkspaces().finally(() => setLoaded(true)); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.post<{ workspace: Workspace }>('/api/workspaces', { name });
      useSession.getState().upsertWorkspace(r.workspace);
      navigate(`/w/${r.workspace.id}`);
    } catch (err: any) { setError(err.message); }
  };

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const code = invite.trim().split('/').filter(Boolean).pop() ?? '';
    try {
      const r = await api.post<{ workspace: Workspace }>(`/api/workspaces/join/${encodeURIComponent(code)}`);
      useSession.getState().upsertWorkspace(r.workspace);
      navigate(`/w/${r.workspace.id}`);
    } catch (err: any) { setError(err.message); }
  };

  return (
    <div className="landing">
      <header className="landing-head">
        <Wordmark />
        <div className="row gap-sm"><span className="muted">{me.email}</span>
          <button className="btn btn-sm" onClick={async () => { await logout(); navigate('/login'); }}>Sign out</button></div>
      </header>
      <div className="landing-body">
        <h1>Welcome{workspaces.length ? ' back' : ''}, {me.displayName || me.fullName}</h1>
        {loaded && workspaces.length > 0 && (
          <section className="card-panel">
            <h3>Your workspaces</h3>
            <ul className="ws-list">
              {workspaces.map((w) => (
                <li key={w.id}>
                  <button onClick={() => navigate(`/w/${w.id}`)}>
                    <span className="ws-icon">{initials(w.name)}</span>
                    <span className="grow"><strong>{w.name}</strong><br /><span className="muted small">{w.slug} · {w.role}</span></span>
                    <span className="btn btn-sm btn-primary">Open</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="landing-grid">
          <form className="card-panel col gap" onSubmit={create}>
            <h3>Create a new workspace</h3>
            <p className="muted small">Start fresh with #general and #random, then invite your team.</p>
            <input className="input" required maxLength={80} placeholder="Workspace name, e.g. Acme Studio" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-primary" disabled={!name.trim()}>Create workspace</button>
          </form>
          <form className="card-panel col gap" onSubmit={join}>
            <h3>Join with an invite</h3>
            <p className="muted small">Paste an invite link or code from a teammate.</p>
            <input className="input" required placeholder="Invite link or code" value={invite} onChange={(e) => setInvite(e.target.value)} />
            <button className="btn" disabled={!invite.trim()}>Join workspace</button>
          </form>
        </div>
        {error && <div className="form-error">{error}</div>}
      </div>
    </div>
  );
}

/** /join/:code — accept an invite link. */
export function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.post<{ workspace: Workspace }>(`/api/workspaces/join/${encodeURIComponent(code ?? '')}`)
      .then((r) => { useSession.getState().upsertWorkspace(r.workspace); navigate(`/w/${r.workspace.id}`, { replace: true }); })
      .catch((e) => setError(e.message));
  }, [code, navigate]);
  return (
    <div className="center-page">
      {error ? <div className="card-panel"><p>{error}</p><button className="btn btn-primary" onClick={() => navigate('/workspaces')}>Go to your workspaces</button></div>
        : <span className="spinner spinner-lg" />}
    </div>
  );
}
