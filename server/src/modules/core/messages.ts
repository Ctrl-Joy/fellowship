import type { Db } from '../../db';
import { tx } from '../../db';
import type { Bus } from '../../bus';
import type { Ids } from '../../ids';
import type { Access } from './access';
import { badRequest, forbidden, notFound } from '../../errors';

export interface MessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  text: string;
  thread_root_id: string | null;
  reply_count: number;
  last_reply_at: number | null;
  edited_at: number | null;
  deleted_at: number | null;
  client_msg_id: string | null;
  created_at: number;
  subtype: string | null;
  meta_json: string | null;
}

export interface FileInfo {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  thumbUrl?: string | null;
  width?: number | null;
  height?: number | null;
  [k: string]: unknown;
}

export interface Message {
  id: string;
  conversationId: string;
  userId: string;
  text: string;
  threadRootId: string | null;
  replyCount: number;
  lastReplyAt: number | null;
  replyUserIds: string[];
  editedAt: number | null;
  deletedAt: number | null;
  createdAt: number;
  clientMsgId: string | null;
  subtype: string | null;
  meta: any | null;
  reactions: { emoji: string; userIds: string[] }[];
  files: FileInfo[];
  pinned: boolean;
  saved: boolean;
}

/** Enrichers mutate the serialized messages in place (e.g. fill reactions / files). */
export type Enricher = (messages: Message[], viewerId: string | null) => void;

export interface PostInput {
  conversationId: string;
  userId: string;
  text: string;
  clientMsgId?: string | null;
  threadRootId?: string | null;
  alsoSendToChannel?: boolean;
  fileIds?: string[];
  subtype?: string | null;
  meta?: any;
  /** Skip the conversation-membership check (system / bot / workflow posts). */
  force?: boolean;
  /** Override timestamp (seed / imports only). */
  createdAt?: number;
}

/** Runs inside post()'s transaction, after the row is inserted, before serialization/emit. */
export type PostHook = (row: MessageRow, input: PostInput) => void;

/** Root-level rows: real roots plus thread replies that were "also sent to channel". */
export const ROOT_FILTER = "(m.thread_root_id IS NULL OR m.subtype = 'thread_broadcast')";
export const MAX_TEXT = 40000;

