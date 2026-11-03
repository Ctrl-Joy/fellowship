import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db';
import { randomToken } from './ids';
import { HttpError, unauthorized } from './errors';

export const SESSION_COOKIE = 'fs_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  display_name: string;
  title: string;
  pronouns: string;
  phone: string;
  timezone: string;
  avatar_url: string | null;
  status_emoji: string;
  status_text: string;
  status_expires: number | null;
  created_at: number;
  is_bot: number;
  /** null until the person proves they own the address (bots are created verified). */
  email_verified_at: number | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export function createAuth(db: Db) {
  const findSession = db.prepare(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?',
  );

  function sessionUser(token: string | undefined | null): UserRow | null {
    if (!token) return null;
    return (findSession.get(token, Date.now()) as unknown as UserRow) ?? null;
  }

  /** The signed-in, email-verified user for a session token, else null. */
  function userFromToken(token: string | undefined | null): UserRow | null {
    const user = sessionUser(token);
    return user && user.email_verified_at != null ? user : null;
  }

  function createSession(userId: string): { token: string; expiresAt: number } {
    const token = randomToken(32);
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
      token, userId, now, expiresAt,
    );
    return { token, expiresAt };
  }

  function destroySession(token: string | undefined): void {
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  function setSessionCookie(reply: FastifyReply, token: string, expiresAt: number) {
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/', httpOnly: true, sameSite: 'lax', expires: new Date(expiresAt),
    });
  }

  function clearSessionCookie(reply: FastifyReply) {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  /** Fastify preHandler: 401 without a valid session, 403 `email_unverified` for unverified users. */
  async function requireUser(req: FastifyRequest): Promise<void> {
    const user = sessionUser(req.cookies?.[SESSION_COOKIE]);
    if (!user) throw unauthorized();
    if (user.email_verified_at == null) throw emailUnverified();
    req.user = user;
  }

  /** Same as requireUser but never throws (req.user may be null). */
  async function optionalUser(req: FastifyRequest): Promise<void> {
    req.user = userFromToken(req.cookies?.[SESSION_COOKIE]);
  }

  return {
    hashPassword, verifyPassword, userFromToken, createSession, destroySession,
    setSessionCookie, clearSessionCookie, requireUser, optionalUser,
  };
}

export type Auth = ReturnType<typeof createAuth>;

export const emailUnverified = () =>
  new HttpError(403, 'email_unverified', 'Please verify your email address to continue');

/** Narrow req.user after requireUser has run. */
export function me(req: FastifyRequest): UserRow {
  if (!req.user) throw unauthorized();
  return req.user;
}
