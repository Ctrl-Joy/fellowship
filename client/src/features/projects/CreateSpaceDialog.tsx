import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Modal } from '../../components/Modal';
import { projectsApi } from './api';
import { useProjects } from './store';
import { SPACE_COLORS, SPACE_EMOJIS } from './kit';

/** Mirror of the server's key suggestion: initials (max 4), or the first letters for one-word names. */
export function suggestKey(name: string, taken: Set<string>) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  let base = words.map((w) => w[0]).join('').toUpperCase().slice(0, 4);
  if (base.length < 2) base = (name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 3) || 'SPC');
  if (!/^[A-Z]/.test(base)) base = `S${base}`.slice(0, 4);
  let key = base;
  for (let n = 1; taken.has(key); n++) key = `${base}${n}`;
  return key.slice(0, 10);
}

/** "Create space" dialog: name, key (suggested, editable), icon and colour. Navigates into the new space. */
export default function CreateSpaceDialog({ workspaceId, onClose }: { workspaceId: string; onClose(): void }) {
  const navigate = useNavigate();
  const projects = useProjects((s) => s.projects);
  const taken = useMemo(() => new Set(Object.values(projects).filter((p) => p.workspaceId === workspaceId).map((p) => p.key)), [projects, workspaceId]);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [emoji, setEmoji] = useState(SPACE_EMOJIS[0]);
  const [color, setColor] = useState(SPACE_COLORS[0]);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const effectiveKey = keyEdited ? key : (name.trim() ? suggestKey(name, taken) : '');
  const keyValid = /^[A-Z][A-Z0-9]{1,9}$/.test(effectiveKey);
  const keyTaken = taken.has(effectiveKey);
  const canSubmit = name.trim().length > 0 && keyValid && !keyTaken && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErr('');
    try {
      const p = await projectsApi.createProject(workspaceId, { name: name.trim(), key: effectiveKey, iconEmoji: emoji, color, description: description.trim() || undefined });
      onClose();
      navigate(`/w/${workspaceId}/projects/p/${p.id}`);
    } catch (e: any) {
      setErr(e?.message || 'Could not create the space');
      setBusy(false);
    }
  };

  return (
    <Modal title="Create space" onClose={onClose} width={520}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>{busy ? <span className="spinner" /> : 'Create space'}</button>
      </>}>
      <form className="pj-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <p className="muted small" style={{ margin: 0 }}>A space holds your team's work items, board, timeline and docs.</p>
        <div className="pj-space-preview">
          <span className="pj-space-icon pj-space-icon-lg" style={{ background: color }}>{emoji}</span>
          <div>
            <b>{name.trim() || 'New space'}</b>
            <div className="muted small">Work items will be numbered {effectiveKey || 'KEY'}-1, {effectiveKey || 'KEY'}-2…</div>
          </div>
        </div>
        <label className="field">Name
          <input className="input" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mobile app" />
        </label>
        <label className="field">Key
          <input className="input pj-key-input" maxLength={10} value={effectiveKey}
            onChange={(e) => { setKeyEdited(true); setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); }} placeholder="APP" />
          <small className={keyTaken || (effectiveKey && !keyValid) ? 'pj-err-text' : 'muted'}>
            {keyTaken ? `${effectiveKey} is already used by another space` : effectiveKey && !keyValid ? '2–10 letters or digits, starting with a letter' : 'Used as the prefix of every work item key.'}
            {keyEdited && <> <button type="button" className="pj-link-btn" onClick={() => { setKeyEdited(false); setKey(''); }}>Use suggestion</button></>}
          </small>
        </label>
        <div className="field">Icon
          <div className="pj-emoji-grid" role="radiogroup" aria-label="Icon">
            {SPACE_EMOJIS.map((e) => (
              <button key={e} type="button" role="radio" aria-checked={e === emoji} className={`pj-emoji${e === emoji ? ' on' : ''}`} onClick={() => setEmoji(e)}>{e}</button>
            ))}
          </div>
        </div>
        <div className="field">Colour
          <div className="pj-swatches" role="radiogroup" aria-label="Colour">
            {SPACE_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} className={`pj-swatch${c === color ? ' on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <label className="field">Description <span className="muted small" style={{ fontWeight: 400 }}>(optional)</span>
          <textarea className="input" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {err && <p className="form-error">{err}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
