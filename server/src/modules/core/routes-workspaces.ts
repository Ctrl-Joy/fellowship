import type { FastifyInstance } from 'fastify';
import type { ModuleContext } from '../../context';
import { me } from '../../auth';
import { randomToken } from '../../ids';
import { parse, z } from '../../validate';
import { forbidden, notFound } from '../../errors';
import { tx } from '../../db';
import { publicUser, publicWorkspace } from './serializers';
import type { ConversationHelpers } from './routes-conversations';

const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  iconUrl: z.string().max(2000).nullable().optional(),
});

const patchBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  iconUrl: z.string().max(2000).nullable().optional(),
});

const roleBody = z.object({
  role: z.enum(['admin', 'member', 'guest']).optional(),
  deactivated: z.boolean().optional(),
});

function slugify(name: string) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'workspace';
}

export function registerWorkspaceRoutes(app: FastifyInstance, ctx: ModuleContext, conv: ConversationHelpers) {
  const { db, auth, bus, ids, access } = ctx;
  const pre = { preHandler: auth.requireUser };

  function uniqueSlug(name: string) {
    const base = slugify(name);
    let slug = base;
    for (let i = 2; db.prepare('SELECT 1 FROM workspaces WHERE slug = ?').get(slug); i++) slug = `${base}-${i}`;
    return slug;
  }

  function getWorkspace(id: string) {
    return db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as any;
  }

  /** Create a workspace owned by userId, with #general and #random. */
  function createWorkspace(userId: string, name: string, iconUrl: string | null = null) {
    const id = ids.next('W');
    const now = Date.now();
    tx(db, () => {
      db.prepare(
        'INSERT INTO workspaces (id, name, slug, icon_url, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, name, uniqueSlug(name), iconUrl, randomToken(9), userId, now);
      db.prepare(
        "INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
      ).run(id, userId, now);
      conv.createChannel(id, userId, {
        name: 'general', description: 'The whole team, together. Announcements and anything everyone should see.',
      });
      conv.createChannel(id, userId, {
        name: 'random', description: 'Off-topic chatter, links and good news.',
      });
    });
    return getWorkspace(id);
  }

  /** Add a user to a workspace (and its default channels). Idempotent. */
  function joinWorkspace(workspaceId: string, userId: string, role: 'member' | 'admin' | 'guest' = 'member') {
    const existing = db.prepare('SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId) as any;
    if (existing) {
      if (existing.deactivated) throw forbidden('Your account in this workspace has been deactivated');
      return false;
    }
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
      .run(workspaceId, userId, role, Date.now());
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
    bus.emit({
      type: 'workspace.member_joined', workspaceId, actorId: userId,
      payload: { workspaceId, member: { ...publicUser(user), role, joinedAt: Date.now(), deactivated: false } },
    });
    const defaults = db.prepare(
      "SELECT id FROM conversations WHERE workspace_id = ? AND kind = 'channel' AND name IN ('general','random') AND is_archived = 0",
    ).all(workspaceId) as any[];
    for (const c of defaults) conv.addMember(c.id, userId, userId);
    return true;
  }

  app.get('/api/workspaces', pre, async (req) => {
    const user = me(req);
    const rows = db.prepare(
      `SELECT w.*, wm.role FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = ? AND wm.deactivated = 0 ORDER BY wm.joined_at`,
    ).all(user.id) as any[];
    return { workspaces: rows.map((r) => publicWorkspace(r)) };
  });

  app.post('/api/workspaces', pre, async (req) => {
    const user = me(req);
    const body = parse(createBody, req.body);
    const w = createWorkspace(user.id, body.name, body.iconUrl ?? null);
    return { workspace: publicWorkspace(w, 'owner') };
  });

  app.post<{ Params: { inviteCode: string } }>('/api/workspaces/join/:inviteCode', pre, async (req) => {
    const user = me(req);
    const w = db.prepare('SELECT * FROM workspaces WHERE invite_code = ?').get(req.params.inviteCode) as any;
    if (!w) throw notFound('That invite link is invalid or has expired');
    joinWorkspace(w.id, user.id);
    const m = access.requireWorkspaceMember(w.id, user.id);
    return { workspace: publicWorkspace(w, m.role) };
  });

  app.get<{ Params: { wid: string } }>('/api/w/:wid', pre, async (req) => {
    const m = access.requireWorkspaceMember(req.params.wid, me(req).id);
    return { workspace: publicWorkspace(getWorkspace(req.params.wid), m.role) };
  });

  app.patch<{ Params: { wid: string } }>('/api/w/:wid', pre, async (req) => {
    const m = access.requireWorkspaceAdmin(req.params.wid, me(req).id);
    const body = parse(patchBody, req.body);
    if (body.name !== undefined) db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(body.name, req.params.wid);
    if (body.iconUrl !== undefined) db.prepare('UPDATE workspaces SET icon_url = ? WHERE id = ?').run(body.iconUrl, req.params.wid);
    const workspace = publicWorkspace(getWorkspace(req.params.wid), m.role);
    bus.emit({ type: 'workspace.updated', workspaceId: req.params.wid, actorId: me(req).id, payload: { workspace: { ...workspace, role: null } } });
    return { workspace };
  });

  app.get<{ Params: { wid: string } }>('/api/w/:wid/members', pre, async (req) => {
    access.requireWorkspaceMember(req.params.wid, me(req).id);
    const rows = db.prepare(
      `SELECT u.*, wm.role, wm.joined_at AS ws_joined_at, wm.deactivated FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = ? ORDER BY u.display_name COLLATE NOCASE`,
    ).all(req.params.wid) as any[];
    return {
      members: rows.map((r) => ({ ...publicUser(r), role: r.role, joinedAt: r.ws_joined_at, deactivated: !!r.deactivated })),
    };
  });

  app.patch<{ Params: { wid: string; uid: string } }>('/api/w/:wid/members/:uid', pre, async (req) => {
    const actor = me(req);
    access.requireWorkspaceAdmin(req.params.wid, actor.id);
    const target = db.prepare('SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .get(req.params.wid, req.params.uid) as any;
    if (!target) throw notFound('Member not found');
    if (target.role === 'owner') throw forbidden('The owner cannot be changed');
    const body = parse(roleBody, req.body);
    if (body.role) db.prepare('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?').run(body.role, req.params.wid, req.params.uid);
    if (body.deactivated !== undefined) db.prepare('UPDATE workspace_members SET deactivated = ? WHERE workspace_id = ? AND user_id = ?').run(body.deactivated ? 1 : 0, req.params.wid, req.params.uid);
    const r = db.prepare(
      `SELECT u.*, wm.role, wm.joined_at AS ws_joined_at, wm.deactivated FROM workspace_members wm JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = ? AND wm.user_id = ?`,
    ).get(req.params.wid, req.params.uid) as any;
    const member = { ...publicUser(r), role: r.role, joinedAt: r.ws_joined_at, deactivated: !!r.deactivated };
    bus.emit({ type: 'user.updated', workspaceId: req.params.wid, actorId: actor.id, payload: { user: member } });
    return { member };
  });

  return { createWorkspace, joinWorkspace };
}
