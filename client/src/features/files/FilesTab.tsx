import type { Conversation, User } from '../../types';

export interface FilesTabProps {
  workspaceId: string;
  conversation: Conversation;
  currentUser: User;
}

/** Conversation header "Files" tab. Core stub — owned by `files`. */
export default function FilesTab(_props: FilesTabProps) {
  return <div className="empty">Files shared in this conversation will appear here.</div>;
}
