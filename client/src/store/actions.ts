/**
 * Data actions shared by the shell and features. They call the API and update the stores.
 */
import { api } from '../api';
import { ws } from '../ws';
import type { Conversation, Member, Message, Workspace } from '../types';
import { useSession } from './session';
import { useConversations } from './conversations';
import { tempIdFor, useMessages } from './messages';
import { useUi } from './ui';

export async function loadWorkspaces() {
  const r = await api.get<{ workspaces: Workspace[] }>('/api/workspaces');
  useSession.getState().setWorkspaces(r.workspaces);
  return r.workspaces;
}

export async function loadMembers(workspaceId: string) {
  const r = await api.get<{ members: Member[] }>(`/api/w/${workspaceId}/members`);
  if (useSession.getState().workspaceId === workspaceId) useSession.getState().setMembers(r.members);
}

export async function loadConversations(workspaceId: string) {
  const r = await api.get<{ conversations: Conversation[] }>(`/api/w/${workspaceId}/conversations`);
  if (useSession.getState().workspaceId === workspaceId) useConversations.getState().setAll(r.conversations);
}

/** Fetch one conversation (with your read state) and put it in the store. */
export async function fetchConversation(conversationId: string) {
  const r = await api.get<{ conversation: Conversation }>(`/api/conversations/${conversationId}`);
  if (r.conversation.workspaceId === useSession.getState().workspaceId) {
    useConversations.getState().upsert(r.conversation);
  }
  return r.conversation;
}

const PAGE = 50;

export async function loadLatestMessages(conversationId: string) {
  const store = useMessages.getState();
  store.setLoading(conversationId, true);
  try {
    const r = await api.get<{ messages: Message[]; hasMore: boolean }>(`/api/conversations/${conversationId}/messages?limit=${PAGE}`);
    useMessages.getState().setPage(conversationId, r.messages, r.hasMore, 'replace');
  } catch (err) {
    useMessages.getState().setLoading(conversationId, false);
    throw err;
  }
}

export async function loadOlderMessages(conversationId: string) {
  const page = useMessages.getState().channels[conversationId];
  if (!page || page.loading || !page.hasMore) return;
  const firstId = page.ids.find((id) => !id.startsWith('tmp_'));
  if (!firstId) return;
  useMessages.getState().setLoading(conversationId, true);
  try {
    const r = await api.get<{ messages: Message[]; hasMore: boolean }>(
      `/api/conversations/${conversationId}/messages?limit=${PAGE}&before=${encodeURIComponent(firstId)}`,
    );
    useMessages.getState().setPage(conversationId, r.messages, r.hasMore, 'prepend');
  } catch {
    useMessages.getState().setLoading(conversationId, false);
  }
}

export async function loadThread(rootId: string) {
  const r = await api.get<{ root: Message; replies: Message[] }>(`/api/messages/${rootId}/replies`);
  useMessages.getState().setThread(r.root.id, r.root, r.replies);
  return r;
}

function newClientMsgId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface SendInput {
  conversationId: string;
  text: string;
  threadRootId?: string | null;
  alsoSendToChannel?: boolean;
  fileIds?: string[];
  /** Pass to retry a failed send. */
  clientMsgId?: string;
}

/** Optimistic send: shows a pending message immediately, reconciled by clientMsgId. */
export async function sendMessage(input: SendInput): Promise<Message | null> {
  const me = useSession.getState().me;
  if (!me) return null;
  const clientMsgId = input.clientMsgId ?? newClientMsgId();
  const temp: Message = {
    id: tempIdFor(clientMsgId), conversationId: input.conversationId, userId: me.id, text: input.text,
    threadRootId: input.threadRootId ?? null, replyCount: 0, lastReplyAt: null, replyUserIds: [],
    editedAt: null, deletedAt: null, createdAt: Date.now(), clientMsgId,
    subtype: input.threadRootId && input.alsoSendToChannel ? 'thread_broadcast' : null,
    meta: null, reactions: [], files: [], pinned: false, saved: false, pending: true,
  };
  useMessages.getState().upsert(temp);
  try {
    const r = await api.post<{ message: Message }>(`/api/conversations/${input.conversationId}/messages`, {
      text: input.text, clientMsgId, threadRootId: input.threadRootId ?? undefined,
      alsoSendToChannel: input.alsoSendToChannel || undefined, fileIds: input.fileIds?.length ? input.fileIds : undefined,
    });
    useMessages.getState().upsert(r.message);
    return r.message;
  } catch (err) {
    useMessages.getState().patch(temp.id, { pending: false, failed: true });
    throw err;
  }
}

