import type { FastifyInstance } from 'fastify';
import type { ModuleContext } from '../../context';
import { me } from '../../auth';
import { parse, z } from '../../validate';
import { badRequest, conflict, notFound, HttpError } from '../../errors';
import type { MessageRow, Enricher } from '../core/messages';
import { OUTBOUND_TIMEOUT_MS, signedHeaders } from './helpers';
import { parseMeta, type AppsService } from './service';

interface PollMeta {
  poll: { question: string; options: { id: string; text: string }[]; createdBy: string };
}

/**
 * Live poll state: voter lists per option, so every viewer (including WebSocket broadcasts,
 * which are serialized without a viewer) can derive counts and their own vote on the client.
 */
export function pollEnricher(db: ModuleContext['db']): Enricher {
  return (messages) => {
    const polls = messages.filter((m) => m.meta?.poll && Array.isArray(m.meta.poll.options));
    if (!polls.length) return;
    const ids = polls.map((m) => m.id);
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT message_id, option_id, user_id FROM apps_poll_votes WHERE message_id IN (${placeholders}) ORDER BY voted_at`,
    ).all(...ids) as any[];
    const voters = new Map<string, Record<string, string[]>>();
    for (const id of ids) voters.set(id, {});
    for (const r of rows) {
      const byOption = voters.get(r.message_id)!;
      (byOption[r.option_id] ??= []).push(r.user_id);
    }
    for (const m of polls) {
      const byOption = voters.get(m.id)!;
      const counts: Record<string, number> = {};
      let total = 0;
      for (const [opt, list] of Object.entries(byOption)) { counts[opt] = list.length; total += list.length; }
      m.meta = { ...m.meta, poll: { ...m.meta.poll, voters: byOption, counts, totalVotes: total } };
    }
  };
}

export function registerInteractiveRoutes(app: FastifyInstance, ctx: ModuleContext, svc: AppsService) {
  const { db, auth, access, messages } = ctx;
  const pre = { preHandler: auth.requireUser };

  messages.addEnricher(pollEnricher(db));

  // Vote in a poll (one vote per user; voting again changes it).
  app.post<{ Params: { mid: string } }>('/api/apps/polls/:mid/vote', pre, async (req) => {
    const user = me(req);
    const row = messages.getRow(req.params.mid);
    if (!row || row.deleted_at) throw notFound('Message not found');
    access.requireConversationMember(row.conversation_id, user.id);
    const meta = parseMeta(row.meta_json) as PollMeta | null;
    if (!meta?.poll) throw badRequest('This message is not a poll', 'not_a_poll');
    const body = parse(z.object({ optionId: z.string().min(1).max(40) }), req.body);
    if (!meta.poll.options.some((o) => o.id === body.optionId)) throw badRequest('Unknown poll option', 'bad_option');
    db.prepare(
      `INSERT INTO apps_poll_votes (message_id, user_id, option_id, voted_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(message_id, user_id) DO UPDATE SET option_id = excluded.option_id, voted_at = excluded.voted_at`,
    ).run(row.id, user.id, body.optionId, Date.now());
    messages.emitUpdated(row, user.id);
    return { message: messages.serializeOne(row, user.id) };
  });

  // Click an interactive button on an app message. The app may answer with replace_original.
  app.post<{ Params: { mid: string } }>('/api/messages/:mid/actions', pre, async (req) => {
    const user = me(req);
    const row = messages.getRow(req.params.mid);
    if (!row || row.deleted_at) throw notFound('Message not found');
    const conv = access.requireConversationMember(row.conversation_id, user.id).conv;
    const body = parse(z.object({ actionId: z.string().min(1).max(100), value: z.string().max(2000).optional() }), req.body);
    const meta = parseMeta(row.meta_json);
    const action = (meta?.actions ?? []).find((a: any) => a.actionId === body.actionId);
    if (!action) throw badRequest('Unknown action for this message', 'bad_action');
    const appRow = meta?.app?.id ? svc.appById(meta.app.id) : null;
    if (!appRow) throw notFound('App not found');
    if (!appRow.interactivity_url) throw conflict('This app has no interactivity URL', 'no_interactivity_url');

    const payload = JSON.stringify({
      type: 'block_actions',
      team: { id: conv.workspace_id },
      user: { id: user.id, name: user.display_name || user.full_name },
      channel: { id: conv.id, name: conv.name },
      message: { id: row.id, ts: row.id, text: row.text, threadRootId: row.thread_root_id },
      actions: [{ actionId: action.actionId, text: action.text, value: body.value ?? action.value, type: 'button' }],
    });
    let reply: any = null;
    try {
      const res = await fetch(appRow.interactivity_url, {
        method: 'POST',
        headers: signedHeaders(appRow.signing_secret, payload, 'application/json'),
        body: payload,
        signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
      });
      if (!res.ok) throw new HttpError(502, 'app_error', `The app answered HTTP ${res.status}`);
      const raw = await res.text();
      try { reply = raw ? JSON.parse(raw) : null; } catch { reply = null; }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, 'app_unreachable', 'The app did not respond in time');
    }

    if (reply && typeof reply === 'object') {
      const isOwn = row.user_id === appRow.bot_user_id;
      if (reply.replace_original === true && isOwn) {
        const changes: { text?: string; blocks?: unknown } = {};
        if (typeof reply.text === 'string') changes.text = reply.text;
        if (Array.isArray(reply.blocks)) changes.blocks = reply.blocks;
        if (Object.keys(changes).length) svc.updateAppMessage(row as MessageRow, changes);
      }
      if (typeof reply.ephemeral_text === 'string' && reply.ephemeral_text.trim()) {
        svc.postEphemeral(conv, user.id, appRow.bot_user_id, reply.ephemeral_text.trim(), { app: svc.appMeta(appRow) });
      }
    }
    return { ok: true };
  });
}
