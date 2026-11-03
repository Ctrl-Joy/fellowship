/**
 * Applies server WebSocket events to the stores. Started once by the workspace shell.
 * Feature modules subscribe to their own event types with `ws.on(type, fn)` in their setup.ts.
 */
import { ws } from '../ws';
import type { Conversation, Frame, Member, Message } from '../types';
import { useSession } from './session';
import { useConversations } from './conversations';
import { isRootLevel, useMessages } from './messages';
import { useTyping } from './typing';
import { fetchConversation, loadConversations, loadLatestMessages, loadMembers, markRead } from './actions';

function inCurrentWorkspace(frame: Frame) {
  const wid = useSession.getState().workspaceId;
  return !frame.workspaceId || frame.workspaceId === wid;
}

export function mentionsUser(text: string, userId: string) {
  return text.includes(`<@${userId}>`) || /<!(channel|here|everyone)>/.test(text);
}

/** True when the user is looking at this conversation right now. */
export function isViewing(conversationId: string) {
  return useConversations.getState().activeId === conversationId && document.visibilityState === 'visible' && document.hasFocus();
}

let started = false;
let sawHello = false;

export function startRealtime() {
  if (started) return;
  started = true;

  ws.on('hello', () => {
    // On reconnect, resync anything we may have missed.
    if (sawHello) {
      const wid = useSession.getState().workspaceId;
      if (wid) {
        loadConversations(wid).catch(() => {});
        loadMembers(wid).catch(() => {});
        const active = useConversations.getState().activeId;
        if (active) loadLatestMessages(active).catch(() => {});
      }
    }
    sawHello = true;
  });

  ws.on('message.created', (p: { message: Message }, frame) => {
    if (!inCurrentWorkspace(frame)) return;
    const m = p.message;
    useMessages.getState().upsert(m, { keepPersonal: true });
    const me = useSession.getState().me;
    if (!me) return;
    useTyping.getState().clear(m.conversationId, m.threadRootId && m.subtype !== 'thread_broadcast' ? m.threadRootId : null, m.userId);
    if (!isRootLevel(m)) return;
    const conv = useConversations.getState().byId[m.conversationId];
    if (!conv) {
      // A conversation we have not seen yet (e.g. a new DM) — fetch it.
      fetchConversation(m.conversationId).catch(() => {});
      return;
    }
    const patch: Partial<Conversation> = { lastMessageAt: m.createdAt };
    if (m.userId === me.id) {
      patch.lastReadTs = Math.max(conv.lastReadTs, m.createdAt);
    } else if (isViewing(conv.id)) {
      markRead(conv.id, m.createdAt);
    } else if (conv.isMember) {
      patch.unreadCount = conv.unreadCount + 1;
      if (conv.kind !== 'channel' || mentionsUser(m.text, me.id)) patch.mentionCount = conv.mentionCount + 1;
    }
    useConversations.getState().patch(conv.id, patch);
  });

  ws.on('message.updated', (p: { message: Message; personal?: boolean }, frame) => {
    if (!inCurrentWorkspace(frame)) return;
    useMessages.getState().upsert(p.message, { keepPersonal: !p.personal });
  });

  ws.on('message.deleted', (p: { message: Message }, frame) => {
    if (!inCurrentWorkspace(frame)) return;
    useMessages.getState().upsert(p.message, { keepPersonal: true });
    if (useMessages.getState().editingId === p.message.id) useMessages.getState().setEditing(null);
  });

  const onConversation = (p: { conversation: Conversation }, frame: Frame) => {
    if (!inCurrentWorkspace(frame) || !p.conversation) return;
    const existing = useConversations.getState().byId[p.conversation.id];
    if (existing) useConversations.getState().upsert(p.conversation, { fromBroadcast: true });
    else fetchConversation(p.conversation.id).catch(() => {});
  };
  ws.on('conversation.created', onConversation);
  ws.on('conversation.updated', onConversation);
  ws.on('conversation.archived', onConversation);

  ws.on('conversation.read', (p: { conversationId: string; lastReadTs: number; unreadCount: number; mentionCount: number }) => {
    useConversations.getState().patch(p.conversationId, { lastReadTs: p.lastReadTs, unreadCount: p.unreadCount, mentionCount: p.mentionCount });
  });

  ws.on('member.joined', (p: { conversationId: string; userId: string }, frame) => {
    if (!inCurrentWorkspace(frame)) return;
    const me = useSession.getState().me;
    if (p.userId === me?.id) {
      fetchConversation(p.conversationId).catch(() => {});
      return;
    }
    const c = useConversations.getState().byId[p.conversationId];
    if (c && !(c.memberIds ?? []).includes(p.userId)) {
      useConversations.getState().patch(c.id, {
        memberCount: c.memberCount + 1,
        memberIds: c.memberIds ? [...c.memberIds, p.userId] : c.memberIds,
      });
    }
  });

  ws.on('member.left', (p: { conversationId: string; userId: string }, frame) => {
    if (!inCurrentWorkspace(frame)) return;
    const me = useSession.getState().me;
    if (p.userId === me?.id) {
      useConversations.getState().remove(p.conversationId);
      return;
    }
    const c = useConversations.getState().byId[p.conversationId];
    if (c) {
      useConversations.getState().patch(c.id, {
        memberCount: Math.max(0, c.memberCount - 1),
        memberIds: c.memberIds ? c.memberIds.filter((id) => id !== p.userId) : c.memberIds,
      });
    }
  });

  ws.on('workspace.member_joined', (p: { member: Member }, frame) => {
    if (!inCurrentWorkspace(frame)) return;
    useSession.getState().upsertMember(p.member);
  });

  ws.on('workspace.updated', (p: { workspace: any }) => {
    useSession.getState().upsertWorkspace({ ...p.workspace, role: null });
  });

  ws.on('user.updated', (p: { user: Member }, frame) => {
    const s = useSession.getState();
    if (s.me?.id === p.user.id) s.setMe({ ...s.me, ...p.user });
    if (inCurrentWorkspace(frame)) s.upsertMember(p.user);
  });

  ws.on('typing', (p: { conversationId: string; userId: string; threadRootId: string | null }) => {
    if (p.userId === useSession.getState().me?.id) return;
    useTyping.getState().add(p.conversationId, p.threadRootId ?? null, p.userId);
  });
}
