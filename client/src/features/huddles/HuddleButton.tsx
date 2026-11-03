import type { Conversation, User } from '../../types';
import { Icon } from '../../components/Icon';

export interface HuddleButtonProps {
  workspaceId: string;
  conversation: Conversation;
  currentUser: User;
}

/** Conversation-header huddle button. Core stub — owned by `huddles`. */
export default function HuddleButton(_props: HuddleButtonProps) {
  return (
    <button className="btn btn-ghost btn-sm" disabled title="Huddles are coming soon">
      <Icon name="headphones" size={16} /> Huddle
    </button>
  );
}
