import type { FastifyInstance } from 'fastify';
import type { ModuleContext } from '../../context';
import type { UserRow } from '../../auth';
import { me } from '../../auth';
import { parse, z } from '../../validate';
import { conflict, notFound, unauthorized } from '../../errors';
import { publicUser } from './serializers';
import { SESSION_COOKIE } from '../../auth';

const signupBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
  fullName: z.string().trim().min(1).max(80),
  displayName: z.string().trim().max(80).optional(),
  timezone: z.string().max(80).optional(),
});

const loginBody = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string(),
});

const profileBody = z.object({
  fullName: z.string().trim().min(1).max(80),
  displayName: z.string().trim().max(80),
  title: z.string().trim().max(120),
  pronouns: z.string().trim().max(40),
  phone: z.string().trim().max(40),
  timezone: z.string().trim().max(80),
  avatarUrl: z.string().max(2000).nullable(),
  statusEmoji: z.string().max(40),
  statusText: z.string().max(100),
  statusExpires: z.number().int().nullable(),
}).partial();

const PROFILE_COLUMNS: Record<string, string> = {
  fullName: 'full_name', displayName: 'display_name', title: 'title', pronouns: 'pronouns',
  phone: 'phone', timezone: 'timezone', avatarUrl: 'avatar_url', statusEmoji: 'status_emoji',
  statusText: 'status_text', statusExpires: 'status_expires',
};

export function registerAuthRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const { db, auth, bus, ids } = ctx;
  const getUser = (id: string) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined;

  /** Create a user row (also used by seed and by bot creation in other modules). */
  function createUser(input: { email: string; password: string; fullName: string; displayName?: string; timezone?: string; isBot?: boolean }) {
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(input.email)) {
      throw conflict('An account with that email already exists', 'email_taken');
    }
    const id = ids.next('U');
    db.prepare(
      `INSERT INTO users (id, email, password_hash, full_name, display_name, timezone, created_at, is_bot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.email, auth.hashPassword(input.password), input.fullName,
      input.displayName || input.fullName.split(' ')[0], input.timezone || 'UTC', Date.now(), input.isBot ? 1 : 0);
    return getUser(id)!;
  }

  app.post('/api/auth/signup', async (req, reply) => {
    const body = parse(signupBody, req.body);
    const user = createUser(body);
    const s = auth.createSession(user.id);
    auth.setSessionCookie(reply, s.token, s.expiresAt);
    return { user: publicUser(user) };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = parse(loginBody, req.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_bot = 0').get(body.email) as unknown as UserRow | undefined;
    if (!user || !auth.verifyPassword(body.password, user.password_hash)) {
      throw Object.assign(unauthorized('Incorrect email or password'), { code: 'invalid_credentials' });
    }
    const s = auth.createSession(user.id);
    auth.setSessionCookie(reply, s.token, s.expiresAt);
    return { user: publicUser(user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    auth.destroySession(req.cookies?.[SESSION_COOKIE]);
    auth.clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: auth.requireUser }, async (req) => ({ user: publicUser(me(req)) }));
  app.get('/api/users/me', { preHandler: auth.requireUser }, async (req) => ({ user: publicUser(me(req)) }));

  app.patch('/api/users/me', { preHandler: auth.requireUser }, async (req) => {
    const user = me(req);
    const body = parse(profileBody, req.body);
    const sets: string[] = [];
    const vals: any[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      sets.push(`${PROFILE_COLUMNS[k]} = ?`);
      vals.push(v);
    }
    if (sets.length) db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, user.id);
    const updated = publicUser(getUser(user.id)!);
    const workspaces = db.prepare(
      'SELECT workspace_id FROM workspace_members WHERE user_id = ? AND deactivated = 0',
    ).all(user.id) as any[];
    for (const w of workspaces) {
      bus.emit({ type: 'user.updated', workspaceId: w.workspace_id, actorId: user.id, payload: { user: updated } });
    }
    return { user: updated };
  });

  app.get<{ Params: { id: string } }>('/api/users/:id', { preHandler: auth.requireUser }, async (req) => {
    const viewer = me(req);
    const target = getUser(req.params.id);
    if (!target) throw notFound('User not found');
    if (target.id !== viewer.id) {
      const shared = db.prepare(
        `SELECT 1 FROM workspace_members a JOIN workspace_members b ON a.workspace_id = b.workspace_id
         WHERE a.user_id = ? AND b.user_id = ? LIMIT 1`,
      ).get(viewer.id, target.id);
      if (!shared) throw notFound('User not found');
    }
    return { user: publicUser(target) };
  });

  return { createUser };
}
