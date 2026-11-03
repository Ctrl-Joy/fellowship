import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import type { User } from '../../types';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { useSession, displayName } from '../../store/session';
import { useConversations, conversationTitle } from '../../store/conversations';
import { useUi } from '../../store/ui';
import { timeAgo } from '../../lib/time';
import { useNotifications, TAB_LABELS, type ActivityTab, type NotificationItem } from './store';
import { describeNotification, channelLabel, previewText } from './describe';
import './notifications.css';

export interface ActivityViewProps {
  workspaceId: string;
  currentUser: User;
}

const TABS: ActivityTab[] = ['all', 'mentions', 'threads', 'reactions'];

/** Sidebar "Activity": mentions, DMs, thread replies and reactions, newest first. */
export default function ActivityView({ workspaceId, currentUser }: ActivityViewProps) {
  const storeWorkspace = useNotifications((s) => s.workspaceId);
  const tab = useNotifications((s) => s.tab);
  const unreadOnly = useNotifications((s) => s.unreadOnly);
  const items = useNotifications((s) => s.items);
  const unread = useNotifications((s) => s.unread);
  const hasMore = useNotifications((s) => s.hasMore);
  const loading = useNotifications((s) => s.loading);
  const loaded = useNotifications((s) => s.loaded);
  const error = useNotifications((s) => s.error);
  const members = useSession((s) => s.members);
  const byId = useConversations((s) => s.byId);
  const navigate = useNavigate();

  // Feature setup resets the store for this workspace after the first render, so load once it matches.
  useEffect(() => {
    if (storeWorkspace === workspaceId) void useNotifications.getState().load();
  }, [workspaceId, storeWorkspace]);

  const open = (n: NotificationItem) => {
    void useNotifications.getState().markRead(n.id);
    if (!n.conversationId) return;
    navigate(`/w/${workspaceId}/c/${n.conversationId}`);
    if (n.kind === 'thread_reply') {
      useUi.getState().openRightPanel({ kind: 'thread', conversationId: n.conversationId, rootId: n.threadRootId ?? n.messageId ?? '' });
    }
  };

  return (
    <div className="view activity-view">
      <header className="view-head">
        <h2>Activity</h2>
        <span className="muted small">{unread} unread</span>
        <button className="btn btn-sm" onClick={() => void useNotifications.getState().markAllRead()} disabled={unread === 0}>
          Mark all as read
        </button>
        <button className="icon-btn" aria-label="Notification settings" title="Notification settings"
          onClick={() => useUi.getState().openModal({ kind: 'notificationPrefs' })}>
          <Icon name="bell" />
        </button>
      </header>

      <div className="view-toolbar activity-toolbar">
        <div className="tabs" role="tablist" aria-label="Activity filters">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' active' : ''}`}
              onClick={() => useNotifications.getState().setView(t, unreadOnly)}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
        <label className="act-unread-toggle">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => useNotifications.getState().setView(tab, e.target.checked)} />
          Unread only
        </label>
      </div>

      <div className="view-scroll">
        {error && <div className="act-error" role="alert">{error}</div>}
        {!loaded && loading && <div className="empty"><span className="spinner" /></div>}
        {loaded && items.length === 0 && !loading && (
          <div className="empty">
            {unreadOnly ? 'You are all caught up.' : 'Mentions, direct messages, thread replies and reactions to you will show up here.'}
          </div>
        )}

        <ul className="act-list">
          {items.map((n) => {
            const actor = n.actorId ? displayName(members[n.actorId]) : 'Someone';
            const conv = n.conversationId ? byId[n.conversationId] : undefined;
            const where = channelLabel(n) ?? (conv && n.conversationKind !== 'channel' ? conversationTitle(conv, members, currentUser) : null);
            return (
              <li key={n.id} className={`act-item${n.readAt == null ? ' unread' : ''}`}>
                <button className="act-main" onClick={() => open(n)}>
                  <Avatar userId={n.actorId ?? undefined} size={32} />
                  <span className="act-body">
                    <span className="act-title">{describeNotification(n, actor, where)}</span>
                    <span className="act-preview">{previewText(n.text)}</span>
                    <span className="act-meta muted small">
                      {timeAgo(n.createdAt)}
                      {n.silenced && <span className="act-quiet"> · Arrived during Do Not Disturb</span>}
                    </span>
                  </span>
                  {n.readAt == null && <span className="act-dot" aria-label="Unread" />}
                </button>
              </li>
            );
          })}
        </ul>

        {hasMore && (
          <div className="center" style={{ padding: 12 }}>
            <button className="btn" onClick={() => void useNotifications.getState().loadMore()} disabled={loading}>
              {loading ? 'Loading…' : 'Load older'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
