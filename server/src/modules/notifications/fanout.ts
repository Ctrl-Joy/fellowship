import type { ModuleContext } from '../../context';
import type { BusEvent } from '../../bus';
import { presenceFor } from '../presence/service';
import { clockFor } from '../presence/clock';
import { createPrefsStore } from './store';
import { loadDtos } from './dto';
import {
  KIND_PRIORITY, effectiveLevel, isSilenced, levelAllows, matchKeywords, parseMentions,
  type ConversationLevel, type NotificationKind,
} from './rules';

interface MemberRow {
  user_id: string;
  notify_pref: ConversationLevel;
  muted: number;
  timezone: string;
}

interface ConvRow {
  id: string;
  workspace_id: string;
  kind: string;
}

/**
 * Turns bus events into notification rows. Runs synchronously inside bus.emit, after the
 * triggering write has committed. Recipients are always current conversation members in an
 * active workspace membership, so nothing leaks from channels a user is not in.
 */
export function registerFanout(ctx: ModuleContext) {
  const { db, bus, ids, messages } = ctx;
  const presence = presenceFor(ctx);
  const clock = clockFor(ctx);
  const prefs = createPrefsStore(db);

  const getConv = db.prepare('SELECT id, workspace_id, kind FROM conversations WHERE id = ?');
  const membersFor = db.prepare(
    `SELECT cm.user_id, cm.notify_pref, cm.muted, u.timezone
     FROM conversation_members cm
     JOIN workspace_members wm ON wm.user_id = cm.user_id AND wm.workspace_id = ? AND wm.deactivated = 0
     JOIN users u ON u.id = cm.user_id
     WHERE cm.conversation_id = ? AND cm.user_id != ? AND u.is_bot = 0`,
  );
  const memberOf = db.prepare(
    `SELECT cm.user_id, cm.notify_pref, cm.muted, u.timezone
     FROM conversation_members cm
     JOIN workspace_members wm ON wm.user_id = cm.user_id AND wm.workspace_id = ? AND wm.deactivated = 0
     JOIN users u ON u.id = cm.user_id
     WHERE cm.conversation_id = ? AND cm.user_id = ?`,
  );
  // Threads module keeps thread_followers (root author and every replier, following = 1).
  const followersTable = db.prepare(`SELECT user_id FROM thread_followers WHERE root_id = ? AND following = 1`);
  // Fallback when the threads table is unavailable: root author plus everyone who has replied.
  const followersFallback = db.prepare(
    `SELECT DISTINCT user_id FROM messages
     WHERE (id = ? OR thread_root_id = ?) AND deleted_at IS NULL`,
  );
  function followersOf(rootId: string): Set<string> {
    try {
      return new Set((followersTable.all(rootId) as any[]).map((r) => r.user_id));
    } catch {
      return new Set((followersFallback.all(rootId, rootId) as any[]).map((r) => r.user_id));
    }
  }
  const insert = db.prepare(
    `INSERT OR IGNORE INTO notifications
       (id, user_id, workspace_id, kind, conversation_id, message_id, actor_id, emoji, silenced, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  function notify(args: {
    userId: string; workspaceId: string; kind: NotificationKind; conversationId: string;
    messageId: string; actorId: string; emoji?: string; silenced: boolean;
  }) {
    if (args.userId === args.actorId) return;
    const id = ids.next('N');
    const r = insert.run(
      id, args.userId, args.workspaceId, args.kind, args.conversationId, args.messageId,
      args.actorId, args.emoji ?? '', args.silenced ? 1 : 0, clock.now(),
    );
    if (r.changes === 0) return;
    const [notification] = loadDtos(db, [id]);
    bus.emit({
      type: 'notification.created', workspaceId: args.workspaceId, conversationId: args.conversationId,
      actorId: args.actorId, audience: [args.userId], payload: { notification },
    });
  }

  function onMessageCreated(event: BusEvent) {
    const m = event.payload?.message;
    if (!m || m.deletedAt) return;
    const conv = getConv.get(m.conversationId) as ConvRow | undefined;
    if (!conv || conv.kind === 'self') return;
    const isChannel = conv.kind === 'channel';
    const members = membersFor.all(conv.workspace_id, conv.id, m.userId) as unknown as MemberRow[];
    if (!members.length) return;

    const text: string = m.text ?? '';
    const mentions = parseMentions(text);
    const followers = m.threadRootId ? followersOf(m.threadRootId) : new Set<string>();
    const now = clock.now();

    for (const mem of members) {
      if (mem.muted) continue;
      const p = prefs.load(mem.user_id, conv.workspace_id);
      const level = effectiveLevel(p.level, mem.notify_pref);
      if (level === 'nothing') continue;

      const candidates: NotificationKind[] = [];
      if (!isChannel) {
        candidates.push('dm');
      } else {
        if (mentions.users.has(mem.user_id)) candidates.push('mention');
        // @here only reaches members who are active right now.
        if (mentions.channel || (mentions.here && presence.isActive(mem.user_id))) candidates.push('channel_broadcast');
        if (followers.has(mem.user_id)) candidates.push('thread_reply');
        if (p.keywordList.length && matchKeywords(text, p.keywordList)) candidates.push('keyword');
        // Conversation or global level "all": every plain channel message.
        if (level === 'all' && !m.threadRootId) candidates.push('channel_broadcast');
      }
      const kind = KIND_PRIORITY.find((k) => candidates.includes(k) && levelAllows(level, k));
      if (!kind) continue;

      notify({
        userId: mem.user_id, workspaceId: conv.workspace_id, kind, conversationId: conv.id,
        messageId: m.id, actorId: m.userId, silenced: isSilenced(p, mem.timezone, now),
      });
    }
  }

  function onReactionAdded(event: BusEvent) {
    const pl = event.payload ?? {};
    const messageId: unknown = pl.messageId ?? pl.message?.id ?? pl.message_id;
    const actorId: unknown = event.actorId ?? pl.userId;
    if (typeof messageId !== 'string' || typeof actorId !== 'string') return;
    const row = messages.getRow(messageId);
    if (!row || row.deleted_at || row.user_id === actorId) return;
    const conv = getConv.get(row.conversation_id) as ConvRow | undefined;
    if (!conv || conv.kind === 'self') return;
    const author = memberOf.get(conv.workspace_id, conv.id, row.user_id) as unknown as MemberRow | undefined;
    if (!author || author.muted) return;
    const p = prefs.load(author.user_id, conv.workspace_id);
    if (!levelAllows(effectiveLevel(p.level, author.notify_pref), 'reaction')) return;
    notify({
      userId: author.user_id, workspaceId: conv.workspace_id, kind: 'reaction', conversationId: conv.id,
      messageId: row.id, actorId, emoji: typeof pl.emoji === 'string' ? pl.emoji.slice(0, 64) : '',
      silenced: isSilenced(p, author.timezone, clock.now()),
    });
  }

  /** Reading a conversation marks the notifications from before the read cursor as read. */
  function onConversationRead(event: BusEvent) {
    const userId = event.actorId;
    const conversationId = event.payload?.conversationId ?? event.conversationId;
    const ts = event.payload?.lastReadTs;
    if (!userId || !conversationId || typeof ts !== 'number') return;
    db.prepare(
      'UPDATE notifications SET read_at = ? WHERE user_id = ? AND conversation_id = ? AND read_at IS NULL AND created_at <= ?',
    ).run(clock.now(), userId, conversationId, ts);
  }

  bus.on('message.created', onMessageCreated);
  bus.on('reaction.added', onReactionAdded);
  bus.on('conversation.read', onConversationRead);
}
