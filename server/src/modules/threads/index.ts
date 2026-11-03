import type { FellowshipModule, ModuleContext } from '../../context';
import { me } from '../../auth';
import { notFound } from '../../errors';
import { createThreadState } from './state';
import type { MessageRow } from '../core/messages';

const LIST_LIMIT_MAX = 100;

/** Threads: followers, read cursors, the "threads I follow" list. Owned by the threads module. */
const threads: FellowshipModule = {
  name: 'threads',
  migrations: [
    `CREATE TABLE thread_followers (
      root_id TEXT NOT NULL REFERENCES messages(id),
      user_id TEXT NOT NULL,
      following INTEGER NOT NULL DEFAULT 1,
      followed_at INTEGER NOT NULL,
      last_read_ts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (root_id, user_id)
    );
    CREATE INDEX thread_followers_user ON thread_followers(user_id, following);`,
  ],
  register(app, ctx: ModuleContext) {
    const { db, auth, access, messages } = ctx;
    const pre = { preHandler: auth.requireUser };
    const state = createThreadState(db, ctx.bus, messages, access);
    messages.addPostHook((row, input) => state.onPost(row, input));

    /** Resolve any message id to its thread root, enforcing read access. */
    function rootFor(mid: string, userId: string) {
      const row = messages.getRow(mid);
      if (!row) throw notFound('Message not found');
      const root = row.thread_root_id ? messages.getRow(row.thread_root_id) : row;
      if (!root) throw notFound('Message not found');
      const { conv } = access.requireConversationRead(root.conversation_id, userId);
      return { root, conv };
    }

    // Threads I follow, newest activity first, with unread count and the last two replies.
    app.get<{ Params: { wid: string }; Querystring: { limit?: string } }>('/api/w/:wid/threads', pre, async (req) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), LIST_LIMIT_MAX);
      const rows = db.prepare(
        `SELECT m.*, f.last_read_ts, c.id AS conv_id, c.name AS conv_name, c.kind AS conv_kind, c.is_private AS conv_private,
           (SELECT COUNT(*) FROM messages r WHERE r.thread_root_id = m.id AND r.deleted_at IS NULL
              AND r.user_id != f.user_id AND r.created_at > f.last_read_ts) AS unread
         FROM thread_followers f
         JOIN messages m ON m.id = f.root_id
         JOIN conversations c ON c.id = m.conversation_id
         JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = f.user_id
         WHERE f.user_id = ? AND f.following = 1 AND c.workspace_id = ? AND m.deleted_at IS NULL
         ORDER BY COALESCE(m.last_reply_at, m.created_at) DESC, m.id DESC
         LIMIT ?`,
      ).all(user.id, req.params.wid, limit) as any[];

      const lastReplies = db.prepare(
        `SELECT * FROM messages WHERE thread_root_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC, id DESC LIMIT 2`,
      );
      const items = rows.map((r) => {
        const last = (lastReplies.all(r.id) as unknown as MessageRow[]).reverse();
        const [root] = messages.serialize([r as MessageRow], user.id);
        return {
          root,
          replies: messages.serialize(last, user.id),
          following: true,
          unreadCount: Number(r.unread),
          lastReadTs: Number(r.last_read_ts),
          lastActivityAt: r.last_reply_at ?? r.created_at,
          conversation: { id: r.conv_id, name: r.conv_name, kind: r.conv_kind, isPrivate: !!r.conv_private },
        };
      });
      const unreadThreadCount = items.filter((i) => i.unreadCount > 0).length;
      return { threads: items, unreadThreadCount };
    });

    // One thread: root, all replies, and the viewer's follow state.
    app.get<{ Params: { rootId: string } }>('/api/threads/:rootId', pre, async (req) => {
      const user = me(req);
      const { root } = rootFor(req.params.rootId, user.id);
      return {
        root: messages.serializeOne(root, user.id),
        replies: messages.listReplies(root.id, user.id),
        ...state.stateFor(root.id, user.id),
      };
    });

    app.post<{ Params: { rootId: string } }>('/api/threads/:rootId/follow', pre, async (req) => {
      const user = me(req);
      const { root, conv } = rootFor(req.params.rootId, user.id);
      access.requireConversationMember(conv.id, user.id);
      if (root.deleted_at) throw notFound('Message not found');
      state.setFollowing(root.id, user.id, true);
      state.notifyUsers(root.id, [user.id]);
      return state.stateFor(root.id, user.id);
    });

    app.delete<{ Params: { rootId: string } }>('/api/threads/:rootId/follow', pre, async (req) => {
      const user = me(req);
      const { root, conv } = rootFor(req.params.rootId, user.id);
      access.requireConversationMember(conv.id, user.id);
      state.setFollowing(root.id, user.id, false);
      state.notifyUsers(root.id, [user.id]);
      return state.stateFor(root.id, user.id);
    });

    // Mark a thread read for the viewer (no-op unless they follow it).
    app.post<{ Params: { rootId: string } }>('/api/threads/:rootId/read', pre, async (req) => {
      const user = me(req);
      const { root } = rootFor(req.params.rootId, user.id);
      state.markRead(root.id, user.id);
      state.notifyUsers(root.id, [user.id]);
      return state.stateFor(root.id, user.id);
    });
  },
};

export default threads;
