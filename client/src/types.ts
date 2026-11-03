export interface User {
  id: string;
  email: string;
  fullName: string;
  displayName: string;
  title: string;
  pronouns: string;
  phone: string;
  timezone: string;
  avatarUrl: string | null;
  statusEmoji: string;
  statusText: string;
  statusExpires: number | null;
  isBot: boolean;
  createdAt: number;
}

export type Role = 'owner' | 'admin' | 'member' | 'guest';

export interface Member extends User {
  role: Role;
  joinedAt: number;
  deactivated: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  inviteCode: string;
  createdBy: string;
  createdAt: number;
  role: Role | null;
}

export type ConversationKind = 'channel' | 'dm' | 'group_dm' | 'self';

export interface Conversation {
  id: string;
  workspaceId: string;
  kind: ConversationKind;
  name: string | null;
  topic: string;
  description: string;
  isPrivate: boolean;
  isArchived: boolean;
  createdBy: string | null;
  createdAt: number;
  isDefault: boolean;
  memberCount: number;
  memberIds: string[] | null;
  isMember: boolean;
  lastReadTs: number;
  unreadCount: number;
  mentionCount: number;
  lastMessageAt: number | null;
  muted: boolean;
  notifyPref: string;
}

export interface FileInfo {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  thumbUrl?: string | null;
  width?: number | null;
  height?: number | null;
  [k: string]: unknown;
}

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface Message {
  id: string;
  conversationId: string;
  userId: string;
  text: string;
  threadRootId: string | null;
  replyCount: number;
  lastReplyAt: number | null;
  replyUserIds: string[];
  editedAt: number | null;
  deletedAt: number | null;
  createdAt: number;
  clientMsgId: string | null;
  subtype: string | null;
  meta: any | null;
  reactions: Reaction[];
  files: FileInfo[];
  pinned: boolean;
  saved: boolean;
  /** Client-only: optimistic message not yet confirmed by the server. */
  pending?: boolean;
  /** Client-only: optimistic send failed. */
  failed?: boolean;
}

/** WebSocket frame from the server. */
export interface Frame<P = any> {
  type: string;
  payload: P;
  workspaceId?: string | null;
  conversationId?: string | null;
  actorId?: string | null;
}
