import { create } from 'zustand';

const TTL = 5000;

interface TypingState {
  /** key `${conversationId}|${threadRootId ?? ''}` → userId → expiresAt */
  byKey: Record<string, Record<string, number>>;
  add(conversationId: string, threadRootId: string | null, userId: string): void;
  clear(conversationId: string, threadRootId: string | null, userId: string): void;
}

export const typingKey = (cid: string, root: string | null) => `${cid}|${root ?? ''}`;

export const useTyping = create<TypingState>()((set, get) => ({
  byKey: {},
  add: (cid, root, userId) => {
    const key = typingKey(cid, root);
    set((s) => ({ byKey: { ...s.byKey, [key]: { ...s.byKey[key], [userId]: Date.now() + TTL } } }));
    setTimeout(() => {
      const exp = get().byKey[key]?.[userId];
      if (exp && exp <= Date.now()) get().clear(cid, root, userId);
    }, TTL + 50);
  },
  clear: (cid, root, userId) => set((s) => {
    const key = typingKey(cid, root);
    if (!s.byKey[key]?.[userId]) return s;
    const next = { ...s.byKey[key] };
    delete next[userId];
    return { byKey: { ...s.byKey, [key]: next } };
  }),
}));

/** User ids currently typing in a conversation (or thread). */
export function useTypingUsers(cid: string, root: string | null = null): string[] {
  const entry = useTyping((s) => s.byKey[typingKey(cid, root)]);
  return entry ? Object.keys(entry) : [];
}
