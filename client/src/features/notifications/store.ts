import { create } from 'zustand';
import { api } from '../../api';

export type ActivityTab = 'all' | 'mentions' | 'threads' | 'reactions';

export interface NotificationItem {
  id: string;
  kind: 'mention' | 'dm' | 'thread_reply' | 'reaction' | 'keyword' | 'channel_broadcast';
  workspaceId: string;
  conversationId: string | null;
  conversationKind: string | null;
  conversationName: string | null;
  messageId: string | null;
  threadRootId: string | null;
  actorId: string | null;
  emoji: string;
  /** Live message text, or null once the message was deleted. */
  text: string | null;
  createdAt: number;
  readAt: number | null;
  silenced: boolean;
}

interface NotificationsState {
  workspaceId: string | null;
  /** Unread notifications in the current workspace (drives the badge and the title). */
  unread: number;
  tab: ActivityTab;
  unreadOnly: boolean;
  items: NotificationItem[];
  hasMore: boolean;
  nextCursor: string | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  reset(workspaceId: string): void;
  setUnread(n: number): void;
  setView(tab: ActivityTab, unreadOnly: boolean): void;
  /** Load the first page for the current tab. */
  load(): Promise<void>;
  loadMore(): Promise<void>;
  /** Prepend a live notification (from WebSocket) if it belongs to this view. */
  receive(n: NotificationItem): void;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
}

export const TAB_LABELS: Record<ActivityTab, string> = {
  all: 'All', mentions: 'Mentions', threads: 'Threads', reactions: 'Reactions',
};

const TAB_KINDS: Record<ActivityTab, NotificationItem['kind'][] | null> = {
  all: null,
  mentions: ['mention', 'dm', 'channel_broadcast', 'keyword'],
  threads: ['thread_reply'],
  reactions: ['reaction'],
};

function matchesView(n: NotificationItem, tab: ActivityTab, unreadOnly: boolean) {
  const kinds = TAB_KINDS[tab];
  if (kinds && !kinds.includes(n.kind)) return false;
  if (unreadOnly && n.readAt != null) return false;
  return true;
}

let loadSeq = 0;

export const useNotifications = create<NotificationsState>()((set, get) => ({
  workspaceId: null,
  unread: 0,
  tab: 'all',
  unreadOnly: false,
  items: [],
  hasMore: false,
  nextCursor: null,
  loading: false,
  loaded: false,
  error: null,

  reset: (workspaceId) => set({
    workspaceId, unread: 0, items: [], hasMore: false, nextCursor: null, loaded: false, error: null,
  }),

  setUnread: (unread) => set({ unread: Math.max(0, unread) }),

  setView: (tab, unreadOnly) => {
    set({ tab, unreadOnly, items: [], hasMore: false, nextCursor: null, loaded: false });
    void get().load();
  },

  load: async () => {
    const { workspaceId, tab, unreadOnly } = get();
    if (!workspaceId) return;
    const seq = ++loadSeq;
    set({ loading: true, error: null });
    try {
      const qs = new URLSearchParams({ filter: tab, limit: '30' });
      if (unreadOnly) qs.set('unread', '1');
      const r = await api.get<{ notifications: NotificationItem[]; hasMore: boolean; nextCursor: string | null; unreadCount: number }>(
        `/api/w/${workspaceId}/notifications?${qs}`,
      );
      if (seq !== loadSeq || get().workspaceId !== workspaceId) return;
      set({
        items: r.notifications, hasMore: r.hasMore, nextCursor: r.nextCursor,
        unread: r.unreadCount, loaded: true, loading: false,
      });
    } catch (err: any) {
      if (seq === loadSeq) set({ loading: false, loaded: true, error: err?.message ?? 'Could not load activity' });
    }
  },

  loadMore: async () => {
    const { workspaceId, tab, unreadOnly, nextCursor, loading } = get();
    if (!workspaceId || !nextCursor || loading) return;
    set({ loading: true });
    try {
      const qs = new URLSearchParams({ filter: tab, limit: '30', before: nextCursor });
      if (unreadOnly) qs.set('unread', '1');
      const r = await api.get<{ notifications: NotificationItem[]; hasMore: boolean; nextCursor: string | null }>(
        `/api/w/${workspaceId}/notifications?${qs}`,
      );
      if (get().workspaceId !== workspaceId) return;
      set((s) => ({
        items: [...s.items, ...r.notifications.filter((n) => !s.items.some((x) => x.id === n.id))],
        hasMore: r.hasMore, nextCursor: r.nextCursor, loading: false,
      }));
    } catch (err: any) {
      set({ loading: false, error: err?.message ?? 'Could not load more' });
    }
  },

  receive: (n) => {
    const s = get();
    if (n.workspaceId !== s.workspaceId) return;
    if (s.items.some((x) => x.id === n.id)) return;
    set({
      unread: n.readAt == null ? s.unread + 1 : s.unread,
      items: matchesView(n, s.tab, s.unreadOnly) ? [n, ...s.items] : s.items,
    });
  },

  markRead: async (id) => {
    const { workspaceId, items } = get();
    const target = items.find((n) => n.id === id);
    if (!workspaceId || !target || target.readAt != null) return;
    const readAt = Date.now();
    set((s) => ({
      unread: Math.max(0, s.unread - 1),
      items: s.unreadOnly ? s.items.filter((n) => n.id !== id) : s.items.map((n) => (n.id === id ? { ...n, readAt } : n)),
    }));
    try {
      await api.post(`/api/w/${workspaceId}/notifications/${id}/read`);
    } catch { /* the next load corrects the count */ }
  },

  markAllRead: async () => {
    const { workspaceId } = get();
    if (!workspaceId) return;
    const readAt = Date.now();
    set((s) => ({
      unread: 0,
      items: s.unreadOnly ? [] : s.items.map((n) => (n.readAt == null ? { ...n, readAt } : n)),
    }));
    try {
      await api.post(`/api/w/${workspaceId}/notifications/read-all`);
    } catch { /* the next load corrects the count */ }
  },
}));

/** Refresh only the unread count (cheap; used on reconnect and read events). */
export async function refreshUnread(workspaceId: string) {
  try {
    const r = await api.get<{ unreadCount: number }>(`/api/w/${workspaceId}/notifications/unread-count`);
    if (useNotifications.getState().workspaceId === workspaceId) useNotifications.getState().setUnread(r.unreadCount);
  } catch { /* ignore */ }
}
