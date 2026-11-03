import type { ModuleContext } from '../../context';
import { tx } from '../../db';
import { conflict, forbidden } from '../../errors';

/** Full-mesh WebRTC gets expensive quickly: every participant uploads one stream per peer. */
export const MAX_PARTICIPANTS = 8;

export interface HuddleRow {
  id: string;
  conversation_id: string;
  workspace_id: string;
  started_by: string;
  started_at: number;
  ended_at: number | null;
  message_id: string | null;
}

export interface ParticipantRow {
  huddle_id: string;
  user_id: string;
  joined_at: number;
  left_at: number | null;
  muted: number;
  video: number;
  screen: number;
}

export interface HuddleParticipant {
  userId: string;
  joinedAt: number;
  muted: boolean;
  video: boolean;
  screen: boolean;
}

export interface Huddle {
  id: string;
  conversationId: string;
  workspaceId: string;
  startedBy: string;
  startedAt: number;
  endedAt: number | null;
  messageId: string | null;
  participants: HuddleParticipant[];
  /** Everyone who was ever in the huddle (for the summary). */
  everParticipantIds: string[];
}

export type HuddleChange =
  | { type: 'joined'; userId: string }
  | { type: 'left'; userId: string; reason: 'left' | 'disconnected' | 'removed' }
  | { type: 'media'; userId: string };

