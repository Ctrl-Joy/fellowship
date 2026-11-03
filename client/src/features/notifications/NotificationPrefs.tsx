import { useEffect, useState } from 'react';
import type { Conversation, User } from '../../types';
import { Modal } from '../../components/Modal';
import { api } from '../../api';
import { updateConversation } from '../../store/actions';
import { useSession } from '../../store/session';
import { conversationTitle } from '../../store/conversations';
import { playChime } from './sound';
import { deviceSettings, desktopPermission } from './settings';
import './notifications.css';

export interface NotificationPrefsProps {
  workspaceId: string;
  currentUser: User;
  /** When set, edit this conversation's override; otherwise global preferences. */
  conversation?: Conversation;
  onClose(): void;
}

type Level = 'all' | 'mentions' | 'nothing';

interface ServerPrefs {
  level: Level;
  keywords: string[];
  dnd: { enabled: boolean; start: string; end: string };
  snoozeUntil: number | null;
}

const LEVEL_OPTIONS: { value: Level; label: string; hint: string }[] = [
  { value: 'all', label: 'All new messages', hint: 'Every message in conversations you are in, plus reactions.' },
  { value: 'mentions', label: 'Mentions and direct messages', hint: 'Direct messages, @mentions, @channel/@here, replies in threads you follow, and keywords.' },
  { value: 'nothing', label: 'Nothing', hint: 'No notifications, and nothing added to Activity.' },
];

const SNOOZE_OPTIONS = [30, 60, 120];

/** Notification settings: global preferences and per-conversation overrides. */
export default function NotificationPrefs(props: NotificationPrefsProps) {
  return props.conversation
    ? <ConversationPrefs {...props} conversation={props.conversation} />
    : <GlobalPrefs {...props} />;
}

