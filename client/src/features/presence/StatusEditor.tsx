import { useState } from 'react';
import type { User } from '../../types';
import { Modal } from '../../components/Modal';
import { api } from '../../api';
import { useSession } from '../../store/session';
import { usePresence } from './store';
import { EXPIRY_OPTIONS, STATUS_PRESETS, expiryFor, expiryKeyFor, formatUntil, type ExpiryKey } from './statusOptions';
import './presence.css';

export interface StatusEditorProps {
  currentUser: User;
  onClose(): void;
}

/** Custom status (emoji, text, expiry presets) and the "appear away" override. */
export default function StatusEditor({ currentUser, onClose }: StatusEditorProps) {
  const [emoji, setEmoji] = useState(currentUser.statusEmoji);
  const [text, setText] = useState(currentUser.statusText);
  const [expiry, setExpiry] = useState<ExpiryKey>(() => (currentUser.statusText ? expiryKeyFor(currentUser.statusExpires) : 'today'));
  const manualAway = usePresence((s) => s.manualAway);
  const [away, setAway] = useState(manualAway);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (p: typeof STATUS_PRESETS[number]) => {
    setEmoji(p.emoji);
    setText(p.text);
    setExpiry(p.expiry);
  };

  const save = async (clear = false) => {
    setBusy(true);
    setError(null);
    try {
      const body = clear
        ? { statusEmoji: '', statusText: '', statusExpires: null }
        : { statusEmoji: emoji.trim().slice(0, 16), statusText: text.trim().slice(0, 100), statusExpires: expiryFor(expiry) };
      const r = await api.patch<{ user: User }>('/api/users/me', body);
      useSession.getState().setMe(r.user);
      useSession.getState().upsertMember(r.user);
      if (away !== manualAway) {
        const p = await api.put<{ manualAway: boolean }>('/api/presence/me', { manualAway: away });
        usePresence.getState().setManualAway(p.manualAway);
      }
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Could not save your status');
    } finally {
      setBusy(false);
    }
  };

  const hasStatus = !!(currentUser.statusText || currentUser.statusEmoji);
  const savedUntil = currentUser.statusExpires != null ? formatUntil(currentUser.statusExpires) : '';

  return (
    <Modal title="Set a status" onClose={onClose} footer={<>
      {hasStatus && <button className="btn" onClick={() => save(true)} disabled={busy}>Clear status</button>}
      <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="btn btn-primary" onClick={() => save()} disabled={busy || (!text.trim() && !emoji.trim())}>Save</button>
    </>}>
      <div className="status-presets" role="group" aria-label="Status presets">
        {STATUS_PRESETS.map((p) => (
          <button key={p.text} className="status-preset" onClick={() => applyPreset(p)}>
            <span aria-hidden="true">{p.emoji}</span>{p.text}
          </button>
        ))}
      </div>

      <div className="status-row">
        <input className="input" style={{ width: 64 }} value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🙂" aria-label="Status emoji" maxLength={16} />
        <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="What’s your status?" aria-label="Status text" maxLength={100} />
      </div>

      <fieldset className="status-expiry" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="muted small" style={{ marginBottom: 6 }}>Clear status after</legend>
        {EXPIRY_OPTIONS.map((o) => (
          <label key={o.key}>
            <input type="radio" name="status-expiry" value={o.key} checked={expiry === o.key} onChange={() => setExpiry(o.key)} />
            {o.label}
          </label>
        ))}
      </fieldset>
      {savedUntil && <p className="muted small" style={{ marginTop: 8 }}>Current status clears {savedUntil}.</p>}

      <div className="status-presence">
        <label>
          <input type="checkbox" checked={away} onChange={(e) => setAway(e.target.checked)} />
          <span>
            <strong>Appear away</strong><br />
            <span className="muted small">Shows you as away even while you are using Fellowship. Turn it off to go back to automatic presence.</span>
          </span>
        </label>
      </div>
      {error && <p className="edit-error" role="alert">{error}</p>}
    </Modal>
  );
}
