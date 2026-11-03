import type { FellowshipModule, ModuleContext } from '../../context';
import { me } from '../../auth';
import { parse, z } from '../../validate';
import { badRequest, forbidden, notFound } from '../../errors';
import { tx } from '../../db';
import { randomToken } from '../../ids';
import { migrations } from './schema';
import { PRIORITIES, STATUSES, TYPES, parseAsk, whereFor, type ItemQuery } from './query';
import { SAMPLE_ITEMS, FORM_TEMPLATES } from './samples';

const DAY = 86_400_000;
const TABS = ['summary', 'list', 'board', 'development', 'forms', 'timeline', 'docs'] as const;
const DEFAULT_TABS = { order: [...TABS], hidden: [] as string[], labels: {} as Record<string, string>, default: 'summary' };
/** Fields whose changes are logged to the activity feed. */
const TRACKED = ['summary', 'description', 'status', 'priority', 'type', 'assignee_id', 'reporter_id', 'parent_id', 'start_date', 'due_date', 'labels_json'] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const itemBody = z.object({
  type: z.enum(TYPES).optional(),
  summary: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(20_000).optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.string().nullable().optional(),
  reporterId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  startDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  labels: z.array(z.string().max(40)).max(20).optional(),
});
const tabsBody = z.object({
  order: z.array(z.enum(TABS)).optional(),
  hidden: z.array(z.enum(TABS)).optional(),
  labels: z.record(z.string().max(40)).optional(),
  default: z.enum(TABS).optional(),
});
const formField = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  type: z.enum(['text', 'textarea', 'select', 'date', 'user', 'priority']),
  required: z.boolean().default(false),
  options: z.array(z.string().max(80)).max(30).default([]),
  mapTo: z.enum(['summary', 'description', 'priority', 'dueDate', 'assignee']).nullable().default(null),
});
const queryBody = z.object({
  projectId: z.string().optional(), text: z.string().optional(), ask: z.string().optional(),
  assignee: z.array(z.string()).optional(), status: z.array(z.string()).optional(),
  type: z.array(z.string()).optional(), priority: z.array(z.string()).optional(),
});

