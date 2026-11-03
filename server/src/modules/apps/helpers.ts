import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { ModuleContext } from '../../context';
import { HttpError, unauthorized } from '../../errors';
import { randomToken } from '../../ids';
import type { Message } from '../core/messages';

export const ALL_SCOPES = [
  'chat:write', 'channels:read', 'channels:join', 'channels:history',
  'users:read', 'reactions:write',
] as const;
export type Scope = (typeof ALL_SCOPES)[number];

export const SYSTEM_BOT_NAME = 'Fellowship Bot';
/** Timeout for every call the server makes to an app's URL (slash commands, interactivity). */
export const OUTBOUND_TIMEOUT_MS = 3000;

export interface AppRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  icon_emoji: string;
  bot_user_id: string;
  created_by: string;
  created_at: number;
  is_system: number;
  signing_secret: string;
  interactivity_url: string | null;
  events_url: string | null;
  event_types: string;
}

export interface BotContext {
  app: AppRow;
  botUserId: string;
  scopes: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    bot: BotContext | null;
  }
}

/** Bot messages: text is required unless blocks carry the content. */
export function requireMessageBody(text: unknown, hasBlocks: boolean): string {
  const t = typeof text === 'string' ? text : '';
  if (!t.trim() && !hasBlocks) throw new HttpError(400, 'bad_request', 'text is required');
  return t;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newBotToken = () => `fsbot_${randomToken(32)}`;
export const newSecret = (bytes = 24) => randomBytes(bytes).toString('hex');

export function appDto(row: AppRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    iconEmoji: row.icon_emoji,
    botUserId: row.bot_user_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    isSystem: !!row.is_system,
  };
}

/** Signature = HMAC-SHA256(secret, `v0:<timestamp>:<body>`), sent as `v0=<hex>`. */
export function signBody(secret: string, timestamp: number, body: string): string {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex');
}

export function signedHeaders(secret: string, body: string, contentType: string) {
  const ts = Date.now();
  return {
    'content-type': contentType,
    'x-fellowship-request-timestamp': String(ts),
    'x-fellowship-signature': signBody(secret, ts, body),
  };
}

export function parseEventTypes(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Resolve "<@U123>", "@name", "name" or an email local part to an active workspace member. */
export function resolveUserRef(db: ModuleContext['db'], workspaceId: string, ref: string): { id: string; fullName: string } | null {
  const wrapped = /^<@([A-Za-z0-9_]+)>$/.exec(ref.trim());
  if (wrapped) {
    const row = db.prepare(
      `SELECT u.id, u.full_name AS fullName FROM users u JOIN workspace_members wm ON wm.user_id = u.id
       WHERE wm.workspace_id = ? AND u.id = ? AND wm.deactivated = 0`,
    ).get(workspaceId, wrapped[1]) as any;
    return row ? { id: row.id, fullName: row.fullName } : null;
  }
  const bare = ref.trim().replace(/^@/, '').toLowerCase();
  if (!bare) return null;
  const row = db.prepare(
    `SELECT u.id, u.full_name AS fullName FROM users u JOIN workspace_members wm ON wm.user_id = u.id
     WHERE wm.workspace_id = ? AND wm.deactivated = 0 AND u.is_bot = 0
       AND (lower(u.display_name) = ? OR lower(u.full_name) = ? OR lower(u.email) = ?
            OR lower(replace(u.full_name, ' ', '.')) = ? OR lower(replace(u.full_name, ' ', '')) = ?)
     LIMIT 1`,
  ).get(workspaceId, bare, bare, bare, bare, bare) as any;
  return row ? { id: row.id, fullName: row.fullName } : null;
}

/** Bearer-token auth for the bot Web API. 401 on a bad token, 403 when the scope is missing. */
export function authenticateBot(db: ModuleContext['db'], req: FastifyRequest, scope?: Scope): BotContext {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  if (!m) throw unauthorized('Missing bearer token');
  const hash = hashToken(m[1]);
  const row = db.prepare(
    'SELECT t.scopes, a.* FROM apps_tokens t JOIN apps a ON a.id = t.app_id WHERE t.token_hash = ?',
  ).get(hash) as any;
  if (!row) throw unauthorized('Invalid bearer token');
  const scopes = String(row.scopes).split(',').filter(Boolean);
  if (scope && !scopes.includes(scope)) throw new HttpError(403, 'missing_scope', `Token is missing the ${scope} scope`);
  db.prepare('UPDATE apps_tokens SET last_used_at = ? WHERE token_hash = ?').run(Date.now(), hash);
  return { app: row as AppRow, botUserId: row.bot_user_id, scopes };
}

/** A message that is delivered over WebSocket to one user and never stored. */
export function ephemeralMessage(ids: ModuleContext['ids'], args: {
  conversationId: string; userId: string; text: string; meta?: Record<string, unknown>;
}): Message {
  return {
    id: 'E' + ids.next(),
    conversationId: args.conversationId,
    userId: args.userId,
    text: args.text,
    threadRootId: null,
    replyCount: 0,
    lastReplyAt: null,
    replyUserIds: [],
    editedAt: null,
    deletedAt: null,
    createdAt: Date.now(),
    clientMsgId: null,
    subtype: 'ephemeral',
    meta: { ephemeral: true, ...(args.meta ?? {}) },
    reactions: [],
    files: [],
    pinned: false,
    saved: false,
  };
}
