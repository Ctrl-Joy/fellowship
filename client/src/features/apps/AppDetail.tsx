import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../api';
import { Icon } from '../../components/Icon';
import { formatFull, timeAgo } from '../../lib/time';
import {
  appsApi, absoluteUrl, APP_SCOPES, EVENT_TYPE_OPTIONS,
  type AppDetail as AppDetailData, type ChannelOption,
} from './api';

type Tab = 'token' | 'webhooks' | 'commands' | 'events' | 'interactivity';

const TABS: { id: Tab; label: string }[] = [
  { id: 'token', label: 'Bot token' },
  { id: 'webhooks', label: 'Incoming webhooks' },
  { id: 'commands', label: 'Slash commands' },
  { id: 'events', label: 'Event subscriptions' },
  { id: 'interactivity', label: 'Interactivity' },
];

export interface AppDetailProps {
  workspaceId: string;
  appId: string;
  onBack(): void;
  onChanged(): void;
}

export default function AppDetail({ workspaceId, appId, onBack, onChanged }: AppDetailProps) {
  const [app, setApp] = useState<AppDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('token');

  const load = useCallback(() => {
    appsApi.detail(workspaceId, appId)
      .then((a) => { setApp(a); setError(null); })
      .catch((e: ApiError) => setError(e.message));
  }, [workspaceId, appId]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div className="view apps-view">
        <header className="view-head"><button className="btn btn-sm" onClick={onBack}>Back to apps</button></header>
        <div className="view-scroll apps-scroll"><div className="form-error">{error}</div></div>
      </div>
    );
  }
  if (!app) return <div className="loading-block"><span className="spinner" /></div>;

  return (
    <div className="view apps-view">
      <header className="view-head apps-detail-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back to apps"><Icon name="back" size={16} /></button>
        <span className="app-card-icon app-card-icon-sm" aria-hidden="true">{app.iconEmoji || app.name.slice(0, 1).toUpperCase()}</span>
        <h2>{app.name}</h2>
        <span className="badge-app">APP</span>
      </header>
      <div className="tabs-panel app-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="view-scroll apps-scroll">
        {tab === 'token' && <TokenTab workspaceId={workspaceId} app={app} onChanged={() => { load(); onChanged(); }} onDeleted={() => { onChanged(); onBack(); }} />}
        {tab === 'webhooks' && <WebhooksTab workspaceId={workspaceId} app={app} onChanged={load} />}
        {tab === 'commands' && <CommandsTab workspaceId={workspaceId} app={app} onChanged={() => { load(); onChanged(); }} />}
        {tab === 'events' && <EventsTab workspaceId={workspaceId} app={app} onChanged={load} />}
        {tab === 'interactivity' && <InteractivityTab workspaceId={workspaceId} app={app} onChanged={load} />}
      </div>
    </div>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  return message ? <div className="form-error">{message}</div> : null;
}

function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="app-copy-field">
      {label && <span className="app-label">{label}</span>}
      <div className="app-token-box">
        <code>{value}</code>
        <button className="btn btn-sm" onClick={async () => {
          try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
        }}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="app-section-block">
      <h3>{title}</h3>
      {hint && <p className="muted small">{hint}</p>}
      {children}
    </section>
  );
}

// ---------- Bot token ----------

