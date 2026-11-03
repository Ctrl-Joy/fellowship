import { randomBytes } from 'node:crypto';
import type { ModuleContext } from '../../context';
import { tx } from '../../db';
import { notFound } from '../../errors';
import { z } from '../../validate';
import type { ConversationRow } from '../core/access';
import type { Message, MessageRow } from '../core/messages';
import {
  ALL_SCOPES, SYSTEM_BOT_NAME, ephemeralMessage, hashToken, newBotToken, newSecret,
  type AppRow, type Scope,
} from './helpers';

export interface AppAction {
  actionId: string;
  text: string;
  value: string;
  style: 'default' | 'primary' | 'danger';
}

const buttonSchema = z.object({
  type: z.literal('button'),
  actionId: z.string().min(1).max(100),
  text: z.string().min(1).max(75),
  value: z.string().max(2000).optional(),
  style: z.enum(['default', 'primary', 'danger']).optional(),
});

const blockSchema = z.union([
  z.object({ type: z.literal('section'), text: z.string().min(1).max(3000) }),
  z.object({ type: z.literal('actions'), elements: z.array(buttonSchema).min(1).max(10) }),
]);

export const blocksSchema = z.array(blockSchema).max(20);

/** Validate blocks and derive the flat button list the client renders (meta.actions). */
export function normalizeBlocks(input: unknown): { blocks: any[]; actions: AppAction[] } {
  const blocks = blocksSchema.parse(input ?? []);
  const actions: AppAction[] = [];
  for (const b of blocks) {
    if (b.type !== 'actions') continue;
    for (const el of b.elements) {
      actions.push({ actionId: el.actionId, text: el.text, value: el.value ?? '', style: el.style ?? 'default' });
    }
  }
  return { blocks, actions };
}

