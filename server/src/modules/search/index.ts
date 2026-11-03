import type { FellowshipModule, ModuleContext } from '../../context';
import { me } from '../../auth';
import { badRequest } from '../../errors';
import { tx } from '../../db';
import { fileInfo, type FileRow } from '../files/info';
import type { MessageRow } from '../core/messages';

/** Markers wrapped around matched words in snippets. The client renders them as <mark>, never as HTML. */
const HL_START = '\u0002';
const HL_END = '\u0003';
const DAY = 24 * 60 * 60 * 1000;
const TYPES = ['messages', 'files', 'channels', 'people'] as const;
type SearchType = (typeof TYPES)[number];
const HAS_VALUES = ['link', 'file', 'reaction', 'pin'] as const;
type HasValue = (typeof HAS_VALUES)[number];

export interface ParsedQuery {
  terms: { text: string; phrase: boolean }[];
  inChannel: string | null;
  from: string | null;
  has: HasValue[];
  isThread: boolean;
  /** created_at strictly before this instant (ms). */
  before: number | null;
  /** created_at at or after this instant (ms). */
  after: number | null;
}

function dayStart(ymd: string, modifier: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw badRequest(`${modifier}: use a date like 2026-03-31`);
  const t = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== ymd) {
    throw badRequest(`${modifier}: "${ymd}" is not a real date`);
  }
  return t;
}

/**
 * Parse the search box text. Words and "quoted phrases" are free text. Modifiers:
 * in:#channel  from:@name  has:link|file|reaction|pin  is:thread  before:/after:/on: YYYY-MM-DD (UTC).
 * after: is exclusive of that day; before: excludes that day; on: is that whole day.
 * Unknown `word:value` tokens are kept as free text.
 */
