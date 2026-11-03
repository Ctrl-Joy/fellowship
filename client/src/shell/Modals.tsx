import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Conversation, Member, User } from '../types';
import { api } from '../api';
import { useUi } from '../store/ui';
import { useSession, displayName } from '../store/session';
import { useConversations, conversationTitle, dmPartnerId } from '../store/conversations';
import { openDm } from '../store/actions';
import { Modal } from '../components/Modal';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import StatusEditor from '../features/presence/StatusEditor';
import NotificationPrefs from '../features/notifications/NotificationPrefs';

/** Renders whichever global modal is open (ui.modal). */
export function Modals({ workspaceId, currentUser }: { workspaceId: string; currentUser: User }) {
  const modal = useUi((s) => s.modal);
  const close = useUi((s) => s.closeModal);
  const conv = useConversations((s) => (modal?.kind === 'notificationPrefs' && modal.conversationId ? s.byId[modal.conversationId] : undefined));
  if (!modal) return null;
  switch (modal.kind) {
    case 'createChannel': return <CreateChannelModal workspaceId={workspaceId} onClose={close} />;
    case 'newMessage': return <NewMessageModal workspaceId={workspaceId} currentUser={currentUser} onClose={close} />;
    case 'invite': return <InviteModal workspaceId={workspaceId} onClose={close} />;
    case 'quickSwitcher': return <QuickSwitcher workspaceId={workspaceId} currentUser={currentUser} onClose={close} />;
    case 'status': return <StatusEditor currentUser={currentUser} onClose={close} />;
    case 'notificationPrefs': return <NotificationPrefs workspaceId={workspaceId} currentUser={currentUser} conversation={conv} onClose={close} />;
    default: return null;
  }
}

const normalize = (name: string) => name.toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 80);

/** Share the workspace's invite link. */
function InviteModal({ workspaceId, onClose }: { workspaceId: string; onClose(): void }) {
  const workspace = useSession((s) => s.workspaces.find((w) => w.id === workspaceId));
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/join/${workspace?.inviteCode ?? ''}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <Modal title={`Invite people to ${workspace?.name ?? 'this workspace'}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Done</button><button className="btn btn-primary" onClick={copy}>{copied ? 'Copied' : 'Copy invite link'}</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>Anyone with this link can join after signing in with a verified email.</p>
      <input className="input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
    </Modal>
  );
}

function CreateChannelModal({ workspaceId, onClose }: { workspaceId: string; onClose(): void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const clean = normalize(name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clean) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ conversation: Conversation }>(`/api/w/${workspaceId}/channels`, { name: clean, description, isPrivate });
      useConversations.getState().upsert(r.conversation);
      onClose();
      navigate(`/w/${workspaceId}/c/${r.conversation.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Create a channel" onClose={onClose}>
      <form className="col gap" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <div className="input-prefix"><Icon name={isPrivate ? 'lock' : 'hash'} size={15} /><input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. plan-budget" /></div>
          {name && clean !== name && <small className="muted">Will be created as #{clean || '…'}</small>}
        </label>
        <label className="field">
          <span>Description <span className="muted">(optional)</span></span>
          <input className="input" value={description} maxLength={250} onChange={(e) => setDescription(e.target.value)} placeholder="What’s this channel about?" />
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
          <span><strong>Make private</strong><br /><span className="muted small">Only invited people can view and join.</span></span>
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="row end gap-sm">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!clean || busy}>Create</button>
        </div>
      </form>
    </Modal>
  );
}

function NewMessageModal({ workspaceId, currentUser, onClose }: { workspaceId: string; currentUser: User; onClose(): void }) {
  const members = useSession((s) => s.members);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    return Object.values(members)
      .filter((m) => !m.deactivated && !picked.includes(m.id))
      .filter((m) => !s || m.fullName.toLowerCase().includes(s) || m.displayName.toLowerCase().includes(s) || m.email.toLowerCase().includes(s))
      .slice(0, 8);
  }, [q, members, picked]);

  const go = async () => {
    try {
      const c = await openDm(workspaceId, picked.filter((id) => id !== currentUser.id));
      onClose();
      navigate(`/w/${workspaceId}/c/${c.id}`);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <Modal title="New message" onClose={onClose}>
      <div className="col gap">
        <div className="chip-input">
          {picked.map((id) => (
            <span key={id} className="chip"><Avatar userId={id} size={18} /> {displayName(members[id])}
              <button aria-label="Remove" onClick={() => setPicked((p) => p.filter((x) => x !== id))}><Icon name="x" size={12} /></button>
            </span>
          ))}
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={picked.length ? '' : 'To: name or email'}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !q && picked.length) setPicked((p) => p.slice(0, -1));
              if (e.key === 'Enter' && !q && picked.length) go();
              if (e.key === 'Enter' && q && results[0]) { setPicked((p) => [...p, results[0].id]); setQ(''); }
            }} />
        </div>
        <ul className="pick-list">
          {results.map((m: Member) => (
            <li key={m.id}><button onClick={() => { setPicked((p) => [...p, m.id].slice(0, 8)); setQ(''); }}>
              <Avatar user={m} size={24} /> <strong>{m.fullName}</strong> <span className="muted">{m.id === currentUser.id ? '(you)' : m.displayName}</span>
            </button></li>
          ))}
        </ul>
        {error && <div className="form-error">{error}</div>}
        <div className="row end gap-sm">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!picked.length} onClick={go}>Go to conversation</button>
        </div>
      </div>
    </Modal>
  );
}

