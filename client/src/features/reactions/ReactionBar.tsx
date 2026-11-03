import { useRef, useState } from 'react';
import type { Conversation, Message, User } from '../../types';
import { useSession, displayName } from '../../store/session';
import EmojiPicker from './EmojiPicker';
import { toggleReaction } from './api';

export interface ReactionBarProps {
  message: Message;
  conversation: Conversation;
  currentUser: User;
}

const PICKER_WIDTH = 300;
const PICKER_HEIGHT = 380;

/** Reaction pills under a message. Click toggles your reaction; "+" opens the picker. */
export default function ReactionBar({ message, currentUser }: ReactionBarProps) {
  const members = useSession((s) => s.members);
  const [anchor, setAnchor] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const picker = anchor !== null;

  // The picker is position:fixed so scroll containers (thread panel, channel list) cannot clip it.
  function togglePicker() {
    if (picker) { setAnchor(null); return; }
    const r = addRef.current?.getBoundingClientRect();
    if (!r) return;
    // Open upwards unless there is no room above; then open downwards.
    const below = r.top < PICKER_HEIGHT + 16;
    setAnchor({
      x: Math.max(8, Math.min(r.left, window.innerWidth - PICKER_WIDTH - 8)),
      y: below ? r.bottom + 6 : r.top - 6,
      below,
    });
  }

  if (!message.reactions.length) return null;

  return (
    <div className="reactions">
      {message.reactions.map((r) => {
        const mine = r.userIds.includes(currentUser.id);
        const names = r.userIds.map((id) => displayName(members[id]) || 'someone').join(', ');
        const label = `Reacted by ${names}`;
        return (
          <button
            key={r.emoji}
            type="button"
            className={`reaction${mine ? ' reaction-mine' : ''}`}
            aria-pressed={mine}
            aria-label={`${r.emoji} ${r.userIds.length}. ${label}`}
            title={label}
            onClick={() => toggleReaction(message, r.emoji, currentUser.id)}
          >
            <span className="reaction-emoji">{r.emoji}</span>
            <span className="reaction-count">{r.userIds.length}</span>
          </button>
        );
      })}
      <button ref={addRef} type="button" className="reaction reaction-add" data-emoji-trigger title="Add reaction"
        aria-label="Add reaction" aria-expanded={picker} onClick={togglePicker}>+</button>
      {anchor && (
        <div className="reaction-pop" style={{ left: anchor.x, top: anchor.y, transform: anchor.below ? 'none' : undefined }}>
          <EmojiPicker
            onPick={(e) => toggleReaction(message, e, currentUser.id)}
            onClose={() => setAnchor(null)}
          />
        </div>
      )}
    </div>
  );
}
