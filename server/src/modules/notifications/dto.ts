import type { Db } from '../../db';

export const PREVIEW_CHARS = 200;

/** Public notification shape used by REST and WebSocket. */
export interface NotificationDto {
  id: string;
  kind: string;
  workspaceId: string;
  conversationId: string | null;
  conversationKind: string | null;
  conversationName: string | null;
  messageId: string | null;
  threadRootId: string | null;
  actorId: string | null;
  emoji: string;
  /** Live message text (null once the message is deleted). Never a stale copy. */
  text: string | null;
  createdAt: number;
  readAt: number | null;
  silenced: boolean;
}

const SELECT = `SELECT n.*, c.kind AS conv_kind, c.name AS conv_name, m.text AS msg_text,
  m.deleted_at AS msg_deleted, m.thread_root_id AS msg_root
  FROM notifications n
  LEFT JOIN conversations c ON c.id = n.conversation_id
  LEFT JOIN messages m ON m.id = n.message_id`;

/**
 * A notification row only shows while the viewer is still a member of its conversation,
 * so nothing leaks from channels the user has left.
 */
const STILL_MEMBER = `EXISTS (SELECT 1 FROM conversation_members cm
  WHERE cm.conversation_id = n.conversation_id AND cm.user_id = n.user_id)`;

export function toDto(r: any): NotificationDto {
  const deleted = r.msg_deleted != null;
  return {
    id: r.id,
    kind: r.kind,
    workspaceId: r.workspace_id,
    conversationId: r.conversation_id ?? null,
    conversationKind: r.conv_kind ?? null,
    conversationName: r.conv_name ?? null,
    messageId: r.message_id ?? null,
    threadRootId: r.msg_root ?? null,
    actorId: r.actor_id ?? null,
    emoji: r.emoji ?? '',
    text: deleted || r.msg_text == null ? null : String(r.msg_text).slice(0, PREVIEW_CHARS),
    createdAt: r.created_at,
    readAt: r.read_at ?? null,
    silenced: !!r.silenced,
  };
}

export function loadDtos(db: Db, ids: string[]): NotificationDto[] {
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(`${SELECT} WHERE n.id IN (${ph})`).all(...ids) as any[];
  return rows.map(toDto);
}

export function listQuery(db: Db, args: {
  userId: string; workspaceId: string; kinds?: string[]; unreadOnly?: boolean; before?: string; limit: number;
}): { rows: NotificationDto[]; hasMore: boolean } {
  const where = ['n.user_id = ?', 'n.workspace_id = ?', STILL_MEMBER];
  const params: any[] = [args.userId, args.workspaceId];
  if (args.kinds?.length) {
    where.push(`n.kind IN (${args.kinds.map(() => '?').join(',')})`);
    params.push(...args.kinds);
  }
  if (args.unreadOnly) where.push('n.read_at IS NULL');
  if (args.before) { where.push('n.id < ?'); params.push(args.before); }
  params.push(args.limit + 1);
  const rows = db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY n.id DESC LIMIT ?`).all(...params) as any[];
  const hasMore = rows.length > args.limit;
  return { rows: rows.slice(0, args.limit).map(toDto), hasMore };
}

export function unreadCount(db: Db, userId: string, workspaceId: string): number {
  const r = db.prepare(
    `SELECT COUNT(*) AS c FROM notifications n WHERE n.user_id = ? AND n.workspace_id = ? AND n.read_at IS NULL AND ${STILL_MEMBER}`,
  ).get(userId, workspaceId) as any;
  return Number(r?.c ?? 0);
}
