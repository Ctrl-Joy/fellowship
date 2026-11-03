import { useEffect, useState } from 'react';
import type { Conversation, Message, User } from '../types';
import { api } from '../api';
import { useMessages } from '../store/messages';
import { MessageItem } from './MessageItem';

export function PinsTab({ conversation, currentUser, workspaceId }: { conversation: Conversation; currentUser: User; workspaceId: string }) {
  const [ids, setIds] = useState<string[] | null>(null);
  const byId = useMessages((s) => s.byId);
  useEffect(() => {
    api.get<{ messages: Message[] }>(`/api/conversations/${conversation.id}/pins`).then((r) => {
      for (const m of r.messages) useMessages.getState().upsert(m);
      setIds(r.messages.map((m) => m.id));
    }).catch(() => setIds([]));
  }, [conversation.id]);
  if (!ids) return <div className="loading-block"><span className="spinner" /></div>;
  const pinned = ids.map((id) => byId[id]).filter((m) => m && m.pinned && !m.deletedAt);
  if (!pinned.length) return <div className="empty">Nothing pinned yet. Pin important messages from the message menu.</div>;
  return (
    <div className="card-list">
      {pinned.map((m) => (
        <div className="card" key={m.id}>
          <MessageItem message={m} conversation={conversation} currentUser={currentUser} workspaceId={workspaceId} showHeader />
        </div>
      ))}
    </div>
  );
}