export function createMessageService(db: Db, bus: Bus, ids: Ids, access: Access) {
  const enrichers: Enricher[] = [];
  const postHooks: PostHook[] = [];

  const getRowStmt = db.prepare('SELECT * FROM messages WHERE id = ?');
  const byClientId = db.prepare('SELECT * FROM messages WHERE user_id = ? AND client_msg_id = ?');

  function getRow(id: string): MessageRow | null {
    return (getRowStmt.get(id) as unknown as MessageRow) ?? null;
  }

  const placeholders = (n: number) => Array(n).fill('?').join(',');

  /** Turn DB rows into the public Message shape for a viewer (null = viewer-agnostic, used for WS). */
  function serialize(rows: MessageRow[], viewerId: string | null): Message[] {
    if (rows.length === 0) return [];
    const msgIds = rows.map((r) => r.id);
    const ph = placeholders(msgIds.length);

    const pinned = new Set(
      (db.prepare(`SELECT message_id FROM pins WHERE message_id IN (${ph})`).all(...msgIds) as any[])
        .map((r) => r.message_id),
    );
    const saved = new Set<string>(
      viewerId
        ? (db.prepare(`SELECT message_id FROM saved_items WHERE user_id = ? AND message_id IN (${ph})`)
            .all(viewerId, ...msgIds) as any[]).map((r) => r.message_id)
        : [],
    );
    const roots = rows.filter((r) => r.reply_count > 0).map((r) => r.id);
    const replyUsers = new Map<string, string[]>();
    if (roots.length) {
      const rs = db.prepare(
        `SELECT thread_root_id AS root, user_id, MAX(created_at) AS last FROM messages
         WHERE thread_root_id IN (${placeholders(roots.length)}) AND deleted_at IS NULL
         GROUP BY thread_root_id, user_id ORDER BY last DESC`,
      ).all(...roots) as any[];
      for (const r of rs) {
        const list = replyUsers.get(r.root) ?? [];
        if (list.length < 5) list.push(r.user_id);
        replyUsers.set(r.root, list);
      }
    }

    const out: Message[] = rows.map((r) => {
      const deleted = r.deleted_at != null;
      let meta: any = null;
      if (r.meta_json && !deleted) {
        try { meta = JSON.parse(r.meta_json); } catch { meta = null; }
      }
      return {
        id: r.id,
        conversationId: r.conversation_id,
        userId: r.user_id,
        text: deleted ? '' : r.text,
        threadRootId: r.thread_root_id,
        replyCount: r.reply_count,
        lastReplyAt: r.last_reply_at,
        replyUserIds: replyUsers.get(r.id) ?? [],
        editedAt: r.edited_at,
        deletedAt: r.deleted_at,
        createdAt: r.created_at,
        clientMsgId: r.client_msg_id,
        subtype: r.subtype,
        meta,
        reactions: [],
        files: [],
        pinned: pinned.has(r.id),
        saved: saved.has(r.id),
      };
    });
    for (const fn of enrichers) fn(out, viewerId);
    return out;
  }

  function serializeOne(row: MessageRow, viewerId: string | null): Message {
    return serialize([row], viewerId)[0];
  }

  function get(id: string, viewerId: string | null): Message | null {
    const row = getRow(id);
    return row ? serializeOne(row, viewerId) : null;
  }

  function recountThread(rootId: string) {
    db.prepare(
      `UPDATE messages SET
        reply_count = (SELECT COUNT(*) FROM messages r WHERE r.thread_root_id = ? AND r.deleted_at IS NULL),
        last_reply_at = (SELECT MAX(created_at) FROM messages r WHERE r.thread_root_id = ? AND r.deleted_at IS NULL)
       WHERE id = ?`,
    ).run(rootId, rootId, rootId);
  }

  function emitUpdated(row: MessageRow, actorId: string | null) {
    const conv = access.getConversation(row.conversation_id)!;
    bus.emit({
      type: 'message.updated', workspaceId: conv.workspace_id, conversationId: conv.id,
      actorId, payload: { message: serializeOne(row, null) },
    });
  }

  /** The single path for creating messages (API, bots, webhooks, workflows). Emits message.created. */
  function post(input: PostInput): Message & { deduped?: boolean } {
    if (input.clientMsgId) {
      const existing = byClientId.get(input.userId, input.clientMsgId) as unknown as MessageRow | undefined;
      if (existing) return { ...serializeOne(existing, input.userId), deduped: true };
    }
    const conv = access.getConversation(input.conversationId);
    if (!conv) throw notFound('Conversation not found');
    if (conv.is_archived) throw forbidden('This channel is archived');
    if (!input.force && !access.isConversationMember(conv.id, input.userId)) {
      throw forbidden('Join the conversation to post');
    }
    const text = (input.text ?? '').replace(/\s+$/, '');
    if (text.length > MAX_TEXT) throw badRequest('Message is too long');
    if (!text.trim() && !(input.fileIds && input.fileIds.length) && !input.subtype) {
      throw badRequest('Message is empty');
    }

    let rootId: string | null = null;
    if (input.threadRootId) {
      const root = getRow(input.threadRootId);
      if (!root || root.conversation_id !== conv.id || root.deleted_at) throw badRequest('Thread not found');
      rootId = root.thread_root_id ?? root.id;
    }
    const subtype = rootId && input.alsoSendToChannel ? 'thread_broadcast' : (input.subtype ?? null);
    const createdAt = input.createdAt ?? Date.now();
    const id = ids.next('M');
    const isPlainReply = !!rootId && subtype !== 'thread_broadcast';

    const row = tx(db, () => {
      db.prepare(
        `INSERT INTO messages (id, conversation_id, user_id, text, thread_root_id, client_msg_id, created_at, subtype, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, conv.id, input.userId, text, rootId, input.clientMsgId ?? null, createdAt, subtype,
        input.meta != null ? JSON.stringify(input.meta) : null);
      const inserted = getRow(id)!;
      for (const hook of postHooks) hook(inserted, input);
      if (rootId) recountThread(rootId);
      if (!isPlainReply) {
        // Your own channel-level message counts as read.
        db.prepare(
          'UPDATE conversation_members SET last_read_ts = MAX(last_read_ts, ?) WHERE conversation_id = ? AND user_id = ?',
        ).run(createdAt, conv.id, input.userId);
      }
      return getRow(id)!;
    });

    const message = serializeOne(row, null);
    bus.emit({
      type: 'message.created', workspaceId: conv.workspace_id, conversationId: conv.id,
      actorId: input.userId, payload: { message },
    });
    if (rootId) emitUpdated(getRow(rootId)!, input.userId);
    return message;
  }

  function edit(id: string, actorId: string, text: string): Message {
    const row = getRow(id);
    if (!row || row.deleted_at) throw notFound('Message not found');
    if (row.user_id !== actorId) throw forbidden('You can only edit your own messages');
    const clean = text.replace(/\s+$/, '');
    if (!clean.trim()) throw badRequest('Message is empty');
    if (clean.length > MAX_TEXT) throw badRequest('Message is too long');
    db.prepare('UPDATE messages SET text = ?, edited_at = ? WHERE id = ?').run(clean, Date.now(), id);
    const updated = getRow(id)!;
    emitUpdated(updated, actorId);
    return serializeOne(updated, actorId);
  }

  /** Soft delete. Authors may delete their own; workspace owners/admins may delete any. */
  function remove(id: string, actorId: string): Message {
    const row = getRow(id);
    if (!row || row.deleted_at) throw notFound('Message not found');
    const conv = access.getConversation(row.conversation_id)!;
    if (row.user_id !== actorId) {
      const m = access.workspaceMember(conv.workspace_id, actorId);
      if (!m || (m.role !== 'owner' && m.role !== 'admin')) throw forbidden('You can only delete your own messages');
    }
    tx(db, () => {
      db.prepare("UPDATE messages SET deleted_at = ?, text = '', meta_json = NULL WHERE id = ?").run(Date.now(), id);
      db.prepare('DELETE FROM pins WHERE message_id = ?').run(id);
      if (row.thread_root_id) recountThread(row.thread_root_id);
    });
    const message = serializeOne(getRow(id)!, null);
    bus.emit({
      type: 'message.deleted', workspaceId: conv.workspace_id, conversationId: conv.id,
      actorId, payload: { message },
    });
    if (row.thread_root_id) emitUpdated(getRow(row.thread_root_id)!, actorId);
    return message;
  }

  /**
   * Root-level messages, newest page first, returned in ascending order.
   * `before` is a message id (preferred) or a millisecond timestamp.
   */
  function listRoots(conversationId: string, viewerId: string, opts: { before?: string; limit?: number }) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const params: any[] = [conversationId];
    let cursor = '';
    if (opts.before) {
      if (/^\d+$/.test(opts.before)) {
        cursor = 'AND m.created_at < ?';
        params.push(Number(opts.before));
      } else {
        const b = getRow(opts.before);
        if (b) {
          cursor = 'AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))';
          params.push(b.created_at, b.created_at, b.id);
        }
      }
    }
    params.push(limit + 1);
    const rows = db.prepare(
      `SELECT m.* FROM messages m
       WHERE m.conversation_id = ? AND ${ROOT_FILTER}
         AND NOT (m.deleted_at IS NOT NULL AND m.reply_count = 0)
         ${cursor}
       ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
    ).all(...params) as unknown as MessageRow[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    return { messages: serialize(page, viewerId), hasMore };
  }

  /** All live replies of a thread, ascending. */
  function listReplies(rootId: string, viewerId: string): Message[] {
    const rows = db.prepare(
      'SELECT * FROM messages WHERE thread_root_id = ? AND deleted_at IS NULL ORDER BY created_at ASC, id ASC',
    ).all(rootId) as unknown as MessageRow[];
    return serialize(rows, viewerId);
  }

  return {
    serialize,
    serializeOne,
    get,
    getRow,
    post,
    edit,
    remove,
    listRoots,
    listReplies,
    recountThread,
    emitUpdated,
    /** Register a function that fills fields (reactions, files, …) on serialized messages. */
    addEnricher(fn: Enricher) { enrichers.push(fn); },
    /** Register a hook that runs inside post()'s transaction right after insert (e.g. attach fileIds). */
    addPostHook(fn: PostHook) { postHooks.push(fn); },
  };
}

export type MessageService = ReturnType<typeof createMessageService>;
