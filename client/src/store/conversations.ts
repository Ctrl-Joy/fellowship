import { create } from 'zustand';
import type { Conversation, Member, User } from '../types';
import { displayName } from './session';

/** Fields that belong to the viewer and must not be overwritten by broadcast events. */
const PERSONAL_FIELDS = ['isMember', 'lastReadTs', 'unreadCount', 'mentionCount', 'muted', 'notifyPref'] as const;

interface ConversationsState {
  byId: Record<string, Conversation>;
  loaded: boolean;
  /** Conversation currently on screen (null when on another view). */
  activeId: string | null;
  setAll(list: Conversation[]): void;
  /** Insert or replace. With `fromBroadcast`, keeps the viewer's read-state fields. */
  upsert(c: Conversation, opts?: { fromBroadcast?: boolean }): void;
  patch(id: string, partial: Partial<Conversation>): void;
  remove(id: string): void;
  setActive(id: string | null): void;
  reset(): void;
}

export const useConversations = create<ConversationsState>()((set) => ({
  byId: {},
  loaded: false,
  activeId: null,
  setAll: (list) => set({ byId: Object.fromEntries(list.map((c) => [c.id, c])), loaded: true }),
  upsert: (c, opts) => set((s) => {
    const prev = s.byId[c.id];
    let next = c;
    if (prev && opts?.fromBroadcast) {
      next = { ...prev, ...c };
      for (const k of PERSONAL_FIELDS) (next as any)[k] = prev[k];
      if (c.memberIds == null) next.memberIds = prev.memberIds;
    }
    return { byId: { ...s.byId, [c.id]: next } };
  }),
  patch: (id, partial) => set((s) => (s.byId[id] ? { byId: { ...s.byId, [id]: { ...s.byId[id], ...partial } } } : s)),
  remove: (id) => set((s) => {
    const byId = { ...s.byId };
    delete byId[id];
    return { byId };
  }),
  setActive: (activeId) => set({ activeId }),
  reset: () => set({ byId: {}, loaded: false, activeId: null }),
}));

export function useConversation(id: string | null | undefined): Conversation | undefined {
  return useConversations((s) => (id ? s.byId[id] : undefined));
}

/** Human title: "#name" style name for channels, member names for DMs. */
export function conversationTitle(c: Conversation | undefined, members: Record<string, Member>, me: User | null): string {
  if (!c) return '';
  if (c.kind === 'channel') return c.name ?? '';
  if (c.kind === 'self') return `${displayName(me)} (you)`;
  const others = (c.memberIds ?? []).filter((id) => id !== me?.id);
  if (others.length === 0) return displayName(me);
  return others.map((id) => displayName(members[id])).join(', ');
}

/** The other participant of a 1:1 DM (or yourself for a self-DM). */
export function dmPartnerId(c: Conversation, meId: string): string | null {
  if (c.kind === 'self') return meId;
  if (c.kind !== 'dm') return null;
  return (c.memberIds ?? []).find((id) => id !== meId) ?? null;
}
