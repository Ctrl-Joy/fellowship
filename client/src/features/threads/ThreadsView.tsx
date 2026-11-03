import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { User } from '../../types';
import { useConversations, conversationTitle } from '../../store/conversations';
import { useSession, displayName } from '../../store/session';
import { useUi } from '../../store/ui';
import { Avatar } from '../../components/Avatar';
import { plainText } from '../../lib/markdown';
import { timeAgo } from '../../lib/time';
import { useThreads, type ThreadListItem } from './store';
import { refreshThreadList } from './api';
import './threads.css';

export interface ThreadsViewProps {
  workspaceId: string;
  currentUser: User;
}

const preview = (text: string, max = 180) => {
  const t = plainText(text).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Sidebar "Threads" view: threads you follow, unread ones highlighted, click to open. */
export default function ThreadsView({ workspaceId, currentUser }: ThreadsViewProps) {
  const list = useThreads((s) => s.list);
  const byRoot = useThreads((s) => s.byRoot);
  const members = useSession((s) => s.members);
  const conversations = useConversations((s) => s.byId);
  const openPanel = useUi((s) => s.openRightPanel);
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    refreshThreadList(workspaceId)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  // Unread state is live in byRoot; the list order and reply previews refresh through setup.ts.
  const items: ThreadListItem[] = (list ?? []).filter((it) => {
    if (!unreadOnly) return true;
    return (byRoot[it.root.id]?.unreadCount ?? it.unreadCount) > 0;
  });

  function open(it: ThreadListItem) {
    navigate(`/w/${workspaceId}/c/${it.conversation.id}`);
    openPanel({ kind: 'thread', conversationId: it.conversation.id, rootId: it.root.id });
  }

  const titleOf = (it: ThreadListItem) => {
    const conv = conversations[it.conversation.id];
    if (conv && conv.kind === 'channel') return `#${conv.name}`;
    if (conv) return conversationTitle(conv, members, currentUser);
    return it.conversation.kind === 'channel' ? `#${it.conversation.name}` : 'Direct message';
  };

  return (
    <div className="view threads-view">
      <header className="view-head">
        <h2>Threads</h2>
        <div className="seg" role="group" aria-label="Filter threads">
          <button type="button" className={`seg-btn${!unreadOnly ? ' active' : ''}`} onClick={() => setUnreadOnly(false)}>All</button>
          <button type="button" className={`seg-btn${unreadOnly ? ' active' : ''}`} onClick={() => setUnreadOnly(true)}>Unread</button>
        </div>
      </header>
      <div className="view-scroll">
        {error && <div className="empty">{error}</div>}
        {!error && list === null && loading && <div className="empty">Loading threads…</div>}
        {!error && list !== null && items.length === 0 && (
          <div className="empty">
            {unreadOnly ? 'No unread threads. Nice.' : 'Threads you take part in will show up here.'}
          </div>
        )}
        <ul className="thread-list">
          {items.map((it) => {
            const unread = byRoot[it.root.id]?.unreadCount ?? it.unreadCount;
            const author = members[it.root.userId];
            return (
              <li key={it.root.id}>
                <button type="button" className={`thread-row${unread > 0 ? ' is-unread' : ''}`} onClick={() => open(it)}>
                  <div className="thread-row-head">
                    <span className="thread-row-where">{titleOf(it)}</span>
                    <span className="muted small">{timeAgo(it.lastActivityAt)}</span>
                    {unread > 0 && <span className="badge" aria-label={`${unread} unread replies`}>{unread}</span>}
                  </div>
                  <div className="thread-row-root">
                    <Avatar userId={it.root.userId} size={22} />
                    <span className="thread-row-author">{displayName(author) || 'Someone'}</span>
                    <span className="thread-row-text">{preview(it.root.text)}</span>
                  </div>
                  {it.replies.length > 0 && (
                    <div className="thread-row-replies">
                      {it.replies.map((r) => (
                        <div key={r.id} className="thread-row-reply">
                          <span className="thread-row-author">{displayName(members[r.userId]) || 'Someone'}</span>
                          <span className="thread-row-text">{preview(r.text, 140)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="thread-row-foot muted small">
                    {it.root.replyCount} {it.root.replyCount === 1 ? 'reply' : 'replies'}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
