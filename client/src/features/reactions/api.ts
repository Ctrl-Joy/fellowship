import type { Message } from '../../types';

/**
 * Toggle `emoji` on a message for the current user. Core stub — the reactions feature
 * implements the API call (and optimistic update). Called by the message hover toolbar.
 */
export async function toggleReaction(_message: Message, _emoji: string, _userId: string): Promise<void> {
  console.info('[reactions] not implemented yet');
}
