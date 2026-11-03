import { useHuddles, useConversationHuddle } from './store';
import { HIcon } from './icons';
import './huddles.css';

/** Small "huddle in progress" marker for sidebar rows. Renders nothing when no huddle is live. */
export default function HuddleIndicator({ conversationId }: { conversationId: string }) {
  const huddle = useConversationHuddle(conversationId);
  const mine = useHuddles((s) => s.call?.conversationId === conversationId);
  if (!huddle || huddle.participants.length === 0) return null;
  const n = huddle.participants.length;
  return (
    <span className={`huddle-ind${mine ? ' huddle-ind-mine' : ''}`} title={`Huddle in progress · ${n} ${n === 1 ? 'person' : 'people'}`}
      aria-label={`Huddle in progress with ${n} ${n === 1 ? 'person' : 'people'}`}>
      <HIcon name="headphones" size={12} />{n}
    </span>
  );
}