export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { terms: [], inChannel: null, from: null, has: [], isThread: false, before: null, after: null };
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    if (m[1] !== undefined) {
      const text = m[1].replace(/\s+/g, ' ').trim();
      if (/[\p{L}\p{N}]/u.test(text)) out.terms.push({ text, phrase: true });
      continue;
    }
    const tok = m[2];
    const mod = /^(in|from|has|is|before|after|on):(.+)$/i.exec(tok);
    if (!mod) {
      if (/[\p{L}\p{N}]/u.test(tok)) out.terms.push({ text: tok.replace(/"/g, ''), phrase: false });
      continue;
    }
    const key = mod[1].toLowerCase();
    const value = mod[2];
    switch (key) {
      case 'in': out.inChannel = value.replace(/^#/, '').toLowerCase(); break;
      case 'from': out.from = value.replace(/^@/, '').replace(/\s+/g, '').toLowerCase(); break;
      case 'has': {
        const v = value.toLowerCase() as HasValue;
        if (!HAS_VALUES.includes(v)) throw badRequest('has: accepts link, file, reaction or pin');
        if (!out.has.includes(v)) out.has.push(v);
        break;
      }
      case 'is': {
        if (value.toLowerCase() !== 'thread') throw badRequest('is: only accepts thread');
        out.isThread = true;
        break;
      }
      case 'before': out.before = dayStart(value, 'before:'); break;
      case 'after': out.after = dayStart(value, 'after:') + DAY; break;
      case 'on': {
        const s = dayStart(value, 'on:');
        out.after = s;
        out.before = s + DAY;
        break;
      }
    }
  }
  return out;
}

/** FTS5 MATCH expression: every word is a prefix match, phrases are exact. Terms are ANDed. */
function ftsExpr(terms: ParsedQuery['terms']): string {
  return terms.map((t) => (t.phrase ? `"${t.text}"` : `"${t.text}"*`)).join(' ');
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const VIS_CHANNEL = `EXISTS (SELECT 1 FROM workspace_members wm
   WHERE wm.workspace_id = c.workspace_id AND wm.user_id = ? AND wm.deactivated = 0)
  AND ((c.kind = 'channel' AND c.is_private = 0)
       OR EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = c.id AND cm.user_id = ?))`;

/**
 * Conditions shared by message and file search: the searcher can read the conversation,
 * the conversation is in this workspace, plus the in:/from:/date modifiers.
 */
function filters(p: ParsedQuery, wid: string, uid: string, cols: { user: string; created: string }) {
  const conds: string[] = ['c.workspace_id = ?', VIS_CHANNEL];
  const params: any[] = [wid, uid, uid];
  if (p.inChannel) {
    conds.push(`c.kind = 'channel' AND c.name = ?`);
    params.push(p.inChannel);
  }
  if (p.from) {
    conds.push(`${cols.user} IN (SELECT u.id FROM users u
      WHERE lower(replace(u.display_name, ' ', '')) = ? OR lower(replace(u.full_name, ' ', '')) = ?
         OR lower(substr(u.email, 1, instr(u.email, '@') - 1)) = ?)`);
    params.push(p.from, p.from, p.from);
  }
  if (p.before != null) { conds.push(`${cols.created} < ?`); params.push(p.before); }
  if (p.after != null) { conds.push(`${cols.created} >= ?`); params.push(p.after); }
  return { conds, params };
}

/** Plain text used for snippets without a match (mentions shown as names). */
function messageBody(text: string, userName: (id: string) => string | null, chanName: (id: string) => string | null): string {
  return text
    .replace(/<@([A-Z0-9]+)>/g, (_all, id: string) => {
      const n = userName(id);
      return n ? `@${n}` : '';
    })
    .replace(/<#([A-Z0-9]+)>/g, (_all, id: string) => {
      const n = chanName(id);
      return n ? `#${n}` : '';
    })
    .replace(/<!(channel|here|everyone)>/g, '@$1')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const search: FellowshipModule = {
  name: 'search',
  migrations: [
    `CREATE VIRTUAL TABLE search_messages USING fts5(ref_id UNINDEXED, body, tokenize = 'unicode61 remove_diacritics 2');
     CREATE TABLE search_message_state (ref_id TEXT PRIMARY KEY, body TEXT NOT NULL);
     CREATE VIRTUAL TABLE search_files USING fts5(ref_id UNINDEXED, body, tokenize = 'unicode61 remove_diacritics 2');
     CREATE TABLE search_file_state (ref_id TEXT PRIMARY KEY, body TEXT NOT NULL);`,
  ],
  register(app, ctx: ModuleContext) {
    const { db, auth, access, messages, bus } = ctx;
    const pre = { preHandler: auth.requireUser };

    const userName = db.prepare('SELECT display_name, full_name FROM users WHERE id = ?');
    const chanName = db.prepare('SELECT name FROM conversations WHERE id = ?');
    const msgRow = db.prepare('SELECT id, text, deleted_at FROM messages WHERE id = ?');
    const fileRow = db.prepare('SELECT id, name, deleted_at FROM files WHERE id = ?');
    const msgState = db.prepare('SELECT body FROM search_message_state WHERE ref_id = ?');
    const fileState = db.prepare('SELECT body FROM search_file_state WHERE ref_id = ?');
    const msgFtsDel = db.prepare('DELETE FROM search_messages WHERE ref_id = ?');
    const msgFtsIns = db.prepare('INSERT INTO search_messages (ref_id, body) VALUES (?, ?)');
    const msgStateDel = db.prepare('DELETE FROM search_message_state WHERE ref_id = ?');
    const msgStateIns = db.prepare('INSERT INTO search_message_state (ref_id, body) VALUES (?, ?)');
    const fileFtsDel = db.prepare('DELETE FROM search_files WHERE ref_id = ?');
    const fileFtsIns = db.prepare('INSERT INTO search_files (ref_id, body) VALUES (?, ?)');
    const fileStateDel = db.prepare('DELETE FROM search_file_state WHERE ref_id = ?');
    const fileStateIns = db.prepare('INSERT INTO search_file_state (ref_id, body) VALUES (?, ?)');

    const nameOf = (id: string) => {
      const u = userName.get(id) as { display_name: string; full_name: string } | undefined;
      return u ? (u.display_name || u.full_name) : null;
    };
    const channelOf = (id: string) => (chanName.get(id) as { name: string | null } | undefined)?.name ?? null;
    const bodyOf = (text: string) => messageBody(text, nameOf, channelOf);

    /** Keep the message's index row equal to its current searchable text (no-op when unchanged). */
    function reindexMessage(id: string) {
      const row = msgRow.get(id) as unknown as { id: string; text: string; deleted_at: number | null } | undefined;
      const next = row && row.deleted_at == null ? bodyOf(row.text) : '';
      const prev = msgState.get(id) as { body: string } | undefined;
      if ((prev?.body ?? '') === next) return;
      if (prev) { msgFtsDel.run(id); msgStateDel.run(id); }
      if (next) { msgFtsIns.run(id, next); msgStateIns.run(id, next); }
    }

    function reindexFile(id: string) {
      const row = fileRow.get(id) as unknown as { id: string; name: string; deleted_at: number | null } | undefined;
      const next = row && row.deleted_at == null ? row.name : '';
      const prev = fileState.get(id) as { body: string } | undefined;
      if ((prev?.body ?? '') === next) return;
      if (prev) { fileFtsDel.run(id); fileStateDel.run(id); }
      if (next) { fileFtsIns.run(id, next); fileStateIns.run(id, next); }
    }

    // Startup backfill: index everything live, drop entries for deleted rows. Idempotent.
    tx(db, () => {
      for (const r of db.prepare('SELECT id FROM messages WHERE deleted_at IS NULL').all() as { id: string }[]) reindexMessage(r.id);
      for (const r of db.prepare('SELECT id FROM files WHERE deleted_at IS NULL').all() as { id: string }[]) reindexFile(r.id);
      const staleMsgs = db.prepare('SELECT ref_id FROM search_message_state WHERE ref_id NOT IN (SELECT id FROM messages WHERE deleted_at IS NULL)').all() as { ref_id: string }[];
      for (const r of staleMsgs) { msgFtsDel.run(r.ref_id); msgStateDel.run(r.ref_id); }
      const staleFiles = db.prepare('SELECT ref_id FROM search_file_state WHERE ref_id NOT IN (SELECT id FROM files WHERE deleted_at IS NULL)').all() as { ref_id: string }[];
      for (const r of staleFiles) { fileFtsDel.run(r.ref_id); fileStateDel.run(r.ref_id); }
    });

    // Live sync from the bus.
    for (const type of ['message.created', 'message.updated', 'message.deleted'] as const) {
      ctx.bus.on(type, (e) => { if (e.payload?.message?.id) reindexMessage(e.payload.message.id); });
    }
    bus.on('file.uploaded', (e) => { if (e.payload?.file?.id) reindexFile(e.payload.file.id); });
    bus.on('file.deleted', (e) => { if (e.payload?.fileId) reindexFile(e.payload.fileId); });

    // ---- query ----
    app.get<{ Params: { wid: string }; Querystring: { q?: string; type?: string; cursor?: string; limit?: string } }>(
      '/api/w/:wid/search', pre, async (req) => {
        const user = me(req);
        const wid = req.params.wid;
        access.requireWorkspaceMember(wid, user.id);
        const q = (req.query.q ?? '').slice(0, 500);
        const type = (req.query.type ?? 'messages') as SearchType;
        if (!TYPES.includes(type)) throw badRequest(`type must be one of ${TYPES.join(', ')}`);
        const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 50);
        const cursor = req.query.cursor ? Number(req.query.cursor) : 0;
        if (!Number.isInteger(cursor) || cursor < 0) throw badRequest('cursor is invalid');

        const p = parseQuery(q);
        const parsed = {
          terms: p.terms.map((t) => t.text), in: p.inChannel, from: p.from, has: p.has, is: p.isThread ? 'thread' : null,
          before: p.before, after: p.after,
        };
        const base = { query: q, type, parsed };
        const hasText = p.terms.length > 0;
        const page = (rows: unknown[]) => {
          const hasMore = rows.length > limit;
          return { hasMore, rows: rows.slice(0, limit), nextCursor: hasMore ? String(cursor + limit) : null };
        };

        if (type === 'messages') {
          if (!hasText && !p.inChannel && !p.from && !p.has.length && !p.isThread && p.before == null && p.after == null) {
            return { ...base, results: [], nextCursor: null };
          }
          const f = filters(p, wid, user.id, { user: 'm.user_id', created: 'm.created_at' });
          const conds = [...f.conds, 'm.deleted_at IS NULL'];
          const params: any[] = [...f.params];
          for (const h of p.has) {
            if (h === 'link') conds.push(`(m.text LIKE '%http://%' OR m.text LIKE '%https://%' OR m.text LIKE '%www.%')`);
            if (h === 'file') conds.push(`EXISTS (SELECT 1 FROM files fl WHERE fl.message_id = m.id AND fl.deleted_at IS NULL)`);
            if (h === 'reaction') conds.push(`EXISTS (SELECT 1 FROM reactions r WHERE r.message_id = m.id)`);
            if (h === 'pin') conds.push(`EXISTS (SELECT 1 FROM pins pn WHERE pn.message_id = m.id)`);
          }
          if (p.isThread) conds.push('(m.thread_root_id IS NOT NULL OR m.reply_count > 0)');
          const from = hasText
            ? 'FROM search_messages JOIN messages m ON m.id = search_messages.ref_id JOIN conversations c ON c.id = m.conversation_id'
            : 'FROM messages m JOIN conversations c ON c.id = m.conversation_id';
          if (hasText) {
            conds.unshift('search_messages MATCH ?');
            params.unshift(ftsExpr(p.terms));
          }
          const order = hasText ? 'ORDER BY bm25(search_messages), m.created_at DESC, m.id DESC' : 'ORDER BY m.created_at DESC, m.id DESC';
          const snip = hasText ? `snippet(search_messages, 1, '${HL_START}', '${HL_END}', '…', 24)` : 'NULL';
          const rows = db.prepare(
            `SELECT m.*, c.name AS conv_name, c.kind AS conv_kind, c.is_private AS conv_private, ${snip} AS snip
             ${from} WHERE ${conds.join(' AND ')} ${order} LIMIT ? OFFSET ?`,
          ).all(...params, limit + 1, cursor) as any[];
          const pg = page(rows);
          const serialized = messages.serialize(pg.rows as MessageRow[], user.id);
          return {
            ...base,
            results: pg.rows.map((r: any, i: number) => ({
              type: 'message',
              message: serialized[i],
              snippet: r.snip ?? bodyOf(r.text).slice(0, 200),
              conversation: { id: r.conversation_id, name: r.conv_name, kind: r.conv_kind, isPrivate: !!r.conv_private },
            })),
            nextCursor: pg.nextCursor,
          };
        }

        if (type === 'files') {
          if (!hasText && !p.inChannel && !p.from && p.before == null && p.after == null) {
            return { ...base, results: [], nextCursor: null };
          }
          const f = filters(p, wid, user.id, { user: 'f.user_id', created: 'f.created_at' });
          const conds = [...f.conds, 'f.deleted_at IS NULL', 'f.message_id IS NOT NULL', 'm.deleted_at IS NULL'];
          const params: any[] = [...f.params];
          const from = hasText
            ? 'FROM search_files JOIN files f ON f.id = search_files.ref_id'
            : 'FROM files f';
          if (hasText) {
            conds.unshift('search_files MATCH ?');
            params.unshift(ftsExpr(p.terms));
          }
          const order = hasText ? 'ORDER BY bm25(search_files), f.created_at DESC, f.id DESC' : 'ORDER BY f.created_at DESC, f.id DESC';
          const rows = db.prepare(
            `SELECT f.*, c.name AS conv_name, c.kind AS conv_kind, c.is_private AS conv_private
             ${from}
             JOIN messages m ON m.id = f.message_id
             JOIN conversations c ON c.id = f.conversation_id
             WHERE ${conds.join(' AND ')} ${order} LIMIT ? OFFSET ?`,
          ).all(...params, limit + 1, cursor) as any[];
          const pg = page(rows);
          return {
            ...base,
            results: pg.rows.map((r: any) => ({
              type: 'file',
              file: fileInfo(r as FileRow),
              conversation: { id: r.conversation_id, name: r.conv_name, kind: r.conv_kind, isPrivate: !!r.conv_private },
              messageId: r.message_id,
            })),
            nextCursor: pg.nextCursor,
          };
        }

        if (type === 'channels') {
          if (!hasText) return { ...base, results: [], nextCursor: null };
          // Public channels are visible to every workspace member; private ones only to their members.
          const conds = [
            'c.workspace_id = ?',
            "c.kind = 'channel'",
            `EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = c.workspace_id AND wm.user_id = ? AND wm.deactivated = 0)`,
            `(c.is_private = 0 OR EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = c.id AND cm.user_id = ?))`,
          ];
          const params: any[] = [wid, user.id, user.id];
          for (const t of p.terms) {
            const like = `%${likeEscape(t.text.toLowerCase())}%`;
            conds.push(`(lower(c.name) LIKE ? ESCAPE '\\' OR lower(c.topic) LIKE ? ESCAPE '\\' OR lower(c.description) LIKE ? ESCAPE '\\')`);
            params.push(like, like, like);
          }
          const first = `${likeEscape(p.terms[0].text.toLowerCase())}%`;
          const rows = db.prepare(
            `SELECT c.*,
               (SELECT COUNT(*) FROM conversation_members cm WHERE cm.conversation_id = c.id) AS member_count,
               EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = c.id AND cm.user_id = ?) AS is_member
             FROM conversations c WHERE ${conds.join(' AND ')}
             ORDER BY (lower(c.name) LIKE ? ESCAPE '\\') DESC, c.name LIMIT ? OFFSET ?`,
          ).all(user.id, ...params, first, limit + 1, cursor) as any[];
          const pg = page(rows);
          return {
            ...base,
            results: pg.rows.map((r: any) => ({
              type: 'channel',
              conversation: {
                id: r.id, name: r.name, topic: r.topic, description: r.description, isPrivate: !!r.is_private,
                isArchived: !!r.is_archived, memberCount: r.member_count, isMember: !!r.is_member,
              },
            })),
            nextCursor: pg.nextCursor,
          };
        }

        // people
        if (!hasText) return { ...base, results: [], nextCursor: null };
        const conds = ['wm.workspace_id = ?', 'wm.deactivated = 0'];
        const params: any[] = [wid];
        for (const t of p.terms) {
          const like = `%${likeEscape(t.text.toLowerCase())}%`;
          conds.push(`(lower(u.full_name) LIKE ? ESCAPE '\\' OR lower(u.display_name) LIKE ? ESCAPE '\\'
            OR lower(u.email) LIKE ? ESCAPE '\\' OR lower(u.title) LIKE ? ESCAPE '\\')`);
          params.push(like, like, like, like);
        }
        const first = `${likeEscape(p.terms[0].text.toLowerCase())}%`;
        const rows = db.prepare(
          `SELECT u.* FROM workspace_members wm JOIN users u ON u.id = wm.user_id
           WHERE ${conds.join(' AND ')}
           ORDER BY (lower(u.display_name) LIKE ? ESCAPE '\\' OR lower(u.full_name) LIKE ? ESCAPE '\\') DESC, u.full_name
           LIMIT ? OFFSET ?`,
        ).all(...params, first, first, limit + 1, cursor) as any[];
        const pg = page(rows);
        return {
          ...base,
          results: pg.rows.map((u: any) => ({
            type: 'person',
            user: {
              id: u.id, fullName: u.full_name, displayName: u.display_name || u.full_name, title: u.title,
              avatarUrl: u.avatar_url, isBot: !!u.is_bot, statusEmoji: u.status_emoji, statusText: u.status_text,
            },
          })),
          nextCursor: pg.nextCursor,
        };
      },
    );
  },
};

export default search;