function ConversationPrefs({ conversation, currentUser, onClose }: NotificationPrefsProps & { conversation: Conversation }) {
  const members = useSession((s) => s.members);
  const [notifyPref, setNotifyPref] = useState<string>(conversation.notifyPref || 'default');
  const [muted, setMuted] = useState(conversation.muted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = conversationTitle(conversation, members, currentUser);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateConversation(conversation.id, { notifyPref: notifyPref as any, muted });
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Could not save');
      setBusy(false);
    }
  };

  const options = [
    { value: 'default', label: 'Use my default setting', hint: 'Follow your workspace notification settings.' },
    { value: 'all', label: 'All new messages', hint: 'Notify for every new message here.' },
    { value: 'mentions', label: 'Mentions and replies', hint: 'Only mentions, direct messages and thread replies you follow.' },
    { value: 'nothing', label: 'Nothing', hint: 'Never notify for this conversation.' },
  ];

  return (
    <Modal title={`Notifications for ${conversation.kind === 'channel' ? '#' : ''}${title}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={busy}>Save</button>
    </>}>
      <div className="np-section">
        <h3>Notify me about</h3>
        {options.map((o) => (
          <label key={o.value} className="np-radio">
            <input type="radio" name="conv-notify" value={o.value} checked={notifyPref === o.value} onChange={() => setNotifyPref(o.value)} />
            <span>{o.label}<small className="muted">{o.hint}</small></span>
          </label>
        ))}
      </div>
      <div className="np-section">
        <label className="np-check">
          <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
          <span><strong>Mute this conversation</strong> <span className="muted">· no notifications at all, including mentions</span></span>
        </label>
      </div>
      {error && <p className="act-error" role="alert">{error}</p>}
    </Modal>
  );
}

function GlobalPrefs({ workspaceId, onClose }: NotificationPrefsProps) {
  const [prefs, setPrefs] = useState<ServerPrefs | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>('mentions');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [dndOn, setDndOn] = useState(false);
  const [dndStart, setDndStart] = useState('22:00');
  const [dndEnd, setDndEnd] = useState('08:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [desktop, setDesktop] = useState(deviceSettings.desktopOn());
  const [sound, setSound] = useState(deviceSettings.soundOn());
  const [permission, setPermission] = useState(desktopPermission());

  useEffect(() => {
    api.get<{ prefs: ServerPrefs }>(`/api/w/${workspaceId}/notifications/prefs`)
      .then((r) => {
        setPrefs(r.prefs);
        setLevel(r.prefs.level);
        setKeywords(r.prefs.keywords);
        setDndOn(r.prefs.dnd.enabled);
        setDndStart(r.prefs.dnd.start);
        setDndEnd(r.prefs.dnd.end);
      })
      .catch((err) => setLoadError(err?.message ?? 'Could not load your settings'));
  }, [workspaceId]);

  const addKeyword = () => {
    const k = keywordDraft.trim();
    if (!k) return;
    if (keywords.some((x) => x.toLowerCase() === k.toLowerCase())) return setKeywordDraft('');
    if (keywords.length >= 20) return setError('You can follow up to 20 keywords.');
    setKeywords([...keywords, k]);
    setKeywordDraft('');
  };

  const snooze = async (minutes: number) => {
    setError(null);
    try {
      const r = await api.post<{ prefs: ServerPrefs }>(`/api/w/${workspaceId}/notifications/snooze`, { minutes });
      setPrefs(r.prefs);
    } catch (err: any) {
      setError(err?.message ?? 'Could not change Do Not Disturb');
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.put<{ prefs: ServerPrefs }>(`/api/w/${workspaceId}/notifications/prefs`, {
        level, keywords, dnd: { enabled: dndOn, start: dndStart, end: dndEnd },
      });
      setPrefs(r.prefs);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Could not save your settings');
      setBusy(false);
    }
  };

  const askDesktop = async () => {
    if (typeof Notification === 'undefined') return;
    // Only ever asked from this button, never on page load.
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      deviceSettings.setDesktopOn(true);
      setDesktop(true);
    }
  };

  const snoozedUntil = prefs?.snoozeUntil ?? null;

  return (
    <Modal title="Notification preferences" onClose={onClose} width={580} footer={<>
      <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={busy || !prefs}>Save</button>
    </>}>
      {loadError && <p className="act-error" role="alert">{loadError}</p>}
      {!prefs && !loadError && <div className="empty"><span className="spinner" /></div>}

      {prefs && (
        <>
          <div className="np-section">
            <h3>Default for this workspace</h3>
            {LEVEL_OPTIONS.map((o) => (
              <label key={o.value} className="np-radio">
                <input type="radio" name="global-level" value={o.value} checked={level === o.value} onChange={() => setLevel(o.value)} />
                <span>{o.label}<small className="muted">{o.hint}</small></span>
              </label>
            ))}
            <p className="np-note">Each conversation can override this from its details panel.</p>
          </div>

          <div className="np-section">
            <h3>Keywords</h3>
            <p className="muted small" style={{ marginTop: 0 }}>Get notified when a whole word appears in a conversation you are in.</p>
            <div className="row gap-sm">
              <input className="input grow" value={keywordDraft} maxLength={60} placeholder="e.g. release, outage"
                aria-label="Add keyword"
                onChange={(e) => setKeywordDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }} />
              <button className="btn" onClick={addKeyword} disabled={!keywordDraft.trim()}>Add</button>
            </div>
            <div className="np-keywords">
              {keywords.map((k) => (
                <span key={k} className="np-chip">{k}
                  <button aria-label={`Remove ${k}`} onClick={() => setKeywords(keywords.filter((x) => x !== k))}>×</button>
                </span>
              ))}
            </div>
          </div>

          <div className="np-section">
            <h3>Do not disturb</h3>
            <p className="muted small" style={{ marginTop: 0 }}>
              {snoozedUntil
                ? `Snoozed until ${new Date(snoozedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Notifications still appear in Activity without sound or desktop alerts.`
                : 'Quiet new notifications for a while. They still appear in Activity.'}
            </p>
            <div className="np-row">
              {SNOOZE_OPTIONS.map((m) => (
                <button key={m} className="btn btn-sm" onClick={() => snooze(m)}>
                  {m >= 60 ? `${m / 60} hour${m > 60 ? 's' : ''}` : `${m} minutes`}
                </button>
              ))}
              {snoozedUntil && <button className="btn btn-sm btn-ghost" onClick={() => snooze(0)}>Turn off snooze</button>}
            </div>
            <label className="np-check">
              <input type="checkbox" checked={dndOn} onChange={(e) => setDndOn(e.target.checked)} />
              Quiet hours every day
            </label>
            {dndOn && (
              <div className="np-times">
                <label className="field"><span>From</span>
                  <input className="input" type="time" value={dndStart} onChange={(e) => setDndStart(e.target.value)} />
                </label>
                <label className="field"><span>Until</span>
                  <input className="input" type="time" value={dndEnd} onChange={(e) => setDndEnd(e.target.value)} />
                </label>
                <p className="np-note" style={{ gridColumn: 'span 2' }}>Times use your profile time zone.</p>
              </div>
            )}
          </div>

          <div className="np-section">
            <h3>On this device</h3>
            {permission === 'unsupported' && <p className="muted small">This browser does not support desktop notifications.</p>}
            {permission === 'default' && (
              <div className="np-row" style={{ marginTop: 0 }}>
                <button className="btn" onClick={askDesktop}>Enable desktop notifications</button>
                <span className="muted small">Your browser will ask once.</span>
              </div>
            )}
            {permission === 'denied' && <p className="muted small">Desktop notifications are blocked. Allow them in your browser’s site settings.</p>}
            {permission === 'granted' && (
              <label className="np-check">
                <input type="checkbox" checked={desktop} onChange={(e) => { setDesktop(e.target.checked); deviceSettings.setDesktopOn(e.target.checked); }} />
                Show desktop notifications when Fellowship is in the background
              </label>
            )}
            <label className="np-check">
              <input type="checkbox" checked={sound} onChange={(e) => {
                setSound(e.target.checked);
                deviceSettings.setSoundOn(e.target.checked);
                if (e.target.checked) playChime();
              }} />
              Play a short sound for new notifications
            </label>
          </div>

          {error && <p className="act-error" role="alert">{error}</p>}
        </>
      )}
    </Modal>
  );
}
