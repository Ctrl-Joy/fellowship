import type { FellowshipModule, ModuleContext } from '../../context';
import type { Connection } from '../../realtime';
import { me } from '../../auth';
import { tx } from '../../db';
import { parse, z } from '../../validate';
import { badRequest, forbidden, notFound } from '../../errors';
import { POSITION_RE, keyBetween, keysAfter } from './fractional';
import { BLOCK_TYPES, BUILTIN_TEMPLATES, type BlockType, type TemplateBlock } from './templates';

// ---------------------------------------------------------------------------------------------
// Rows & serialization

interface CanvasRow {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  title: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  updated_by: string | null;
  is_template: number;
}

interface BlockRow {
  id: string;
  canvas_id: string;
  position: string;
  type: BlockType;
  text: string;
  checked: number;
  version: number;
  text_v: number;
  type_v: number;
  checked_v: number;
  pos_v: number;
  updated_by: string | null;
  updated_at: number;
}

export type CanvasRole = 'owner' | 'editor' | 'viewer';
const RANK: Record<CanvasRole, number> = { viewer: 1, editor: 2, owner: 3 };
const maxRole = (a: CanvasRole | null, b: CanvasRole | null) => (!a ? b : !b ? a : RANK[a] >= RANK[b] ? a : b);

const MAX_TEXT = 20000;
const MAX_BLOCKS = 5000;
const BLOCK_ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

function serializeBlock(b: BlockRow) {
  return {
    id: b.id, position: b.position, type: b.type, text: b.text, checked: !!b.checked,
    version: b.version, updatedBy: b.updated_by, updatedAt: b.updated_at,
  };
}
export type Block = ReturnType<typeof serializeBlock>;

function serializeCanvas(c: CanvasRow) {
  return {
    id: c.id, workspaceId: c.workspace_id, conversationId: c.conversation_id, title: c.title,
    createdBy: c.created_by, createdAt: c.created_at, updatedAt: c.updated_at, updatedBy: c.updated_by,
    isTemplate: !!c.is_template,
  };
}

// ---------------------------------------------------------------------------------------------
// Schemas

const blockType = z.enum(BLOCK_TYPES as [BlockType, ...BlockType[]]);
const blockId = z.string().regex(BLOCK_ID_RE, 'invalid block id');
const position = z.string().regex(POSITION_RE, 'invalid position');
const text = z.string().max(MAX_TEXT);

const opSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('insert'), blockId,
    position: position.optional(), afterId: blockId.nullable().optional(),
    type: blockType.default('paragraph'), text: text.default(''), checked: z.boolean().default(false),
  }),
  z.object({
    op: z.literal('update'), blockId, baseVersion: z.number().int().min(0),
    type: blockType.optional(), text: text.optional(), checked: z.boolean().optional(),
  }),
  z.object({ op: z.literal('delete'), blockId, baseVersion: z.number().int().min(0).optional() }),
  z.object({
    op: z.literal('move'), blockId, baseVersion: z.number().int().min(0),
    position: position.optional(), afterId: blockId.nullable().optional(),
  }),
]);
export type CanvasOp = z.infer<typeof opSchema>;

const opsBody = z.object({
  clientId: z.string().max(64).optional(),
  ops: z.array(opSchema).min(1).max(500),
});

export interface OpResult {
  op: CanvasOp['op'];
  blockId: string;
  /** ok = applied; noop = nothing to change (e.g. retried insert, delete of a missing block);
   *  conflict = rejected, `block` holds the current server state; gone = block no longer exists. */
  status: 'ok' | 'noop' | 'conflict' | 'gone' | 'error';
  block?: Block;
  conflictFields?: string[];
  error?: string;
}

/** What gets broadcast in canvas.updated: the applied result of each op. */
export type AppliedOp =
  | { op: 'insert' | 'update' | 'move'; block: Block }
  | { op: 'delete'; blockId: string };

// ---------------------------------------------------------------------------------------------

