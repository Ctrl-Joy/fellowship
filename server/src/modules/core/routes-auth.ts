import type { FastifyInstance } from 'fastify';
import type { ModuleContext } from '../../context';
import type { UserRow } from '../../auth';
import { emailUnverified, me } from '../../auth';
import { parse, z } from '../../validate';
import { HttpError, conflict, notFound, unauthorized } from '../../errors';
import { publicUser } from './serializers';
import { SESSION_COOKIE } from '../../auth';
import { createVerification } from './verification';

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

const emailBody = z.object({ email: z.string().trim().toLowerCase().max(200) });

const password = z.string().min(8).max(200);

/** Either the typed code (with the email it was sent to) or the magic-link token. */
const codeOrToken = z.union([
  z.object({ email: z.string().trim().toLowerCase().max(200), code: z.string().max(20) }),
  z.object({ token: z.string().min(10).max(200) }),
]);

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
  const verification = createVerification(ctx);
  const userByEmail = (email: string) =>
    db.prepare('SELECT * FROM users WHERE email = ? AND is_bot = 0').get(email) as unknown as UserRow | undefined;

  function startSession(reply: any, userId: string) {
    const s = auth.createSession(userId);
    auth.setSessionCookie(reply, s.token, s.expiresAt);
  }

  /** Create a user row (also used by seed and by bot creation in other modules). Bots are always verified. */
  function createUser(input: { email: string; password: string; fullName: string; displayName?: string; timezone?: string; isBot?: boolean; verified?: boolean }) {
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(input.email)) {
      throw conflict('An account with that email already exists', 'email_taken');
    }
    const id = ids.next('U');
    const now = Date.now();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, full_name, display_name, timezone, created_at, is_bot, email_verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.email, auth.hashPassword(input.password), input.fullName,
      input.displayName || input.fullName.split(' ')[0], input.timezone || 'UTC', now, input.isBot ? 1 : 0,
      input.isBot || input.verified ? now : null);
    return getUser(id)!;
  }

  /** Signup never signs in: the account stays unverified until the emailed code or link is used. */
  app.post('/api/auth/signup', async (req) => {
    const body = parse(signupBody, req.body);
    const user = createUser(body);
    try {
      const sent = await verification.issue(user, 'verify');
      return { verificationRequired: true, email: user.email, emailSent: true, resendAfter: sent.resendAfter };
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      return { verificationRequired: true, email: user.email, emailSent: false, resendAfter: 0 };
    }
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = parse(loginBody, req.body);
    const user = userByEmail(body.email);
    if (!user || !auth.verifyPassword(body.password, user.password_hash)) {
      throw Object.assign(unauthorized('Incorrect email or password'), { code: 'invalid_credentials' });
    }
    if (user.email_verified_at == null) throw emailUnverified();
    startSession(reply, user.id);
    return { user: publicUser(user) };
  });

  /**
   * Email a 6-digit code + magic link. For an unverified account it verifies the address; for a
   * verified one it is a passwordless sign-in. Unknown addresses get the same response.
   */
  app.post('/api/auth/resend', async (req) => {
    const { email } = parse(emailBody, req.body);
    const user = userByEmail(email);
    if (!user) return { ok: true, resendAfter: 60 };
    const sent = await verification.issue(user, 'verify');
    return { ok: true, resendAfter: sent.resendAfter };
  });

  /** Redeem a code or magic link: marks the email verified and signs in. */
  app.post('/api/auth/verify', async (req, reply) => {
    const body = parse(codeOrToken, req.body);
    let userId: string;
    if ('token' in body) {
      userId = verification.consumeLink(body.token, 'verify');
    } else {
      const user = userByEmail(body.email);
      verification.consumeCode(user?.id, 'verify', body.code);
      userId = user!.id;
    }
    db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL').run(Date.now(), userId);
    startSession(reply, userId);
    return { user: publicUser(getUser(userId)!) };
  });

  app.post('/api/auth/password/forgot', async (req) => {
    const { email } = parse(emailBody, req.body);
    const user = userByEmail(email);
    if (!user) return { ok: true, resendAfter: 60 };
    const sent = await verification.issue(user, 'reset');
    return { ok: true, resendAfter: sent.resendAfter };
  });

  /** Set a new password from a reset code or link; signs out every other session. */
  app.post('/api/auth/password/reset', async (req, reply) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const body = parse(codeOrToken, raw);
    const newPassword = parse(z.object({ password }), raw).password;
    let userId: string;
    if ('token' in body) {
      userId = verification.consumeLink(body.token, 'reset');
    } else {
      const user = userByEmail(body.email);
      verification.consumeCode(user?.id, 'reset', body.code);
      userId = user!.id;
    }
    const now = Date.now();
    db.prepare('UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?')
      .run(auth.hashPassword(newPassword), now, userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    startSession(reply, userId);
    return { user: publicUser(getUser(userId)!) };
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