function TokenTab({ workspaceId, app, onChanged, onDeleted }: {
  workspaceId: string; app: AppDetailData; onChanged(): void; onDeleted(): void;
}) {
  const [revealed, setRevealed] = useState<{ token: string; scopes: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(app.name);
  const [description, setDescription] = useState(app.description);
  const [iconEmoji, setIconEmoji] = useState(app.iconEmoji);
  const [saved, setSaved] = useState(false);
  const info = app.tokenInfo;
  const base = `${window.location.origin}/api/bot`;

  async function rotate() {
    if (!confirm('Generate a new token? The current token stops working immediately.')) return;
    setBusy(true); setError(null);
    try {
      const r = await appsApi.rotateToken(workspaceId, app.id, info?.scopes ?? APP_SCOPES.map((s) => s.id));
      setRevealed({ token: r.token.value, scopes: r.token.scopes });
      onChanged();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function saveDetails() {
    setBusy(true); setError(null); setSaved(false);
    try {
      await appsApi.update(workspaceId, app.id, { name: name.trim(), description: description.trim(), iconEmoji: iconEmoji.trim() });
      setSaved(true);
      onChanged();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm(`Delete ${app.name}? Its token, webhooks and commands stop working. Past messages stay in place.`)) return;
    setBusy(true); setError(null);
    try { await appsApi.remove(workspaceId, app.id); onDeleted(); } catch (e: any) { setError(e.message); setBusy(false); }
  }

  return (
    <div className="col gap-lg">
      <Section title="Bot token" hint="Used as Authorization: Bearer <token> on the bot Web API. Shown once when generated.">
        {revealed && (
          <div className="col gap">
            <div className="app-warning">Copy this token now. It will not be shown again.</div>
            <CopyField value={revealed.token} />
          </div>
        )}
        <div className="app-kv">
          <span className="muted">Scopes</span>
          <span>{info ? info.scopes.map((s) => <code key={s} className="app-scope">{s}</code>) : 'No token'}</span>
          <span className="muted">Last used</span>
          <span>{info?.lastUsedAt ? timeAgo(info.lastUsedAt) : 'Never'}</span>
        </div>
        <div className="row gap-sm" style={{ marginTop: 12 }}>
          <button className="btn" onClick={rotate} disabled={busy}><Icon name="refresh" size={14} /> {info ? 'Regenerate token' : 'Generate token'}</button>
        </div>
        <ErrorLine message={error} />
      </Section>

      <Section title="Quick start" hint="Replace $TOKEN with your bot token. Posting requires the chat:write scope and channel membership.">
        <pre className="app-code">{`curl -X POST ${base}/chat.post \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"channel":"#general","text":"Hello from ${app.name}"}'`}</pre>
        <p className="muted small">
          Methods: <code>auth.test</code>, <code>chat.post</code>, <code>chat.update</code>, <code>chat.delete</code>,
          {' '}<code>conversations.list</code>, <code>conversations.history</code>, <code>conversations.join</code>,
          {' '}<code>users.info</code>. Pass <code>blocks</code> with an <code>actions</code> block to add buttons.
        </p>
      </Section>

      <Section title="App details">
        <div className="col gap">
          <label className="field"><span>Name</span><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} disabled={app.isSystem} /></label>
          <label className="field"><span>Description</span><input className="input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} disabled={app.isSystem} /></label>
          <label className="field"><span>Icon</span><input className="input" value={iconEmoji} maxLength={16} onChange={(e) => setIconEmoji(e.target.value)} disabled={app.isSystem} style={{ maxWidth: 120 }} /></label>
          {!app.isSystem && (
            <div className="row gap-sm">
              <button className="btn btn-primary btn-sm" onClick={saveDetails} disabled={busy || !name.trim()}>Save details</button>
              {saved && <span className="muted small">Saved</span>}
            </div>
          )}
          {app.isSystem && <p className="muted small">The built-in Fellowship Bot is managed by Fellowship.</p>}
        </div>
      </Section>

      {!app.isSystem && (
        <Section title="Danger zone">
          <button className="btn btn-danger-ghost" onClick={remove} disabled={busy}><Icon name="trash" size={14} /> Delete app</button>
        </Section>
      )}
    </div>
  );
}

// ---------- Incoming webhooks ----------

function WebhooksTab({ workspaceId, app, onChanged }: { workspaceId: string; app: AppDetailData; onChanged(): void }) {
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [channelId, setChannelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const hooks = app.webhooks ?? [];

  useEffect(() => {
    appsApi.channels(workspaceId).then((list) => setChannels(list.filter((c) => !c.isArchived))).catch(() => undefined);
  }, [workspaceId]);

  async function add() {
    if (!channelId) return;
    setBusy(true); setError(null);
    try {
      const hook = await appsApi.addWebhook(workspaceId, app.id, channelId);
      setLatest(absoluteUrl(hook.path));
      onChanged();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this webhook URL? Anything posting to it will fail.')) return;
    setBusy(true); setError(null);
    try { await appsApi.removeWebhook(workspaceId, app.id, id); onChanged(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  const example = latest ?? (hooks[0] ? absoluteUrl(hooks[0].path) : 'https://your-fellowship/api/hooks/incoming/SECRET');

  return (
    <div className="col gap-lg">
      <Section title="Incoming webhooks" hint="POST JSON to a secret URL to post a message as this app in one channel. Anyone with the URL can post, so keep it private.">
        {hooks.length === 0 && <div className="empty">No webhook URLs yet.</div>}
        <ul className="app-rows">
          {hooks.map((h) => (
            <li key={h.id}>
              <div className="col" style={{ minWidth: 0, flex: 1 }}>
                <strong>#{h.channelName ?? 'conversation'}</strong>
                <span className="muted small app-url">{absoluteUrl(h.path)}</span>
                <span className="muted small">{h.lastUsedAt ? `Last used ${timeAgo(h.lastUsedAt)}` : 'Not used yet'}</span>
              </div>
              <CopyFieldInline value={absoluteUrl(h.path)} />
              <button className="icon-btn danger" aria-label="Delete webhook" onClick={() => remove(h.id)} disabled={busy}><Icon name="trash" size={15} /></button>
            </li>
          ))}
        </ul>
        <div className="row gap-sm" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <select className="input" value={channelId} onChange={(e) => setChannelId(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">Choose a channel…</option>
            {channels.map((c) => <option key={c.id} value={c.id}>#{c.name ?? c.id}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={add} disabled={!channelId || busy}>Add webhook URL</button>
        </div>
        <ErrorLine message={error} />
        {latest && <div className="col gap" style={{ marginTop: 12 }}><CopyField label="New webhook URL" value={latest} /></div>}
      </Section>

      <Section title="Example" hint="The app is added to the channel automatically.">
        <pre className="app-code">{`curl -X POST '${example}' \\
  -H 'Content-Type: application/json' \\
  -d '{"text":"Deploy finished","username":"CI","icon_emoji":":ship:"}'`}</pre>
        <p className="muted small">Rate limit: a burst of 10 requests, then one per second. Extra requests get HTTP 429 with a Retry-After header.</p>
      </Section>
    </div>
  );
}

function CopyFieldInline({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="btn btn-sm" onClick={async () => {
      try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
    }}>{copied ? 'Copied' : 'Copy URL'}</button>
  );
}

// ---------- Slash commands ----------

function CommandsTab({ workspaceId, app, onChanged }: { workspaceId: string; app: AppDetailData; onChanged(): void }) {
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [usageHint, setUsageHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commands = app.commands ?? [];

  async function add() {
    setBusy(true); setError(null);
    try {
      await appsApi.addCommand(workspaceId, app.id, { command, url: url.trim(), description: description.trim(), usageHint: usageHint.trim() });
      setCommand(''); setUrl(''); setDescription(''); setUsageHint('');
      onChanged();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); setError(null);
    try { await appsApi.removeCommand(workspaceId, app.id, id); onChanged(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="col gap-lg">
      <Section title="Commands" hint="When someone types the command, Fellowship POSTs form data to the request URL and waits up to 3 seconds.">
        {commands.length === 0 && <div className="empty">No slash commands yet.</div>}
        <ul className="app-rows">
          {commands.map((c) => (
            <li key={c.id}>
              <div className="col" style={{ minWidth: 0, flex: 1 }}>
                <strong><code>/{c.command}</code> {c.usageHint && <span className="muted small">{c.usageHint}</span>}</strong>
                <span className="muted small">{c.description}</span>
                <span className="muted small app-url">{c.url}</span>
              </div>
              <button className="icon-btn danger" aria-label={`Delete /${c.command}`} onClick={() => remove(c.id)} disabled={busy}><Icon name="trash" size={15} /></button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Register a command">
        <div className="col gap">
          <label className="field"><span>Command</span>
            <div className="input-prefix"><span>/</span><input value={command} maxLength={32} onChange={(e) => setCommand(e.target.value)} placeholder="weather" /></div>
          </label>
          <label className="field"><span>Request URL</span>
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/fellowship/weather" />
          </label>
          <label className="field"><span>Description <span className="muted">(shown in autocomplete)</span></span>
            <input className="input" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="field"><span>Usage hint <span className="muted">(optional)</span></span>
            <input className="input" maxLength={200} value={usageHint} onChange={(e) => setUsageHint(e.target.value)} placeholder="/weather <city>" />
          </label>
          <div className="row"><button className="btn btn-primary btn-sm" onClick={add} disabled={busy || !command.trim() || !url.trim()}>Add command</button></div>
          <ErrorLine message={error} />
        </div>
      </Section>

      <Section title="What your endpoint receives" hint="Form fields: command, text, user_id, user_name, team_id, channel_id, channel_name, response_url. Header X-Fellowship-Signature verifies the request.">
        <pre className="app-code">{`{ "text": "Thanks for the update", "response_type": "in_channel" }`}</pre>
        <p className="muted small">Reply with <code>response_type: "in_channel"</code> to post for everyone, or leave it as <code>ephemeral</code> (the default) so only the person who typed the command sees it. You can also POST later to <code>response_url</code> for up to 30 minutes.</p>
      </Section>
    </div>
  );
}

// ---------- Event subscriptions ----------

function EventsTab({ workspaceId, app, onChanged }: { workspaceId: string; app: AppDetailData; onChanged(): void }) {
  const events = app.events ?? { url: null, eventTypes: [], deliveries: [] };
  const [url, setUrl] = useState(events.url ?? '');
  const [types, setTypes] = useState<string[]>(events.eventTypes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null); setNotice(null);
    try {
      await appsApi.setEvents(workspaceId, app.id, { url: url.trim() || null, eventTypes: url.trim() ? types : [] });
      setNotice('Saved');
      onChanged();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setError(null); setNotice(null);
    try { await appsApi.testEvent(workspaceId, app.id); setNotice('Test event queued. Check the log below.'); onChanged(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="col gap-lg">
      <Section title="Events URL" hint="Fellowship POSTs signed JSON here for conversations the app is in. Failed deliveries retry 3 times with backoff.">
        <div className="col gap">
          <label className="field"><span>Request URL</span>
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/fellowship/events" />
          </label>
          <fieldset className="app-fieldset">
            <legend>Event types</legend>
            {EVENT_TYPE_OPTIONS.map((e) => (
              <label key={e.id} className="toggle-row">
                <input type="checkbox" checked={types.includes(e.id)} onChange={(ev) => setTypes((cur) => (ev.target.checked ? [...cur, e.id] : cur.filter((x) => x !== e.id)))} />
                <span><code>{e.id}</code> <span className="muted small">{e.label}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="row gap-sm">
            <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>Save</button>
            <button className="btn btn-sm" onClick={test} disabled={busy || !events.url}>Send test event</button>
            {notice && <span className="muted small">{notice}</span>}
          </div>
          <ErrorLine message={error} />
        </div>
      </Section>

      {app.signingSecret && (
        <Section title="Signing secret" hint="Each request carries X-Fellowship-Request-Timestamp and X-Fellowship-Signature (v0=HMAC-SHA256 of 'v0:<timestamp>:<body>').">
          <CopyField value={app.signingSecret} />
        </Section>
      )}

      <Section title="Delivery log">
        {events.deliveries.length === 0 && <div className="empty">No deliveries yet.</div>}
        {events.deliveries.length > 0 && (
          <table className="app-table">
            <thead><tr><th>When</th><th>Event</th><th>Status</th><th>Attempts</th><th>Last response</th></tr></thead>
            <tbody>
              {events.deliveries.map((d) => (
                <tr key={d.id}>
                  <td title={formatFull(d.createdAt)}>{timeAgo(d.createdAt)}</td>
                  <td><code>{d.eventType}</code></td>
                  <td><span className={`app-status app-status-${d.status}`}>{d.status}</span></td>
                  <td>{d.attempts}</td>
                  <td className="muted small">{d.lastError ?? (d.lastStatus ? `HTTP ${d.lastStatus}` : '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

// ---------- Interactivity ----------

function InteractivityTab({ workspaceId, app, onChanged }: { workspaceId: string; app: AppDetailData; onChanged(): void }) {
  const [url, setUrl] = useState(app.interactivityUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null); setNotice(null);
    try {
      await appsApi.setInteractivity(workspaceId, app.id, url.trim() || null);
      setNotice('Saved');
      onChanged();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="col gap-lg">
      <Section title="Request URL" hint="Button clicks on this app's messages are POSTed here as signed JSON (block_actions).">
        <div className="col gap">
          <label className="field"><span>Request URL</span>
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/fellowship/interact" />
          </label>
          <div className="row gap-sm">
            <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>Save</button>
            {notice && <span className="muted small">{notice}</span>}
          </div>
          <ErrorLine message={error} />
        </div>
      </Section>
      <Section title="Responding to a click" hint="Respond with HTTP 200 and JSON. The app has 3 seconds.">
        <pre className="app-code">{`{ "replace_original": true, "text": "Approved by Ben" }
{ "ephemeral_text": "Only you can see this" }`}</pre>
        <p className="muted small">
          <code>replace_original</code> edits the app's message for everyone, and only works on messages the app posted.
          Buttons are declared with an <code>actions</code> block in <code>chat.post</code>.
        </p>
      </Section>
    </div>
  );
}
