import { api } from '../../api';
import type { Message, Reaction } from '../../types';
import { useMessages } from '../../store/messages';

function withToggle(reactions: Reaction[], emoji: string, userId: string): Reaction[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (!existing) return [...reactions, { emoji, userIds: [userId] }];
  if (existing.userIds.includes(userId)) {
    return reactions
      .map((r) => (r.emoji === emoji ? { ...r, userIds: r.userIds.filter((u) => u !== userId) } : r))
      .filter((r) => r.userIds.length > 0);
  }
  return reactions.map((r) => (r.emoji === emoji ? { ...r, userIds: [...r.userIds, userId] } : r));
}

/**
 * Toggle `emoji` on a message for the current user. Optimistic: the local reactions change at once,
 * then the server response replaces them; on failure the previous reactions are restored.
 * Live updates for everyone come from reaction.added / reaction.removed (see setup.ts).
 */
export async function toggleReaction(message: Message, emoji: string, userId: string): Promise<void> {
  if (message.id.startsWith('tmp_')) return;
  const store = useMessages.getState();
  const current = store.byId[message.id]?.reactions ?? message.reactions;
  store.patch(message.id, { reactions: withToggle(current, emoji, userId) });
  try {
    const r = await api.post<{ message: Message }>(`/api/messages/${message.id}/reactions`, { emoji });
    useMessages.getState().patch(message.id, { reactions: r.message.reactions });
  } catch (err) {
    useMessages.getState().patch(message.id, { reactions: current });
    console.warn('[reactions] toggle failed', err);
  }
}
