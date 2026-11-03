import { useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import type { Conversation, User, Workspace } from '../types';
import { useConversations, conversationTitle, dmPartnerId } from '../store/conversations';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { hasDraft } from '../lib/drafts';
import { useStarred } from '../lib/starred';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import PresenceDot from '../features/presence/PresenceDot';
import UnreadThreadsBadge from '../features/threads/UnreadThreadsBadge';
import ActivityBadge from '../features/notifications/ActivityBadge';
import HuddleIndicator from '../features/huddles/HuddleIndicator';
import ProjectsSidebarSection from '../features/projects/SidebarSection';

function loadCollapsed(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem('fs:sidebar') ?? '{}'); } catch { return {}; }
}

export function Sidebar({ workspace, currentUser }: { workspace: Workspace; currentUser: User }) {
  const byId = useConversations((s) => s.byId);
  const activeId = useConversations((s) => s.activeId);
  const members = useSession((s) => s.members);
  const openModal = useUi((s) => s.openModal);
  const mode = useUi((s) => s.sidebarMode);
  const starredIds = useStarred();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [menu, setMenu] = useState<'channels' | 'workspace' | null>(null);
  const [query, setQuery] = useState('');

  const toggle = (k: string) => setCollapsed((c) => {
    const next = { ...c, [k]: !c[k] };
    try { localStorage.setItem('fs:sidebar', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  const { starred, channels, dms } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = Object.values(byId).filter((c) => c.isMember && c.workspaceId === workspace.id && !c.isArchived)
      .filter((c) => !q || conversationTitle(c, members, currentUser).toLowerCase().includes(q));
    const byRecent = (a: Conversation, b: Conversation) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt);
    const starred = all.filter((c) => starredIds.includes(c.id));
    const rest = all.filter((c) => !starredIds.includes(c.id));
    const channels = rest.filter((c) => c.kind === 'channel').sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    const dms = (mode === 'dms' ? all : rest).filter((c) => c.kind !== 'channel').sort(byRecent);
    return { starred, channels, dms };
  }, [byId, workspace.id, query, starredIds, mode, members, currentUser]);

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
            : partner ? <span className="avatar-wrap"><Avatar userId={partner} size={20} /><PresenceDot userId={partner} size={8} /></span>
              : c.kind === 'self' ? <span className="avatar-wrap"><Avatar user={currentUser} size={20} /><PresenceDot userId={currentUser.id} size={8} /></span>
                : <span className="sb-group-count">{(c.memberIds?.length ?? 1) - 1}</span>}
        </span>
        <span className="sb-label">{title}{c.kind === 'self' && <span className="sb-you">you</span>}</span>
        {draft && <Icon name="edit" size={13} className="sb-draft" />}
        <HuddleIndicator conversationId={c.id} />
        {c.mentionCount > 0 && <span className="badge" aria-label={`${c.mentionCount} mentions`}>{c.mentionCount}</span>}
      </NavLink>
    );
  };

  return (
    <nav className="sidebar" aria-label="Sidebar">
      <div className="sb-head">
        <button className="sb-ws" onClick={() => setMenu(menu === 'workspace' ? null : 'workspace')}>
          <span>{mode === 'dms' ? 'Direct messages' : workspace.name}</span>{mode === 'home' && <Icon name="chevronDown" size={14} />}
        </button>
        <div className="sb-head-actions">
          <button className="sb-head-btn" title="Preferences" onClick={() => openModal({ kind: 'notificationPrefs' })}><Icon name="gear" size={18} /></button>
          <button className="sb-head-btn" title="New message" onClick={() => openModal({ kind: 'newMessage' })}><Icon name="compose" size={18} /></button>
        </div>
        {menu === 'workspace' && mode === 'home' && (
          <div className="menu" onMouseLeave={() => setMenu(null)}>
            <div className="menu-note">
              Invite people with this link:
              <code className="invite">{`${location.origin}/join/${workspace.inviteCode}`}</code>
            </div>
            <button onClick={() => { navigator.clipboard?.writeText(`${location.origin}/join/${workspace.inviteCode}`); setMenu(null); }}>Copy invite link</button>
            <button onClick={() => { openModal({ kind: 'createChannel' }); setMenu(null); }}>Create a channel</button>
            <button onClick={() => { openModal({ kind: 'notificationPrefs' }); setMenu(null); }}>Notification preferences</button>
            <button onClick={() => { navigate('/workspaces'); setMenu(null); }}>Switch or add workspace</button>
          </div>
        )}
      </div>
      <div className="sb-scroll">
        <label className="sb-find">
          <Icon name="filter" size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a conversation…" aria-label="Find a conversation" />
          {query && <button onClick={() => setQuery('')} aria-label="Clear"><Icon name="x" size={13} /></button>}
        </label>

        {mode === 'home' && (
          <>
            <div className="sb-nav">
              <NavLink to={`${base}/threads`} className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}><span className="sb-icon"><Icon name="thread" size={16} /></span><span className="sb-label">Threads</span><UnreadThreadsBadge /></NavLink>
              <NavLink to={`${base}/activity`} className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}><span className="sb-icon"><Icon name="bell" size={16} /></span><span className="sb-label">Activity</span><ActivityBadge /></NavLink>
            </div>
            <hr className="sb-rule" />

            {starred.length > 0 && (
              <Section title="Starred" open={!collapsed.starred} onToggle={() => toggle('starred')}>
                {starred.map(item)}
              </Section>
            )}

            <Section title="Channels" icon="hash" open={!collapsed.channels} onToggle={() => toggle('channels')}
              onAdd={() => setMenu(menu === 'channels' ? null : 'channels')} addLabel="Add channels">
              {menu === 'channels' && (
                <div className="menu menu-inline" onMouseLeave={() => setMenu(null)}>
                  <button onClick={() => { openModal({ kind: 'createChannel' }); setMenu(null); }}>Create a new channel</button>
                  <button onClick={() => { navigate(`${base}/browse`); setMenu(null); }}>Browse channels</button>
                </div>
              )}
              {channels.map(item)}
              {!query && <button className="sb-item sb-add" onClick={() => navigate(`${base}/browse`)}><span className="sb-icon"><Icon name="plus" size={15} /></span><span className="sb-label">Browse channels</span></button>}
            </Section>
          </>
        )}

        <Section title="Direct messages" icon="messages" open={mode === 'dms' || !collapsed.dms} onToggle={() => toggle('dms')} onAdd={() => openModal({ kind: 'newMessage' })} addLabel="New message">
          {dms.map(item)}
          {!query && <button className="sb-item sb-add" onClick={() => openModal({ kind: 'invite' })}><span className="sb-icon"><Icon name="plus" size={15} /></span><span className="sb-label">Add teammates</span></button>}
        </Section>

        {mode === 'home' && <ProjectsSidebarSection workspaceId={workspace.id} />}

        {mode === 'home' && (
          <Section title="Apps" icon="grid" open={!collapsed.apps} onToggle={() => toggle('apps')}>
            <NavLink to={`${base}/apps`} className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}><span className="sb-icon"><Icon name="apps" size={15} /></span><span className="sb-label">Apps &amp; bots</span></NavLink>
            <NavLink to={`${base}/workflows`} className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}><span className="sb-icon"><Icon name="workflow" size={15} /></span><span className="sb-label">Workflows</span></NavLink>
            <NavLink to={`${base}/canvases`} className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}><span className="sb-icon"><Icon name="canvas" size={15} /></span><span className="sb-label">Canvases</span></NavLink>
            <NavLink to={`${base}/apps`} className="sb-item sb-add"><span className="sb-icon"><Icon name="plus" size={15} /></span><span className="sb-label">Connect apps</span></NavLink>
          </Section>
        )}
      </div>
    </nav>
  );
}

function Section({ title, icon, open, onToggle, onAdd, addLabel, children }: {
  title: string; icon?: string; open: boolean; onToggle(): void; onAdd?(): void; addLabel?: string; children: React.ReactNode;
}) {
  return (
    <div className="sb-section">
      <div className="sb-section-head">
        <button className="sb-section-toggle" onClick={onToggle} aria-expanded={open}>
          <span className="sb-icon">{icon ? <Icon name={icon} size={16} /> : <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />}</span> {title}
        </button>
        {onAdd && <button className="sb-section-add" title={addLabel} aria-label={addLabel} onClick={onAdd}><Icon name="plus" size={14} /></button>}
      </div>
      {open && <div className="sb-section-body">{children}</div>}
    </div>
  );
}