export async function retrySend(tempId: string) {
  const m = useMessages.getState().byId[tempId];
  if (!m || !m.clientMsgId) return;
  useMessages.getState().patch(tempId, { failed: false, pending: true });
  try {
    await sendMessage({
      conversationId: m.conversationId, text: m.text, threadRootId: m.threadRootId,
      alsoSendToChannel: m.subtype === 'thread_broadcast', clientMsgId: m.clientMsgId,
    });
  } catch { /* already marked failed */ }
}

export async function editMessage(id: string, text: string) {
  const r = await api.patch<{ message: Message }>(`/api/messages/${id}`, { text });
  useMessages.getState().upsert(r.message);
}

export async function deleteMessage(id: string) {
  if (id.startsWith('tmp_')) { useMessages.getState().removeLocal(id); return; }
  const r = await api.del<{ message: Message }>(`/api/messages/${id}`);
  useMessages.getState().upsert(r.message);
}

export async function togglePin(m: Message) {
  const r = m.pinned ? await api.del<{ message: Message }>(`/api/messages/${m.id}/pin`) : await api.post<{ message: Message }>(`/api/messages/${m.id}/pin`);
  useMessages.getState().upsert(r.message);
}

export async function toggleSave(m: Message) {
  const r = m.saved ? await api.del<{ message: Message }>(`/api/messages/${m.id}/save`) : await api.post<{ message: Message }>(`/api/messages/${m.id}/save`);
  useMessages.getState().upsert(r.message);
}

const pendingRead = new Map<string, number>();

/** Move your read cursor (debounced per conversation). Updates the sidebar immediately. */
export function markRead(conversationId: string, ts: number) {
  const conv = useConversations.getState().byId[conversationId];
  if (!conv || !conv.isMember) return;
  if (ts <= conv.lastReadTs && conv.unreadCount === 0 && conv.mentionCount === 0) return;
  useConversations.getState().patch(conversationId, { lastReadTs: Math.max(ts, conv.lastReadTs), unreadCount: 0, mentionCount: 0 });
  const prevTimer = pendingRead.get(conversationId);
  if (prevTimer) clearTimeout(prevTimer);
  pendingRead.set(conversationId, window.setTimeout(() => {
    pendingRead.delete(conversationId);
    api.post(`/api/conversations/${conversationId}/read`, { ts }).catch(() => {});
  }, 400));
}

export async function openDm(workspaceId: string, userIds: string[]): Promise<Conversation> {
  const r = await api.post<{ conversation: Conversation }>(`/api/w/${workspaceId}/dms`, { userIds });
  useConversations.getState().upsert(r.conversation);
  return r.conversation;
}

export async function joinConversation(conversationId: string) {
  const r = await api.post<{ conversation: Conversation }>(`/api/conversations/${conversationId}/join`);
  useConversations.getState().upsert(r.conversation);
  return r.conversation;
}

export async function leaveConversation(conversationId: string) {
  await api.post(`/api/conversations/${conversationId}/leave`);
  const c = useConversations.getState().byId[conversationId];
  if (c && c.kind === 'channel' && !c.isPrivate) {
    useConversations.getState().patch(conversationId, { isMember: false, unreadCount: 0, mentionCount: 0 });
    useConversations.getState().remove(conversationId);
  } else {
    useConversations.getState().remove(conversationId);
  }
}

export async function updateConversation(conversationId: string, patch: Partial<Pick<Conversation, 'name' | 'topic' | 'description' | 'isPrivate' | 'muted' | 'notifyPref'>>) {
  const r = await api.patch<{ conversation: Conversation }>(`/api/conversations/${conversationId}`, patch);
  useConversations.getState().upsert(r.conversation);
  return r.conversation;
}

export async function logout() {
  try { await api.post('/api/auth/logout'); } catch { /* ignore */ }
  ws.disconnect();
  useSession.setState({ me: null, workspaces: [], workspaceId: null, members: {}, membersLoaded: false });
  useConversations.getState().reset();
  useMessages.setState({ byId: {}, channels: {}, threads: {}, editingId: null });
  useUi.setState({ rightPanel: null, modal: null });
}
