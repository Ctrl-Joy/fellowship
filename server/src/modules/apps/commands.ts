import type { FastifyInstance } from 'fastify';
import type { ModuleContext } from '../../context';
import { me } from '../../auth';
import { parse, z } from '../../validate';
import { badRequest, HttpError } from '../../errors';
import { randomToken } from '../../ids';
import type { ConversationRow } from '../core/access';
import { DEFAULT_CHANNELS, loadConversation } from '../core/serializers';
import { OUTBOUND_TIMEOUT_MS, type AppRow, resolveUserRef, signedHeaders } from './helpers';
import type { AppsService } from './service';

export const BUILTIN_COMMANDS = ['me', 'shrug', 'topic', 'invite', 'leave', 'remind', 'poll'] as const;

export const BUILTIN_DESCRIPTORS = [
  { command: 'me', usage: '/me <action>', description: 'Post an action in italics' },
  { command: 'shrug', usage: '/shrug [message]', description: 'Add a shrug to your message' },
  { command: 'topic', usage: '/topic <text>', description: 'Set this channel’s topic' },
  { command: 'invite', usage: '/invite @person [@person …]', description: 'Add people to this channel' },
  { command: 'leave', usage: '/leave', description: 'Leave this channel' },
  { command: 'remind', usage: '/remind me <text> in <N> minutes|hours', description: 'Get a reminder DM later' },
  { command: 'poll', usage: '/poll "Question" "Option A" "Option B" …', description: 'Start a poll with live votes' },
];

const MAX_REMINDER_MINUTES = 60 * 24 * 30;
const RESPONSE_TOKEN_TTL_MS = 30 * 60 * 1000;
const RESPONSE_TOKEN_USES = 5;

const commandBody = z.object({
  command: z.string().trim().min(1).max(64),
  text: z.string().max(2000).optional(),
});

export interface CommandRunner {
  execute(args: {
    user: { id: string; displayName: string };
    conv: ConversationRow;
    name: string;
    text: string;
    baseUrl: string;
  }): Promise<{ kind: 'builtin' | 'app'; responseType?: 'in_channel' | 'ephemeral' }>;
  /** Used by the response_url route: post a follow-up for an earlier command. */
  respond(token: string, reply: { text?: string; response_type?: string; replace_original?: boolean }): { ok: true } | null;
  /** Lookup used by GET /api/w/:wid/commands. */
  listCustom(workspaceId: string): any[];
}

