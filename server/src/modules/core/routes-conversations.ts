import type { FastifyInstance } from 'fastify';
import type { ModuleContext } from '../../context';
import { me } from '../../auth';
import { parse, z } from '../../validate';
import { badRequest, conflict, forbidden, notFound } from '../../errors';
import { tx } from '../../db';
import { DEFAULT_CHANNELS, loadConversation, loadConversations } from './serializers';
import type { ConversationRow } from './access';

export const CHANNEL_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;

export function normalizeChannelName(name: string) {
  return name.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 80);
}

const createChannelBody = z.object({
  name: z.string().min(1).max(80),
  isPrivate: z.boolean().optional(),
  topic: z.string().max(250).optional(),
  description: z.string().max(250).optional(),
  memberIds: z.array(z.string()).max(500).optional(),
});

const patchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  topic: z.string().max(250).optional(),
  description: z.string().max(250).optional(),
  isPrivate: z.boolean().optional(),
  notifyPref: z.enum(['default', 'all', 'mentions', 'nothing']).optional(),
  muted: z.boolean().optional(),
});

const dmBody = z.object({ userIds: z.array(z.string()).max(8) });
const membersBody = z.object({ userIds: z.array(z.string()).min(1).max(500) });
const archiveBody = z.object({ archived: z.boolean().optional() });
const readBody = z.object({ ts: z.number().int().nonnegative() });

export interface ConversationHelpers {
  createChannel(workspaceId: string, userId: string, input: {
    name: string; isPrivate?: boolean; topic?: string; description?: string; memberIds?: string[];
  }): ConversationRow;
  addMember(conversationId: string, userId: string, actorId: string): boolean;
  openDm(workspaceId: string, userId: string, otherIds: string[]): ConversationRow;
}

