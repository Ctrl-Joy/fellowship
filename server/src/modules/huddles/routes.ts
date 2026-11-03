import type { FastifyInstance } from 'fastify';
import type { ModuleContext } from '../../context';
import { me } from '../../auth';
import { parse, z } from '../../validate';
import { forbidden, notFound } from '../../errors';
import type { HuddleService } from './service';

const joinBody = z.object({ muted: z.boolean().optional() }).strict();
const mediaBody = z.object({
  muted: z.boolean().optional(),
  video: z.boolean().optional(),
  screen: z.boolean().optional(),
}).strict();

export function registerHuddleRoutes(app: FastifyInstance, ctx: ModuleContext, svc: HuddleService) {
  const { access } = ctx;
  const pre = { preHandler: ctx.auth.requireUser };

  /** Join the conversation's huddle, starting one if none is active. Members only. */
  app.post<{ Params: { cid: string } }>('/api/conversations/:cid/huddle/join', pre, async (req) => {
    const user = me(req);
    const { conv } = access.requireConversationMember(req.params.cid, user.id);
    if (conv.is_archived) throw forbidden('This channel is archived');
    const body = parse(joinBody, req.body);
    const huddle = svc.join(conv.id, conv.workspace_id, user.id, body);
    return { huddle };
  });

  app.post<{ Params: { cid: string } }>('/api/conversations/:cid/huddle/leave', pre, async (req) => {
    const user = me(req);
    const conv = access.getConversation(req.params.cid);
    if (!conv || !access.workspaceMember(conv.workspace_id, user.id)) throw notFound('Conversation not found');
    const row = svc.activeRowFor(conv.id);
    const huddle = row ? svc.leave(row.id, user.id, 'left') : null;
    return { ok: true, huddle };
  });

  /** Update my media state (muted / video / screen) in the conversation's active huddle. */
  app.patch<{ Params: { cid: string } }>('/api/conversations/:cid/huddle/me', pre, async (req) => {
    const user = me(req);
    access.requireConversationMember(req.params.cid, user.id);
    const body = parse(mediaBody, req.body);
    const row = svc.activeRowFor(req.params.cid);
    if (!row) throw notFound('No active huddle');
    return { huddle: svc.setMedia(row.id, user.id, body) };
  });

  app.get<{ Params: { cid: string } }>('/api/conversations/:cid/huddle', pre, async (req) => {
    const user = me(req);
    access.requireConversationRead(req.params.cid, user.id);
    const row = svc.activeRowFor(req.params.cid);
    return { huddle: row ? svc.serialize(row) : null };
  });

  /** Active huddles in conversations I belong to. */
  app.get<{ Params: { wid: string } }>('/api/w/:wid/huddles', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceMember(req.params.wid, user.id);
    return { huddles: svc.activeInWorkspace(req.params.wid, user.id) };
  });

  app.get<{ Params: { hid: string } }>('/api/huddles/:hid', pre, async (req) => {
    const user = me(req);
    const row = svc.getRow(req.params.hid);
    if (!row) throw notFound('Huddle not found');
    access.requireConversationRead(row.conversation_id, user.id);
    return { huddle: svc.serialize(row) };
  });
}
