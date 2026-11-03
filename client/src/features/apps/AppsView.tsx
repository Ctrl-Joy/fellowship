import { useCallback, useEffect, useState } from 'react';
import type { User } from '../../types';
import { useSession } from '../../store/session';
import { Modal } from '../../components/Modal';
import { ApiError } from '../../api';
import { appsApi, APP_SCOPES, type AppSummary } from './api';
import { useAppCommands, NO_COMMANDS, loadAppCommands } from './commands';
import AppDetail from './AppDetail';
import './apps.css';

export interface AppsViewProps {
  workspaceId: string;
  currentUser: User;
}

/** Sidebar "Apps": directory, create wizard, and per-app settings. */
export default function AppsView({ workspaceId, currentUser }: AppsViewProps) {
  const role = useSession((s) => s.members[currentUser.id]?.role);
  const isAdmin = role === 'owner' || role === 'admin';
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const commands = useAppCommands((s) => s.byWorkspace[workspaceId] ?? NO_COMMANDS);
  const builtins = commands.filter((c) => c.builtin);

  const load = useCallback(() => {
    appsApi.list(workspaceId).then(setApps).catch((e: ApiError) => setError(e.message));
  }, [workspaceId]);

  useEffect(() => { setSelected(null); load(); loadAppCommands(workspaceId); }, [workspaceId, load]);

  if (selected) {
    return (
      <AppDetail
        workspaceId={workspaceId}
        appId={selected}
        onBack={() => { setSelected(null); load(); }}
        onChanged={() => { load(); loadAppCommands(workspaceId); }}
      />
    );
  }

  return (
    <div className="view apps-view">
      <header className="view-head">
        <h2>Apps</h2>
        {isAdmin && (
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>Create an app</button>
        )}
      </header>
      <div className="view-scroll apps-scroll">
        <p className="muted apps-intro">
          Apps are bots that post in Fellowship. They can answer slash commands, post through incoming
          webhooks, receive events and handle button clicks. Only workspace admins can create or change them.
        </p>

        {error && <div className="form-error">{error}</div>}
        {apps === null && !error && <div className="loading-block"><span className="spinner" /></div>}

        {apps && apps.length === 0 && (
          <div className="empty">No apps yet. {isAdmin ? 'Create one to get a bot token and webhook URL.' : 'Ask an admin to add one.'}</div>
        )}

        {apps && apps.length > 0 && (
          <ul className="app-list">
            {apps.map((a) => (
              <li key={a.id}>
                <button className="app-card" onClick={() => setSelected(a.id)} disabled={a.isSystem}>
                  <span className="app-card-icon" aria-hidden="true">{a.iconEmoji || a.name.slice(0, 1).toUpperCase()}</span>
                  <span className="app-card-main">
                    <span className="app-card-name">
                      {a.name} <span className="badge-app">APP</span>
                      {a.isSystem && <span className="app-chip">Built-in</span>}
                    </span>
                    <span className="muted small">{a.description || 'No description'}</span>
                  </span>
                  {!a.isSystem && <span className="app-card-go muted small">Manage</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        <h3 className="apps-section-title">Built-in slash commands</h3>
        <p className="muted small">Type <kbd>/</kbd> in the composer to see these and any app commands.</p>
        <ul className="app-command-ref">
          {builtins.map((c) => (
            <li key={c.command}>
              <code>{c.usage}</code>
              <span className="muted small">{c.description}</span>
            </li>
          ))}
        </ul>
      </div>

      {creating && (
        <CreateAppModal
          workspaceId={workspaceId}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); load(); loadAppCommands(workspaceId); setSelected(id); }}
        />
      )}
    </div>
  );
}

type Step = 'details' | 'scopes' | 'done';

function CreateAppModal({ workspaceId, onClose, onCreated }: {
  workspaceId: string;
  onClose(): void;
  onCreated(appId: string): void;
}) {
  const [step, setStep] = useState<Step>('details');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [iconEmoji, setIconEmoji] = useState('');
  const [scopes, setScopes] = useState<string[]>(APP_SCOPES.map((s) => s.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ appId: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await appsApi.create(workspaceId, { name: name.trim(), description: description.trim(), iconEmoji: iconEmoji.trim(), scopes });
      setCreated({ appId: r.app.id, token: r.token.value });
      setStep('done');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const title = step === 'details' ? 'Create an app' : step === 'scopes' ? 'Choose permissions' : 'Save your bot token';

  return (
    <Modal
      title={title}
      onClose={step === 'done' ? () => onCreated(created!.appId) : onClose}
      width={560}
      footer={step === 'done' ? (
        <div className="row end"><button className="btn btn-primary" onClick={() => onCreated(created!.appId)}>Done</button></div>
      ) : (
        <div className="row end gap-sm">
          {step === 'scopes' && <button className="btn" onClick={() => setStep('details')} disabled={busy}>Back</button>}
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          {step === 'details' && (
            <button className="btn btn-primary" disabled={!name.trim()} onClick={() => setStep('scopes')}>Next</button>
          )}
          {step === 'scopes' && (
            <button className="btn btn-primary" disabled={busy || scopes.length === 0} onClick={submit}>
              {busy ? 'Creating…' : 'Create app'}
            </button>
          )}
        </div>
      )}
    >
      {step === 'details' && (
        <div className="col gap">
          <label className="field">
            <span>App name</span>
            <input className="input" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Deploy Bot" />
            <small className="muted">The bot posts under this name.</small>
          </label>
          <label className="field">
            <span>Description <span className="muted">(optional)</span></span>
            <input className="input" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this app do?" />
          </label>
          <label className="field">
            <span>Icon <span className="muted">(an emoji, optional)</span></span>
            <input className="input" maxLength={16} value={iconEmoji} onChange={(e) => setIconEmoji(e.target.value)} placeholder="🚀" style={{ maxWidth: 120 }} />
          </label>
        </div>
      )}

      {step === 'scopes' && (
        <div className="col gap">
          <p className="muted small">The bot token can only do what these permissions allow. You can rotate the token later.</p>
          {APP_SCOPES.map((s) => (
            <label key={s.id} className="toggle-row">
              <input
                type="checkbox"
                checked={scopes.includes(s.id)}
                onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
              />
              <span><code>{s.id}</code><br /><span className="muted small">{s.label}</span></span>
            </label>
          ))}
          {error && <div className="form-error">{error}</div>}
        </div>
      )}

      {step === 'done' && created && (
        <div className="col gap">
          <div className="app-warning">
            This is the only time the full token is shown. Store it somewhere safe. Fellowship keeps only a hash.
          </div>
          <div className="app-token-box">
            <code>{created.token}</code>
            <button className="btn btn-sm" onClick={copyToken}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
