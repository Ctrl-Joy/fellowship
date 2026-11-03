import type { Db } from '../../db';
import type { UserRow } from '../../auth';
import type { ConversationRow } from './access';

export interface PublicUser {
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

export function publicUser(u: UserRow): PublicUser {
  const expired = u.status_expires != null && u.status_expires < Date.now();
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    displayName: u.display_name || u.full_name,
    title: u.title,
    pronouns: u.pronouns,
    phone: u.phone,
    timezone: u.timezone,
    avatarUrl: u.avatar_url,
    statusEmoji: expired ? '' : u.status_emoji,
    statusText: expired ? '' : u.status_text,
    statusExpires: expired ? null : u.status_expires,
    isBot: !!u.is_bot,
    createdAt: u.created_at,
  };
}

export function publicWorkspace(w: any, role?: string) {
  return {
    id: w.id as string,
    name: w.name as string,
    slug: w.slug as string,
    iconUrl: (w.icon_url as string | null) ?? null,
    inviteCode: w.invite_code as string,
    createdBy: w.created_by as string,
    createdAt: w.created_at as number,
    role: (role ?? w.role ?? null) as string | null,
  };
}

export interface ConversationDto {
  id: string;
  workspaceId: string;
  kind: ConversationRow['kind'];
  name: string | null;
  topic: string;
  description: string;
  isPrivate: boolean;
  isArchived: boolean;
  createdBy: string | null;
  createdAt: number;
  isDefault: boolean;
  memberCount: number;
  /** Filled for dm / group_dm / self (always), and for channels when requested. */
  memberIds: string[] | null;
  isMember: boolean;
  lastReadTs: number;
  unreadCount: number;
  mentionCount: number;
  lastMessageAt: number | null;
  muted: boolean;
  notifyPref: string;
}

export const DEFAULT_CHANNELS = ['general'];

/**
 * Load conversations with viewer-specific read state.
 * Unread = root-level messages from others after the viewer's last_read_ts.
 * Mentions = unread messages containing <@viewerId>, <!channel>, <!here> or <!everyone>
 * (every unread message counts as a mention in DMs).
 */
export function loadConversations(
  db: Db, viewerId: string, where: string, params: any[], opts: { withMemberIds?: boolean } = {},
): ConversationDto[] {
  const rows = db.prepare(
    `SELECT c.*, cm.user_id AS viewer_member, cm.last_read_ts, cm.notify_pref, cm.muted,
       (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id = c.id) AS member_count,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id
          AND (m.thread_root_id IS NULL OR m.subtype = 'thread_broadcast')
          AND m.deleted_at IS NULL AND m.user_id != ? AND m.created_at > cm.last_read_ts) AS unread_count,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id
          AND (m.thread_root_id IS NULL OR m.subtype = 'thread_broadcast')
          AND m.deleted_at IS NULL AND m.user_id != ? AND m.created_at > cm.last_read_ts
          AND (instr(m.text, ?) > 0 OR instr(m.text, '<!channel>') > 0 OR instr(m.text, '<!here>') > 0
               OR instr(m.text, '<!everyone>') > 0)) AS mention_count,
       (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id
          AND (m.thread_root_id IS NULL OR m.subtype = 'thread_broadcast') AND m.deleted_at IS NULL) AS last_message_at
     FROM conversations c
     LEFT JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
     WHERE ${where}
     ORDER BY c.kind, c.name, c.created_at`,
  ).all(viewerId, viewerId, `<@${viewerId}>`, viewerId, ...params) as any[];

  const needMembers = rows.filter((r) => r.kind !== 'channel' || opts.withMemberIds).map((r) => r.id);
  const members = new Map<string, string[]>();
  if (needMembers.length) {
    const ph = needMembers.map(() => '?').join(',');
    const ms = db.prepare(
      `SELECT conversation_id, user_id FROM conversation_members WHERE conversation_id IN (${ph}) ORDER BY joined_at`,
    ).all(...needMembers) as any[];
    for (const m of ms) {
      const list = members.get(m.conversation_id) ?? [];
      list.push(m.user_id);
      members.set(m.conversation_id, list);
    }
  }

  return rows.map((r) => {
    const isMember = r.viewer_member != null;
    const isDirect = r.kind !== 'channel';
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      kind: r.kind,
      name: r.name,
      topic: r.topic,
      description: r.description,
      isPrivate: !!r.is_private || isDirect,
      isArchived: !!r.is_archived,
      createdBy: r.created_by,
      createdAt: r.created_at,
      isDefault: r.kind === 'channel' && DEFAULT_CHANNELS.includes(r.name),
      memberCount: r.member_count,
      memberIds: members.get(r.id) ?? (isDirect || opts.withMemberIds ? [] : null),
      isMember,
      lastReadTs: isMember ? r.last_read_ts : 0,
      unreadCount: isMember ? r.unread_count : 0,
      mentionCount: isMember ? (isDirect ? r.unread_count : r.mention_count) : 0,
      lastMessageAt: r.last_message_at ?? null,
      muted: isMember ? !!r.muted : false,
      notifyPref: isMember ? r.notify_pref : 'default',
    };
  });
}

export function loadConversation(db: Db, viewerId: string, conversationId: string, withMemberIds = false) {
  return loadConversations(db, viewerId, 'c.id = ?', [conversationId], { withMemberIds })[0] ?? null;
}
