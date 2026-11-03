import { create } from 'zustand';
import type { Message } from '../../types';

/** Per-thread state for the viewer (only for threads they follow, plus any they opened). */
export interface ThreadStatus {
  conversationId: string;
  following: boolean;
  unreadCount: number;
  replyCount: number;
  lastReplyAt: number | null;
}

export interface ThreadListItem {
  root: Message;
  replies: Message[];
  following: boolean;
  unreadCount: number;
  lastActivityAt: number;
  conversation: { id: string; name: string | null; kind: string; isPrivate: boolean };
}

interface ThreadsState {
  /** Threads list for the current workspace, newest activity first; null until loaded. */
  list: ThreadListItem[] | null;
  byRoot: Record<string, ThreadStatus>;
  setList(items: ThreadListItem[]): void;
  /** Apply a `thread.updated` payload (for the viewer only). */
  applyUpdate(p: { rootId: string; conversationId: string; following: boolean; unreadCount: number; replyCount: number; lastReplyAt: number | null }): void;
  setStatus(rootId: string, status: ThreadStatus): void;
  reset(): void;
}

export const useThreads = create<ThreadsState>()((set) => ({
  list: null,
  byRoot: {},
  setList: (items) => set((s) => {
    const byRoot = { ...s.byRoot };
    for (const it of items) {
      byRoot[it.root.id] = {
        conversationId: it.conversation.id,
        following: it.following,
        unreadCount: it.unreadCount,
        replyCount: it.root.replyCount,
        lastReplyAt: it.root.lastReplyAt,
      };
    }
    return { list: items, byRoot };
  }),
  applyUpdate: (p) => set((s) => ({
    byRoot: {
      ...s.byRoot,
      [p.rootId]: {
        conversationId: p.conversationId,
        following: p.following,
        unreadCount: p.following ? p.unreadCount : 0,
        replyCount: p.replyCount,
        lastReplyAt: p.lastReplyAt,
      },
    },
  })),
  setStatus: (rootId, status) => set((s) => ({ byRoot: { ...s.byRoot, [rootId]: status } })),
  reset: () => set({ list: null, byRoot: {} }),
}));

/** Number of followed threads with unread replies (drives the sidebar badge). */
export function countUnreadThreads(byRoot: Record<string, ThreadStatus>): number {
  let n = 0;
  for (const t of Object.values(byRoot)) if (t.following && t.unreadCount > 0) n++;
  return n;
}
