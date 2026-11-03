import type { Conversation, User } from '../../types';
import { Modal } from '../../components/Modal';

export interface NotificationPrefsProps {
  workspaceId: string;
  currentUser: User;
  /** When set, edit this conversation's override; otherwise global preferences. */
  conversation?: Conversation;
  onClose(): void;
}

/** Notification preferences modal. Core stub — owned by `notifications`. */
export default function NotificationPrefs({ conversation, onClose }: NotificationPrefsProps) {
  return (
    <Modal title={conversation ? `Notifications for ${conversation.name ?? 'this conversation'}` : 'Notification preferences'} onClose={onClose}>
      <p className="muted">Notification settings are coming soon.</p>
    </Modal>
  );
}