export function createCommandRunner(ctx: ModuleContext, svc: AppsService): CommandRunner {
  const { messages, access } = ctx;
  const responseTokens = new Map<string, { app: AppRow; conv: ConversationRow; userId: string; expires: number; uses: number }>();

  function systemBotId(workspaceId: string) {
    return svc.ensureSystemApp(workspaceId).bot_user_id;
  }

  function usage(conv: ConversationRow, userId: string, text: string) {
    return svc.postEphemeral(conv, userId, systemBotId(conv.workspace_id), text);
  }

  /** Built-ins. Each returns void; errors become ephemeral messages to the invoker. */
  const builtins: Record<string, (c: { conv: ConversationRow; user: { id: string; displayName: string }; text: string }) => void> = {
    me({ conv, user, text }) {
      if (!text.trim()) return void usage(conv, user.id, 'Usage: /me <action>');
      messages.post({ conversationId: conv.id, userId: user.id, text: `_${user.displayName} ${text.trim()}_` });
    },

    shrug({ conv, user, text }) {
      const prefix = text.trim() ? `${text.trim()} ` : '';
      messages.post({ conversationId: conv.id, userId: user.id, text: `${prefix}¯\\_(ツ)_/¯` });
    },

    topic({ conv, user, text }) {
      if (conv.kind !== 'channel') return void usage(conv, user.id, 'Topics can only be set in channels.');
      const topic = text.trim();
      if (!topic) return void usage(conv, user.id, 'Usage: /topic <text>');
      if (topic.length > 250) return void usage(conv, user.id, 'Topics can be at most 250 characters.');
      ctx.db.prepare('UPDATE conversations SET topic = ? WHERE id = ?').run(topic, conv.id);
      ctx.bus.emit({
        type: 'conversation.updated', workspaceId: conv.workspace_id, conversationId: conv.id, actorId: user.id,
        payload: { conversation: loadConversation(ctx.db, user.id, conv.id, true) },
      });
      usage(conv, user.id, `Topic set to “${topic}”.`);
    },

    invite({ conv, user, text }) {
      if (conv.kind !== 'channel') return void usage(conv, user.id, '/invite works in channels only.');
      if (conv.is_archived) return void usage(conv, user.id, 'This channel is archived.');
      const refs = [...text.matchAll(/<@[A-Za-z0-9_]+>|@?[^\s]+/g)].map((m) => m[0]).filter(Boolean);
      if (!refs.length) return void usage(conv, user.id, 'Usage: /invite @person [@person …]');
      const names: string[] = [];
      const missing: string[] = [];
      for (const ref of refs) {
        const found = resolveUserRef(ctx.db, conv.workspace_id, ref);
        if (!found) { missing.push(ref); continue; }
        if (!access.isConversationMember(conv.id, found.id)) ctx.core.addMember(conv.id, found.id, user.id);
        names.push(found.fullName);
      }
      const parts: string[] = [];
      if (names.length) parts.push(`Invited ${names.join(', ')}.`);
      if (missing.length) parts.push(`Could not find ${missing.join(', ')}.`);
      usage(conv, user.id, parts.join(' '));
    },

    leave({ conv, user }) {
      if (conv.kind !== 'channel') return void usage(conv, user.id, '/leave works in channels only.');
      if (DEFAULT_CHANNELS.includes(conv.name ?? '')) return void usage(conv, user.id, 'Everyone stays in the default channel.');
      const r = ctx.db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(conv.id, user.id);
      if (r.changes) {
        ctx.bus.emit({
          type: 'member.left', workspaceId: conv.workspace_id, conversationId: conv.id, actorId: user.id,
          payload: { conversationId: conv.id, userId: user.id },
        });
      }
    },

    remind({ conv, user, text }) {
      const m = /^me\s+(.+?)\s+in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|h|m)$/i.exec(text.trim());
      if (!m) return void usage(conv, user.id, 'Usage: /remind me <text> in <N> minutes|hours');
      const n = Number(m[2]);
      const perHour = /^h|hour|hr/i.test(m[3]);
      const minutes = perHour ? n * 60 : n;
      if (!n || minutes > MAX_REMINDER_MINUTES) return void usage(conv, user.id, 'Reminders can be set up to 30 days ahead.');
      const due = Date.now() + minutes * 60_000;
      svc.createReminder(conv.workspace_id, user.id, m[1].trim(), due);
      usage(conv, user.id, `Okay, I will remind you “${m[1].trim()}” in ${n} ${perHour ? (n === 1 ? 'hour' : 'hours') : (n === 1 ? 'minute' : 'minutes')}.`);
    },

    poll({ conv, user, text }) {
      const parts = [...text.matchAll(/"([^"]*)"/g)].map((m) => m[1].trim()).filter(Boolean);
      if (parts.length < 3 || parts.length > 11) {
        return void usage(conv, user.id, 'Usage: /poll "Question" "Option A" "Option B" (2 to 10 options)');
      }
      const [question, ...labels] = parts;
      const options = labels.map((label, i) => ({ id: `o${i + 1}`, text: label }));
      messages.post({
        conversationId: conv.id, userId: user.id, text: question, subtype: 'poll',
        meta: { poll: { question, options, createdBy: user.id } },
      });
    },
  };

  /** Post an app's reply to the channel or as an ephemeral message to the invoker. */
  function deliverReply(app: AppRow, conv: ConversationRow, userId: string, reply: any, command: string): void {
    const text = typeof reply?.text === 'string' ? reply.text.trim() : '';
    if (!text) return;
    if (reply.response_type === 'in_channel') {
      svc.ensureMember(conv, app.bot_user_id);
      svc.postAsApp(app, conv, { text, meta: { command: `/${command}`, invokedBy: userId } });
    } else {
      svc.postEphemeral(conv, userId, app.bot_user_id, text, { app: svc.appMeta(app) });
    }
  }

  async function runCustom(
    app: AppRow, cmdUrl: string, command: string, args: { user: { id: string; displayName: string }; conv: ConversationRow; text: string; baseUrl: string },
  ): Promise<'in_channel' | 'ephemeral'> {
    const token = randomToken(18);
    responseTokens.set(token, {
      app, conv: args.conv, userId: args.user.id, expires: Date.now() + RESPONSE_TOKEN_TTL_MS, uses: 0,
    });
    const form = new URLSearchParams({
      command: `/${command}`,
      text: args.text,
      user_id: args.user.id,
      user_name: args.user.displayName,
      team_id: args.conv.workspace_id,
      channel_id: args.conv.id,
      channel_name: args.conv.name ?? '',
      response_url: `${args.baseUrl}/api/hooks/response/${token}`,
    });
    const body = form.toString();
    let reply: any = null;
    try {
      const res = await fetch(cmdUrl, {
        method: 'POST',
        headers: signedHeaders(app.signing_secret, body, 'application/x-www-form-urlencoded'),
        body,
        signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
      });
      const raw = await res.text();
      if (!res.ok) {
        svc.postEphemeral(args.conv, args.user.id, app.bot_user_id, `${app.name} returned an error for /${command} (HTTP ${res.status}).`);
        return 'ephemeral';
      }
      try { reply = JSON.parse(raw); } catch { reply = { text: raw, response_type: 'ephemeral' }; }
    } catch {
      svc.postEphemeral(args.conv, args.user.id, app.bot_user_id, `${app.name} did not respond to /${command} in time.`);
      return 'ephemeral';
    }
    const responseType = reply?.response_type === 'in_channel' ? 'in_channel' : 'ephemeral';
    deliverReply(app, args.conv, args.user.id, { ...reply, response_type: responseType }, command);
    return responseType;
  }

  return {
    async execute({ user, conv, name, text, baseUrl }) {
      if ((BUILTIN_COMMANDS as readonly string[]).includes(name)) {
        builtins[name]({ conv, user, text });
        return { kind: 'builtin' };
      }
      const cmd = ctx.db.prepare(
        `SELECT c.url, c.command, a.* FROM apps_commands c JOIN apps a ON a.id = c.app_id
         WHERE c.workspace_id = ? AND c.command = ?`,
      ).get(conv.workspace_id, name) as any;
      if (!cmd) throw new HttpError(404, 'unknown_command', `Unknown command /${name}`);
      const responseType = await runCustom(cmd as AppRow, cmd.url, name, { user, conv, text, baseUrl });
      return { kind: 'app', responseType };
    },

    respond(token, reply) {
      const entry = responseTokens.get(token);
      if (!entry || entry.expires < Date.now() || entry.uses >= RESPONSE_TOKEN_USES) return null;
      entry.uses++;
      const type = reply.response_type === 'in_channel' ? 'in_channel' : 'ephemeral';
      const text = typeof reply.text === 'string' ? reply.text.trim() : '';
      if (text) {
        if (type === 'in_channel') {
          svc.ensureMember(entry.conv, entry.app.bot_user_id);
          svc.postAsApp(entry.app, entry.conv, { text });
        } else {
          svc.postEphemeral(entry.conv, entry.userId, entry.app.bot_user_id, text, { app: svc.appMeta(entry.app) });
        }
      }
      return { ok: true };
    },

    listCustom(workspaceId) {
      return ctx.db.prepare(
        `SELECT c.command, c.description, c.usage_hint, a.id AS app_id, a.name AS app_name, a.icon_emoji
         FROM apps_commands c JOIN apps a ON a.id = c.app_id WHERE c.workspace_id = ? ORDER BY c.command`,
      ).all(workspaceId).map((r: any) => ({
        command: r.command,
        description: r.description,
        usage: r.usage_hint || `/${r.command}`,
        builtin: false,
        appId: r.app_id,
        appName: r.app_name,
        iconEmoji: r.icon_emoji,
      }));
    },
  };
}

