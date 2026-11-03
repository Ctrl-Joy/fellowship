import type { FastifyInstance } from 'fastify';
import type { ModuleContext } from '../../context';
import { me } from '../../auth';
import { parse, z } from '../../validate';
import { badRequest, conflict, HttpError, notFound } from '../../errors';
import { randomToken } from '../../ids';
import { ALL_SCOPES, appDto, isHttpUrl, parseEventTypes, type AppRow } from './helpers';
import type { AppsService } from './service';
import type { EventDeliveries } from './events';
import { EVENT_TYPES } from './events';
import { BUILTIN_COMMANDS } from './commands';

const scopeEnum = z.enum(ALL_SCOPES);
const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  iconEmoji: z.string().max(16).optional(),
  scopes: z.array(scopeEnum).min(1).optional(),
});
const patchBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  iconEmoji: z.string().max(16).optional(),
});
const tokenBody = z.object({ scopes: z.array(scopeEnum).min(1).optional() });
const webhookBody = z.object({ conversationId: z.string().min(1) });
const commandBody = z.object({
  command: z.string().trim().min(1).max(40),
  url: z.string().trim().max(2000),
  description: z.string().max(200).optional(),
  usageHint: z.string().max(200).optional(),
});
const eventsBody = z.object({
  url: z.string().trim().max(2000).nullable(),
  eventTypes: z.array(z.enum(EVENT_TYPES)).max(EVENT_TYPES.length),
});
const interactivityBody = z.object({ url: z.string().trim().max(2000).nullable() });

export const COMMAND_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;

