import type { Conversation, Message, User } from '../../types';
import { toggleReaction } from './api';

export interface ReactionBarProps {
  message: Message;
  conversation: Conversation;
  currentUser: User;
}

/** Reaction chips under a message. Core stub — owned by `reactions`. */
export default function ReactionBar({ message, currentUser }: ReactionBarProps) {
  if (!message.reactions.length) return null;
  return (
    <div className="reactions">
      {message.reactions.map((r) => (
        <button key={r.emoji} type="button"
          className={`reaction${r.userIds.includes(currentUser.id) ? ' reaction-mine' : ''}`}
          onClick={() => toggleReaction(message, r.emoji, currentUser.id)}>
          <span>{r.emoji}</span> <span className="reaction-count">{r.userIds.length}</span>
        </button>
      ))}
    </div>
  );
}
