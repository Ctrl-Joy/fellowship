import type { FastifyInstance } from 'fastify';
import type { FellowshipModule, ModuleContext } from '../../context';
import { me } from '../../auth';
import { parse, z } from '../../validate';
import { badRequest, notFound } from '../../errors';
import { registerFanout } from './fanout';
import { createPrefsStore, prefsDto } from './store';
import { listQuery, loadDtos, unreadCount } from './dto';
import { clockFor } from '../presence/clock';
import { isSilenced, type Level } from './rules';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const prefsBody = z.object({
  level: z.enum(['all', 'mentions', 'nothing']).optional(),
  keywords: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  dnd: z.object({
    enabled: z.boolean().optional(),
    start: z.string().regex(TIME_RE, 'Use HH:MM').optional(),
    end: z.string().regex(TIME_RE, 'Use HH:MM').optional(),
  }).optional(),
});

const snoozeBody = z.object({ minutes: z.number().int().min(0).max(24 * 60) });

/** Activity tab -> notification kinds (undefined = everything). */
const TABS: Record<string, string[] | undefined> = {
  all: undefined,
  mentions: ['mention', 'dm', 'channel_broadcast', 'keyword'],
  threads: ['thread_reply'],
  reactions: ['reaction'],
};

const notifications: FellowshipModule = {
  name: 'notifications',
  migrations: [
    `CREATE TABLE notification_prefs (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      level TEXT NOT NULL DEFAULT 'mentions' CHECK (level IN ('all','mentions','nothing')),
      keywords TEXT NOT NULL DEFAULT '[]',
      dnd_enabled INTEGER NOT NULL DEFAULT 0,
      dnd_start TEXT NOT NULL DEFAULT '22:00',
      dnd_end TEXT NOT NULL DEFAULT '08:00',
      snooze_until INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, workspace_id)
    );`,
    `CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('mention','dm','thread_reply','reaction','keyword','channel_broadcast')),
      conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
      actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      emoji TEXT NOT NULL DEFAULT '',
      silenced INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      read_at INTEGER
    );`,
    `CREATE INDEX notifications_user_ws ON notifications(user_id, workspace_id, id);`,
    `CREATE UNIQUE INDEX notifications_dedupe ON notifications(user_id, message_id, kind, actor_id, emoji);`,
  ],
  register(app: FastifyInstance, ctx: ModuleContext) {
    const { db, auth, access } = ctx;
    const pre = { preHandler: auth.requireUser };
    const prefs = createPrefsStore(db);
    const clock = clockFor(ctx);
    registerFanout(ctx);

    const base = '/api/w/:wid/notifications';

    // Paged activity feed, newest first. `before` is the id of the last item of the previous page.
    app.get<{ Params: { wid: string }; Querystring: { filter?: string; unread?: string; before?: string; limit?: string } }>(
      base, pre, async (req) => {
        const user = me(req);
        access.requireWorkspaceMember(req.params.wid, user.id);
        const filter = req.query.filter ?? 'all';
        if (!(filter in TABS)) throw badRequest('filter must be all, mentions, threads or reactions');
        const limit = Math.min(Math.max(Number(req.query.limit ?? 30) || 30, 1), 100);
        const page = listQuery(db, {
          userId: user.id, workspaceId: req.params.wid, kinds: TABS[filter],
          unreadOnly: req.query.unread === '1' || req.query.unread === 'true',
          before: req.query.before || undefined, limit,
        });
        return {
          notifications: page.rows,
          hasMore: page.hasMore,
          nextCursor: page.hasMore ? page.rows[page.rows.length - 1].id : null,
          unreadCount: unreadCount(db, user.id, req.params.wid),
        };
      },
    );

    app.get<{ Params: { wid: string } }>(`${base}/unread-count`, pre, async (req) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      return { unreadCount: unreadCount(db, user.id, req.params.wid) };
    });

    app.post<{ Params: { wid: string } }>(`${base}/read-all`, pre, async (req) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      db.prepare(
        'UPDATE notifications SET read_at = ? WHERE user_id = ? AND workspace_id = ? AND read_at IS NULL',
      ).run(clock.now(), user.id, req.params.wid);
      return { unreadCount: 0 };
    });

    app.post<{ Params: { wid: string; nid: string } }>(`${base}/:nid/read`, pre, async (req) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      const row = db.prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ? AND workspace_id = ?')
        .get(req.params.nid, user.id, req.params.wid);
      if (!row) throw notFound('Notification not found');
      db.prepare('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?').run(clock.now(), req.params.nid);
      return { unreadCount: unreadCount(db, user.id, req.params.wid), notification: loadDtos(db, [req.params.nid])[0] };
    });

    app.get<{ Params: { wid: string } }>(`${base}/prefs`, pre, async (req) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      return { prefs: prefsDto(prefs.load(user.id, req.params.wid), clock.now()) };
    });

    // PUT and PATCH both accept a partial update.
    const savePrefs = async (req: any) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      const body = parse(prefsBody, req.body);
      const patch: { level?: Level; keywords?: string; dnd_enabled?: number; dnd_start?: string; dnd_end?: string } = {};
      if (body.level !== undefined) patch.level = body.level;
      if (body.keywords !== undefined) {
        // De-duplicate case-insensitively, keeping the first spelling.
        const seen = new Set<string>();
        const unique = body.keywords.filter((k) => !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()));
        patch.keywords = JSON.stringify(unique);
      }
      if (body.dnd) {
        if (body.dnd.enabled !== undefined) patch.dnd_enabled = body.dnd.enabled ? 1 : 0;
        if (body.dnd.start !== undefined) patch.dnd_start = body.dnd.start;
        if (body.dnd.end !== undefined) patch.dnd_end = body.dnd.end;
      }
      const saved = prefs.save(user.id, req.params.wid, patch);
      return { prefs: prefsDto(saved, clock.now()) };
    };
    app.put(`${base}/prefs`, pre, savePrefs);
    app.patch(`${base}/prefs`, pre, savePrefs);

    // Manual do-not-disturb. minutes = 0 clears the snooze.
    app.post<{ Params: { wid: string } }>(`${base}/snooze`, pre, async (req) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      const body = parse(snoozeBody, req.body);
      const until = body.minutes > 0 ? clock.now() + body.minutes * 60_000 : null;
      const saved = prefs.save(user.id, req.params.wid, { snooze_until: until });
      return {
        prefs: prefsDto(saved, clock.now()),
        silencedNow: isSilenced(saved, user.timezone, clock.now()),
      };
    });
  },
};

export default notifications;