const canvases: FellowshipModule = {
  name: 'canvases',
  migrations: [
    `CREATE TABLE canvases (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT,
      is_template INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX canvases_conversation ON canvases(conversation_id) WHERE conversation_id IS NOT NULL;
    CREATE INDEX canvases_workspace ON canvases(workspace_id, updated_at);
    CREATE TABLE canvas_blocks (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
      position TEXT NOT NULL,
      type TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      checked INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      text_v INTEGER NOT NULL DEFAULT 1,
      type_v INTEGER NOT NULL DEFAULT 1,
      checked_v INTEGER NOT NULL DEFAULT 1,
      pos_v INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX canvas_blocks_position ON canvas_blocks(canvas_id, position);
    CREATE TABLE canvas_access (
      canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('viewer','editor')),
      granted_by TEXT,
      granted_at INTEGER NOT NULL,
      PRIMARY KEY (canvas_id, user_id)
    );
    CREATE INDEX canvas_access_user ON canvas_access(user_id);
    CREATE TABLE canvas_channel_shares (
      canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('viewer','editor')),
      shared_by TEXT,
      shared_at INTEGER NOT NULL,
      PRIMARY KEY (canvas_id, conversation_id)
    );
    CREATE INDEX canvas_channel_shares_conv ON canvas_channel_shares(conversation_id);`,
  ],
  register(app, ctx) {
    const svc = createCanvasService(ctx);
    const pre = { preHandler: ctx.auth.requireUser };

    // ---- list / create / templates ------------------------------------------------------------
    app.get<{ Params: { wid: string } }>('/api/w/:wid/canvases', pre, async (req) => {
      const user = me(req);
      ctx.access.requireWorkspaceMember(req.params.wid, user.id);
      return { canvases: svc.listFor(req.params.wid, user.id) };
    });

    app.get<{ Params: { wid: string } }>('/api/w/:wid/canvas-templates', pre, async (req) => {
      const user = me(req);
      ctx.access.requireWorkspaceMember(req.params.wid, user.id);
      const builtin = BUILTIN_TEMPLATES.map((t) => ({ id: t.id, title: t.title, description: t.description, builtin: true }));
      const custom = svc.listFor(req.params.wid, user.id)
        .filter((c) => c.isTemplate)
        .map((c) => ({ id: c.id, title: c.title || 'Untitled', description: 'Saved from a canvas in this workspace', builtin: false }));
      return { templates: [...builtin, ...custom] };
    });

    app.post<{ Params: { wid: string } }>('/api/w/:wid/canvases', pre, async (req) => {
      const user = me(req);
      ctx.access.requireWorkspaceMember(req.params.wid, user.id);
      const body = parse(z.object({
        title: z.string().trim().max(200).optional(),
        templateId: z.string().max(64).optional(),
      }), req.body);
      let blocks: TemplateBlock[] = [{ type: 'paragraph', text: '' }];
      let title = body.title ?? '';
      if (body.templateId) {
        const builtin = BUILTIN_TEMPLATES.find((t) => t.id === body.templateId);
        if (builtin) {
          blocks = builtin.blocks;
          if (!body.title) title = builtin.title;
        } else {
          const src = svc.getRow(body.templateId);
          if (!src || src.workspace_id !== req.params.wid || !src.is_template || !svc.roleFor(src, user.id)) {
            throw notFound('Template not found');
          }
          blocks = svc.blockRows(src.id).map((b) => ({ type: b.type, text: b.text, checked: !!b.checked }));
          if (!body.title) title = src.title;
        }
      }
      const row = svc.create({ workspaceId: req.params.wid, conversationId: null, title, userId: user.id, blocks });
      return svc.fullView(row, user.id);
    });

    // ---- channel canvas (auto-created) --------------------------------------------------------
    app.get<{ Params: { cid: string } }>('/api/conversations/:cid/canvas', pre, async (req) => {
      const user = me(req);
      const { conv } = ctx.access.requireConversationRead(req.params.cid, user.id);
      let row = svc.byConversation(conv.id);
      if (!row) {
        const title = conv.kind === 'channel' && conv.name ? `${conv.name} canvas` : 'Conversation canvas';
        try {
          row = svc.create({ workspaceId: conv.workspace_id, conversationId: conv.id, title, userId: user.id, blocks: [{ type: 'paragraph', text: '' }] });
        } catch {
          // Lost a creation race with another opener: use theirs.
          row = svc.byConversation(conv.id);
          if (!row) throw badRequest('Could not create canvas');
        }
      }
      return svc.fullView(row, user.id);
    });

    // ---- single canvas ------------------------------------------------------------------------
    app.get<{ Params: { id: string } }>('/api/canvases/:id', pre, async (req) => {
      const user = me(req);
      const { row } = svc.requireRole(req.params.id, user.id, 'viewer');
      return svc.fullView(row, user.id);
    });

    app.patch<{ Params: { id: string } }>('/api/canvases/:id', pre, async (req) => {
      const user = me(req);
      const body = parse(z.object({
        title: z.string().trim().max(200).optional(),
        isTemplate: z.boolean().optional(),
      }), req.body);
      const { row } = svc.requireRole(req.params.id, user.id, 'editor');
      if (body.isTemplate !== undefined && row.conversation_id) throw badRequest('Channel canvases cannot be templates');
      const now = Date.now();
      ctx.db.prepare(`UPDATE canvases SET title = COALESCE(?, title), is_template = COALESCE(?, is_template),
        updated_at = ?, updated_by = ? WHERE id = ?`)
        .run(body.title ?? null, body.isTemplate === undefined ? null : body.isTemplate ? 1 : 0, now, user.id, row.id);
      const fresh = svc.getRow(row.id)!;
      const canvas = serializeCanvas(fresh);
      svc.emitUpdated(fresh, user.id, [], { canvas });
      return { canvas };
    });

    app.delete<{ Params: { id: string } }>('/api/canvases/:id', pre, async (req) => {
      const user = me(req);
      const { row } = svc.requireRole(req.params.id, user.id, 'viewer');
      if (!svc.canManage(row, user.id)) throw forbidden('Only the owner can delete this canvas');
      const audience = svc.audience(row);
      ctx.db.prepare('DELETE FROM canvases WHERE id = ?').run(row.id);
      ctx.bus.emit({
        type: 'canvas.deleted', workspaceId: row.workspace_id, actorId: user.id,
        payload: { canvasId: row.id, actorId: user.id }, audience,
      });
      svc.presence.drop(row.id);
      return { ok: true };
    });

    // ---- sharing ------------------------------------------------------------------------------
    app.post<{ Params: { id: string } }>('/api/canvases/:id/share', pre, async (req) => {
      const user = me(req);
      const body = parse(z.object({
        userIds: z.array(z.string()).max(100).optional(),
        conversationId: z.string().optional(),
        role: z.enum(['viewer', 'editor']).default('editor'),
        note: z.string().max(2000).optional(),
      }), req.body);
      const { row } = svc.requireRole(req.params.id, user.id, 'editor');
      if (!body.userIds?.length && !body.conversationId) throw badRequest('Choose people or a channel to share with');
      if (body.userIds?.length && row.conversation_id) throw badRequest('Channel canvases follow channel membership');
      const now = Date.now();
      const newlyAdded: string[] = [];
      let message: unknown = null;

      if (body.conversationId) ctx.access.requireConversationMember(body.conversationId, user.id);
      const conv = body.conversationId ? ctx.access.getConversation(body.conversationId)! : null;
      if (conv && conv.workspace_id !== row.workspace_id) throw notFound('Conversation not found');

      for (const uid of body.userIds ?? []) {
        if (!ctx.access.workspaceMember(row.workspace_id, uid)) throw badRequest('Can only share with workspace members');
      }
      tx(ctx.db, () => {
        for (const uid of new Set(body.userIds ?? [])) {
          if (uid === row.created_by) continue;
          const before = svc.roleFor(row, uid);
          ctx.db.prepare(`INSERT INTO canvas_access (canvas_id, user_id, role, granted_by, granted_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(canvas_id, user_id) DO UPDATE SET role = excluded.role`).run(row.id, uid, body.role, user.id, now);
          if (!before) newlyAdded.push(uid);
        }
        if (conv && !row.conversation_id) {
          const beforeIds = ctx.realtime.conversationMemberIds(conv.id).filter((uid) => !svc.roleFor(row, uid));
          ctx.db.prepare(`INSERT INTO canvas_channel_shares (canvas_id, conversation_id, role, shared_by, shared_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(canvas_id, conversation_id) DO UPDATE SET role = excluded.role`).run(row.id, conv.id, body.role, user.id, now);
          newlyAdded.push(...beforeIds);
        }
      });
      if (conv) {
        const note = body.note?.trim();
        message = ctx.messages.post({
          conversationId: conv.id, userId: user.id,
          text: note || `shared a canvas: *${row.title || 'Untitled'}*`,
          subtype: 'canvas_share',
          meta: { canvasId: row.id, title: row.title || 'Untitled', workspaceId: row.workspace_id, role: body.role },
        });
      }
      if (newlyAdded.length) {
        ctx.bus.emit({
          type: 'canvas.shared', workspaceId: row.workspace_id, actorId: user.id,
          payload: { canvas: serializeCanvas(row), actorId: user.id }, audience: [...new Set(newlyAdded)],
        });
      }
      return { ...svc.sharing(row), message };
    });

    app.delete<{ Params: { id: string; uid: string } }>('/api/canvases/:id/access/:uid', pre, async (req) => {
      const user = me(req);
      const { row } = svc.requireRole(req.params.id, user.id, 'viewer');
      if (req.params.uid !== user.id && !svc.canManage(row, user.id)) throw forbidden('Only the owner can remove people');
      ctx.db.prepare('DELETE FROM canvas_access WHERE canvas_id = ? AND user_id = ?').run(row.id, req.params.uid);
      return svc.sharing(row);
    });

    app.delete<{ Params: { id: string; cid: string } }>('/api/canvases/:id/channels/:cid', pre, async (req) => {
      const user = me(req);
      const { row } = svc.requireRole(req.params.id, user.id, 'viewer');
      if (!svc.canManage(row, user.id)) throw forbidden('Only the owner can stop sharing');
      ctx.db.prepare('DELETE FROM canvas_channel_shares WHERE canvas_id = ? AND conversation_id = ?').run(row.id, req.params.cid);
      return svc.sharing(row);
    });

    // ---- block ops ----------------------------------------------------------------------------
    app.post<{ Params: { id: string } }>('/api/canvases/:id/ops', pre, async (req) => {
      const user = me(req);
      const body = parse(opsBody, req.body);
      const { row } = svc.requireRole(req.params.id, user.id, 'editor');
      const { results, applied } = svc.applyOps(row, user.id, body.ops);
      const fresh = svc.getRow(row.id)!;
      if (applied.length) svc.emitUpdated(fresh, user.id, applied, { clientId: body.clientId ?? null });
      return { results, canvas: serializeCanvas(fresh) };
    });

    // ---- presence -----------------------------------------------------------------------------
    ctx.realtime.onClientMessage('canvas.cursor', (user, payload, conn) => {
      const canvasId = payload?.canvasId;
      if (typeof canvasId !== 'string') return;
      const blockId = typeof payload?.blockId === 'string' ? payload.blockId : null;
      svc.presence.cursor(canvasId, user.id, conn, blockId);
    });
    ctx.realtime.onClientMessage('canvas.leave', (user, payload, conn) => {
      if (typeof payload?.canvasId === 'string') svc.presence.leave(payload.canvasId, conn);
    });
    ctx.realtime.onDisconnect((_uid, _remaining, conn) => svc.presence.leaveAll(conn));
  },
};