export function registerConversationRoutes(app: FastifyInstance, ctx: ModuleContext): ConversationHelpers {
  const { db, auth, bus, ids, access } = ctx;
  const pre = { preHandler: auth.requireUser };

  function emitConversation(type: string, conv: ConversationRow, actorId: string, extra: Record<string, any> = {}) {
    const dto = loadConversation(db, actorId, conv.id, true);
    bus.emit({
      type, workspaceId: conv.workspace_id, conversationId: conv.id, actorId,
      payload: { conversation: dto, ...extra },
    });
  }

  function addMember(conversationId: string, userId: string, actorId: string): boolean {
    const conv = access.getConversation(conversationId)!;
    const r = db.prepare(
      'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at, last_read_ts) VALUES (?, ?, ?, ?)',
    ).run(conversationId, userId, Date.now(), Date.now());
    if (r.changes === 0) return false;
    bus.emit({
      type: 'member.joined', workspaceId: conv.workspace_id, conversationId, actorId,
      payload: { conversationId, userId, conversation: loadConversation(db, userId, conversationId, true) },
    });
    return true;
  }

  function createChannel(workspaceId: string, userId: string, input: {
    name: string; isPrivate?: boolean; topic?: string; description?: string; memberIds?: string[];
  }): ConversationRow {
    const name = normalizeChannelName(input.name);
    if (!CHANNEL_NAME_RE.test(name)) {
      throw badRequest('Channel names can only contain lowercase letters, numbers, hyphens and underscores', 'invalid_name');
    }
    if (db.prepare("SELECT 1 FROM conversations WHERE workspace_id = ? AND kind = 'channel' AND name = ?").get(workspaceId, name)) {
      throw conflict('A channel with that name already exists', 'name_taken');
    }
    const id = ids.next('C');
    const now = Date.now();
    tx(db, () => {
      db.prepare(
        `INSERT INTO conversations (id, workspace_id, kind, name, topic, description, is_private, created_by, created_at)
         VALUES (?, ?, 'channel', ?, ?, ?, ?, ?, ?)`,
      ).run(id, workspaceId, name, input.topic ?? '', input.description ?? '', input.isPrivate ? 1 : 0, userId, now);
      db.prepare(
        'INSERT INTO conversation_members (conversation_id, user_id, joined_at, last_read_ts) VALUES (?, ?, ?, ?)',
      ).run(id, userId, now, now);
    });
    const conv = access.getConversation(id)!;
    emitConversation('conversation.created', conv, userId);
    for (const mid of input.memberIds ?? []) {
      if (mid !== userId && access.workspaceMember(workspaceId, mid)) addMember(id, mid, userId);
    }
    return conv;
  }

  function openDm(workspaceId: string, userId: string, otherIds: string[]): ConversationRow {
    const memberIds = [...new Set([userId, ...otherIds])].sort();
    if (memberIds.length > 9) throw badRequest('Group conversations are limited to 9 people');
    for (const uid of memberIds) {
      if (!access.workspaceMember(workspaceId, uid)) throw badRequest('Everyone must be a member of this workspace');
    }
    const key = memberIds.join(',');
    const existing = db.prepare('SELECT * FROM conversations WHERE workspace_id = ? AND dm_key = ?').get(workspaceId, key) as unknown as ConversationRow | undefined;
    if (existing) return existing;
    const kind = memberIds.length === 1 ? 'self' : memberIds.length === 2 ? 'dm' : 'group_dm';
    const id = ids.next('C');
    const now = Date.now();
    tx(db, () => {
      db.prepare(
        `INSERT INTO conversations (id, workspace_id, kind, name, is_private, created_by, created_at, dm_key)
         VALUES (?, ?, ?, NULL, 1, ?, ?, ?)`,
      ).run(id, workspaceId, kind, userId, now, key);
      const ins = db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at, last_read_ts) VALUES (?, ?, ?, ?)');
      for (const uid of memberIds) ins.run(id, uid, now, uid === userId ? now : 0);
    });
    const conv = access.getConversation(id)!;
    emitConversation('conversation.created', conv, userId);
    return conv;
  }

  // ---- routes ----

  app.get<{ Params: { wid: string } }>('/api/w/:wid/conversations', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceMember(req.params.wid, user.id);
    const conversations = loadConversations(db, user.id, 'c.workspace_id = ? AND cm.user_id IS NOT NULL', [req.params.wid]);
    return { conversations };
  });

  app.get<{ Params: { wid: string }; Querystring: { q?: string; includeArchived?: string } }>(
    '/api/w/:wid/channels/browse', pre, async (req) => {
      const user = me(req);
      access.requireWorkspaceMember(req.params.wid, user.id);
      const q = (req.query.q ?? '').trim().toLowerCase();
      const archived = req.query.includeArchived === '1' || req.query.includeArchived === 'true';
      const conversations = loadConversations(
        db, user.id,
        `c.workspace_id = ? AND c.kind = 'channel' AND (c.is_private = 0 OR cm.user_id IS NOT NULL)
         ${archived ? '' : 'AND c.is_archived = 0'} AND (? = '' OR instr(c.name, ?) > 0 OR instr(lower(c.description), ?) > 0)`,
        [req.params.wid, q, q, q],
      );
      return { channels: conversations };
    },
  );

  app.post<{ Params: { wid: string } }>('/api/w/:wid/channels', pre, async (req) => {
    const user = me(req);
    const m = access.requireWorkspaceMember(req.params.wid, user.id);
    if (m.role === 'guest') throw forbidden('Guests cannot create channels');
    const body = parse(createChannelBody, req.body);
    const conv = createChannel(req.params.wid, user.id, body);
    return { conversation: loadConversation(db, user.id, conv.id) };
  });

  app.post<{ Params: { wid: string } }>('/api/w/:wid/dms', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceMember(req.params.wid, user.id);
    const body = parse(dmBody, req.body);
    const conv = openDm(req.params.wid, user.id, body.userIds);
    return { conversation: loadConversation(db, user.id, conv.id) };
  });

  app.get<{ Params: { cid: string } }>('/api/conversations/:cid', pre, async (req) => {
    const user = me(req);
    access.requireConversationRead(req.params.cid, user.id);
    return { conversation: loadConversation(db, user.id, req.params.cid) };
  });

  app.get<{ Params: { cid: string } }>('/api/conversations/:cid/members', pre, async (req) => {
    const user = me(req);
    access.requireConversationRead(req.params.cid, user.id);
    const rows = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? ORDER BY joined_at').all(req.params.cid) as any[];
    return { userIds: rows.map((r) => r.user_id) };
  });

  app.patch<{ Params: { cid: string } }>('/api/conversations/:cid', pre, async (req) => {
    const user = me(req);
    const { conv } = access.requireConversationMember(req.params.cid, user.id);
    const body = parse(patchBody, req.body);
    const isDefault = conv.kind === 'channel' && DEFAULT_CHANNELS.includes(conv.name ?? '');
    let changed = false;
    if (body.name !== undefined) {
      if (conv.kind !== 'channel') throw badRequest('Only channels have names');
      if (isDefault) throw forbidden('The default channel cannot be renamed');
      const name = normalizeChannelName(body.name);
      if (!CHANNEL_NAME_RE.test(name)) throw badRequest('Invalid channel name', 'invalid_name');
      if (name !== conv.name) {
        if (db.prepare("SELECT 1 FROM conversations WHERE workspace_id = ? AND kind = 'channel' AND name = ? AND id != ?").get(conv.workspace_id, name, conv.id)) {
          throw conflict('A channel with that name already exists', 'name_taken');
        }
        db.prepare('UPDATE conversations SET name = ? WHERE id = ?').run(name, conv.id);
        changed = true;
      }
    }
    if (body.topic !== undefined) { db.prepare('UPDATE conversations SET topic = ? WHERE id = ?').run(body.topic.trim(), conv.id); changed = true; }
    if (body.description !== undefined) { db.prepare('UPDATE conversations SET description = ? WHERE id = ?').run(body.description.trim(), conv.id); changed = true; }
    if (body.isPrivate !== undefined) {
      if (conv.kind !== 'channel' || isDefault) throw badRequest('This conversation\'s visibility cannot change');
      db.prepare('UPDATE conversations SET is_private = ? WHERE id = ?').run(body.isPrivate ? 1 : 0, conv.id);
      changed = true;
    }
    // Personal settings (not broadcast).
    if (body.notifyPref !== undefined) db.prepare('UPDATE conversation_members SET notify_pref = ? WHERE conversation_id = ? AND user_id = ?').run(body.notifyPref, conv.id, user.id);
    if (body.muted !== undefined) db.prepare('UPDATE conversation_members SET muted = ? WHERE conversation_id = ? AND user_id = ?').run(body.muted ? 1 : 0, conv.id, user.id);
    if (changed) emitConversation('conversation.updated', access.getConversation(conv.id)!, user.id);
    return { conversation: loadConversation(db, user.id, conv.id) };
  });

  app.post<{ Params: { cid: string } }>('/api/conversations/:cid/join', pre, async (req) => {
    const user = me(req);
    const { conv, isMember } = access.requireConversationRead(req.params.cid, user.id);
    if (conv.kind !== 'channel') throw badRequest('You can only join channels');
    if (conv.is_archived) throw forbidden('This channel is archived');
    if (!isMember) addMember(conv.id, user.id, user.id);
    return { conversation: loadConversation(db, user.id, conv.id) };
  });

  app.post<{ Params: { cid: string } }>('/api/conversations/:cid/leave', pre, async (req) => {
    const user = me(req);
    const { conv } = access.requireConversationMember(req.params.cid, user.id);
    if (conv.kind !== 'channel') throw badRequest('You can only leave channels');
    if (DEFAULT_CHANNELS.includes(conv.name ?? '')) throw forbidden('Everyone stays in the default channel');
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(conv.id, user.id);
    bus.emit({
      type: 'member.left', workspaceId: conv.workspace_id, conversationId: conv.id, actorId: user.id,
      payload: { conversationId: conv.id, userId: user.id },
    });
    return { ok: true };
  });

  app.post<{ Params: { cid: string } }>('/api/conversations/:cid/members', pre, async (req) => {
    const user = me(req);
    const { conv } = access.requireConversationMember(req.params.cid, user.id);
    if (conv.kind !== 'channel') throw badRequest('Start a new group conversation to add people');
    if (conv.is_archived) throw forbidden('This channel is archived');
    const body = parse(membersBody, req.body);
    const added: string[] = [];
    for (const uid of body.userIds) {
      if (!access.workspaceMember(conv.workspace_id, uid)) throw badRequest('Everyone must be a member of this workspace');
      if (addMember(conv.id, uid, user.id)) added.push(uid);
    }
    return { added, conversation: loadConversation(db, user.id, conv.id) };
  });

  app.delete<{ Params: { cid: string; uid: string } }>('/api/conversations/:cid/members/:uid', pre, async (req) => {
    const user = me(req);
    const { conv, wsMember } = access.requireConversationMember(req.params.cid, user.id);
    if (conv.kind !== 'channel' || DEFAULT_CHANNELS.includes(conv.name ?? '')) throw badRequest('Members cannot be removed here');
    if (req.params.uid !== user.id && conv.created_by !== user.id && wsMember.role !== 'owner' && wsMember.role !== 'admin') {
      throw forbidden('Only the channel creator or an admin can remove people');
    }
    const r = db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(conv.id, req.params.uid);
    if (r.changes) {
      bus.emit({
        type: 'member.left', workspaceId: conv.workspace_id, conversationId: conv.id, actorId: user.id,
        payload: { conversationId: conv.id, userId: req.params.uid },
      });
    }
    return { ok: true };
  });

  app.post<{ Params: { cid: string } }>('/api/conversations/:cid/archive', pre, async (req) => {
    const user = me(req);
    const { conv } = access.requireConversationMember(req.params.cid, user.id);
    if (conv.kind !== 'channel') throw badRequest('Only channels can be archived');
    if (DEFAULT_CHANNELS.includes(conv.name ?? '')) throw forbidden('The default channel cannot be archived');
    const body = parse(archiveBody, req.body);
    const archived = body.archived ?? true;
    db.prepare('UPDATE conversations SET is_archived = ? WHERE id = ?').run(archived ? 1 : 0, conv.id);
    emitConversation('conversation.archived', access.getConversation(conv.id)!, user.id);
    return { conversation: loadConversation(db, user.id, conv.id) };
  });

  app.post<{ Params: { cid: string } }>('/api/conversations/:cid/read', pre, async (req) => {
    const user = me(req);
    const { conv } = access.requireConversationMember(req.params.cid, user.id);
    const body = parse(readBody, req.body);
    db.prepare('UPDATE conversation_members SET last_read_ts = ? WHERE conversation_id = ? AND user_id = ?').run(body.ts, conv.id, user.id);
    const dto = loadConversation(db, user.id, conv.id);
    // Personal event: only the reader's own clients (other tabs/devices) get it.
    bus.emit({
      type: 'conversation.read', workspaceId: conv.workspace_id, conversationId: conv.id, actorId: user.id,
      audience: [user.id],
      payload: { conversationId: conv.id, lastReadTs: body.ts, unreadCount: dto?.unreadCount ?? 0, mentionCount: dto?.mentionCount ?? 0 },
    });
    return { conversation: dto };
  });

  return { createChannel, addMember, openDm };
}
