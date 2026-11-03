import type { FastifyInstance } from 'fastify';
import type { ModuleContext } from '../../context';
import { parse, z } from '../../validate';
import { HttpError, notFound } from '../../errors';
import type { AppRow } from './helpers';
import type { AppsService } from './service';
import { blocksSchema, normalizeBlocks } from './service';
import type { CommandRunner } from './commands';

const BUCKET_CAPACITY = 10;
const REFILL_PER_SECOND = 1;

/** Token bucket per webhook: burst of 10, then 1 request per second. */
export function createRateLimiter(capacity = BUCKET_CAPACITY, refillPerSecond = REFILL_PER_SECOND) {
  const buckets = new Map<string, { tokens: number; last: number }>();
  return {
    /** Returns 0 when allowed, otherwise the number of seconds to wait. */
    take(key: string, now = Date.now()): number {
      const b = buckets.get(key) ?? { tokens: capacity, last: now };
      b.tokens = Math.min(capacity, b.tokens + ((now - b.last) / 1000) * refillPerSecond);
      b.last = now;
      if (b.tokens < 1) {
        buckets.set(key, b);
        return Math.ceil((1 - b.tokens) / refillPerSecond);
      }
      b.tokens -= 1;
      buckets.set(key, b);
      return 0;
    },
  };
}

const incomingBody = z.object({
  text: z.string().max(40000).optional(),
  username: z.string().trim().max(80).optional(),
  icon_emoji: z.string().max(16).optional(),
  blocks: blocksSchema.optional(),
});

const responseBody = z.object({
  text: z.string().max(40000).optional(),
  response_type: z.enum(['in_channel', 'ephemeral']).optional(),
  replace_original: z.boolean().optional(),
});

export function registerHookRoutes(app: FastifyInstance, ctx: ModuleContext, svc: AppsService, runner: CommandRunner) {
  const { db } = ctx;
  const limiter = createRateLimiter();

  // Incoming webhook: POST /api/hooks/incoming/:secret {text, username?, icon_emoji?, blocks?}
  app.post<{ Params: { secret: string } }>('/api/hooks/incoming/:secret', async (req, reply) => {
    const hook = db.prepare(
      `SELECT w.id AS hook_id, w.secret, w.conversation_id, a.* FROM apps_webhooks w JOIN apps a ON a.id = w.app_id
       WHERE w.secret = ?`,
    ).get(req.params.secret) as any;
    if (!hook) throw notFound('Unknown webhook URL');
    const wait = limiter.take(hook.secret);
    if (wait > 0) {
      reply.header('retry-after', String(wait));
      throw new HttpError(429, 'rate_limited', 'Too many requests, slow down');
    }
    const body = parse(incomingBody, req.body);
    const text = (body.text ?? '').replace(/\s+$/, '');
    if (!text.trim() && !body.blocks?.length) throw new HttpError(400, 'bad_request', 'text or blocks is required');
    const app0 = hook as AppRow;
    const conv = ctx.access.getConversation(hook.conversation_id);
    if (!conv) throw notFound('Channel not found');
    svc.ensureMember(conv, app0.bot_user_id);
    const norm = body.blocks?.length ? normalizeBlocks(body.blocks) : null;
    const override: Record<string, string> = {};
    if (body.username) override.username = body.username;
    if (body.icon_emoji) override.iconEmoji = body.icon_emoji;
    const message = svc.postAsApp(app0, conv, {
      text,
      blocks: norm?.blocks,
      actions: norm?.actions,
      meta: Object.keys(override).length ? { override } : undefined,
    });
    db.prepare('UPDATE apps_webhooks SET last_used_at = ? WHERE id = ?').run(Date.now(), hook.hook_id);
    return { ok: true, message };
  });

  // Response URL handed to slash-command apps: POST /api/hooks/response/:token.
  app.post<{ Params: { token: string } }>('/api/hooks/response/:token', async (req) => {
    const body = parse(responseBody, req.body);
    const result = runner.respond(req.params.token, body);
    if (!result) throw notFound('This response URL has expired or was already used up');
    return result;
  });
}
