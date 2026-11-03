import { useSession, displayName } from '../store/session';
import { useTypingUsers } from '../store/typing';

export function TypingIndicator({ conversationId, threadRootId = null }: { conversationId: string; threadRootId?: string | null }) {
  const ids = useTypingUsers(conversationId, threadRootId);
  const members = useSession((s) => s.members);
  const names = ids.map((id) => displayName(members[id]));
  let label = '';
  if (names.length === 1) label = `${names[0]} is typing…`;
  else if (names.length === 2) label = `${names[0]} and ${names[1]} are typing…`;
  else if (names.length > 2) label = 'Several people are typing…';
  return <div className="typing" aria-live="polite">{label && <><span className="typing-dots"><i /><i /><i /></span>{label}</>}</div>;
}
