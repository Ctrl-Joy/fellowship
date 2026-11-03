import type { Db } from '../../db';
import type { Bus } from '../../bus';
import type { MessageRow, MessageService, PostInput } from '../core/messages';
import type { Access } from '../core/access';

export interface ThreadState {
  rootId: string;
  following: boolean;
  unreadCount: number;
  lastReadTs: number;
  replyCount: number;
  lastReplyAt: number | null;
}

/**
 * Follower bookkeeping for threads. Rules:
 * - the root author follows the thread when the first reply arrives (unless they unfollowed earlier);
 * - every replier follows (replying re-follows, and their own reply counts as read);
 * - unread = live replies from other people created after the follower's read cursor.
 */
export function createThreadState(db: Db, bus: Bus, messages: MessageService, access: Access) {
  const stateStmt = db.prepare(
    `SELECT f.following, f.last_read_ts,
       (SELECT COUNT(*) FROM messages r WHERE r.thread_root_id = f.root_id AND r.deleted_at IS NULL
          AND r.user_id != f.user_id AND r.created_at > f.last_read_ts) AS unread
     FROM thread_followers f WHERE f.root_id = ? AND f.user_id = ?`,
  );
  const followerIds = db.prepare('SELECT user_id FROM thread_followers WHERE root_id = ? AND following = 1');

  function stateFor(rootId: string, userId: string): ThreadState {
    const root = messages.getRow(rootId);
    const row = stateStmt.get(rootId, userId) as any;
    const following = !!row && row.following === 1;
    return {
      rootId,
      following,
      unreadCount: following ? Number(row.unread) : 0,
      lastReadTs: row ? Number(row.last_read_ts) : 0,
      replyCount: root?.reply_count ?? 0,
      lastReplyAt: root?.last_reply_at ?? null,
    };
  }

  function notifyUsers(rootId: string, userIds: string[]) {
    const root = messages.getRow(rootId);
    if (!root) return;
    const conv = access.getConversation(root.conversation_id);
    if (!conv) return;
    for (const userId of new Set(userIds)) {
      bus.emit({
        type: 'thread.updated', workspaceId: conv.workspace_id, conversationId: conv.id, actorId: null,
        audience: [userId], payload: { ...stateFor(rootId, userId), conversationId: conv.id },
      });
    }
  }

  /** Tell every follower their own view of the thread changed (per-user audience). */
  function notifyFollowers(rootId: string) {
    notifyUsers(rootId, (followerIds.all(rootId) as any[]).map((r) => r.user_id));
  }

  /** Runs inside post()'s transaction, after the reply row is inserted. */
  function onPost(row: MessageRow, _input: PostInput) {
    if (!row.thread_root_id) return;
    const root = messages.getRow(row.thread_root_id);
    if (!root) return;
    db.prepare(
      `INSERT INTO thread_followers (root_id, user_id, following, followed_at, last_read_ts)
       VALUES (?, ?, 1, ?, 0) ON CONFLICT(root_id, user_id) DO NOTHING`,
    ).run(root.id, root.user_id, row.created_at);
    db.prepare(
      `INSERT INTO thread_followers (root_id, user_id, following, followed_at, last_read_ts)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(root_id, user_id) DO UPDATE SET following = 1, last_read_ts = MAX(last_read_ts, excluded.last_read_ts)`,
    ).run(root.id, row.user_id, row.created_at, row.created_at);
  }

  function setFollowing(rootId: string, userId: string, following: boolean) {
    const now = Date.now();
    db.prepare(
      `INSERT INTO thread_followers (root_id, user_id, following, followed_at, last_read_ts)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(root_id, user_id) DO UPDATE SET following = excluded.following,
         last_read_ts = CASE WHEN excluded.following = 1 THEN MAX(last_read_ts, excluded.last_read_ts) ELSE last_read_ts END`,
    ).run(rootId, userId, following ? 1 : 0, now, now);
  }

  function markRead(rootId: string, userId: string) {
    db.prepare(
      'UPDATE thread_followers SET last_read_ts = MAX(last_read_ts, ?) WHERE root_id = ? AND user_id = ? AND following = 1',
    ).run(Date.now(), rootId, userId);
  }

  // Keep unread and reply counts live for followers.
  bus.on('message.created', (e) => {
    const m = e.payload?.message;
    if (m?.threadRootId) notifyFollowers(m.threadRootId);
  });
  bus.on('message.deleted', (e) => {
    const m = e.payload?.message;
    if (m?.threadRootId) notifyFollowers(m.threadRootId);
  });

  return { stateFor, notifyUsers, notifyFollowers, onPost, setFollowing, markRead };
}

export type ThreadStateService = ReturnType<typeof createThreadState>;