const projects: FellowshipModule = {
  name: 'projects',
  migrations,
  register(app, ctx: ModuleContext) {
    const { db, access, bus, ids } = ctx;
    const pre = { preHandler: ctx.auth.requireUser };

    // ---------- helpers ----------
    const getProject = (pid: string) => db.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL').get(pid) as any;
    function projectFor(pid: string, userId: string) {
      const p = getProject(pid);
      if (!p) throw notFound('Space not found');
      access.requireWorkspaceMember(p.workspace_id, userId);
      return p;
    }
    function itemFor(iid: string, userId: string) {
      const row = db.prepare('SELECT * FROM work_items WHERE id = ? AND deleted_at IS NULL').get(iid) as any;
      if (!row) throw notFound('Work item not found');
      const p = projectFor(row.project_id, userId);
      return { row, project: p };
    }
    function requireWorkspaceUser(wid: string, uid: string | null | undefined) {
      if (!uid) return;
      const m = access.workspaceMember(wid, uid);
      if (!m || (m as any).deactivated) throw badRequest('That person is not in this workspace');
    }

    function serializeProject(p: any, viewerId: string | null) {
      const counts = db.prepare(
        `SELECT COUNT(*) AS total, SUM(status = 'done') AS done FROM work_items WHERE project_id = ? AND deleted_at IS NULL`,
      ).get(p.id) as any;
      const starred = viewerId ? !!db.prepare('SELECT 1 FROM project_stars WHERE project_id = ? AND user_id = ?').get(p.id, viewerId) : false;
      const visit = viewerId ? (db.prepare('SELECT visited_at FROM project_visits WHERE project_id = ? AND user_id = ?').get(p.id, viewerId) as any) : null;
      return {
        id: p.id, workspaceId: p.workspace_id, key: p.key, name: p.name, iconEmoji: p.icon_emoji, color: p.color,
        description: p.description, leadId: p.lead_id, createdBy: p.created_by, createdAt: p.created_at, updatedAt: p.updated_at,
        tabs: { ...DEFAULT_TABS, ...JSON.parse(p.tabs_json || '{}') },
        itemCount: counts.total ?? 0, doneCount: counts.done ?? 0, starred, visitedAt: visit?.visited_at ?? null,
      };
    }

    const ITEM_SELECT = `SELECT i.*, p.key AS project_key,
      (SELECT COUNT(*) FROM work_items c WHERE c.parent_id = i.id AND c.deleted_at IS NULL) AS child_count,
      (SELECT COUNT(*) FROM work_items c WHERE c.parent_id = i.id AND c.deleted_at IS NULL AND c.status = 'done') AS child_done,
      (SELECT COUNT(*) FROM work_items c WHERE c.parent_id = i.id AND c.deleted_at IS NULL AND c.status IN ('in_progress','in_review')) AS child_progress
      FROM work_items i JOIN projects p ON p.id = i.project_id`;
    function serializeItem(r: any) {
      return {
        id: r.id, projectId: r.project_id, key: `${r.project_key}-${r.number}`, number: r.number, type: r.type,
        summary: r.summary, description: r.description, status: r.status, priority: r.priority,
        assigneeId: r.assignee_id, reporterId: r.reporter_id, parentId: r.parent_id,
        startDate: r.start_date, dueDate: r.due_date, rank: r.rank, labels: JSON.parse(r.labels_json || '[]'),
        createdAt: r.created_at, updatedAt: r.updated_at, resolvedAt: r.resolved_at, reopenedCount: r.reopened_count,
        childCount: r.child_count ?? 0, childDone: r.child_done ?? 0, childInProgress: r.child_progress ?? 0,
      };
    }
    const loadItem = (iid: string) => serializeItem(db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(iid));

    function emitProject(type: string, p: any, actorId: string) {
      bus.emit({ type, workspaceId: p.workspace_id, actorId, payload: { project: serializeProject(p, null) } });
    }
    function emitItem(type: string, item: any, workspaceId: string, actorId: string) {
      bus.emit({ type, workspaceId, actorId, payload: { item } });
    }
    function logActivity(itemId: string, projectId: string, actorId: string | null, field: string, from: unknown, to: unknown, at = Date.now()) {
      db.prepare(`INSERT INTO work_item_activity (id, item_id, project_id, actor_id, field, from_value, to_value, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(ids.next('IA'), itemId, projectId, actorId, field,
        from == null ? null : String(from), to == null ? null : String(to), at);
    }
    function checkParent(projectId: string, itemId: string | null, parentId: string | null | undefined, type: string) {
      if (!parentId) return;
      const parent = db.prepare('SELECT * FROM work_items WHERE id = ? AND deleted_at IS NULL').get(parentId) as any;
      if (!parent || parent.project_id !== projectId) throw badRequest('Parent must be in the same space');
      if (parentId === itemId) throw badRequest('An item cannot be its own parent');
      if (type === 'epic') throw badRequest('Epics cannot have a parent');
      if (parent.type === 'subtask') throw badRequest('Subtasks cannot have children');
      // No cycles: walk up from the parent.
      let cur: any = parent;
      while (cur?.parent_id) {
        if (cur.parent_id === itemId) throw badRequest('That would create a loop');
        cur = db.prepare('SELECT id, parent_id FROM work_items WHERE id = ?').get(cur.parent_id);
      }
    }

    /** Create a work item (used by the API, forms and the sample space). */
    function createItem(p: any, actorId: string, body: z.infer<typeof itemBody> & { summary: string }, at = Date.now()) {
      const type = body.type ?? (body.parentId ? 'subtask' : 'task');
      checkParent(p.id, null, body.parentId, type);
      requireWorkspaceUser(p.workspace_id, body.assigneeId);
      requireWorkspaceUser(p.workspace_id, body.reporterId);
      return tx(db, () => {
        const num = (db.prepare('SELECT next_number FROM projects WHERE id = ?').get(p.id) as any).next_number;
        db.prepare('UPDATE projects SET next_number = next_number + 1, updated_at = ? WHERE id = ?').run(at, p.id);
        const rank = ((db.prepare('SELECT MAX(rank) AS r FROM work_items WHERE project_id = ?').get(p.id) as any).r ?? 0) + 1;
        const id = ids.next('I');
        const status = body.status ?? 'todo';
        db.prepare(`INSERT INTO work_items (id, project_id, number, type, summary, description, status, priority, assignee_id,
          reporter_id, parent_id, start_date, due_date, rank, labels_json, created_at, updated_at, resolved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id, p.id, num, type, body.summary, body.description ?? '', status, body.priority ?? 'none',
          body.assigneeId ?? null, body.reporterId === undefined ? actorId : body.reporterId, body.parentId ?? null,
          body.startDate ?? null, body.dueDate ?? null, rank, JSON.stringify(body.labels ?? []), at, at, status === 'done' ? at : null);
        logActivity(id, p.id, actorId, 'created', null, body.summary, at);
        return id;
      });
    }

    function applyPatch(row: any, project: any, actorId: string, body: z.infer<typeof itemBody>) {
      const next: Record<string, any> = {};
      const map: [keyof typeof body, string][] = [['type', 'type'], ['summary', 'summary'], ['description', 'description'],
        ['status', 'status'], ['priority', 'priority'], ['assigneeId', 'assignee_id'], ['reporterId', 'reporter_id'],
        ['parentId', 'parent_id'], ['startDate', 'start_date'], ['dueDate', 'due_date']];
      for (const [k, col] of map) if (body[k] !== undefined) next[col] = body[k];
      if (body.labels !== undefined) next.labels_json = JSON.stringify(body.labels);
      if ('parent_id' in next || 'type' in next) checkParent(project.id, row.id, next.parent_id ?? row.parent_id, next.type ?? row.type);
      if ('assignee_id' in next) requireWorkspaceUser(project.workspace_id, next.assignee_id);
      if ('reporter_id' in next) requireWorkspaceUser(project.workspace_id, next.reporter_id);
      const changed = Object.keys(next).filter((c) => next[c] !== row[c]);
      if (!changed.length) return false;
      const now = Date.now();
      if ('status' in next && next.status !== row.status) {
        if (next.status === 'done') next.resolved_at = now;
        else if (row.status === 'done') { next.resolved_at = null; next.reopened_count = row.reopened_count + 1; }
      }
      const cols = Object.keys(next);
      tx(db, () => {
        db.prepare(`UPDATE work_items SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
          .run(...cols.map((c) => next[c]), now, row.id);
        for (const c of changed) if ((TRACKED as readonly string[]).includes(c)) logActivity(row.id, project.id, actorId, c, row[c], next[c], now);
      });
      if ('assignee_id' in next && next.assignee_id && next.assignee_id !== row.assignee_id && next.assignee_id !== actorId) {
        // Tell the new assignee directly (their client shows a toast).
        bus.emit({ type: 'item.assigned', workspaceId: project.workspace_id, actorId, audience: [next.assignee_id], payload: { item: loadItem(row.id), by: actorId } });
      }
      return true;
    }

    function listItems(where: string, params: (string | number)[], limit = 1000) {
      return (db.prepare(`${ITEM_SELECT} WHERE ${where} ORDER BY i.rank ASC, i.number ASC LIMIT ${limit}`).all(...params) as any[]).map(serializeItem);
    }
    function membersFor(wid: string) {
      return (db.prepare(`SELECT u.id, u.full_name, u.display_name, u.email FROM workspace_members m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = ? AND m.deactivated = 0`).all(wid) as any[])
        .map((u) => ({ id: u.id, names: [u.display_name, u.full_name, ...u.full_name.split(' '), u.email.split('@')[0]].filter(Boolean) }));
    }
    function buildQuery(raw: Record<string, string | undefined>, wid: string, userId: string): { q: ItemQuery; explanation: string[] } {
      const split = (v?: string) => (v ? v.split(',').map((x) => (x === 'me' ? userId : x)).filter(Boolean) : undefined);
      let q: ItemQuery = { text: raw.q || undefined, assignee: split(raw.assignee), status: split(raw.status), type: split(raw.type),
        priority: split(raw.priority), parent: raw.parent || undefined };
      let explanation: string[] = [];
      if (raw.ask?.trim()) {
        const r = parseAsk(raw.ask, userId, membersFor(wid));
        q = { ...q, ...Object.fromEntries(Object.entries(r.query).filter(([, v]) => v !== undefined)) };
        explanation = r.explanation;
      }
      return { q, explanation };
    }

    // ---------- spaces ----------
    app.get<{ Params: { wid: string } }>('/api/w/:wid/projects', pre, async (req) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      const rows = db.prepare('SELECT * FROM projects WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE').all(req.params.wid) as any[];
      return { projects: rows.map((p) => serializeProject(p, user.id)) };
    });

    const createProjectBody = z.object({
      name: z.string().trim().min(1).max(80),
      key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Key must be 2–10 letters/digits, starting with a letter').optional(),
      iconEmoji: z.string().max(16).optional(), color: z.string().max(16).optional(), description: z.string().max(2000).optional(),
    });
    function suggestKey(wid: string, name: string) {
      const base = (name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('') || 'SP').toUpperCase().slice(0, 4);
      let key = base.length >= 2 ? base : (name.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3) || 'SPC');
      for (let n = 1; db.prepare('SELECT 1 FROM projects WHERE workspace_id = ? AND key = ? AND deleted_at IS NULL').get(wid, key); n++) key = `${base}${n}`;
      return key;
    }
    function createProject(wid: string, userId: string, body: z.infer<typeof createProjectBody>) {
      const key = body.key ?? suggestKey(wid, body.name);
      if (db.prepare('SELECT 1 FROM projects WHERE workspace_id = ? AND key = ? AND deleted_at IS NULL').get(wid, key)) throw badRequest(`Key ${key} is already used`, 'key_taken');
      const id = ids.next('P');
      const now = Date.now();
      db.prepare(`INSERT INTO projects (id, workspace_id, key, name, icon_emoji, color, description, lead_id, dev_secret, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, wid, key, body.name, body.iconEmoji ?? '🧭', body.color ?? '#6E5BD8',
        body.description ?? '', userId, randomToken(18), userId, now, now);
      db.prepare('INSERT INTO project_visits (project_id, user_id, visited_at) VALUES (?, ?, ?)').run(id, userId, now);
      return getProject(id);
    }
    app.post<{ Params: { wid: string } }>('/api/w/:wid/projects', pre, async (req) => {
      const user = me(req);
      const m = access.requireWorkspaceMember(req.params.wid, user.id);
      if (m.role === 'guest') throw forbidden('Guests cannot create spaces');
      const p = createProject(req.params.wid, user.id, parse(createProjectBody, req.body));
      emitProject('project.created', p, user.id);
      return { project: serializeProject(p, user.id) };
    });

    /** A ready-made example space so new workspaces have something to explore. */
    app.post<{ Params: { wid: string } }>('/api/w/:wid/projects/sample', pre, async (req) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      const p = createProject(req.params.wid, user.id, { name: '(Example) Billing System', key: suggestKey(req.params.wid, 'Sample Billing'), iconEmoji: '💳', color: '#6E5BD8' });
      const now = Date.now();
      const byRef = new Map<string, string>();
      for (const s of SAMPLE_ITEMS) {
        const at = now - s.daysAgo * DAY;
        const due = s.dueIn == null ? null : new Date(now + s.dueIn * DAY).toISOString().slice(0, 10);
        const start = s.startIn == null ? null : new Date(now + s.startIn * DAY).toISOString().slice(0, 10);
        const id = createItem(p, user.id, { summary: s.summary, type: s.type, status: s.status, priority: s.priority,
          parentId: s.parent ? byRef.get(s.parent) : null, dueDate: due, startDate: start, description: s.description ?? '' }, at);
        byRef.set(s.ref, id);
      }
      const fresh = getProject(p.id);
      emitProject('project.created', fresh, user.id);
      return { project: serializeProject(fresh, user.id) };
    });

    app.get<{ Params: { pid: string } }>('/api/projects/:pid', pre, async (req) => {
      const user = me(req);
      return { project: serializeProject(projectFor(req.params.pid, user.id), user.id) };
    });

    app.patch<{ Params: { pid: string } }>('/api/projects/:pid', pre, async (req) => {
      const user = me(req);
      const p = projectFor(req.params.pid, user.id);
      const body = parse(z.object({
        name: z.string().trim().min(1).max(80).optional(), iconEmoji: z.string().max(16).optional(), color: z.string().max(16).optional(),
        description: z.string().max(2000).optional(), leadId: z.string().nullable().optional(), tabs: tabsBody.optional(),
      }), req.body);
      const sets: string[] = [];
      const vals: any[] = [];
      const put = (col: string, v: any) => { sets.push(`${col} = ?`); vals.push(v); };
      if (body.name !== undefined) put('name', body.name);
      if (body.iconEmoji !== undefined) put('icon_emoji', body.iconEmoji);
      if (body.color !== undefined) put('color', body.color);
      if (body.description !== undefined) put('description', body.description);
      if (body.leadId !== undefined) { requireWorkspaceUser(p.workspace_id, body.leadId); put('lead_id', body.leadId); }
      if (body.tabs) {
        const tabs = { ...DEFAULT_TABS, ...JSON.parse(p.tabs_json || '{}'), ...body.tabs };
        // Keep every tab exactly once in the order, and never hide the default.
        tabs.order = [...new Set([...tabs.order, ...TABS])].filter((t) => (TABS as readonly string[]).includes(t));
        if (tabs.hidden.includes(tabs.default)) throw badRequest('The default tab cannot be hidden');
        put('tabs_json', JSON.stringify(tabs));
      }
      if (sets.length) db.prepare(`UPDATE projects SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...vals, Date.now(), p.id);
      const fresh = getProject(p.id);
      emitProject('project.updated', fresh, user.id);
      return { project: serializeProject(fresh, user.id) };
    });

    app.delete<{ Params: { pid: string } }>('/api/projects/:pid', pre, async (req) => {
      const user = me(req);
      const p = projectFor(req.params.pid, user.id);
      const m = access.requireWorkspaceMember(p.workspace_id, user.id);
      if (p.created_by !== user.id && m.role !== 'owner' && m.role !== 'admin') throw forbidden('Only the space creator or an admin can delete it');
      db.prepare('UPDATE projects SET deleted_at = ? WHERE id = ?').run(Date.now(), p.id);
      bus.emit({ type: 'project.deleted', workspaceId: p.workspace_id, actorId: user.id, payload: { projectId: p.id } });
      return { ok: true };
    });

    app.post<{ Params: { pid: string } }>('/api/projects/:pid/star', pre, async (req) => {
      const user = me(req);
      const p = projectFor(req.params.pid, user.id);
      const had = db.prepare('SELECT 1 FROM project_stars WHERE project_id = ? AND user_id = ?').get(p.id, user.id);
      if (had) db.prepare('DELETE FROM project_stars WHERE project_id = ? AND user_id = ?').run(p.id, user.id);
      else db.prepare('INSERT INTO project_stars (project_id, user_id, starred_at) VALUES (?, ?, ?)').run(p.id, user.id, Date.now());
      return { project: serializeProject(p, user.id) };
    });

    app.post<{ Params: { pid: string } }>('/api/projects/:pid/visit', pre, async (req) => {
      const user = me(req);
      const p = projectFor(req.params.pid, user.id);
      db.prepare(`INSERT INTO project_visits (project_id, user_id, visited_at) VALUES (?, ?, ?)
        ON CONFLICT(project_id, user_id) DO UPDATE SET visited_at = excluded.visited_at`).run(p.id, user.id, Date.now());
      return { ok: true };
    });

    // ---------- work items ----------
    app.get<{ Params: { pid: string }; Querystring: Record<string, string | undefined> }>('/api/projects/:pid/items', pre, async (req) => {
      const user = me(req);
      const p = projectFor(req.params.pid, user.id);
      const { q, explanation } = buildQuery(req.query, p.workspace_id, user.id);
      const params: (string | number)[] = [p.id];
      const where = `i.project_id = ? AND ${whereFor(q, params)}`;
      const total = (db.prepare('SELECT COUNT(*) AS n FROM work_items WHERE project_id = ? AND deleted_at IS NULL').get(p.id) as any).n;
      return { items: listItems(where, params), total, explanation };
    });

    /** Cross-space search, used by saved filters and dashboards. */
    app.get<{ Params: { wid: string }; Querystring: Record<string, string | undefined> }>('/api/w/:wid/items', pre, async (req) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      const { q, explanation } = buildQuery(req.query, req.params.wid, user.id);
      const params: (string | number)[] = [req.params.wid];
      let where = `p.workspace_id = ? AND p.deleted_at IS NULL AND ${whereFor(q, params)}`;
      if (req.query.projectId) { where += ' AND i.project_id = ?'; params.push(req.query.projectId); }
      return { items: listItems(where, params, 500), explanation };
    });

    app.post<{ Params: { pid: string } }>('/api/projects/:pid/items', pre, async (req) => {
      const user = me(req);
      const p = projectFor(req.params.pid, user.id);
      const body = parse(itemBody.extend({ summary: z.string().trim().min(1).max(255) }), req.body);
      const id = createItem(p, user.id, body);
      const item = loadItem(id);
      emitItem('item.created', item, p.workspace_id, user.id);
      if (item.parentId) emitItem('item.updated', loadItem(item.parentId), p.workspace_id, user.id);
      if (body.assigneeId && body.assigneeId !== user.id) {
        bus.emit({ type: 'item.assigned', workspaceId: p.workspace_id, actorId: user.id, audience: [body.assigneeId], payload: { item, by: user.id } });
      }
      return { item };
    });

    app.get<{ Params: { iid: string } }>('/api/items/:iid', pre, async (req) => {
      const user = me(req);
      const { row } = itemFor(req.params.iid, user.id);
      const children = listItems('i.parent_id = ? AND i.deleted_at IS NULL', [row.id]);
      return { item: loadItem(row.id), children };
    });

    /** Look up an item by its key ("SAM-12") within a workspace — used for links in chat. */
    app.get<{ Params: { wid: string; key: string } }>('/api/w/:wid/items/by-key/:key', pre, async (req) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      const m = /^([A-Z][A-Z0-9]+)-(\d+)$/i.exec(req.params.key);
      if (!m) throw notFound('Work item not found');
      const row = db.prepare(`${ITEM_SELECT} WHERE p.workspace_id = ? AND p.key = ? AND i.number = ? AND i.deleted_at IS NULL AND p.deleted_at IS NULL`)
        .get(req.params.wid, m[1].toUpperCase(), Number(m[2]));
      if (!row) throw notFound('Work item not found');
      return { item: serializeItem(row) };
    });

    app.patch<{ Params: { iid: string } }>('/api/items/:iid', pre, async (req) => {
      const user = me(req);
      const { row, project } = itemFor(req.params.iid, user.id);
      const body = parse(itemBody, req.body);
      if (applyPatch(row, project, user.id, body)) {
        const item = loadItem(row.id);
        emitItem('item.updated', item, project.workspace_id, user.id);
        // Parents show child progress, so refresh old and new parents.
        for (const pid of new Set([row.parent_id, item.parentId].filter(Boolean))) emitItem('item.updated', loadItem(pid), project.workspace_id, user.id);
      }
      return { item: loadItem(row.id) };
    });

    app.post<{ Params: { iid: string } }>('/api/items/:iid/rank', pre, async (req) => {
      const user = me(req);
      const { row, project } = itemFor(req.params.iid, user.id);
      const body = parse(z.object({ beforeId: z.string().nullable().optional(), afterId: z.string().nullable().optional(), status: z.enum(STATUSES).optional() }), req.body);
      const rankOf = (id?: string | null) => {
        if (!id) return null;
        const r = db.prepare('SELECT rank, project_id FROM work_items WHERE id = ? AND deleted_at IS NULL').get(id) as any;
        if (!r || r.project_id !== project.id) throw badRequest('Neighbour must be in the same space');
        return r.rank as number;
      };
      // beforeId = the item that should come right after this one; afterId = the one right before.
      const next = rankOf(body.beforeId), prev = rankOf(body.afterId);
      let rank: number;
      if (prev != null && next != null) rank = (prev + next) / 2;
      else if (prev != null) rank = prev + 1;
      else if (next != null) rank = next - 1;
      else rank = row.rank;
      db.prepare('UPDATE work_items SET rank = ?, updated_at = ? WHERE id = ?').run(rank, Date.now(), row.id);
      if (body.status) applyPatch({ ...row, rank }, project, user.id, { status: body.status });
      const item = loadItem(row.id);
      emitItem('item.updated', item, project.workspace_id, user.id);
      if (body.status && row.parent_id) emitItem('item.updated', loadItem(row.parent_id), project.workspace_id, user.id);
      return { item };
    });

    app.delete<{ Params: { iid: string } }>('/api/items/:iid', pre, async (req) => {
      const user = me(req);
      const { row, project } = itemFor(req.params.iid, user.id);
      const now = Date.now();
      // Deleting removes the item and everything beneath it.
      const doomed: string[] = [row.id];
      for (let i = 0; i < doomed.length; i++) {
        for (const c of db.prepare('SELECT id FROM work_items WHERE parent_id = ? AND deleted_at IS NULL').all(doomed[i]) as any[]) doomed.push(c.id);
      }
      tx(db, () => { for (const id of doomed) db.prepare('UPDATE work_items SET deleted_at = ? WHERE id = ?').run(now, id); });
      for (const id of doomed) bus.emit({ type: 'item.deleted', workspaceId: project.workspace_id, actorId: user.id, payload: { itemId: id, projectId: project.id } });
      if (row.parent_id) emitItem('item.updated', loadItem(row.parent_id), project.workspace_id, user.id);
      return { ok: true, deleted: doomed.length };
    });

    function serializeActivity(r: any) {
      return { id: r.id, itemId: r.item_id, projectId: r.project_id, actorId: r.actor_id, field: r.field.replace(/_id$|_json$/, '').replace('_date', 'Date'),
        from: r.from_value, to: r.to_value, createdAt: r.created_at, itemKey: r.item_key ?? null, itemSummary: r.item_summary ?? null, itemStatus: r.item_status ?? null, itemType: r.item_type ?? null };
    }
    app.get<{ Params: { iid: string } }>('/api/items/:iid/activity', pre, async (req) => {
      const user = me(req);
      const { row } = itemFor(req.params.iid, user.id);
      const rows = db.prepare('SELECT * FROM work_item_activity WHERE item_id = ? ORDER BY created_at DESC, id DESC LIMIT 200').all(row.id) as any[];
      return { activity: rows.map(serializeActivity) };
    });

    app.get<{ Params: { iid: string } }>('/api/items/:iid/comments', pre, async (req) => {
      const user = me(req);
      const { row } = itemFor(req.params.iid, user.id);
      const rows = db.prepare('SELECT * FROM work_item_comments WHERE item_id = ? ORDER BY created_at').all(row.id) as any[];
      return { comments: rows.map((c) => ({ id: c.id, itemId: c.item_id, userId: c.user_id, text: c.text, createdAt: c.created_at, editedAt: c.edited_at })) };
    });
    app.post<{ Params: { iid: string } }>('/api/items/:iid/comments', pre, async (req) => {
      const user = me(req);
      const { row, project } = itemFor(req.params.iid, user.id);
      const { text } = parse(z.object({ text: z.string().trim().min(1).max(10_000) }), req.body);
      const id = ids.next('IC');
      const now = Date.now();
      db.prepare('INSERT INTO work_item_comments (id, item_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)').run(id, row.id, user.id, text, now);
      logActivity(row.id, project.id, user.id, 'comment', null, text.slice(0, 200), now);
      const comment = { id, itemId: row.id, userId: user.id, text, createdAt: now, editedAt: null };
      bus.emit({ type: 'item.commented', workspaceId: project.workspace_id, actorId: user.id, payload: { comment, projectId: project.id } });
      return { comment };
    });

    /** Post a card for the item into a channel or DM the user belongs to. */
    app.post<{ Params: { iid: string } }>('/api/items/:iid/share', pre, async (req) => {
      const user = me(req);
      const { row, project } = itemFor(req.params.iid, user.id);
      const body = parse(z.object({ conversationId: z.string(), comment: z.string().max(4000).optional() }), req.body);
      const { conv } = access.requireConversationRead(body.conversationId, user.id);
      if (conv.workspace_id !== project.workspace_id) throw badRequest('That conversation is in another workspace');
      const item = loadItem(row.id);
      const message = ctx.messages.post({
        conversationId: conv.id, userId: user.id, text: body.comment?.trim() || `${item.key}: ${item.summary}`,
        subtype: 'work_item', meta: { workItem: { id: item.id, key: item.key, summary: item.summary, status: item.status,
          priority: item.priority, type: item.type, projectId: project.id, projectName: project.name, assigneeId: item.assigneeId } },
      });
      return { message };
    });

    // ---------- summary ----------
    app.get<{ Params: { pid: string }; Querystring: { days?: string; assignee?: string } }>('/api/projects/:pid/summary', pre, async (req) => {
      const user = me(req);
      const p = projectFor(req.params.pid, user.id);
      const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
      const now = Date.now();
      const since = now - days * DAY;
      const today = new Date(now).toISOString().slice(0, 10);
      const soon = new Date(now + days * DAY).toISOString().slice(0, 10);
      const people = req.query.assignee ? req.query.assignee.split(',').map((x) => (x === 'me' ? user.id : x)) : null;
      const params: (string | number)[] = [p.id];
      const filt = people ? ` AND (${[people.includes('none') ? 'assignee_id IS NULL' : '', ...(people.filter((x) => x !== 'none').length
        ? [`assignee_id IN (${people.filter((x) => x !== 'none').map(() => '?').join(',')})`] : [])].filter(Boolean).join(' OR ')})` : '';
      if (people) params.push(...people.filter((x) => x !== 'none'));
      const base = `FROM work_items WHERE project_id = ? AND deleted_at IS NULL${filt}`;
      const one = (sql: string, ...extra: (string | number)[]) => (db.prepare(sql).get(...params, ...extra) as any).n as number;
      const group = (col: string) => Object.fromEntries((db.prepare(`SELECT ${col} AS k, COUNT(*) AS n ${base} GROUP BY ${col}`).all(...params) as any[]).map((r) => [r.k ?? 'none', r.n]));

      const workload = (db.prepare(`SELECT assignee_id AS id, COUNT(*) AS n ${base} GROUP BY assignee_id ORDER BY n DESC`).all(...params) as any[])
        .map((r) => ({ assigneeId: r.id, count: r.n }));
      const epics = (db.prepare(`${ITEM_SELECT} WHERE i.project_id = ? AND i.type = 'epic' AND i.deleted_at IS NULL ORDER BY i.rank`).all(p.id) as any[])
        .map(serializeItem).map((e) => ({ id: e.id, key: e.key, summary: e.summary, status: e.status, total: e.childCount,
          done: e.childDone, inProgress: e.childInProgress, todo: e.childCount - e.childDone - e.childInProgress }));
      const activity = (db.prepare(`SELECT a.*, p.key || '-' || i.number AS item_key, i.summary AS item_summary, i.status AS item_status, i.type AS item_type
        FROM work_item_activity a JOIN work_items i ON i.id = a.item_id JOIN projects p ON p.id = a.project_id
        WHERE a.project_id = ? AND i.deleted_at IS NULL ORDER BY a.created_at DESC, a.id DESC LIMIT 30`).all(p.id) as any[]).map(serializeActivity);
      return {
        days,
        stats: {
          completed: one(`SELECT COUNT(*) AS n ${base} AND status = 'done' AND resolved_at >= ?`, since),
          updated: one(`SELECT COUNT(*) AS n ${base} AND updated_at >= ?`, since),
          created: one(`SELECT COUNT(*) AS n ${base} AND created_at >= ?`, since),
          dueSoon: one(`SELECT COUNT(*) AS n ${base} AND status != 'done' AND due_date >= ? AND due_date <= ?`, today, soon),
        },
        total: one(`SELECT COUNT(*) AS n ${base}`),
        status: group('status'), priority: group('priority'), types: group('type'), workload, epics, activity,
      };
    });

    // ---------- development ----------
    function devEvents(pid: string, kind: string) {
      return (db.prepare('SELECT * FROM project_dev_events WHERE project_id = ? AND kind = ? ORDER BY updated_at DESC').all(pid, kind) as any[])
        .map((r) => ({ ref: r.ref, ...JSON.parse(r.data_json), createdAt: r.created_at, updatedAt: r.updated_at }));
    }
    const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    app.get<{ Params: { pid: string } }>('/api/projects/:pid/development', pre, async (req) => {
      const user = me(req);
      const p = projectFor(req.params.pid, user.id);
      const now = Date.now();
      const weekStart = now - 7 * DAY;
      const today = new Date(now).toISOString().slice(0, 10);
      const n = (sql: string, ...a: any[]) => (db.prepare(sql).get(p.id, ...a) as any).n as number;
      const series = Array.from({ length: 7 }, (_, k) => {
        const from = now - (7 - k) * DAY, to = from + DAY;
        return n(`SELECT COUNT(*) AS n FROM work_items WHERE project_id = ? AND deleted_at IS NULL AND status = 'done' AND resolved_at >= ? AND resolved_at < ?`, from, to);
      });
      const prs = devEvents(p.id, 'pull_request');
      const deployments = devEvents(p.id, 'deployment');
      const vulns = devEvents(p.id, 'vulnerability');
      const repos = devEvents(p.id, 'repository');
      const merged = prs.filter((x) => x.mergedAt && x.mergedAt >= weekStart && x.openedAt);
      const leads = deployments.filter((d) => d.deployedAt >= now - 84 * DAY && d.status === 'success')
        .flatMap((d) => (d.prIds ?? []).map((id: string) => prs.find((x) => x.ref === id)).filter((x: any) => x?.mergedAt).map((x: any) => d.deployedAt - x.mergedAt));
      return {
        metrics: {
          completedThisWeek: n(`SELECT COUNT(*) AS n FROM work_items WHERE project_id = ? AND deleted_at IS NULL AND status = 'done' AND resolved_at >= ?`, weekStart),
          completedSeries: series,
          prCycleTimeHours: median(merged.map((x) => (x.mergedAt - x.openedAt) / 3_600_000)),
          leadTimeHours: median(leads.map((ms) => ms / 3_600_000)),
          overdue: n(`SELECT COUNT(*) AS n FROM work_items WHERE project_id = ? AND deleted_at IS NULL AND status != 'done' AND due_date < ?`, today),
          reopened: n(`SELECT COUNT(*) AS n FROM work_items WHERE project_id = ? AND deleted_at IS NULL AND reopened_count > 0`),
          bugsOpen: n(`SELECT COUNT(*) AS n FROM work_items WHERE project_id = ? AND deleted_at IS NULL AND type = 'bug' AND status != 'done'`),
          prsOpen: prs.filter((x) => x.state === 'open').length,
          criticalVulnerabilities: vulns.filter((v) => v.status !== 'fixed' && v.severity === 'critical').length,
        },
        pullRequests: prs, deployments, vulnerabilities: vulns, repositories: repos,
        hookPath: `/api/hooks/dev/${p.dev_secret}`,
      };
    });

    /** Code-host events for a space: pull requests, deployments, vulnerabilities, repositories. */
    app.post<{ Params: { secret: string } }>('/api/hooks/dev/:secret', async (req) => {
      const p = db.prepare('SELECT * FROM projects WHERE dev_secret = ? AND deleted_at IS NULL').get(req.params.secret) as any;
      if (!p) throw notFound('Unknown hook');
      const body = parse(z.discriminatedUnion('type', [
        z.object({ type: z.literal('pull_request'), id: z.string().min(1), action: z.enum(['opened', 'merged', 'closed', 'reopened']),
          title: z.string().max(300).optional(), url: z.string().max(1000).optional(), repo: z.string().max(200).optional(),
          author: z.string().max(100).optional(), itemKeys: z.array(z.string()).optional() }),
        z.object({ type: z.literal('deployment'), id: z.string().min(1), environment: z.string().max(60).default('production'),
          status: z.enum(['success', 'failed', 'in_progress']).default('success'), prIds: z.array(z.string()).default([]), url: z.string().max(1000).optional() }),
        z.object({ type: z.literal('vulnerability'), id: z.string().min(1), title: z.string().max(300).default(''),
          severity: z.enum(['critical', 'high', 'medium', 'low']).default('medium'), status: z.enum(['open', 'fixed']).default('open'), url: z.string().max(1000).optional() }),
        z.object({ type: z.literal('repository'), id: z.string().min(1), name: z.string().max(200), url: z.string().max(1000).optional() }),
      ]), req.body);
      const now = Date.now();
      const prev = db.prepare('SELECT data_json, created_at FROM project_dev_events WHERE project_id = ? AND kind = ? AND ref = ?').get(p.id, body.type, body.id) as any;
      const old = prev ? JSON.parse(prev.data_json) : {};
      // Later events may omit fields (e.g. a merge without a title): keep what we already know.
      const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
      let data: any;
      if (body.type === 'pull_request') {
        const { type: _t, id: _i, action, ...rest } = body;
        data = { title: '', ...old, ...defined(rest), state: action === 'merged' ? 'merged' : action === 'closed' ? 'closed' : 'open',
          openedAt: old.openedAt ?? now, mergedAt: action === 'merged' ? now : old.mergedAt ?? null };
      } else if (body.type === 'deployment') {
        const { type: _t, id: _i, ...rest } = body;
        data = { ...old, ...defined(rest), deployedAt: now };
      } else {
        const { type: _t, id: _i, ...rest } = body;
        data = { ...old, ...defined(rest) };
      }
      db.prepare(`INSERT INTO project_dev_events (project_id, kind, ref, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, kind, ref) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`)
        .run(p.id, body.type, body.id, JSON.stringify(data), prev?.created_at ?? now, now);
      bus.emit({ type: 'project.dev_updated', workspaceId: p.workspace_id, payload: { projectId: p.id, kind: body.type } });
      return { ok: true };
    });

    // ---------- forms ----------
    function serializeForm(f: any) {
      return { id: f.id, projectId: f.project_id, name: f.name, description: f.description, template: f.template, itemType: f.item_type,
        fields: JSON.parse(f.fields_json), active: !!f.active, createdBy: f.created_by, createdAt: f.created_at, updatedAt: f.updated_at,
        submissions: (db.prepare(`SELECT COUNT(*) AS n FROM work_item_activity WHERE field = 'form' AND to_value = ?`).get(f.id) as any).n };
    }
    function formFor(fid: string, userId: string) {
      const f = db.prepare('SELECT * FROM project_forms WHERE id = ? AND deleted_at IS NULL').get(fid) as any;
      if (!f) throw notFound('Form not found');
      return { form: f, project: projectFor(f.project_id, userId) };
    }
    app.get<{ Params: { pid: string } }>('/api/projects/:pid/forms', pre, async (req) => {
      const user = me(req);
      const p = projectFor(req.params.pid, user.id);
      const rows = db.prepare('SELECT * FROM project_forms WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC').all(p.id) as any[];
      return { forms: rows.map(serializeForm), templates: FORM_TEMPLATES };
    });
    const formBody = z.object({
      name: z.string().trim().min(1).max(120), description: z.string().max(2000).optional(), template: z.string().max(40).optional(),
      itemType: z.enum(TYPES).optional(), fields: z.array(formField).min(1).max(40).optional(), active: z.boolean().optional(),
    });
    app.post<{ Params: { pid: string } }>('/api/projects/:pid/forms', pre, async (req) => {
      const user = me(req);
      const p = projectFor(req.params.pid, user.id);
      const body = parse(formBody, req.body);
      const tpl = FORM_TEMPLATES.find((t) => t.id === (body.template ?? 'blank')) ?? FORM_TEMPLATES[0];
      const fields = body.fields ?? tpl.fields;
      if (!fields.some((f) => f.mapTo === 'summary')) throw badRequest('One field must fill in the work item summary');
      const id = ids.next('PF');
      const now = Date.now();
      db.prepare(`INSERT INTO project_forms (id, project_id, name, description, template, item_type, fields_json, active, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(id, p.id, body.name, body.description ?? tpl.description, tpl.id,
        body.itemType ?? tpl.itemType, JSON.stringify(fields), user.id, now, now);
      return { form: serializeForm(db.prepare('SELECT * FROM project_forms WHERE id = ?').get(id)) };
    });
    app.get<{ Params: { fid: string } }>('/api/forms/:fid', pre, async (req) => {
      const user = me(req);
      const { form, project } = formFor(req.params.fid, user.id);
      return { form: serializeForm(form), project: serializeProject(project, user.id) };
    });
    app.patch<{ Params: { fid: string } }>('/api/forms/:fid', pre, async (req) => {
      const user = me(req);
      const { form } = formFor(req.params.fid, user.id);
      const body = parse(formBody.partial(), req.body);
      if (body.fields && !body.fields.some((f) => f.mapTo === 'summary')) throw badRequest('One field must fill in the work item summary');
      const next = { name: body.name ?? form.name, description: body.description ?? form.description, item_type: body.itemType ?? form.item_type,
        fields_json: body.fields ? JSON.stringify(body.fields) : form.fields_json, active: body.active === undefined ? form.active : body.active ? 1 : 0 };
      db.prepare('UPDATE project_forms SET name = ?, description = ?, item_type = ?, fields_json = ?, active = ?, updated_at = ? WHERE id = ?')
        .run(next.name, next.description, next.item_type, next.fields_json, next.active, Date.now(), form.id);
      return { form: serializeForm(db.prepare('SELECT * FROM project_forms WHERE id = ?').get(form.id)) };
    });
    app.delete<{ Params: { fid: string } }>('/api/forms/:fid', pre, async (req) => {
      const user = me(req);
      const { form } = formFor(req.params.fid, user.id);
      db.prepare('UPDATE project_forms SET deleted_at = ? WHERE id = ?').run(Date.now(), form.id);
      return { ok: true };
    });
    app.post<{ Params: { fid: string } }>('/api/forms/:fid/submit', pre, async (req) => {
      const user = me(req);
      const { form, project } = formFor(req.params.fid, user.id);
      if (!form.active) throw badRequest('This form is closed');
      const { values } = parse(z.object({ values: z.record(z.string().max(10_000)) }), req.body);
      const fields = JSON.parse(form.fields_json) as z.infer<typeof formField>[];
      const body: any = { type: form.item_type, reporterId: user.id };
      const lines: string[] = [];
      for (const f of fields) {
        const v = (values[f.id] ?? '').trim();
        if (f.required && !v) throw badRequest(`${f.label} is required`);
        if (!v) continue;
        if (f.type === 'select' && f.options.length && !f.options.includes(v)) throw badRequest(`${f.label}: pick one of the options`);
        if (f.type === 'priority' && !(PRIORITIES as readonly string[]).includes(v)) throw badRequest(`${f.label}: unknown priority`);
        if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest(`${f.label}: use YYYY-MM-DD`);
        if (f.mapTo === 'summary') body.summary = v.slice(0, 255);
        else if (f.mapTo === 'priority') body.priority = v;
        else if (f.mapTo === 'dueDate') body.dueDate = v;
        else if (f.mapTo === 'assignee') body.assigneeId = v;
        else if (f.mapTo === 'description') lines.unshift(v);
        else lines.push(`**${f.label}:** ${v}`);
      }
      if (!body.summary) throw badRequest('The summary field is required');
      body.description = [...lines, '', `_Submitted through the "${form.name}" form._`].join('\n').trim();
      const id = createItem(project, user.id, body);
      logActivity(id, project.id, user.id, 'form', null, form.id);
      const item = loadItem(id);
      emitItem('item.created', item, project.workspace_id, user.id);
      return { item };
    });

    // ---------- saved filters ----------
    app.get<{ Params: { wid: string } }>('/api/w/:wid/project-filters', pre, async (req) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      const rows = db.prepare('SELECT * FROM project_filters WHERE workspace_id = ? AND owner_id = ? ORDER BY starred DESC, name').all(req.params.wid, user.id) as any[];
      return { filters: rows.map((f) => ({ id: f.id, name: f.name, query: JSON.parse(f.query_json), starred: !!f.starred, createdAt: f.created_at })) };
    });
    app.post<{ Params: { wid: string } }>('/api/w/:wid/project-filters', pre, async (req) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      const body = parse(z.object({ name: z.string().trim().min(1).max(80), query: queryBody, starred: z.boolean().optional() }), req.body);
      const id = ids.next('PQ');
      db.prepare('INSERT INTO project_filters (id, workspace_id, owner_id, name, query_json, starred, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, req.params.wid, user.id, body.name, JSON.stringify(body.query), body.starred ? 1 : 0, Date.now());
      return { filter: { id, name: body.name, query: body.query, starred: !!body.starred } };
    });
    app.delete<{ Params: { id: string } }>('/api/project-filters/:id', pre, async (req) => {
      const user = me(req);
      const r = db.prepare('DELETE FROM project_filters WHERE id = ? AND owner_id = ?').run(req.params.id, user.id);
      if (!r.changes) throw notFound('Filter not found');
      return { ok: true };
    });

    // ---------- dashboards ----------
    const widget = z.object({
      id: z.string().max(40), type: z.enum(['stats', 'status', 'priority', 'types', 'workload', 'epics', 'activity', 'filter']),
      projectId: z.string().nullable().optional(), filterId: z.string().nullable().optional(), title: z.string().max(80).optional(),
    });
    const serializeDash = (d: any) => ({ id: d.id, name: d.name, ownerId: d.owner_id, widgets: JSON.parse(d.widgets_json), createdAt: d.created_at, updatedAt: d.updated_at });
    function dashFor(id: string, userId: string) {
      const d = db.prepare('SELECT * FROM project_dashboards WHERE id = ?').get(id) as any;
      if (!d) throw notFound('Dashboard not found');
      access.requireWorkspaceMember(d.workspace_id, userId);
      return d;
    }
    app.get<{ Params: { wid: string } }>('/api/w/:wid/dashboards', pre, async (req) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      return { dashboards: (db.prepare('SELECT * FROM project_dashboards WHERE workspace_id = ? ORDER BY name').all(req.params.wid) as any[]).map(serializeDash) };
    });
    app.post<{ Params: { wid: string } }>('/api/w/:wid/dashboards', pre, async (req) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      const body = parse(z.object({ name: z.string().trim().min(1).max(80), widgets: z.array(widget).max(24).default([]) }), req.body);
      const id = ids.next('PD');
      const now = Date.now();
      db.prepare('INSERT INTO project_dashboards (id, workspace_id, owner_id, name, widgets_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, req.params.wid, user.id, body.name, JSON.stringify(body.widgets), now, now);
      return { dashboard: serializeDash(db.prepare('SELECT * FROM project_dashboards WHERE id = ?').get(id)) };
    });
    app.get<{ Params: { id: string } }>('/api/dashboards/:id', pre, async (req) => ({ dashboard: serializeDash(dashFor(req.params.id, me(req).id)) }));
    app.patch<{ Params: { id: string } }>('/api/dashboards/:id', pre, async (req) => {
      const user = me(req);
      const d = dashFor(req.params.id, user.id);
      if (d.owner_id !== user.id) throw forbidden('Only the owner can edit this dashboard');
      const body = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), widgets: z.array(widget).max(24).optional() }), req.body);
      db.prepare('UPDATE project_dashboards SET name = ?, widgets_json = ?, updated_at = ? WHERE id = ?')
        .run(body.name ?? d.name, body.widgets ? JSON.stringify(body.widgets) : d.widgets_json, Date.now(), d.id);
      return { dashboard: serializeDash(db.prepare('SELECT * FROM project_dashboards WHERE id = ?').get(d.id)) };
    });
    app.delete<{ Params: { id: string } }>('/api/dashboards/:id', pre, async (req) => {
      const user = me(req);
      const d = dashFor(req.params.id, user.id);
      if (d.owner_id !== user.id) throw forbidden('Only the owner can delete this dashboard');
      db.prepare('DELETE FROM project_dashboards WHERE id = ?').run(d.id);
      return { ok: true };
    });

    // ---------- for you ----------
    app.get<{ Params: { wid: string } }>('/api/w/:wid/for-you', pre, async (req) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      const assigned = listItems(`p.workspace_id = ? AND p.deleted_at IS NULL AND i.deleted_at IS NULL AND i.assignee_id = ? AND i.status != 'done'`, [req.params.wid, user.id], 100);
      const worked = (db.prepare(`SELECT DISTINCT a.item_id FROM work_item_activity a JOIN projects p ON p.id = a.project_id
        WHERE p.workspace_id = ? AND a.actor_id = ? ORDER BY a.created_at DESC LIMIT 30`).all(req.params.wid, user.id) as any[]).map((r) => r.item_id);
      const recentItems = worked.length ? listItems(`i.id IN (${worked.map(() => '?').join(',')}) AND i.deleted_at IS NULL`, worked)
        .sort((a, b) => worked.indexOf(a.id) - worked.indexOf(b.id)).slice(0, 15) : [];
      const spaces = (db.prepare(`SELECT p.* FROM projects p JOIN project_visits v ON v.project_id = p.id AND v.user_id = ?
        WHERE p.workspace_id = ? AND p.deleted_at IS NULL ORDER BY v.visited_at DESC LIMIT 8`).all(user.id, req.params.wid) as any[]).map((p) => serializeProject(p, user.id));
      return { assigned, recentItems, recentSpaces: spaces };
    });
  },
};

export default projects;
