import { useMemo, useState } from 'react';
import type { User } from '../../types';
import { api } from '../../api';
import { Modal } from '../../components/Modal';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { useSession, displayName } from '../../store/session';
import { useConversations, conversationTitle } from '../../store/conversations';
import type { Canvas } from './types';

type Sharing = { sharedWith: { userId: string; role: 'viewer' | 'editor' }[]; sharedChannels: { conversationId: string; role: 'viewer' | 'editor' }[] };

export function ShareDialog({ canvas, currentUser, sharing, canManage, onChange, onClose, onShared }: {
  workspaceId: string;
  canvas: Canvas;
  currentUser: User;
  sharing: Sharing;
  canManage: boolean;
  onChange(s: Sharing): void;
  onClose(): void;
  onShared(message: string): void;
}) {
  const members = useSession((s) => s.members);
  const conversations = useConversations((s) => s.byId);
  const isChannelCanvas = !!canvas.conversationId;
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [role, setRole] = useState<'viewer' | 'editor'>('editor');
  const [channelId, setChannelId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAccess = new Set([canvas.createdBy, ...sharing.sharedWith.map((s) => s.userId)]);
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(members)
      .filter((m) => !m.deactivated && !m.isBot && m.id !== currentUser.id && !picked.includes(m.id))
      .filter((m) => !q || m.fullName.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q))
      .slice(0, 6);
  }, [members, query, picked, currentUser.id]);
  const myConversations = Object.values(conversations)
    .filter((c) => c.isMember && !c.isArchived && c.id !== canvas.conversationId)
    .sort((a, b) => conversationTitle(a, members, currentUser).localeCompare(conversationTitle(b, members, currentUser)));

  const submit = async () => {
    if (!picked.length && !channelId) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post<Sharing>(`/api/canvases/${canvas.id}/share`, {
        userIds: picked.length ? picked : undefined,
        conversationId: channelId || undefined,
        role, note: note.trim() || undefined,
      });
      onChange({ sharedWith: r.sharedWith, sharedChannels: r.sharedChannels });
      const where = channelId ? conversationLabel(channelId) : `${picked.length} ${picked.length === 1 ? 'person' : 'people'}`;
      onShared(`Shared with ${where}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const conversationLabel = (cid: string) => {
    const c = conversations[cid];
    if (!c) return 'a conversation';
    return c.kind === 'channel' ? `#${c.name}` : conversationTitle(c, members, currentUser);
  };

  const removeUser = async (uid: string) => {
    const r = await api.del<Sharing>(`/api/canvases/${canvas.id}/access/${uid}`);
    onChange(r);
  };
  const removeChannel = async (cid: string) => {
    const r = await api.del<Sharing>(`/api/canvases/${canvas.id}/channels/${cid}`);
    onChange(r);
  };

  return (
    <Modal title={`Share “${canvas.title || 'Untitled canvas'}”`} onClose={onClose} width={520}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || (!picked.length && !channelId)} onClick={submit}>{busy ? 'Sharing…' : 'Share'}</button>
      </>}>
      <div className="cv-share">
        {isChannelCanvas
          ? <p className="muted small">Everyone in the channel can already open and edit this canvas. You can post a link to it in another conversation.</p>
          : (
            <label className="field">
              <span>Add people</span>
              <div className="chip-input">
                {picked.map((id) => (
                  <span key={id} className="chip"><Avatar userId={id} size={18} />{displayName(members[id])}
                    <button className="icon-btn" aria-label="Remove" onClick={() => setPicked((p) => p.filter((x) => x !== id))}><Icon name="x" size={12} /></button>
                  </span>
                ))}
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={picked.length ? '' : 'Search by name'} />
              </div>
              {query && candidates.length > 0 && (
                <div className="cv-share-results">
                  {candidates.map((m) => (
                    <button key={m.id} onClick={() => { setPicked((p) => [...p, m.id]); setQuery(''); }}>
                      <Avatar user={m} size={22} /> <b>{displayName(m)}</b> <span className="muted small">{m.fullName}</span>
                      {hasAccess.has(m.id) && <span className="muted small"> · has access</span>}
                    </button>
                  ))}
                </div>
              )}
            </label>
          )}

        <label className="field">
          <span>{isChannelCanvas ? 'Post a link in' : 'Post to a conversation (optional)'}</span>
          <select className="input" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            <option value="">— Don’t post —</option>
            {myConversations.map((c) => <option key={c.id} value={c.id}>{c.kind === 'channel' ? `#${c.name}` : conversationLabel(c.id)}</option>)}
          </select>
        </label>
        {channelId && (
          <label className="field">
            <span>Add a note</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Here’s the doc we talked about…" maxLength={2000} />
          </label>
        )}
        {!isChannelCanvas && (
          <label className="field">
            <span>They can</span>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'viewer' | 'editor')}>
              <option value="editor">Edit</option>
              <option value="viewer">View only</option>
            </select>
          </label>
        )}
        {error && <div className="form-error">{error}</div>}

        {!isChannelCanvas && (sharing.sharedWith.length > 0 || sharing.sharedChannels.length > 0) && (
          <div className="cv-share-list">
            <div className="cv-menu-label">Who has access</div>
            <div className="cv-share-row"><Avatar userId={canvas.createdBy} size={22} /><span>{displayName(members[canvas.createdBy])}</span><span className="muted small">Owner</span></div>
            {sharing.sharedWith.map((s) => (
              <div key={s.userId} className="cv-share-row">
                <Avatar userId={s.userId} size={22} /><span>{displayName(members[s.userId])}</span>
                <span className="muted small">{s.role === 'editor' ? 'Can edit' : 'Can view'}</span>
                {(canManage || s.userId === currentUser.id) && <button className="link small" onClick={() => removeUser(s.userId)}>Remove</button>}
              </div>
            ))}
            {sharing.sharedChannels.map((s) => (
              <div key={s.conversationId} className="cv-share-row">
                <span className="cv-share-hash"><Icon name="hash" size={14} /></span><span>{conversationLabel(s.conversationId)}</span>
                <span className="muted small">{s.role === 'editor' ? 'Members can edit' : 'Members can view'}</span>
                {canManage && <button className="link small" onClick={() => removeChannel(s.conversationId)}>Remove</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
