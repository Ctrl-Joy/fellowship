import { useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import type { Conversation, User, Workspace } from '../types';
import { useConversations, conversationTitle, dmPartnerId } from '../store/conversations';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { hasDraft } from '../lib/drafts';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import PresenceDot from '../features/presence/PresenceDot';

function loadCollapsed(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem('fs:sidebar') ?? '{}'); } catch { return {}; }
}

export function Sidebar({ workspace, currentUser }: { workspace: Workspace; currentUser: User }) {
  const byId = useConversations((s) => s.byId);
  const activeId = useConversations((s) => s.activeId);
  const members = useSession((s) => s.members);
  const openModal = useUi((s) => s.openModal);
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [menu, setMenu] = useState<'channels' | 'workspace' | null>(null);

  const toggle = (k: string) => setCollapsed((c) => {
    const next = { ...c, [k]: !c[k] };
    try { localStorage.setItem('fs:sidebar', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  const { channels, dms } = useMemo(() => {
    const all = Object.values(byId).filter((c) => c.isMember && c.workspaceId === workspace.id);
    const channels = all.filter((c) => c.kind === 'channel' && !c.isArchived).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    const dms = all.filter((c) => c.kind !== 'channel')
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt));
    return { channels, dms };
  }, [byId, workspace.id]);

  const base = `/w/${workspace.id}`;
  const item = (c: Conversation) => {
    const unread = c.unreadCount > 0 && !c.muted;
    const title = conversationTitle(c, members, currentUser);
    const partner = dmPartnerId(c, currentUser.id);
    const draft = c.id !== activeId && hasDraft(c.id);
    return (
      <NavLink key={c.id} to={`${base}/c/${c.id}`}
        className={({ isActive }) => `sb-item${isActive ? ' active' : ''}${unread ? ' unread' : ''}${c.muted ? ' muted-conv' : ''}`}>
        <span className="sb-icon">
          {c.kind === 'channel' ? <Icon name={c.isPrivate ? 'lock' : 'hash'} size={15} />
            : partner ? <span className="avatar-wrap"><Avatar userId={partner} size={18} /><PresenceDot userId={partner} size={8} /></span>
              : <span className="sb-group-count">{(c.memberIds?.length ?? 1) - 1}</span>}
        </span>
        <span className="sb-label">{title}</span>
        {draft && <Icon name="edit" size={13} className="sb-draft" />}
        {c.mentionCount > 0 && <span className="badge" aria-label={`${c.mentionCount} mentions`}>{c.mentionCount}</span>}
      </NavLink>
    );
  };

  return (
    <nav className="sidebar" aria-label="Sidebar">
      <div className="sb-head">
        <button className="sb-ws" onClick={() => setMenu(menu === 'workspace' ? null : 'workspace')}>
          <span>{workspace.name}</span><Icon name="chevronDown" size={14} />
        </button>
        <button className="sb-compose" title="New message" onClick={() => openModal({ kind: 'newMessage' })}><Icon name="compose" size={17} /></button>
        {menu === 'workspace' && (
          <div className="menu" onMouseLeave={() => setMenu(null)}>
            <div className="menu-note">
              Invite people with this link:
              <code className="invite">{`${location.origin}/join/${workspace.inviteCode}`}</code>
            </div>
            <button onClick={() => { navigator.clipboard?.writeText(`${location.origin}/join/${workspace.inviteCode}`); setMenu(null); }}>Copy invite link</button>
            <button onClick={() => { openModal({ kind: 'notificationPrefs' }); setMenu(null); }}>Notification preferences</button>
            <button onClick={() => { navigate('/workspaces'); setMenu(null); }}>Switch or add workspace</button>
          </div>
        )}
      </div>
      <div className="sb-scroll">
        <div className="sb-nav">
          <NavLink to={`${base}/threads`} className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}><span className="sb-icon"><Icon name="thread" size={15} /></span><span className="sb-label">Threads</span></NavLink>
          <NavLink to={`${base}/activity`} className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}><span className="sb-icon"><Icon name="bell" size={15} /></span><span className="sb-label">Activity</span></NavLink>
          <NavLink to={`${base}/saved`} className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}><span className="sb-icon"><Icon name="bookmark" size={15} /></span><span className="sb-label">Saved</span></NavLink>
        </div>

        <Section title="Channels" open={!collapsed.channels} onToggle={() => toggle('channels')}
          onAdd={() => setMenu(menu === 'channels' ? null : 'channels')} addLabel="Add channels">
          {menu === 'channels' && (
            <div className="menu menu-inline" onMouseLeave={() => setMenu(null)}>
              <button onClick={() => { openModal({ kind: 'createChannel' }); setMenu(null); }}>Create a new channel</button>
              <button onClick={() => { navigate(`${base}/browse`); setMenu(null); }}>Browse channels</button>
            </div>
          )}
          {channels.map(item)}
          <button className="sb-item sb-add" onClick={() => navigate(`${base}/browse`)}><span className="sb-icon"><Icon name="plus" size={15} /></span><span className="sb-label">Browse channels</span></button>
        </Section>

        <Section title="Direct messages" open={!collapsed.dms} onToggle={() => toggle('dms')} onAdd={() => openModal({ kind: 'newMessage' })} addLabel="New message">
          {dms.map(item)}
          <button className="sb-item sb-add" onClick={() => openModal({ kind: 'newMessage' })}><span className="sb-icon"><Icon name="plus" size={15} /></span><span className="sb-label">Add teammates</span></button>
        </Section>

        <div className="sb-nav sb-nav-bottom">
          <NavLink to={`${base}/apps`} className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}><span className="sb-icon"><Icon name="apps" size={15} /></span><span className="sb-label">Apps</span></NavLink>
          <NavLink to={`${base}/workflows`} className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}><span className="sb-icon"><Icon name="workflow" size={15} /></span><span className="sb-label">Workflows</span></NavLink>
        </div>
      </div>
    </nav>
  );
}

function Section({ title, open, onToggle, onAdd, addLabel, children }: {
  title: string; open: boolean; onToggle(): void; onAdd(): void; addLabel: string; children: React.ReactNode;
}) {
  return (
    <div className="sb-section">
      <div className="sb-section-head">
        <button className="sb-section-toggle" onClick={onToggle} aria-expanded={open}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} /> {title}
        </button>
        <button className="sb-section-add" title={addLabel} aria-label={addLabel} onClick={onAdd}><Icon name="plus" size={14} /></button>
      </div>
      {open && <div className="sb-section-body">{children}</div>}
    </div>
  );
}
