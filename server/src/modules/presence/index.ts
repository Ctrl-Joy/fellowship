import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { FellowshipModule, ModuleContext } from '../../context';
import { me } from '../../auth';
import { parse, z } from '../../validate';
import { badRequest, notFound } from '../../errors';
import { publicUser } from '../core/serializers';
import { presenceFor } from './service';

/** Scheduler period: activity expiry and custom-status expiry are checked this often. */
const TICK_MS = 30_000;
const AVATAR_TYPES: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
};
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const manualBody = z.object({ manualAway: z.boolean() });

const presence: FellowshipModule = {
  name: 'presence',
  migrations: [
    `CREATE TABLE presence_state (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      last_activity_at INTEGER NOT NULL DEFAULT 0,
      manual_away INTEGER NOT NULL DEFAULT 0
    );`,
  ],
  register(app: FastifyInstance, ctx: ModuleContext) {
    const { db, auth, bus, realtime, config } = ctx;
    const pre = { preHandler: auth.requireUser };
    const svc = presenceFor(ctx);

    // Client -> server activity frames (client throttles; idle detection sends presence.away).
    realtime.onClientMessage('presence.active', (user) => svc.activity(user.id));
    realtime.onClientMessage('presence.away', (user) => svc.idle(user.id));

    const timer = setInterval(() => {
      try { svc.tick(); } catch (err) { app.log.error(err, 'presence tick failed'); }
    }, TICK_MS);
    timer.unref();
    ctx.onClose(() => clearInterval(timer));

    app.get<{ Params: { wid: string } }>('/api/w/:wid/presence', pre, async (req) => {
      const user = me(req);
      ctx.access.requireWorkspaceMember(req.params.wid, user.id);
      return { presence: svc.workspaceStates(req.params.wid) };
    });

    app.get('/api/presence/me', pre, async (req) => {
      const user = me(req);
      return { presence: svc.state(user.id), manualAway: svc.isManualAway(user.id) };
    });

    /** Manual "set yourself away" override. Sending manualAway=false returns to automatic presence. */
    const setManual = async (req: any) => {
      const user = me(req);
      const body = parse(manualBody, req.body);
      const state = svc.setManualAway(user.id, body.manualAway);
      return { presence: state, manualAway: body.manualAway };
    };
    app.put('/api/presence/me', pre, setManual);
    app.patch('/api/presence/me', pre, setManual);

    // ---- avatars ----
    const avatarDir = join(config.uploadsDir, 'avatars');
    const avatarFiles = (userId: string) => {
      if (!existsSync(avatarDir)) return [] as string[];
      return readdirSync(avatarDir).filter((f) => f.startsWith(`${userId}.`)).map((f) => join(avatarDir, f));
    };

    function publishUser(userId: string) {
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
      const dto = publicUser(row);
      for (const w of db.prepare('SELECT workspace_id FROM workspace_members WHERE user_id = ? AND deactivated = 0').all(userId) as any[]) {
        bus.emit({ type: 'user.updated', workspaceId: w.workspace_id, actorId: userId, payload: { user: dto } });
      }
      return dto;
    }

    app.post('/api/users/me/avatar', pre, async (req) => {
      const user = me(req);
      const file = await req.file();
      if (!file) throw badRequest('Choose an image to upload', 'no_file');
      const ext = AVATAR_TYPES[file.mimetype];
      if (!ext) throw badRequest('Avatars must be PNG, JPEG, GIF or WebP images', 'unsupported_type');
      const buf = await file.toBuffer();
      if (file.file.truncated || buf.length > AVATAR_MAX_BYTES) throw badRequest('Avatars must be 2 MB or smaller', 'too_large');
      mkdirSync(avatarDir, { recursive: true });
      for (const old of avatarFiles(user.id)) rmSync(old, { force: true });
      writeFileSync(join(avatarDir, `${user.id}.${ext}`), buf);
      db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(`/api/avatars/${user.id}?v=${Date.now()}`, user.id);
      return { user: publishUser(user.id) };
    });

    app.delete('/api/users/me/avatar', pre, async (req) => {
      const user = me(req);
      for (const old of avatarFiles(user.id)) rmSync(old, { force: true });
      db.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').run(user.id);
      return { user: publishUser(user.id) };
    });

    app.get<{ Params: { uid: string } }>('/api/avatars/:uid', pre, async (req, reply) => {
      const viewer = me(req);
      const shared = db.prepare(
        `SELECT 1 FROM workspace_members a JOIN workspace_members b ON a.workspace_id = b.workspace_id
         WHERE a.user_id = ? AND b.user_id = ? LIMIT 1`,
      ).get(viewer.id, req.params.uid);
      if (!shared && viewer.id !== req.params.uid) throw notFound('Avatar not found');
      const file = avatarFiles(req.params.uid)[0];
      if (!file) throw notFound('Avatar not found');
      const mime = Object.entries(AVATAR_TYPES).find(([, ext]) => file.endsWith(`.${ext}`))?.[0] ?? 'application/octet-stream';
      reply.header('Cache-Control', 'private, max-age=300');
      return reply.type(mime).send(readFileSync(file));
    });
  },
};

export default presence;
