import type { FastifyInstance } from 'fastify';
import type { ModuleContext } from '../../context';
import { me } from '../../auth';
import { parse, z } from '../../validate';
import { badRequest, notFound } from '../../errors';
import type { MessageRow } from './messages';

const postBody = z.object({
  text: z.string().max(40000).default(''),
  clientMsgId: z.string().min(1).max(100).optional(),
  threadRootId: z.string().nullable().optional(),
  alsoSendToChannel: z.boolean().optional(),
  fileIds: z.array(z.string()).max(20).optional(),
});

const editBody = z.object({ text: z.string().max(40000) });

export function registerMessageRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const { db, auth, bus, access, messages } = ctx;
  const pre = { preHandler: auth.requireUser };

  /** Load a message and check the viewer can read its conversation. */
  function readable(mid: string, userId: string) {
    const row = messages.getRow(mid);
    if (!row) throw notFound('Message not found');
    const r = access.requireConversationRead(row.conversation_id, userId);
    return { row, ...r };
  }

  app.get<{ Params: { cid: string }; Querystring: { before?: string; limit?: string } }>(
    '/api/conversations/:cid/messages', pre, async (req) => {
      const user = me(req);
      access.requireConversationRead(req.params.cid, user.id);
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      if (!Number.isFinite(limit)) throw badRequest('limit must be a number');
      return messages.listRoots(req.params.cid, user.id, { before: req.query.before, limit });
    },
  );

  app.post<{ Params: { cid: string } }>('/api/conversations/:cid/messages', pre, async (req) => {
    const user = me(req);
    access.requireConversationMember(req.params.cid, user.id);
    const body = parse(postBody, req.body);
    const msg = messages.post({
      conversationId: req.params.cid, userId: user.id, text: body.text, clientMsgId: body.clientMsgId,
      threadRootId: body.threadRootId ?? null, alsoSendToChannel: body.alsoSendToChannel, fileIds: body.fileIds,
    });
    const { deduped, ...message } = msg;
    return { message: messages.get(message.id, user.id), deduped: !!deduped };
  });

  app.get<{ Params: { mid: string } }>('/api/messages/:mid', pre, async (req) => {
    const user = me(req);
    const { row } = readable(req.params.mid, user.id);
    return { message: messages.serializeOne(row, user.id) };
  });

  app.get<{ Params: { mid: string } }>('/api/messages/:mid/replies', pre, async (req) => {
    const user = me(req);
    let { row } = readable(req.params.mid, user.id);
    if (row.thread_root_id) row = messages.getRow(row.thread_root_id)!;
    return { root: messages.serializeOne(row, user.id), replies: messages.listReplies(row.id, user.id) };
  });

  app.patch<{ Params: { mid: string } }>('/api/messages/:mid', pre, async (req) => {
    const user = me(req);
    readable(req.params.mid, user.id);
    const body = parse(editBody, req.body);
    return { message: messages.edit(req.params.mid, user.id, body.text) };
  });

  app.delete<{ Params: { mid: string } }>('/api/messages/:mid', pre, async (req) => {
    const user = me(req);
    readable(req.params.mid, user.id);
    return { message: messages.remove(req.params.mid, user.id) };
  });

  // ---- pins ----
  app.get<{ Params: { cid: string } }>('/api/conversations/:cid/pins', pre, async (req) => {
    const user = me(req);
    access.requireConversationRead(req.params.cid, user.id);
    const rows = db.prepare(
      `SELECT m.* FROM pins p JOIN messages m ON m.id = p.message_id
       WHERE p.conversation_id = ? AND m.deleted_at IS NULL ORDER BY p.pinned_at DESC`,
    ).all(req.params.cid) as unknown as MessageRow[];
    return { messages: messages.serialize(rows, user.id) };
  });

  app.post<{ Params: { mid: string } }>('/api/messages/:mid/pin', pre, async (req) => {
    const user = me(req);
    const { row } = readable(req.params.mid, user.id);
    access.requireConversationMember(row.conversation_id, user.id);
    if (row.deleted_at) throw notFound('Message not found');
    db.prepare('INSERT OR IGNORE INTO pins (conversation_id, message_id, pinned_by, pinned_at) VALUES (?, ?, ?, ?)')
      .run(row.conversation_id, row.id, user.id, Date.now());
    messages.emitUpdated(row, user.id);
    return { message: messages.serializeOne(row, user.id) };
  });

  app.delete<{ Params: { mid: string } }>('/api/messages/:mid/pin', pre, async (req) => {
    const user = me(req);
    const { row } = readable(req.params.mid, user.id);
    access.requireConversationMember(row.conversation_id, user.id);
    db.prepare('DELETE FROM pins WHERE message_id = ?').run(row.id);
    messages.emitUpdated(row, user.id);
    return { message: messages.serializeOne(row, user.id) };
  });

  // ---- saved items (personal) ----
  app.get<{ Params: { wid: string } }>('/api/w/:wid/saved', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceMember(req.params.wid, user.id);
    const rows = db.prepare(
      `SELECT m.*, s.saved_at FROM saved_items s JOIN messages m ON m.id = s.message_id
       JOIN conversations c ON c.id = m.conversation_id
       WHERE s.user_id = ? AND c.workspace_id = ? AND m.deleted_at IS NULL ORDER BY s.saved_at DESC`,
    ).all(user.id, req.params.wid) as any[];
    const serialized = messages.serialize(rows as MessageRow[], user.id);
    return { items: serialized.map((m, i) => ({ savedAt: rows[i].saved_at, message: m })) };
  });

  function emitSaved(row: MessageRow, userId: string) {
    const conv = access.getConversation(row.conversation_id)!;
    bus.emit({
      type: 'message.updated', workspaceId: conv.workspace_id, conversationId: conv.id, actorId: userId,
      // personal: true tells clients this payload's viewer-specific fields (saved) are authoritative.
      audience: [userId], payload: { message: messages.serializeOne(row, userId), personal: true },
    });
  }

  app.post<{ Params: { mid: string } }>('/api/messages/:mid/save', pre, async (req) => {
    const user = me(req);
    const { row } = readable(req.params.mid, user.id);
    db.prepare('INSERT OR IGNORE INTO saved_items (user_id, message_id, saved_at) VALUES (?, ?, ?)').run(user.id, row.id, Date.now());
    emitSaved(row, user.id);
    return { message: messages.serializeOne(row, user.id) };
  });

  app.delete<{ Params: { mid: string } }>('/api/messages/:mid/save', pre, async (req) => {
    const user = me(req);
    const { row } = readable(req.params.mid, user.id);
    db.prepare('DELETE FROM saved_items WHERE user_id = ? AND message_id = ?').run(user.id, row.id);
    emitSaved(row, user.id);
    return { message: messages.serializeOne(row, user.id) };
  });
}
