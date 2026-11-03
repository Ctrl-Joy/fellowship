import type { Conversation, Message, User } from '../../types';

export interface WorkflowMessagePartsProps {
  message: Message;
  conversation: Conversation;
  currentUser: User;
}

/**
 * Interactive parts inside a message (form / approval buttons), rendered under the text of
 * every message. Core stub (renders nothing) — owned by `workflows`.
 */
export default function WorkflowMessageParts(_props: WorkflowMessagePartsProps) {
  return null;
}
