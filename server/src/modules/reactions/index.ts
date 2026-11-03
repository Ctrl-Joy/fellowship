import type { FellowshipModule, ModuleContext } from '../../context';
import { me } from '../../auth';
import { notFound, badRequest } from '../../errors';
import { parse, z } from '../../validate';

const emojiBody = z.object({ emoji: z.string().min(1).max(32) });

/** Emoji must be a single non-whitespace token (unicode emoji or a short name). */
function cleanEmoji(raw: string): string {
  const e = raw.trim();
  if (!e || /\s/.test(e)) throw badRequest('emoji must be a single emoji');
  return e;
}

/** Reactions: toggle per (message, user, emoji), live events, and the message enricher. */
const reactions: FellowshipModule = {
  name: 'reactions',
  migrations: [
    `CREATE TABLE reactions (
      message_id TEXT NOT NULL REFERENCES messages(id),
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (message_id, user_id, emoji)
    );
    CREATE INDEX reactions_message ON reactions(message_id, created_at);`,
  ],
  register(app, ctx: ModuleContext) {
    const { db, auth, access, messages, bus } = ctx;
    const pre = { preHandler: auth.requireUser };

    /** [{emoji, userIds}] in first-reacted order (viewer-independent). */
    function reactionsFor(messageIds: string[]): Map<string, { emoji: string; userIds: string[] }[]> {
      const out = new Map<string, { emoji: string; userIds: string[] }[]>();
      if (!messageIds.length) return out;
      const ph = messageIds.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${ph}) ORDER BY created_at, rowid`,
      ).all(...messageIds) as any[];
      for (const r of rows) {
        let list = out.get(r.message_id);
        if (!list) { list = []; out.set(r.message_id, list); }
        let entry = list.find((x) => x.emoji === r.emoji);
        if (!entry) { entry = { emoji: r.emoji, userIds: [] }; list.push(entry); }
        entry.userIds.push(r.user_id);
      }
      return out;
    }

    messages.addEnricher((msgs) => {
      const map = reactionsFor(msgs.map((m) => m.id));
      for (const m of msgs) m.reactions = map.get(m.id) ?? [];
    });

    /** Message that a reaction may target: must exist and not be deleted. */
    function targetFor(mid: string, userId: string) {
      const row = messages.getRow(mid);
      if (!row || row.deleted_at) throw notFound('Message not found');
      const { conv } = access.requireConversationRead(row.conversation_id, userId);
      access.requireConversationMember(conv.id, userId);
      return { row, conv };
    }

    function emitChange(type: 'reaction.added' | 'reaction.removed', row: { id: string; conversation_id: string }, conv: { workspace_id: string }, emoji: string, userId: string) {
      bus.emit({
        type, workspaceId: conv.workspace_id, conversationId: row.conversation_id, actorId: userId,
        payload: {
          messageId: row.id, conversationId: row.conversation_id, emoji, userId,
          reactions: reactionsFor([row.id]).get(row.id) ?? [],
        },
      });
    }

    // Toggle: adds the reaction if the viewer has not used this emoji on the message, otherwise removes it.
    app.post<{ Params: { mid: string } }>('/api/messages/:mid/reactions', pre, async (req) => {
      const user = me(req);
      const body = parse(emojiBody, req.body);
      const emoji = cleanEmoji(body.emoji);
      const { row, conv } = targetFor(req.params.mid, user.id);
      const existing = db.prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
        .get(row.id, user.id, emoji);
      if (existing) {
        db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(row.id, user.id, emoji);
      } else {
        db.prepare('INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)')
          .run(row.id, user.id, emoji, Date.now());
      }
      emitChange(existing ? 'reaction.removed' : 'reaction.added', row, conv, emoji, user.id);
      return { message: messages.get(row.id, user.id), added: !existing };
    });

    // Explicit removal. Removing a reaction that is not there is a no-op (no event).
    app.delete<{ Params: { mid: string; emoji: string } }>('/api/messages/:mid/reactions/:emoji', pre, async (req) => {
      const user = me(req);
      const emoji = cleanEmoji(req.params.emoji);
      const { row, conv } = targetFor(req.params.mid, user.id);
      const res = db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
        .run(row.id, user.id, emoji);
      if (res.changes > 0) emitChange('reaction.removed', row, conv, emoji, user.id);
      return { message: messages.get(row.id, user.id), removed: res.changes > 0 };
    });
  },
};

export default reactions;