export interface MediaPatch { muted?: boolean; video?: boolean; screen?: boolean }

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'under a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function createHuddleService(ctx: ModuleContext) {
  const { db, bus, messages } = ctx;

  const q = {
    byId: db.prepare('SELECT * FROM huddles WHERE id = ?'),
    activeForConv: db.prepare('SELECT * FROM huddles WHERE conversation_id = ? AND ended_at IS NULL'),
    activeParts: db.prepare('SELECT * FROM huddle_participants WHERE huddle_id = ? AND left_at IS NULL ORDER BY joined_at, user_id'),
    allParts: db.prepare('SELECT user_id FROM huddle_participants WHERE huddle_id = ? ORDER BY joined_at, user_id'),
    part: db.prepare('SELECT * FROM huddle_participants WHERE huddle_id = ? AND user_id = ?'),
    userActive: db.prepare(
      `SELECT h.* FROM huddles h JOIN huddle_participants p ON p.huddle_id = h.id
       WHERE p.user_id = ? AND p.left_at IS NULL AND h.ended_at IS NULL`,
    ),
    allActiveParts: db.prepare(
      `SELECT p.huddle_id, p.user_id FROM huddle_participants p JOIN huddles h ON h.id = p.huddle_id
       WHERE p.left_at IS NULL AND h.ended_at IS NULL`,
    ),
    activeForWorkspaceMember: db.prepare(
      `SELECT h.* FROM huddles h JOIN conversation_members cm ON cm.conversation_id = h.conversation_id AND cm.user_id = ?
       WHERE h.workspace_id = ? AND h.ended_at IS NULL ORDER BY h.started_at`,
    ),
    userName: db.prepare('SELECT display_name, full_name FROM users WHERE id = ?'),
  };

  function getRow(id: string): HuddleRow | null {
    return (q.byId.get(id) as unknown as HuddleRow) ?? null;
  }

  function activeRowFor(conversationId: string): HuddleRow | null {
    return (q.activeForConv.get(conversationId) as unknown as HuddleRow) ?? null;
  }

  function activeParticipantRows(huddleId: string): ParticipantRow[] {
    return q.activeParts.all(huddleId) as unknown as ParticipantRow[];
  }

  function isActiveParticipant(huddleId: string, userId: string): boolean {
    const h = getRow(huddleId);
    if (!h || h.ended_at != null) return false;
    const p = q.part.get(huddleId, userId) as unknown as ParticipantRow | undefined;
    return !!p && p.left_at == null;
  }

  function serialize(row: HuddleRow): Huddle {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      workspaceId: row.workspace_id,
      startedBy: row.started_by,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      messageId: row.message_id,
      participants: row.ended_at != null ? [] : activeParticipantRows(row.id).map((p) => ({
        userId: p.user_id, joinedAt: p.joined_at, muted: !!p.muted, video: !!p.video, screen: !!p.screen,
      })),
      everParticipantIds: (q.allParts.all(row.id) as any[]).map((r) => r.user_id),
    };
  }

  function emit(type: 'huddle.started' | 'huddle.updated' | 'huddle.ended', row: HuddleRow, actorId: string | null, change?: HuddleChange) {
    bus.emit({
      type, workspaceId: row.workspace_id, conversationId: row.conversation_id, actorId,
      payload: { huddle: serialize(row), change: change ?? null },
    });
  }

  function nameOf(userId: string) {
    const u = q.userName.get(userId) as any;
    return (u?.display_name || u?.full_name || 'Someone') as string;
  }

  /** Join (starting it if needed) the conversation's huddle. Caller has checked membership. */
  function join(conversationId: string, workspaceId: string, userId: string, media: MediaPatch = {}): Huddle {
    const existing = activeRowFor(conversationId);
    if (existing && isActiveParticipant(existing.id, userId)) {
      // Re-join (e.g. page reload): keep the row, tell peers to reset their connection to us.
      if (media.muted !== undefined) setMedia(existing.id, userId, { muted: media.muted }, false);
      emit('huddle.updated', getRow(existing.id)!, userId, { type: 'joined', userId });
      return serialize(getRow(existing.id)!);
    }
    if (existing && activeParticipantRows(existing.id).length >= MAX_PARTICIPANTS) {
      throw conflict(`This huddle is full (${MAX_PARTICIPANTS} people max)`, 'huddle_full');
    }
    // One huddle at a time per user: leave any other one first.
    for (const other of q.userActive.all(userId) as unknown as HuddleRow[]) {
      if (other.conversation_id !== conversationId) leave(other.id, userId, 'left');
    }

    const now = Date.now();
    let row = existing;
    let started = false;
    tx(db, () => {
      if (!row) {
        const id = ctx.ids.next('H');
        db.prepare(
          'INSERT INTO huddles (id, conversation_id, workspace_id, started_by, started_at) VALUES (?, ?, ?, ?, ?)',
        ).run(id, conversationId, workspaceId, userId, now);
        row = getRow(id)!;
        started = true;
      }
      db.prepare(
        `INSERT INTO huddle_participants (huddle_id, user_id, joined_at, left_at, muted, video, screen)
         VALUES (?, ?, ?, NULL, ?, 0, 0)
         ON CONFLICT(huddle_id, user_id) DO UPDATE SET left_at = NULL, joined_at = excluded.joined_at,
           muted = excluded.muted, video = 0, screen = 0`,
      ).run(row!.id, userId, now, media.muted ? 1 : 0);
    });

    if (started) {
      // System message whose thread is the huddle chat.
      const msg = messages.post({
        conversationId, userId, text: 'Started a huddle', subtype: 'huddle',
        meta: { huddleId: row!.id, status: 'active', startedAt: now },
      });
      db.prepare('UPDATE huddles SET message_id = ? WHERE id = ?').run(msg.id, row!.id);
      emit('huddle.started', getRow(row!.id)!, userId, { type: 'joined', userId });
    } else {
      emit('huddle.updated', getRow(row!.id)!, userId, { type: 'joined', userId });
    }
    return serialize(getRow(row!.id)!);
  }

  /** Remove a participant; ends the huddle when it becomes empty. Returns the updated huddle (null if not in it). */
  function leave(huddleId: string, userId: string, reason: 'left' | 'disconnected' | 'removed'): Huddle | null {
    const row = getRow(huddleId);
    if (!row || row.ended_at != null || !isActiveParticipant(huddleId, userId)) return null;
    const now = Date.now();
    db.prepare(
      'UPDATE huddle_participants SET left_at = ?, muted = 0, video = 0, screen = 0 WHERE huddle_id = ? AND user_id = ?',
    ).run(now, huddleId, userId);
    listeners.left.forEach((fn) => fn(huddleId, userId));
    if (activeParticipantRows(huddleId).length === 0) return end(huddleId, userId);
    const updated = getRow(huddleId)!;
    emit('huddle.updated', updated, userId, { type: 'left', userId, reason });
    return serialize(updated);
  }

  /** End a huddle: everyone leaves, the start message becomes a summary. */
  function end(huddleId: string, actorId: string | null): Huddle | null {
    const row = getRow(huddleId);
    if (!row || row.ended_at != null) return null;
    const now = Date.now();
    tx(db, () => {
      for (const p of activeParticipantRows(huddleId)) listeners.left.forEach((fn) => fn(huddleId, p.user_id));
      db.prepare('UPDATE huddle_participants SET left_at = ? WHERE huddle_id = ? AND left_at IS NULL').run(now, huddleId);
      db.prepare('UPDATE huddles SET ended_at = ? WHERE id = ?').run(now, huddleId);
    });
    const ended = getRow(huddleId)!;
    const everyone = (q.allParts.all(huddleId) as any[]).map((r) => r.user_id as string);
    if (ended.message_id) {
      const msgRow = messages.getRow(ended.message_id);
      if (msgRow && !msgRow.deleted_at) {
        const duration = now - ended.started_at;
        const text = `Huddle ended · ${formatDuration(duration)} · ${everyone.map(nameOf).join(', ')}`;
        let meta: any = {};
        try { meta = msgRow.meta_json ? JSON.parse(msgRow.meta_json) : {}; } catch { meta = {}; }
        meta = { ...meta, huddleId, status: 'ended', endedAt: now, durationMs: duration, participantIds: everyone };
        db.prepare('UPDATE messages SET text = ?, meta_json = ? WHERE id = ?').run(text, JSON.stringify(meta), msgRow.id);
        messages.emitUpdated(messages.getRow(msgRow.id)!, actorId);
      }
    }
    emit('huddle.ended', ended, actorId);
    return serialize(ended);
  }

  function setMedia(huddleId: string, userId: string, patch: MediaPatch, broadcast = true): Huddle {
    if (!isActiveParticipant(huddleId, userId)) throw forbidden('You are not in this huddle');
    const sets: string[] = [];
    const vals: number[] = [];
    for (const k of ['muted', 'video', 'screen'] as const) {
      if (patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(patch[k] ? 1 : 0); }
    }
    if (sets.length) {
      db.prepare(`UPDATE huddle_participants SET ${sets.join(', ')} WHERE huddle_id = ? AND user_id = ?`).run(...vals, huddleId, userId);
    }
    const row = getRow(huddleId)!;
    if (broadcast && sets.length) emit('huddle.updated', row, userId, { type: 'media', userId });
    return serialize(row);
  }

  const listeners = { left: new Set<(huddleId: string, userId: string) => void>() };

  return {
    getRow,
    activeRowFor,
    serialize,
    isActiveParticipant,
    join,
    leave,
    end,
    setMedia,
    activeForUser: (userId: string) => q.userActive.all(userId) as unknown as HuddleRow[],
    activeInWorkspace: (workspaceId: string, viewerId: string) =>
      (q.activeForWorkspaceMember.all(viewerId, workspaceId) as unknown as HuddleRow[]).map(serialize),
    allActiveParticipants: () => q.allActiveParts.all() as { huddle_id: string; user_id: string }[],
    /** Called whenever someone stops being a participant (leave or end). */
    onParticipantLeft(fn: (huddleId: string, userId: string) => void) { listeners.left.add(fn); },
  };
}

export type HuddleService = ReturnType<typeof createHuddleService>;
