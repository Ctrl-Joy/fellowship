import { useEffect, useRef, useState } from 'react';
import type { Conversation, User } from '../../types';
import { useMessages } from '../../store/messages';
import { loadThread } from '../../store/actions';
import { MessageItem } from '../../shell/MessageItem';
import { Composer } from '../../shell/Composer';
import { TypingIndicator } from '../../shell/TypingIndicator';
import { Icon } from '../../components/Icon';
import { useThreads } from './store';
import { fetchThreadState, markThreadRead, setThreadFollowing } from './api';

export interface ThreadPanelProps {
  workspaceId: string;
  conversation: Conversation;
  rootId: string;
  currentUser: User;
  onClose(): void;
}

/** Right-panel thread view: root, live replies, follow toggle, mark-read and the reply composer. */
export default function ThreadPanel({ workspaceId, conversation, rootId, currentUser, onClose }: ThreadPanelProps) {
  const root = useMessages((s) => s.byId[rootId]);
  const thread = useMessages((s) => s.threads[rootId]);
  const byId = useMessages((s) => s.byId);
  const status = useThreads((s) => s.byRoot[rootId]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const replyCount = thread?.ids.length ?? 0;
  const following = !!status?.following;

  // Load the thread and the viewer's follow state whenever the panel opens on a thread.
  useEffect(() => {
    setError(null);
    loadThread(rootId).catch((e) => setError(e.message));
    fetchThreadState(rootId, conversation.id).catch(() => {});
  }, [rootId, conversation.id]);

  // Viewing the thread marks it read: on open and whenever a new reply lands while it is open.
  useEffect(() => {
    if (!following) return;
    markThreadRead(rootId, conversation.id).catch(() => {});
  }, [rootId, conversation.id, following, replyCount]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [replyCount]);

  async function toggleFollow() {
    if (busy) return;
    setBusy(true);
    try {
      await setThreadFollowing(rootId, conversation.id, !following);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="panel thread-panel">
      <header className="panel-head">
        <div>
          <h3>Thread</h3>
          <div className="muted small">{conversation.kind === 'channel' ? `#${conversation.name}` : 'Direct message'}</div>
        </div>
        <div className="row gap-sm">
          <button type="button" className={`btn btn-sm thread-follow${following ? ' is-following' : ''}`}
            aria-pressed={following} disabled={busy} onClick={toggleFollow}
            title={following ? 'Stop following this thread' : 'Follow this thread to get updates'}>
            {following ? 'Following' : 'Follow'}
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Close thread"><Icon name="x" /></button>
        </div>
      </header>
      <div className="panel-scroll">
        {error && <div className="empty">{error}</div>}
        {root && (
          <MessageItem message={root} conversation={conversation} currentUser={currentUser} workspaceId={workspaceId} inThread showHeader />
        )}
        {root && (
          <div className="thread-divider"><span>{root.replyCount} {root.replyCount === 1 ? 'reply' : 'replies'}</span></div>
        )}
        {thread?.ids.map((id, i) => {
          const m = byId[id];
          if (!m) return null;
          const prev = i > 0 ? byId[thread.ids[i - 1]] : null;
          const grouped = !!prev && prev.userId === m.userId && m.createdAt - prev.createdAt < 5 * 60_000;
          return (
            <MessageItem key={id} message={m} conversation={conversation} currentUser={currentUser}
              workspaceId={workspaceId} inThread showHeader={!grouped} />
          );
        })}
        <div ref={endRef} />
      </div>
      <div className="panel-composer">
        <Composer conversation={conversation} workspaceId={workspaceId} threadRootId={rootId} placeholder="Reply…" />
        <TypingIndicator conversationId={conversation.id} threadRootId={rootId} />
      </div>
    </aside>
  );
}