export function registerCommandRoutes(app: FastifyInstance, ctx: ModuleContext, svc: AppsService, runner: CommandRunner) {
  const { auth, access } = ctx;
  const pre = { preHandler: auth.requireUser };

  app.get<{ Params: { wid: string } }>('/api/w/:wid/commands', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceMember(req.params.wid, user.id);
    const builtins = BUILTIN_DESCRIPTORS.map((b) => ({ ...b, builtin: true, appId: null, appName: null, iconEmoji: null }));
    return { commands: [...builtins, ...runner.listCustom(req.params.wid)] };
  });

  app.post<{ Params: { cid: string } }>('/api/conversations/:cid/commands', pre, async (req) => {
    const user = me(req);
    const { conv } = access.requireConversationMember(req.params.cid, user.id);
    const body = parse(commandBody, req.body);
    const name = body.command.replace(/^\//, '').trim().toLowerCase();
    if (!name) throw badRequest('Command is required');
    const baseUrl = `${req.protocol}://${req.headers.host ?? `localhost:${ctx.config.port}`}`;
    const person = { id: user.id, displayName: user.display_name || user.full_name };
    const result = await runner.execute({ user: person, conv, name, text: (body.text ?? '').trim(), baseUrl });
    return { ok: true, ...result };
  });
}