export function parseMeta(json: string | null): any {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

export function createAppsService(ctx: ModuleContext) {
  const { db, ids, bus, access, messages, core } = ctx;

  function appById(id: string): AppRow | null {
    return (db.prepare('SELECT * FROM apps WHERE id = ?').get(id) as unknown as AppRow) ?? null;
  }

  function appInWorkspace(workspaceId: string, id: string): AppRow | null {
    const row = appById(id);
    return row && row.workspace_id === workspaceId ? row : null;
  }

  function appMeta(app: AppRow) {
    return { id: app.id, name: app.name, iconEmoji: app.icon_emoji };
  }

  function tokenInfo(appId: string) {
    const row = db.prepare('SELECT scopes, created_at, last_used_at FROM apps_tokens WHERE app_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(appId) as any;
    if (!row) return null;
    return {
      scopes: String(row.scopes).split(',').filter(Boolean),
      createdAt: row.created_at as number,
      lastUsedAt: (row.last_used_at as number | null) ?? null,
    };
  }

  /** Replace the app's token (one live token per app). Returns the plaintext once. */
  function issueToken(appId: string, scopes: string[]): string {
    const token = newBotToken();
    db.prepare('DELETE FROM apps_tokens WHERE app_id = ?').run(appId);
    db.prepare('INSERT INTO apps_tokens (token_hash, app_id, scopes, created_at) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), appId, scopes.join(','), Date.now());
    return token;
  }

  function createBotUser(workspaceId: string, name: string): string {
    const bot = core.createUser({
      email: `bot-${randomBytes(8).toString('hex')}@apps.fellowship.invalid`,
      password: newSecret(32),
      fullName: name,
      displayName: name,
      isBot: true,
    });
    core.joinWorkspace(workspaceId, bot.id);
    return bot.id;
  }

  function createApp(workspaceId: string, actorId: string, input: {
    name: string; description?: string; iconEmoji?: string; scopes?: Scope[];
  }) {
    const scopes = input.scopes?.length ? [...new Set(input.scopes)] : [...ALL_SCOPES];
    const id = ids.next('AP');
    return tx(db, () => {
      const botId = createBotUser(workspaceId, input.name);
      db.prepare(
        `INSERT INTO apps (id, workspace_id, name, description, icon_emoji, bot_user_id, created_by, created_at, signing_secret)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, workspaceId, input.name, input.description ?? '', input.iconEmoji ?? '', botId, actorId, Date.now(), newSecret(24));
      const token = issueToken(id, scopes);
      return { app: appById(id)!, token, scopes };
    });
  }

  /** The built-in "Fellowship Bot" for a workspace (reminders). Created on first use. */
  function ensureSystemApp(workspaceId: string): AppRow {
    const existing = db.prepare('SELECT * FROM apps WHERE workspace_id = ? AND is_system = 1').get(workspaceId) as unknown as AppRow | undefined;
    if (existing) return existing;
    const ws = db.prepare('SELECT created_by FROM workspaces WHERE id = ?').get(workspaceId) as any;
    if (!ws) throw notFound('Workspace not found');
    return tx(db, () => {
      const botId = createBotUser(workspaceId, SYSTEM_BOT_NAME);
      const id = ids.next('AP');
      db.prepare(
        `INSERT INTO apps (id, workspace_id, name, description, icon_emoji, bot_user_id, created_by, created_at, is_system, signing_secret)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      ).run(id, workspaceId, SYSTEM_BOT_NAME, 'Built-in helper: reminders and notices.', '', botId, ws.created_by, Date.now(), newSecret(24));
      return appById(id)!;
    });
  }

  function ensureMember(conv: ConversationRow, userId: string) {
    if (!access.isConversationMember(conv.id, userId)) core.addMember(conv.id, userId, userId);
  }

  /** Post as an app's bot user through the core post() path (realtime, search, notifications). */
  function postAsApp(app: AppRow, conv: ConversationRow, input: {
    text: string; threadRootId?: string | null; alsoSendToChannel?: boolean;
    blocks?: any[]; actions?: AppAction[]; meta?: Record<string, unknown>; force?: boolean;
  }): Message {
    const meta: Record<string, unknown> = { app: appMeta(app), ...(input.meta ?? {}) };
    if (input.blocks?.length) meta.blocks = input.blocks;
    if (input.actions?.length) meta.actions = input.actions;
    return messages.post({
      conversationId: conv.id,
      userId: app.bot_user_id,
      text: input.text,
      threadRootId: input.threadRootId ?? null,
      alsoSendToChannel: input.alsoSendToChannel,
      meta,
      force: input.force,
    });
  }

  /** Deliver a message to one user over WebSocket only. Never stored. */
  function postEphemeral(conv: ConversationRow, toUserId: string, fromUserId: string, text: string, meta?: Record<string, unknown>): Message {
    const message = ephemeralMessage(ids, { conversationId: conv.id, userId: fromUserId, text, meta });
    bus.emit({
      type: 'message.ephemeral', workspaceId: conv.workspace_id, conversationId: conv.id, actorId: null,
      audience: [toUserId], payload: { message },
    });
    return message;
  }

  /** Edit an app's own message text and/or blocks, then broadcast message.updated. */
  function updateAppMessage(row: MessageRow, changes: { text?: string; blocks?: unknown }): Message {
    tx(db, () => {
      if (changes.text !== undefined) {
        db.prepare('UPDATE messages SET text = ?, edited_at = ? WHERE id = ?').run(changes.text.replace(/\s+$/, ''), Date.now(), row.id);
      }
      if (changes.blocks !== undefined) {
        const meta = parseMeta(row.meta_json) ?? {};
        const norm = normalizeBlocks(changes.blocks);
        meta.blocks = norm.blocks;
        meta.actions = norm.actions;
        db.prepare('UPDATE messages SET meta_json = ? WHERE id = ?').run(JSON.stringify(meta), row.id);
      }
    });
    const fresh = messages.getRow(row.id)!;
    messages.emitUpdated(fresh, row.user_id);
    return messages.serializeOne(fresh, null);
  }

  function createReminder(workspaceId: string, userId: string, text: string, dueAt: number) {
    const id = ids.next('RM');
    db.prepare('INSERT INTO apps_reminders (id, workspace_id, user_id, text, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, workspaceId, userId, text, dueAt, Date.now());
    return { id, dueAt };
  }

  /** Deliver every reminder that is due at `now` as a DM from the Fellowship Bot. */
  function runReminders(now: number = Date.now()): number {
    const due = db.prepare(
      'SELECT * FROM apps_reminders WHERE delivered_at IS NULL AND due_at <= ? ORDER BY due_at, id',
    ).all(now) as any[];
    let delivered = 0;
    for (const r of due) {
      db.prepare('UPDATE apps_reminders SET delivered_at = ? WHERE id = ?').run(now, r.id);
      try {
        const sys = ensureSystemApp(r.workspace_id);
        const dm = core.openDm(r.workspace_id, sys.bot_user_id, [r.user_id]);
        postAsApp(sys, dm, { text: `Reminder: ${r.text}`, force: true });
      } catch (err) {
        // The user may have left the workspace; the reminder is still considered handled.
        console.error('[apps] reminder delivery failed', r.id, err);
      }
      delivered++;
    }
    return delivered;
  }

  return {
    appById, appInWorkspace, appMeta, tokenInfo, issueToken, createApp, ensureSystemApp, ensureMember,
    postAsApp, postEphemeral, updateAppMessage, createReminder, runReminders,
    /** Run reminders on a fixed tick (not in tests; tests call the tick explicitly). */
    startScheduler() {
      if (ctx.config.isTest) return;
      const timer = setInterval(() => {
        try { runReminders(); } catch (err) { console.error('[apps] scheduler', err); }
      }, 5000);
      ctx.onClose(() => clearInterval(timer));
    },
  };
}

export type AppsService = ReturnType<typeof createAppsService>;
