import { api } from '../../api';
import { useSession } from '../../store/session';
import { useThreads, type ThreadListItem, type ThreadStatus } from './store';

interface StateResponse {
  rootId: string;
  following: boolean;
  unreadCount: number;
  replyCount: number;
  lastReplyAt: number | null;
}

function statusFrom(r: StateResponse, conversationId: string): ThreadStatus {
  return {
    conversationId,
    following: r.following,
    unreadCount: r.following ? r.unreadCount : 0,
    replyCount: r.replyCount,
    lastReplyAt: r.lastReplyAt,
  };
}

/** Load the followed-threads list for a workspace into the store (ignored if the workspace changed). */
export async function refreshThreadList(workspaceId: string): Promise<ThreadListItem[]> {
  const r = await api.get<{ threads: ThreadListItem[]; unreadThreadCount: number }>(`/api/w/${workspaceId}/threads`);
  if (useSession.getState().workspaceId === workspaceId) useThreads.getState().setList(r.threads);
  return r.threads;
}

/** The viewer's follow/unread state for one thread. */
export async function fetchThreadState(rootId: string, conversationId: string) {
  const r = await api.get<StateResponse & { root: { conversationId: string } }>(`/api/threads/${rootId}`);
  useThreads.getState().setStatus(rootId, statusFrom(r, r.root?.conversationId ?? conversationId));
  return r;
}

export async function setThreadFollowing(rootId: string, conversationId: string, following: boolean) {
  const r = following
    ? await api.post<StateResponse>(`/api/threads/${rootId}/follow`)
    : await api.del<StateResponse>(`/api/threads/${rootId}/follow`);
  useThreads.getState().setStatus(rootId, statusFrom(r, conversationId));
  return r;
}

/** Move the viewer's read cursor for a thread they follow. Cheap no-op for other threads. */
export async function markThreadRead(rootId: string, conversationId: string) {
  const r = await api.post<StateResponse>(`/api/threads/${rootId}/read`);
  useThreads.getState().setStatus(rootId, statusFrom(r, conversationId));
  return r;
}
