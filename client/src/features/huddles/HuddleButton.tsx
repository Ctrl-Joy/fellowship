import type { Conversation, User } from '../../types';
import { useHuddles, useConversationHuddle } from './store';
import { joinHuddle } from './call';
import { HIcon } from './icons';
import './huddles.css';

export interface HuddleButtonProps {
  workspaceId: string;
  conversation: Conversation;
  currentUser: User;
}

/** Conversation-header huddle button: start/join, with a live participant count when active. */
export default function HuddleButton({ conversation, currentUser }: HuddleButtonProps) {
  const huddle = useConversationHuddle(conversation.id);
  const inThis = useHuddles((s) => s.call?.conversationId === conversation.id);
  const joining = useHuddles((s) => s.joining === conversation.id);
  const setMode = useHuddles((s) => s.setMode);
  const count = huddle?.participants.length ?? 0;
  const canJoin = conversation.isMember && !conversation.isArchived;

  if (inThis) {
    return (
      <button className="btn btn-sm huddle-btn huddle-btn-in" onClick={() => setMode('floating')} title="You're in this huddle — show the huddle window">
        <span className="huddle-live-dot" aria-hidden="true" /> In huddle <span className="huddle-count">{count}</span>
      </button>
    );
  }

  const title = !canJoin
    ? (conversation.isArchived ? 'This conversation is archived' : 'Join the channel to start a huddle')
    : huddle ? `Join the huddle (${count} ${count === 1 ? 'person' : 'people'})` : 'Start a huddle';

  return (
    <button
      className={`btn btn-sm ${huddle ? 'huddle-btn huddle-btn-live' : 'btn-ghost huddle-btn'}`}
      disabled={!canJoin || joining}
      title={title}
      aria-label={title}
      onClick={() => joinHuddle(conversation.id, currentUser.id)}
    >
      {joining ? <span className="spinner spinner-sm" /> : <HIcon name="headphones" size={16} />}
      {huddle ? <>Join <span className="huddle-count">{count}</span></> : 'Huddle'}
    </button>
  );
}