export function registerManagementRoutes(
  app: FastifyInstance, ctx: ModuleContext, svc: AppsService, deliveries: EventDeliveries,
) {
  const { db, auth, access, ids } = ctx;
  const pre = { preHandler: auth.requireUser };

  function loadApp(workspaceId: string, appId: string): AppRow {
    const row = svc.appInWorkspace(workspaceId, appId);
    if (!row) throw notFound('App not found');
    return row;
  }

  function webhooksFor(appId: string) {
    const rows = db.prepare(
      `SELECT w.*, c.name AS channel_name, c.kind AS channel_kind FROM apps_webhooks w
       JOIN conversations c ON c.id = w.conversation_id WHERE w.app_id = ? ORDER BY w.created_at`,
    ).all(appId) as any[];
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      channelName: r.channel_name,
      channelKind: r.channel_kind,
      path: `/api/hooks/incoming/${r.secret}`,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
    }));
  }

  function commandsFor(appId: string) {
    return (db.prepare('SELECT * FROM apps_commands WHERE app_id = ? ORDER BY command').all(appId) as any[]).map((r) => ({
      id: r.id, command: r.command, url: r.url, description: r.description, usageHint: r.usage_hint, createdAt: r.created_at,
    }));
  }

  function eventsView(row: AppRow) {
    return {
      url: row.events_url,
      eventTypes: parseEventTypes(row.event_types),
      deliveries: deliveries.recent(row.id, 25),
    };
  }

  function detail(row: AppRow, viewerIsAdmin: boolean) {
    const base = {
      ...appDto(row),
      tokenInfo: svc.tokenInfo(row.id),
    };
    if (!viewerIsAdmin) return base;
    return {
      ...base,
      signingSecret: row.signing_secret,
      interactivityUrl: row.interactivity_url,
      events: eventsView(row),
      webhooks: webhooksFor(row.id),
      commands: commandsFor(row.id),
    };
  }

  // ---- directory and CRUD ----

  app.get<{ Params: { wid: string } }>('/api/w/:wid/apps', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceMember(req.params.wid, user.id);
    svc.ensureSystemApp(req.params.wid);
    const rows = db.prepare('SELECT * FROM apps WHERE workspace_id = ? ORDER BY is_system DESC, name COLLATE NOCASE')
      .all(req.params.wid) as unknown as AppRow[];
    return { apps: rows.map((r) => ({ ...appDto(r), hasToken: !!svc.tokenInfo(r.id) })) };
  });

  app.post<{ Params: { wid: string } }>('/api/w/:wid/apps', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceAdmin(req.params.wid, user.id);
    const body = parse(createBody, req.body);
    const created = svc.createApp(req.params.wid, user.id, body);
    return {
      app: detail(created.app, true),
      // The plaintext token is returned exactly once; only its hash is stored.
      token: { value: created.token, scopes: created.scopes },
    };
  });

  app.get<{ Params: { wid: string; aid: string } }>('/api/w/:wid/apps/:aid', pre, async (req) => {
    const user = me(req);
    const m = access.requireWorkspaceMember(req.params.wid, user.id);
    const row = loadApp(req.params.wid, req.params.aid);
    const isAdmin = m.role === 'owner' || m.role === 'admin';
    if (!isAdmin) throw new HttpError(403, 'admins_only', 'Only workspace admins can view app settings');
    return { app: detail(row, true) };
  });

  app.patch<{ Params: { wid: string; aid: string } }>('/api/w/:wid/apps/:aid', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceAdmin(req.params.wid, user.id);
    const row = loadApp(req.params.wid, req.params.aid);
    const body = parse(patchBody, req.body);
    const name = body.name ?? row.name;
    db.prepare('UPDATE apps SET name = ?, description = ?, icon_emoji = ? WHERE id = ?').run(
      name, body.description ?? row.description, body.iconEmoji ?? row.icon_emoji, row.id,
    );
    db.prepare('UPDATE users SET full_name = ?, display_name = ? WHERE id = ?').run(name, name, row.bot_user_id);
    return { app: detail(svc.appById(row.id)!, true) };
  });

  app.delete<{ Params: { wid: string; aid: string } }>('/api/w/:wid/apps/:aid', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceAdmin(req.params.wid, user.id);
    const row = loadApp(req.params.wid, req.params.aid);
    if (row.is_system) throw new HttpError(403, 'system_app', 'The built-in Fellowship Bot cannot be removed');
    db.prepare('DELETE FROM apps WHERE id = ?').run(row.id);
    // The bot's history stays in channels; the bot account just stops being an active member.
    db.prepare('UPDATE workspace_members SET deactivated = 1 WHERE workspace_id = ? AND user_id = ?').run(req.params.wid, row.bot_user_id);
    return { ok: true };
  });

  // ---- token ----

  app.post<{ Params: { wid: string; aid: string } }>('/api/w/:wid/apps/:aid/token', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceAdmin(req.params.wid, user.id);
    const row = loadApp(req.params.wid, req.params.aid);
    const body = parse(tokenBody, req.body ?? {});
    const scopes = body.scopes?.length ? [...new Set(body.scopes)] : [...ALL_SCOPES];
    // Rotating revokes the previous token immediately.
    const token = svc.issueToken(row.id, scopes);
    return { token: { value: token, scopes }, app: detail(row, true) };
  });

  // ---- incoming webhooks ----

  app.post<{ Params: { wid: string; aid: string } }>('/api/w/:wid/apps/:aid/webhooks', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceAdmin(req.params.wid, user.id);
    const row = loadApp(req.params.wid, req.params.aid);
    const body = parse(webhookBody, req.body);
    const conv = access.getConversation(body.conversationId);
    if (!conv || conv.workspace_id !== req.params.wid) throw notFound('Channel not found');
    if (conv.is_archived) throw new HttpError(403, 'archived', 'This channel is archived');
    if (conv.kind !== 'channel' && conv.kind !== 'dm' && conv.kind !== 'group_dm') throw badRequest('Choose a channel');
    svc.ensureMember(conv, row.bot_user_id);
    const secret = randomToken(24);
    const id = ids.next('IW');
    db.prepare(
      'INSERT INTO apps_webhooks (id, app_id, workspace_id, conversation_id, secret, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, row.id, req.params.wid, conv.id, secret, user.id, Date.now());
    const hook = webhooksFor(row.id).find((h) => h.id === id)!;
    return { webhook: hook };
  });

  app.delete<{ Params: { wid: string; aid: string; hid: string } }>('/api/w/:wid/apps/:aid/webhooks/:hid', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceAdmin(req.params.wid, user.id);
    const row = loadApp(req.params.wid, req.params.aid);
    const r = db.prepare('DELETE FROM apps_webhooks WHERE id = ? AND app_id = ?').run(req.params.hid, row.id);
    if (!r.changes) throw notFound('Webhook not found');
    return { ok: true };
  });

  // ---- slash commands ----

  app.post<{ Params: { wid: string; aid: string } }>('/api/w/:wid/apps/:aid/commands', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceAdmin(req.params.wid, user.id);
    const row = loadApp(req.params.wid, req.params.aid);
    const body = parse(commandBody, req.body);
    const name = body.command.replace(/^\//, '').toLowerCase();
    if (!COMMAND_NAME_RE.test(name)) throw badRequest('Command names use lowercase letters, numbers, - and _ (max 32)', 'invalid_command');
    if ((BUILTIN_COMMANDS as readonly string[]).includes(name)) throw conflict(`/${name} is a built-in command`, 'command_taken');
    if (!isHttpUrl(body.url)) throw badRequest('The request URL must be http or https', 'invalid_url');
    const id = ids.next('SC');
    try {
      db.prepare(
        `INSERT INTO apps_commands (id, app_id, workspace_id, command, url, description, usage_hint, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, row.id, req.params.wid, name, body.url, body.description ?? '', body.usageHint ?? '', Date.now());
    } catch {
      throw conflict(`/${name} is already registered in this workspace`, 'command_taken');
    }
    return { command: commandsFor(row.id).find((c) => c.id === id) };
  });

  app.delete<{ Params: { wid: string; aid: string; cid: string } }>('/api/w/:wid/apps/:aid/commands/:cid', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceAdmin(req.params.wid, user.id);
    const row = loadApp(req.params.wid, req.params.aid);
    const r = db.prepare('DELETE FROM apps_commands WHERE id = ? AND app_id = ?').run(req.params.cid, row.id);
    if (!r.changes) throw notFound('Command not found');
    return { ok: true };
  });

  // ---- event subscriptions ----

  app.put<{ Params: { wid: string; aid: string } }>('/api/w/:wid/apps/:aid/events', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceAdmin(req.params.wid, user.id);
    const row = loadApp(req.params.wid, req.params.aid);
    const body = parse(eventsBody, req.body);
    if (body.url && !isHttpUrl(body.url)) throw badRequest('The events URL must be http or https', 'invalid_url');
    const url = body.url || null;
    const types = url ? [...new Set(body.eventTypes)] : [];
    db.prepare('UPDATE apps SET events_url = ?, event_types = ? WHERE id = ?').run(url, JSON.stringify(types), row.id);
    return { events: eventsView(svc.appById(row.id)!) };
  });

  app.post<{ Params: { wid: string; aid: string } }>('/api/w/:wid/apps/:aid/events/test', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceAdmin(req.params.wid, user.id);
    const row = loadApp(req.params.wid, req.params.aid);
    if (!row.events_url) throw badRequest('Set an events URL first', 'no_events_url');
    const deliveryId = deliveries.enqueueTest(svc.appById(row.id)!);
    return { deliveryId };
  });

  // ---- interactivity ----

  app.put<{ Params: { wid: string; aid: string } }>('/api/w/:wid/apps/:aid/interactivity', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceAdmin(req.params.wid, user.id);
    const row = loadApp(req.params.wid, req.params.aid);
    const body = parse(interactivityBody, req.body);
    if (body.url && !isHttpUrl(body.url)) throw badRequest('The interactivity URL must be http or https', 'invalid_url');
    db.prepare('UPDATE apps SET interactivity_url = ? WHERE id = ?').run(body.url || null, row.id);
    return { app: detail(svc.appById(row.id)!, true) };
  });
}
