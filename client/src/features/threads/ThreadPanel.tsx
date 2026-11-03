import { useEffect, useRef, useState } from 'react';
import type { Conversation, User } from '../../types';
import { useMessages } from '../../store/messages';
import { loadThread } from '../../store/actions';
import { MessageItem } from '../../shell/MessageItem';
import { Composer } from '../../shell/Composer';
import { TypingIndicator } from '../../shell/TypingIndicator';
import { Icon } from '../../components/Icon';

export interface ThreadPanelProps {
  workspaceId: string;
  conversation: Conversation;
  rootId: string;
  currentUser: User;
  onClose(): void;
}

/** Right-panel thread view. Core stub: root + replies + reply composer. Owned by `threads`. */
export default function ThreadPanel({ workspaceId, conversation, rootId, currentUser, onClose }: ThreadPanelProps) {
  const root = useMessages((s) => s.byId[rootId]);
  const thread = useMessages((s) => s.threads[rootId]);
  const byId = useMessages((s) => s.byId);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setError(null);
    loadThread(rootId).catch((e) => setError(e.message));
  }, [rootId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread?.ids.length]);

  return (
    <aside className="panel">
      <header className="panel-head">
        <div>
          <h3>Thread</h3>
          <div className="muted small">{conversation.kind === 'channel' ? `#${conversation.name}` : 'Direct message'}</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close thread"><Icon name="x" /></button>
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