type SwitchItem = { key: string; label: string; sub?: string; icon: React.ReactNode; unread?: boolean; go(): void };

function QuickSwitcher({ workspaceId, currentUser, onClose }: { workspaceId: string; currentUser: User; onClose(): void }) {
  const convs = useConversations((s) => s.byId);
  const members = useSession((s) => s.members);
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo<SwitchItem[]>(() => {
    const s = q.trim().toLowerCase().replace(/^[#@]/, '');
    const out: SwitchItem[] = [];
    const dmWith = new Set<string>();
    const list = Object.values(convs).filter((c) => c.isMember && !c.isArchived)
      .sort((a, b) => (b.unreadCount - a.unreadCount) || ((b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)));
    for (const c of list) {
      const title = conversationTitle(c, members, currentUser);
      const partner = dmPartnerId(c, currentUser.id);
      if (partner) dmWith.add(partner);
      if (s && !title.toLowerCase().includes(s)) continue;
      out.push({
        key: c.id, label: title, sub: c.kind === 'channel' ? c.topic : undefined, unread: c.unreadCount > 0,
        icon: c.kind === 'channel' ? <Icon name={c.isPrivate ? 'lock' : 'hash'} size={15} /> : partner ? <Avatar userId={partner} size={20} /> : <Icon name="users" size={15} />,
        go: () => navigate(`/w/${workspaceId}/c/${c.id}`),
      });
    }
    for (const m of Object.values(members)) {
      if (dmWith.has(m.id) || m.deactivated) continue;
      if (s && !m.fullName.toLowerCase().includes(s) && !m.displayName.toLowerCase().includes(s)) continue;
      out.push({
        key: m.id, label: m.fullName, sub: m.title, icon: <Avatar user={m} size={20} />,
        go: async () => { const c = await openDm(workspaceId, m.id === currentUser.id ? [] : [m.id]); navigate(`/w/${workspaceId}/c/${c.id}`); },
      });
    }
    return out.slice(0, 12);
  }, [q, convs, members, currentUser, workspaceId, navigate]);

  useEffect(() => { setIndex(0); }, [q]);
  useEffect(() => { listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' }); }, [index]);

  const choose = (it?: SwitchItem) => { if (!it) return; onClose(); it.go(); };

  return (
    <Modal onClose={onClose} width={560} className="switcher">
      <div className="switcher-input">
        <Icon name="search" />
        <input autoFocus placeholder="Jump to a channel or person…" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(items.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
            if (e.key === 'Enter') { e.preventDefault(); choose(items[index]); }
          }} />
      </div>
      <ul className="switcher-list" ref={listRef}>
        {items.map((it, i) => (
          <li key={it.key} className={`${i === index ? 'active' : ''}${it.unread ? ' unread' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => choose(it)}>
            <span className="sw-icon">{it.icon}</span><span className="sw-label">{it.label}</span>{it.sub && <span className="sw-sub">{it.sub}</span>}
          </li>
        ))}
        {items.length === 0 && <li className="muted">No matches</li>}
      </ul>
      <div className="switcher-foot muted small">↑↓ to navigate · Enter to open · Esc to close</div>
    </Modal>
  );
}
