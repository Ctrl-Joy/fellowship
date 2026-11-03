import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ModuleContext } from '../../context';
import { parse, z } from '../../validate';
import { badRequest, HttpError, notFound } from '../../errors';
import type { ConversationRow } from '../core/access';
import { loadConversations, loadConversation, publicUser } from '../core/serializers';
import { authenticateBot, requireMessageBody, type Scope } from './helpers';
import type { AppsService } from './service';
import { blocksSchema, normalizeBlocks } from './service';

/** Resolve "C…" ids or "#name" / "name" to a channel or conversation in the bot's workspace. */
function resolveConversation(ctx: ModuleContext, workspaceId: string, ref: string): ConversationRow {
  const trimmed = ref.trim();
  let row: ConversationRow | null = null;
  if (/^C[0-9A-Z]+$/.test(trimmed)) {
    row = ctx.access.getConversation(trimmed);
  } else {
    const name = trimmed.replace(/^#/, '').toLowerCase();
    row = (ctx.db.prepare("SELECT * FROM conversations WHERE workspace_id = ? AND kind = 'channel' AND name = ?")
      .get(workspaceId, name) as unknown as ConversationRow) ?? null;
  }
  if (!row || row.workspace_id !== workspaceId) throw notFound('channel_not_found');
  return row;
}

export function registerBotRoutes(app: FastifyInstance, ctx: ModuleContext, svc: AppsService) {
  const { db, access, messages, core } = ctx;

  /** Bearer auth with an optional scope check, returned to the handler. */
  const bot = (scope?: Scope) => ({
    preHandler: async (req: FastifyRequest) => {
      req.bot = authenticateBot(db, req, scope);
    },
  });

  const workspaceOf = (req: FastifyRequest) => req.bot!.app.workspace_id;

  app.get('/api/bot/auth.test', bot(), async (req) => {
    const b = req.bot!;
    return {
      ok: true,
      appId: b.app.id,
      appName: b.app.name,
      botUserId: b.botUserId,
      workspaceId: b.app.workspace_id,
      scopes: b.scopes,
    };
  });

  const postBody = z.object({
    channel: z.string().min(1).max(100),
    text: z.string().max(40000).optional(),
    threadRootId: z.string().nullable().optional(),
    alsoSendToChannel: z.boolean().optional(),
    blocks: blocksSchema.optional(),
  });

  app.post('/api/bot/chat.post', bot('chat:write'), async (req) => {
    const b = req.bot!;
    const body = parse(postBody, req.body);
    const conv = resolveConversation(ctx, workspaceOf(req), body.channel);
    if (conv.is_archived) throw new HttpError(403, 'is_archived', 'This channel is archived');
    if (!access.isConversationMember(conv.id, b.botUserId)) {
      throw new HttpError(403, 'not_in_channel', 'The bot is not a member of this channel. Call conversations.join first.');
    }
    const norm = body.blocks?.length ? normalizeBlocks(body.blocks) : null;
    const text = requireMessageBody(body.text, !!norm);
    const message = svc.postAsApp(b.app, conv, {
      text,
      threadRootId: body.threadRootId ?? null,
      alsoSendToChannel: body.alsoSendToChannel,
      blocks: norm?.blocks,
      actions: norm?.actions,
    });
    return { ok: true, channel: conv.id, ts: message.id, message };
  });

  const updateBody = z.object({
    channel: z.string().min(1).max(100),
    ts: z.string().min(1).max(64),
    text: z.string().max(40000).optional(),
    blocks: blocksSchema.optional(),
  });

  app.post('/api/bot/chat.update', bot('chat:write'), async (req) => {
    const b = req.bot!;
    const body = parse(updateBody, req.body);
    const conv = resolveConversation(ctx, workspaceOf(req), body.channel);
    const row = messages.getRow(body.ts);
    if (!row || row.conversation_id !== conv.id || row.deleted_at) throw notFound('message_not_found');
    if (row.user_id !== b.botUserId) throw new HttpError(403, 'cant_update_message', 'An app can only change its own messages');
    if (body.text === undefined && body.blocks === undefined) throw badRequest('Nothing to update');
    if (body.text !== undefined && !body.text.trim() && body.blocks === undefined) throw badRequest('text cannot be empty');
    const message = svc.updateAppMessage(row, { text: body.text, blocks: body.blocks });
    return { ok: true, channel: conv.id, ts: row.id, message };
  });

  const deleteBody = z.object({ channel: z.string().min(1).max(100), ts: z.string().min(1).max(64) });

  app.post('/api/bot/chat.delete', bot('chat:write'), async (req) => {
    const b = req.bot!;
    const body = parse(deleteBody, req.body);
    const conv = resolveConversation(ctx, workspaceOf(req), body.channel);
    const row = messages.getRow(body.ts);
    if (!row || row.conversation_id !== conv.id || row.deleted_at) throw notFound('message_not_found');
    if (row.user_id !== b.botUserId) throw new HttpError(403, 'cant_delete_message', 'An app can only delete its own messages');
    messages.remove(row.id, b.botUserId);
    return { ok: true, channel: conv.id, ts: row.id };
  });

  app.get('/api/bot/conversations.list', bot('channels:read'), async (req) => {
    const b = req.bot!;
    const channels = loadConversations(
      db, b.botUserId,
      `c.workspace_id = ? AND ((c.kind = 'channel' AND (c.is_private = 0 OR cm.user_id IS NOT NULL)) OR cm.user_id IS NOT NULL)`,
      [workspaceOf(req)],
    );
    return { ok: true, channels };
  });

  app.get<{ Querystring: { channel?: string; limit?: string; before?: string } }>(
    '/api/bot/conversations.history', bot('channels:history'), async (req) => {
      const b = req.bot!;
      const channel = req.query.channel ?? '';
      const conv = resolveConversation(ctx, workspaceOf(req), channel);
      access.requireConversationRead(conv.id, b.botUserId);
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      if (!Number.isFinite(limit)) throw badRequest('limit must be a number');
      const page = messages.listRoots(conv.id, b.botUserId, { before: req.query.before, limit });
      return { ok: true, messages: page.messages, hasMore: page.hasMore };
    },
  );

  app.post('/api/bot/conversations.join', bot('channels:join'), async (req) => {
    const b = req.bot!;
    const body = parse(z.object({ channel: z.string().min(1).max(100) }), req.body);
    const conv = resolveConversation(ctx, workspaceOf(req), body.channel);
    if (conv.kind !== 'channel') throw badRequest('Only channels can be joined', 'not_a_channel');
    if (conv.is_private) throw new HttpError(403, 'private_channel', 'This channel is private');
    if (conv.is_archived) throw new HttpError(403, 'is_archived', 'This channel is archived');
    if (!access.isConversationMember(conv.id, b.botUserId)) core.addMember(conv.id, b.botUserId, b.botUserId);
    return { ok: true, channel: loadConversation(db, b.botUserId, conv.id) };
  });

  app.get<{ Querystring: { user?: string } }>('/api/bot/users.info', bot('users:read'), async (req) => {
    const user = req.query.user ?? '';
    const row = db.prepare(
      `SELECT u.* FROM users u JOIN workspace_members wm ON wm.user_id = u.id
       WHERE u.id = ? AND wm.workspace_id = ? AND wm.deactivated = 0`,
    ).get(user, workspaceOf(req)) as any;
    if (!row) throw notFound('user_not_found');
    return { ok: true, user: publicUser(row) };
  });
}
