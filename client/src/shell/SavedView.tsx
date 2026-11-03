import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Message, User } from '../types';
import { api } from '../api';
import { useMessages } from '../store/messages';
import { useConversations, conversationTitle } from '../store/conversations';
import { useSession } from '../store/session';
import { MessageItem } from './MessageItem';
import { timeAgo } from '../lib/time';

export function SavedView({ workspaceId, currentUser }: { workspaceId: string; currentUser: User }) {
  const [items, setItems] = useState<{ savedAt: number; id: string }[] | null>(null);
  const byId = useMessages((s) => s.byId);
  const conversations = useConversations((s) => s.byId);
  const members = useSession((s) => s.members);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<{ items: { savedAt: number; message: Message }[] }>(`/api/w/${workspaceId}/saved`).then((r) => {
      for (const it of r.items) useMessages.getState().upsert(it.message);
      setItems(r.items.map((it) => ({ savedAt: it.savedAt, id: it.message.id })));
    }).catch(() => setItems([]));
  }, [workspaceId]);

  const visible = (items ?? []).filter((it) => byId[it.id]?.saved);
  return (
    <div className="view">
      <header className="view-head"><h2>Saved</h2><span className="muted">{visible.length} item{visible.length === 1 ? '' : 's'}</span></header>
      <div className="view-scroll">
        {!items && <div className="loading-block"><span className="spinner" /></div>}
        {items && !visible.length && <div className="empty">Save messages to come back to them later. They’ll show up here.</div>}
        <div className="card-list">
          {visible.map((it) => {
            const m = byId[it.id];
            const conv = conversations[m.conversationId];
            return (
              <div className="card" key={it.id}>
                <div className="card-meta">
                  <button className="link" onClick={() => navigate(`/w/${workspaceId}/c/${m.conversationId}`)}>
                    {conv ? (conv.kind === 'channel' ? '#' : '') + conversationTitle(conv, members, currentUser) : 'Conversation'}
                  </button>
                  <span className="muted small">Saved {timeAgo(it.savedAt)}</span>
                </div>
                {conv
                  ? <MessageItem message={m} conversation={conv} currentUser={currentUser} workspaceId={workspaceId} showHeader />
                  : <div className="muted">{m.text}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
