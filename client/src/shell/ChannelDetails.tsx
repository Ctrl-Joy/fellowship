import { useEffect, useMemo, useState } from 'react';
import { askConfirm } from '../components/Dialogs';
import { useNavigate } from 'react-router';
import type { Conversation, User } from '../types';
import { api } from '../api';
import { useSession, displayName } from '../store/session';
import { useConversations, conversationTitle } from '../store/conversations';
import { useUi } from '../store/ui';
import { leaveConversation, updateConversation } from '../store/actions';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import PresenceDot from '../features/presence/PresenceDot';

type Tab = 'about' | 'members' | 'settings';

export function ChannelDetails({ workspaceId, conversation: c, currentUser, initialTab, onClose }: {
  workspaceId: string; conversation: Conversation; currentUser: User; initialTab?: Tab; onClose(): void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'about');
  const members = useSession((s) => s.members);
  const myRole = members[currentUser.id]?.role;
  const [memberIds, setMemberIds] = useState<string[] | null>(c.memberIds);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<'name' | 'topic' | 'description' | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState('');
  const navigate = useNavigate();
  const isChannel = c.kind === 'channel';
  const canAdmin = myRole === 'owner' || myRole === 'admin' || c.createdBy === currentUser.id;

  useEffect(() => { setTab(initialTab ?? 'about'); }, [initialTab]);
  useEffect(() => {
    api.get<{ userIds: string[] }>(`/api/conversations/${c.id}/members`).then((r) => setMemberIds(r.userIds)).catch(() => {});
  }, [c.id, c.memberCount]);

  const candidates = useMemo(() => {
    const q = adding.trim().toLowerCase();
    if (!q) return [];
    return Object.values(members).filter((m) => !m.deactivated && !(memberIds ?? []).includes(m.id)
      && (m.fullName.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q))).slice(0, 6);
  }, [adding, members, memberIds]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (e: any) { setError(e.message); }
  };

  const saveField = () => run(async () => {
    if (!editing) return;
    await updateConversation(c.id, { [editing]: draft });
    setEditing(null);
  });

  const field = (key: 'name' | 'topic' | 'description', label: string, value: string, editable: boolean) => (
    <div className="detail-field">
      <div className="detail-label">
        <span>{label}</span>
        {editable && c.isMember && editing !== key && <button className="link" onClick={() => { setEditing(key); setDraft(value); }}>Edit</button>}
      </div>
      {editing === key ? (
        <div className="col gap-sm">
          <textarea className="input" value={draft} rows={key === 'name' ? 1 : 3} autoFocus onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveField(); } if (e.key === 'Escape') setEditing(null); }} />
          <div className="row gap-sm"><button className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-sm btn-primary" onClick={saveField}>Save</button></div>
        </div>
      ) : <div className={value ? '' : 'muted'}>{value || `Add a ${label.toLowerCase()}`}</div>}
    </div>
  );

  return (
    <aside className="panel">
      <header className="panel-head">
        <h3>{isChannel ? <>{c.isPrivate ? <Icon name="lock" size={15} /> : '#'}{c.name}</> : conversationTitle(c, members, currentUser)}</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close details"><Icon name="x" /></button>
      </header>
      <nav className="tabs tabs-panel">
        <button className={`tab${tab === 'about' ? ' active' : ''}`} onClick={() => setTab('about')}>About</button>
        <button className={`tab${tab === 'members' ? ' active' : ''}`} onClick={() => setTab('members')}>Members {c.memberCount}</button>
        {isChannel && <button className={`tab${tab === 'settings' ? ' active' : ''}`} onClick={() => setTab('settings')}>Settings</button>}
      </nav>
      <div className="panel-scroll">
        {error && <div className="form-error">{error}</div>}
        {tab === 'about' && (
          <div className="col gap">
            {isChannel && field('name', 'Channel name', c.name ?? '', !c.isDefault)}
            {field('topic', 'Topic', c.topic, true)}
            {isChannel && field('description', 'Description', c.description, true)}
            {isChannel && (
              <div className="detail-field">
                <div className="detail-label">Created by</div>
                <div>{displayName(c.createdBy ? members[c.createdBy] : undefined)} on {new Date(c.createdAt).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })}</div>
              </div>
            )}
            <button className="btn" onClick={() => useUi.getState().openModal({ kind: 'notificationPrefs', conversationId: c.id })}><Icon name="bell" size={15} /> Notification settings</button>
            {c.isMember && (
              <button className="btn" onClick={() => run(() => updateConversation(c.id, { muted: !c.muted }))}>{c.muted ? 'Unmute' : 'Mute'} conversation</button>
            )}
            {isChannel && c.isMember && !c.isDefault && (
              <button className="btn btn-danger-ghost" onClick={() => run(async () => { await leaveConversation(c.id); onClose(); navigate(`/w/${workspaceId}`); })}>Leave channel</button>
            )}
          </div>
        )}
        {tab === 'members' && (
          <div className="col gap-sm">
            {isChannel && c.isMember && !c.isArchived && (
              <div className="add-people">
                <input className="input" placeholder="Add people by name" value={adding} onChange={(e) => setAdding(e.target.value)} />
                {candidates.map((m) => (
                  <button key={m.id} className="member-row" onClick={() => run(async () => {
                    await api.post(`/api/conversations/${c.id}/members`, { userIds: [m.id] });
                    setAdding('');
                    setMemberIds((ids) => [...(ids ?? []), m.id]);
                  })}>
                    <Avatar user={m} size={24} /> <span>{m.fullName}</span> <span className="muted small">Add</span>
                  </button>
                ))}
              </div>
            )}
            {(memberIds ?? []).map((id) => {
              const m = members[id];
              return (
                <div key={id} className="member-row">
                  <button className="row gap-sm grow" onClick={() => useUi.getState().openRightPanel({ kind: 'profile', userId: id })}>
                    <span className="avatar-wrap"><Avatar userId={id} size={28} /><PresenceDot userId={id} size={9} /></span>
                    <span>{m?.fullName ?? 'Unknown'}{id === currentUser.id ? ' (you)' : ''}</span>
                    {m?.title && <span className="muted small">{m.title}</span>}
                  </button>
                  {isChannel && !c.isDefault && canAdmin && id !== currentUser.id && (
                    <button className="link small" onClick={() => run(async () => {
                      await api.del(`/api/conversations/${c.id}/members/${id}`);
                      setMemberIds((ids) => (ids ?? []).filter((x) => x !== id));
                    })}>Remove</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {tab === 'settings' && isChannel && (
          <div className="col gap">
            {!c.isDefault && c.isMember && (
              <button className="btn" onClick={() => run(() => updateConversation(c.id, { isPrivate: !c.isPrivate }))}>
                <Icon name={c.isPrivate ? 'hash' : 'lock'} size={15} /> Change to a {c.isPrivate ? 'public' : 'private'} channel
              </button>
            )}
            {!c.isDefault && c.isMember && (
              <button className="btn btn-danger-ghost" onClick={() => run(async () => {
                if (!c.isArchived && !await askConfirm(`Archive #${c.name}?`, { body: 'No one will be able to post in it.', action: 'Archive' })) return;
                const r = await api.post<{ conversation: Conversation }>(`/api/conversations/${c.id}/archive`, { archived: !c.isArchived });
                useConversations.getState().upsert(r.conversation);
              })}>
                <Icon name="archive" size={15} /> {c.isArchived ? 'Unarchive channel' : 'Archive channel'}
              </button>
            )}
            {c.isDefault && <p className="muted">#{c.name} is the workspace’s default channel. Everyone is in it and it can’t be renamed, archived or left.</p>}
          </div>
        )}
      </div>
    </aside>
  );
}
