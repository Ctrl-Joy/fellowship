import { create } from 'zustand';
import type { Message } from '../types';

export interface ChannelPage {
  /** Root-level message ids, ascending by createdAt. */
  ids: string[];
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
}

export interface ThreadState {
  /** Reply ids, ascending. */
  ids: string[];
  loaded: boolean;
}

interface MessagesState {
  byId: Record<string, Message>;
  channels: Record<string, ChannelPage>;
  threads: Record<string, ThreadState>;
  /** Message currently being edited inline (↑ to edit last). */
  editingId: string | null;
  setPage(conversationId: string, messages: Message[], hasMore: boolean, mode: 'replace' | 'prepend'): void;
  setLoading(conversationId: string, loading: boolean): void;
  setThread(rootId: string, root: Message, replies: Message[]): void;
  /**
   * Insert or update a message wherever it belongs (channel list and/or thread).
   * Reconciles optimistic temp messages by clientMsgId. With `keepPersonal`, keeps the
   * local `saved` flag (broadcast payloads are serialized without a viewer).
   */
  upsert(m: Message, opts?: { keepPersonal?: boolean }): void;
  patch(id: string, partial: Partial<Message>): void;
  removeLocal(id: string): void;
  setEditing(id: string | null): void;
}

export const tempIdFor = (clientMsgId: string) => `tmp_${clientMsgId}`;

export const isRootLevel = (m: Message) => !m.threadRootId || m.subtype === 'thread_broadcast';

function insertSorted(ids: string[], id: string, byId: Record<string, Message>): string[] {
  if (ids.includes(id)) return ids;
  const m = byId[id];
  const out = ids.slice();
  let i = out.length;
  while (i > 0) {
    const prev = byId[out[i - 1]];
    if (!prev || prev.createdAt <= m.createdAt) break;
    i--;
  }
  out.splice(i, 0, id);
  return out;
}

export const useMessages = create<MessagesState>()((set) => ({
  byId: {},
  channels: {},
  threads: {},
  editingId: null,

  setPage: (cid, messages, hasMore, mode) => set((s) => {
    const byId = { ...s.byId };
    for (const m of messages) byId[m.id] = { ...byId[m.id], ...m };
    const prev = s.channels[cid];
    const pageIds = messages.map((m) => m.id);
    let ids: string[];
    if (mode === 'prepend' && prev) {
      ids = [...pageIds.filter((id) => !prev.ids.includes(id)), ...prev.ids];
    } else {
      // Keep any newer messages we already had (e.g. arrived over WS / still pending).
      const last = messages[messages.length - 1];
      const extra = prev ? prev.ids.filter((id) => !pageIds.includes(id) && (!last || (byId[id] && byId[id].createdAt >= last.createdAt))) : [];
      ids = pageIds;
      for (const id of extra) ids = insertSorted(ids, id, byId);
    }
    return {
      byId,
      channels: { ...s.channels, [cid]: { ids, hasMore: mode === 'prepend' || !prev?.loaded ? hasMore : hasMore, loaded: true, loading: false } },
    };
  }),

  setLoading: (cid, loading) => set((s) => ({
    channels: { ...s.channels, [cid]: { ...(s.channels[cid] ?? { ids: [], hasMore: true, loaded: false }), loading } },
  })),

  setThread: (rootId, root, replies) => set((s) => {
    const byId = { ...s.byId, [root.id]: { ...s.byId[root.id], ...root } };
    for (const m of replies) byId[m.id] = { ...byId[m.id], ...m };
    const prev = s.threads[rootId];
    let ids = replies.map((m) => m.id);
    for (const id of prev?.ids ?? []) if (byId[id]?.pending) ids = insertSorted(ids, id, byId);
    return { byId, threads: { ...s.threads, [rootId]: { ids, loaded: true } } };
  }),

  upsert: (incoming, opts) => set((s) => {
    const byId = { ...s.byId };
    const channels = { ...s.channels };
    const threads = { ...s.threads };
    let m = incoming;

    // Reconcile an optimistic temp message.
    if (m.clientMsgId && !m.pending && !m.id.startsWith('tmp_')) {
      const tempId = tempIdFor(m.clientMsgId);
      if (byId[tempId]) {
        delete byId[tempId];
        for (const [k, c] of Object.entries(channels)) if (c.ids.includes(tempId)) channels[k] = { ...c, ids: c.ids.filter((x) => x !== tempId) };
        for (const [k, t] of Object.entries(threads)) if (t.ids.includes(tempId)) threads[k] = { ...t, ids: t.ids.filter((x) => x !== tempId) };
      }
    }

    const prev = byId[m.id];
    if (prev && opts?.keepPersonal) m = { ...m, saved: prev.saved };
    byId[m.id] = { ...prev, ...m };

    const goneFromList = m.deletedAt != null && m.replyCount === 0;
    if (isRootLevel(m)) {
      const c = channels[m.conversationId];
      if (c?.loaded) {
        channels[m.conversationId] = goneFromList
          ? { ...c, ids: c.ids.filter((x) => x !== m.id) }
          : { ...c, ids: insertSorted(c.ids, m.id, byId) };
      }
    }
    if (m.threadRootId) {
      const t = threads[m.threadRootId];
      if (t?.loaded) {
        threads[m.threadRootId] = m.deletedAt != null
          ? { ...t, ids: t.ids.filter((x) => x !== m.id) }
          : { ...t, ids: insertSorted(t.ids, m.id, byId) };
      }
    }
    return { byId, channels, threads };
  }),

  patch: (id, partial) => set((s) => (s.byId[id] ? { byId: { ...s.byId, [id]: { ...s.byId[id], ...partial } } } : s)),

  removeLocal: (id) => set((s) => {
    const byId = { ...s.byId };
    delete byId[id];
    const channels = Object.fromEntries(Object.entries(s.channels).map(([k, c]) => [k, { ...c, ids: c.ids.filter((x) => x !== id) }]));
    const threads = Object.fromEntries(Object.entries(s.threads).map(([k, t]) => [k, { ...t, ids: t.ids.filter((x) => x !== id) }]));
    return { byId, channels, threads };
  }),

  setEditing: (editingId) => set({ editingId }),
}));

export function useMessage(id: string | null | undefined): Message | undefined {
  return useMessages((s) => (id ? s.byId[id] : undefined));
}