export default canvases;

// ---------------------------------------------------------------------------------------------
// Service

function createCanvasService(ctx: ModuleContext) {
  const { db } = ctx;
  const q = {
    get: db.prepare('SELECT * FROM canvases WHERE id = ?'),
    byConv: db.prepare('SELECT * FROM canvases WHERE conversation_id = ?'),
    blocks: db.prepare('SELECT * FROM canvas_blocks WHERE canvas_id = ? ORDER BY position, id'),
    block: db.prepare('SELECT * FROM canvas_blocks WHERE id = ?'),
    blockCount: db.prepare('SELECT COUNT(*) AS n FROM canvas_blocks WHERE canvas_id = ?'),
    nextAfter: db.prepare('SELECT position FROM canvas_blocks WHERE canvas_id = ? AND position > ? ORDER BY position LIMIT 1'),
    first: db.prepare('SELECT position FROM canvas_blocks WHERE canvas_id = ? ORDER BY position LIMIT 1'),
    last: db.prepare('SELECT position FROM canvas_blocks WHERE canvas_id = ? ORDER BY position DESC LIMIT 1'),
    posTaken: db.prepare('SELECT id FROM canvas_blocks WHERE canvas_id = ? AND position = ?'),
    access: db.prepare('SELECT role FROM canvas_access WHERE canvas_id = ? AND user_id = ?'),
    channelRoles: db.prepare(`SELECT s.role FROM canvas_channel_shares s
      JOIN conversation_members m ON m.conversation_id = s.conversation_id
      WHERE s.canvas_id = ? AND m.user_id = ?`),
    insertBlock: db.prepare(`INSERT INTO canvas_blocks (id, canvas_id, position, type, text, checked, version,
      text_v, type_v, checked_v, pos_v, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1, 1, 1, ?, ?)`),
  };

  function getRow(id: string): CanvasRow | null {
    return (q.get.get(id) as unknown as CanvasRow) ?? null;
  }
  function byConversation(cid: string): CanvasRow | null {
    return (q.byConv.get(cid) as unknown as CanvasRow) ?? null;
  }
  function blockRows(canvasId: string): BlockRow[] {
    return q.blocks.all(canvasId) as unknown as BlockRow[];
  }
  function getBlock(id: string): BlockRow | null {
    return (q.block.get(id) as unknown as BlockRow) ?? null;
  }

  /** Effective role of a user on a canvas, or null when they cannot see it. */
  function roleFor(c: CanvasRow, userId: string): CanvasRole | null {
    if (!ctx.access.workspaceMember(c.workspace_id, userId)) return null;
    if (c.conversation_id) {
      const conv = ctx.access.getConversation(c.conversation_id);
      if (!conv) return null;
      const member = ctx.access.isConversationMember(conv.id, userId);
      if (member) return conv.is_archived ? 'viewer' : 'editor';
      if (conv.kind === 'channel' && !conv.is_private) return 'viewer';
      return null;
    }
    if (c.created_by === userId) return 'owner';
    let role: CanvasRole | null = ((q.access.get(c.id, userId) as any)?.role as CanvasRole) ?? null;
    for (const r of q.channelRoles.all(c.id, userId) as any[]) role = maxRole(role, r.role);
    return role;
  }

  function canManage(c: CanvasRow, userId: string): boolean {
    if (c.conversation_id) {
      const m = ctx.access.workspaceMember(c.workspace_id, userId);
      return !!m && (m.role === 'owner' || m.role === 'admin' || c.created_by === userId);
    }
    return c.created_by === userId;
  }

  /** 404 when invisible (no leaking), 403 when visible but the role is too low. */
  function requireRole(id: string, userId: string, need: CanvasRole) {
    const row = getRow(id);
    if (!row) throw notFound('Canvas not found');
    const role = roleFor(row, userId);
    if (!role) {
      // Private-channel canvases: the channel's existence is known to workspace members via
      // the conversation API, which answers 403. Mirror that; otherwise 404.
      if (row.conversation_id && ctx.access.workspaceMember(row.workspace_id, userId)) throw forbidden('Not a member of this conversation');
      throw notFound('Canvas not found');
    }
    if (RANK[role] < RANK[need]) throw forbidden(need === 'editor' ? 'You can only view this canvas' : 'Not allowed');
    return { row, role };
  }

  function create(input: { workspaceId: string; conversationId: string | null; title: string; userId: string; blocks: TemplateBlock[] }): CanvasRow {
    const id = ctx.ids.next('D');
    const now = Date.now();
    tx(db, () => {
      db.prepare(`INSERT INTO canvases (id, workspace_id, conversation_id, title, created_by, created_at, updated_at, updated_by, is_template)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(id, input.workspaceId, input.conversationId, input.title, input.userId, now, now, input.userId);
      const keys = keysAfter(null, input.blocks.length);
      input.blocks.forEach((b, i) => {
        q.insertBlock.run(ctx.ids.next('B'), id, keys[i], b.type, b.type === 'divider' ? '' : b.text ?? '', b.checked ? 1 : 0, input.userId, now);
      });
    });
    return getRow(id)!;
  }

  function sharing(c: CanvasRow) {
    return {
      sharedWith: (db.prepare('SELECT user_id, role FROM canvas_access WHERE canvas_id = ? ORDER BY granted_at').all(c.id) as any[])
        .map((r) => ({ userId: r.user_id, role: r.role })),
      sharedChannels: (db.prepare('SELECT conversation_id, role FROM canvas_channel_shares WHERE canvas_id = ? ORDER BY shared_at').all(c.id) as any[])
        .map((r) => ({ conversationId: r.conversation_id, role: r.role })),
    };
  }

  function fullView(c: CanvasRow, userId: string) {
    const role = roleFor(c, userId)!;
    return {
      canvas: serializeCanvas(c),
      blocks: blockRows(c.id).map(serializeBlock),
      access: { role, canEdit: RANK[role] >= RANK.editor, canManage: canManage(c, userId) },
      ...sharing(c),
      viewers: presence.viewers(c.id),
    };
  }

  function listFor(workspaceId: string, userId: string) {
    const rows = db.prepare(`SELECT c.* FROM canvases c WHERE c.workspace_id = ? AND (
        (c.conversation_id IS NULL AND (
          c.created_by = ?
          OR EXISTS (SELECT 1 FROM canvas_access a WHERE a.canvas_id = c.id AND a.user_id = ?)
          OR EXISTS (SELECT 1 FROM canvas_channel_shares s JOIN conversation_members m ON m.conversation_id = s.conversation_id
                     WHERE s.canvas_id = c.id AND m.user_id = ?)))
        OR (c.conversation_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM conversation_members m WHERE m.conversation_id = c.conversation_id AND m.user_id = ?))
      ) ORDER BY c.updated_at DESC LIMIT 500`).all(workspaceId, userId, userId, userId, userId) as unknown as CanvasRow[];
    return rows.map((r) => ({ ...serializeCanvas(r), role: roleFor(r, userId) }));
  }

  /** Users who should receive live updates: everyone with access, plus anyone viewing it now. */
  function audience(c: CanvasRow): string[] {
    const ids = new Set<string>();
    if (c.conversation_id) {
      for (const uid of ctx.realtime.conversationMemberIds(c.conversation_id)) ids.add(uid);
    } else {
      ids.add(c.created_by);
      for (const r of db.prepare('SELECT user_id FROM canvas_access WHERE canvas_id = ?').all(c.id) as any[]) ids.add(r.user_id);
      for (const r of db.prepare(`SELECT m.user_id FROM canvas_channel_shares s JOIN conversation_members m
        ON m.conversation_id = s.conversation_id WHERE s.canvas_id = ?`).all(c.id) as any[]) ids.add(r.user_id);
    }
    for (const v of presence.viewers(c.id)) if (roleFor(c, v.userId)) ids.add(v.userId);
    return [...ids];
  }

  function emitUpdated(c: CanvasRow, actorId: string, ops: AppliedOp[], extra: Record<string, unknown> = {}) {
    ctx.bus.emit({
      type: 'canvas.updated', workspaceId: c.workspace_id, actorId,
      payload: { canvasId: c.id, ops, actorId, ...extra }, audience: audience(c),
    });
  }

  // ---- positions ----
  function nextPositionAfter(canvasId: string, pos: string): string | null {
    return ((q.nextAfter.get(canvasId, pos) as any)?.position as string) ?? null;
  }

  /** Resolve where a block goes: explicit position (de-duplicated) > afterId > end. */
  function resolvePosition(canvasId: string, selfId: string, op: { position?: string; afterId?: string | null }): string {
    if (op.position) {
      const taken = (q.posTaken.get(canvasId, op.position) as any)?.id;
      if (!taken || taken === selfId) return op.position;
      // Two clients picked the same key: slot in right after the existing one.
      return keyBetween(op.position, nextPositionAfter(canvasId, op.position));
    }
    if (op.afterId === null) {
      const first = (q.first.get(canvasId) as any)?.position ?? null;
      return keyBetween(null, first);
    }
    if (op.afterId) {
      const after = getBlock(op.afterId);
      if (after && after.canvas_id === canvasId) {
        const next = nextPositionAfter(canvasId, after.position);
        return keyBetween(after.position, next);
      }
    }
    const last = (q.last.get(canvasId) as any)?.position ?? null;
    return keyBetween(last, null);
  }

  // ---- ops ----
  function applyOps(c: CanvasRow, userId: string, ops: CanvasOp[]) {
    const results: OpResult[] = [];
    const applied: AppliedOp[] = [];
    const now = Date.now();
    tx(db, () => {
      let count = (q.blockCount.get(c.id) as any).n as number;
      for (const op of ops) {
        const existing = getBlock(op.blockId);
        if (existing && existing.canvas_id !== c.id) {
          results.push({ op: op.op, blockId: op.blockId, status: 'error', error: 'Block belongs to another canvas' });
          continue;
        }
        switch (op.op) {
          case 'insert': {
            if (existing) { results.push({ op: 'insert', blockId: op.blockId, status: 'noop', block: serializeBlock(existing) }); break; }
            if (count >= MAX_BLOCKS) { results.push({ op: 'insert', blockId: op.blockId, status: 'error', error: 'Canvas is full' }); break; }
            const pos = resolvePosition(c.id, op.blockId, op);
            q.insertBlock.run(op.blockId, c.id, pos, op.type, op.type === 'divider' ? '' : op.text, op.checked ? 1 : 0, userId, now);
            count++;
            const block = serializeBlock(getBlock(op.blockId)!);
            results.push({ op: 'insert', blockId: op.blockId, status: 'ok', block });
            applied.push({ op: 'insert', block });
            break;
          }
          case 'update': {
            if (!existing) { results.push({ op: 'update', blockId: op.blockId, status: 'gone' }); break; }
            if (op.baseVersion > existing.version) {
              results.push({ op: 'update', blockId: op.blockId, status: 'conflict', block: serializeBlock(existing), conflictFields: [] });
              break;
            }
            const next = {
              type: op.type ?? existing.type,
              text: op.text ?? existing.text,
              checked: op.checked === undefined ? existing.checked : op.checked ? 1 : 0,
            };
            if (next.type === 'divider') next.text = '';
            const changed: ('type' | 'text' | 'checked')[] = [];
            if (next.type !== existing.type) changed.push('type');
            if (next.text !== existing.text) changed.push('text');
            if (next.checked !== existing.checked) changed.push('checked');
            // Per-field optimistic concurrency: reject only if a field we change was changed by
            // someone else after our base version. Other fields merge (last writer wins).
            const conflicts = changed.filter((f) => (existing as any)[`${f}_v`] > op.baseVersion);
            if (conflicts.length) {
              results.push({ op: 'update', blockId: op.blockId, status: 'conflict', block: serializeBlock(existing), conflictFields: conflicts });
              break;
            }
            if (!changed.length) { results.push({ op: 'update', blockId: op.blockId, status: 'noop', block: serializeBlock(existing) }); break; }
            const v = existing.version + 1;
            db.prepare(`UPDATE canvas_blocks SET type = ?, text = ?, checked = ?, version = ?,
              type_v = ?, text_v = ?, checked_v = ?, updated_by = ?, updated_at = ? WHERE id = ?`).run(
              next.type, next.text, next.checked, v,
              changed.includes('type') ? v : existing.type_v,
              changed.includes('text') ? v : existing.text_v,
              changed.includes('checked') ? v : existing.checked_v,
              userId, now, existing.id,
            );
            const block = serializeBlock(getBlock(existing.id)!);
            results.push({ op: 'update', blockId: op.blockId, status: 'ok', block });
            applied.push({ op: 'update', block });
            break;
          }
          case 'move': {
            if (!existing) { results.push({ op: 'move', blockId: op.blockId, status: 'gone' }); break; }
            if (existing.pos_v > op.baseVersion) {
              results.push({ op: 'move', blockId: op.blockId, status: 'conflict', block: serializeBlock(existing), conflictFields: ['position'] });
              break;
            }
            if (op.afterId === op.blockId) { results.push({ op: 'move', blockId: op.blockId, status: 'error', error: 'Cannot move after itself' }); break; }
            const pos = resolvePosition(c.id, existing.id, op);
            if (pos === existing.position) { results.push({ op: 'move', blockId: op.blockId, status: 'noop', block: serializeBlock(existing) }); break; }
            const v = existing.version + 1;
            db.prepare('UPDATE canvas_blocks SET position = ?, version = ?, pos_v = ?, updated_by = ?, updated_at = ? WHERE id = ?')
              .run(pos, v, v, userId, now, existing.id);
            const block = serializeBlock(getBlock(existing.id)!);
            results.push({ op: 'move', blockId: op.blockId, status: 'ok', block });
            applied.push({ op: 'move', block });
            break;
          }
          case 'delete': {
            if (!existing) { results.push({ op: 'delete', blockId: op.blockId, status: 'noop' }); break; }
            // Deleting a block someone edited after we last saw it would silently drop their work.
            if (op.baseVersion !== undefined && existing.text_v > op.baseVersion && existing.text.trim()) {
              results.push({ op: 'delete', blockId: op.blockId, status: 'conflict', block: serializeBlock(existing), conflictFields: ['text'] });
              break;
            }
            db.prepare('DELETE FROM canvas_blocks WHERE id = ?').run(existing.id);
            count--;
            results.push({ op: 'delete', blockId: op.blockId, status: 'ok' });
            applied.push({ op: 'delete', blockId: op.blockId });
            break;
          }
        }
      }
      if (applied.length) db.prepare('UPDATE canvases SET updated_at = ?, updated_by = ? WHERE id = ?').run(now, userId, c.id);
    });
    return { results, applied };
  }

  // ---- presence: who is viewing which canvas, and which block they are in ----
  const viewing = new Map<string, Map<number, { userId: string; blockId: string | null; conn: Connection; at: number }>>();

  const presence = {
    viewers(canvasId: string) {
      const byUser = new Map<string, { userId: string; blockId: string | null; at: number }>();
      for (const v of viewing.get(canvasId)?.values() ?? []) {
        const prev = byUser.get(v.userId);
        if (!prev || v.at > prev.at) byUser.set(v.userId, { userId: v.userId, blockId: v.blockId, at: v.at });
      }
      return [...byUser.values()].map(({ userId, blockId }) => ({ userId, blockId }));
    },
    broadcast(canvasId: string, frame: { type: string; payload: any }, except?: Connection) {
      for (const v of viewing.get(canvasId)?.values() ?? []) if (v.conn !== except) ctx.realtime.send(v.conn, frame);
    },
    snapshot(canvasId: string) {
      presence.broadcast(canvasId, { type: 'canvas.presence', payload: { canvasId, viewers: presence.viewers(canvasId) } });
    },
    cursor(canvasId: string, userId: string, conn: Connection, blockId: string | null) {
      let set = viewing.get(canvasId);
      const joined = !set?.has(conn.id);
      if (joined) {
        const row = getRow(canvasId);
        if (!row || !roleFor(row, userId)) return;
        if (!set) { set = new Map(); viewing.set(canvasId, set); }
      }
      set!.set(conn.id, { userId, blockId, conn, at: Date.now() });
      if (joined) presence.snapshot(canvasId);
      else presence.broadcast(canvasId, { type: 'canvas.cursor', payload: { canvasId, userId, blockId } }, conn);
    },
    leave(canvasId: string, conn: Connection) {
      const set = viewing.get(canvasId);
      if (!set?.delete(conn.id)) return;
      if (!set.size) viewing.delete(canvasId);
      else presence.snapshot(canvasId);
    },
    leaveAll(conn: Connection) {
      for (const canvasId of [...viewing.keys()]) presence.leave(canvasId, conn);
    },
    drop(canvasId: string) { viewing.delete(canvasId); },
  };

  return {
    getRow, byConversation, blockRows, roleFor, canManage, requireRole, create, sharing, fullView, listFor,
    audience, emitUpdated, applyOps, presence,
  };
}
