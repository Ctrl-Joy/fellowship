/** Per-conversation (and per-thread) composer drafts, persisted in localStorage. */
const key = (conversationId: string, threadRootId?: string | null) =>
  `fs:draft:${conversationId}${threadRootId ? `:${threadRootId}` : ''}`;

export function loadDraft(conversationId: string, threadRootId?: string | null): string {
  try { return localStorage.getItem(key(conversationId, threadRootId)) ?? ''; } catch { return ''; }
}

export function saveDraft(conversationId: string, threadRootId: string | null | undefined, text: string) {
  try {
    if (text.trim()) localStorage.setItem(key(conversationId, threadRootId), text);
    else localStorage.removeItem(key(conversationId, threadRootId));
  } catch { /* ignore */ }
}

export function hasDraft(conversationId: string): boolean {
  return !!loadDraft(conversationId).trim();
}
