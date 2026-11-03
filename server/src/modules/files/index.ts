import { createReadStream, createWriteStream, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FellowshipModule, ModuleContext } from '../../context';
import { me } from '../../auth';
import { badRequest, forbidden, notFound, HttpError } from '../../errors';
import type { ConversationRow } from '../core/access';
import { fileInfo, isInlineMime, probeImage, safeMime, cleanName, type FileRow } from './info';

const MB = 1024 * 1024;
/** Per-file size cap. Configure with FELLOWSHIP_MAX_FILE_MB (default 25). */
export function maxFileBytes(): number {
  const n = Number(process.env.FELLOWSHIP_MAX_FILE_MB ?? 25);
  return (Number.isFinite(n) && n > 0 ? n : 25) * MB;
}
const MAX_FILES_PER_REQUEST = 10;

/** Parse a single `bytes=` range. Returns null when absent/unsupported, 'invalid' when unsatisfiable. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix <= 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (size === 0 || start >= size || start > end) return 'invalid';
  return { start, end };
}

function contentDisposition(inline: boolean, name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  const rfc = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${rfc}`;
}

const files: FellowshipModule = {
  name: 'files',
  migrations: [
    `CREATE TABLE files (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      storage_key TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at INTEGER NOT NULL,
      deleted_at INTEGER,
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL
    );
    CREATE INDEX files_conversation ON files(conversation_id, created_at);
    CREATE INDEX files_message ON files(message_id);
    CREATE INDEX files_user ON files(user_id);`,
  ],
  register(app, ctx: ModuleContext) {
    const { db, auth, access, messages, bus, ids, config } = ctx;
    const pre = { preHandler: auth.requireUser };
    const uploadsDir = config.uploadsDir;
    mkdirSync(uploadsDir, { recursive: true });

    const getFile = db.prepare('SELECT * FROM files WHERE id = ?');
    const insertFile = db.prepare(
      `INSERT INTO files (id, workspace_id, conversation_id, user_id, name, mime, size, storage_key, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const deleteFileRow = db.prepare('DELETE FROM files WHERE id = ?');
    const attachStmt = db.prepare('UPDATE files SET message_id = ? WHERE id = ?');

    /** A file may be attached once, by its uploader, in the same conversation, while it is live. */
    messages.addPostHook((row, input) => {
      const fileIds = [...new Set(input.fileIds ?? [])];
      if (!fileIds.length) return;
      for (const fid of fileIds) {
        const f = getFile.get(fid) as unknown as FileRow | undefined;
        if (!f || f.deleted_at || f.message_id || f.conversation_id !== row.conversation_id || f.user_id !== input.userId) {
          throw badRequest(`Attachment ${fid} is not available to attach to this message`, 'bad_attachment');
        }
      }
      for (const fid of fileIds) attachStmt.run(row.id, fid);
    });

    /** Fill `files` on every serialized message (deleted messages show none). */
    messages.addEnricher((msgs) => {
      const live = msgs.filter((m) => !m.deletedAt);
      if (!live.length) return;
      const ph = live.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT * FROM files WHERE message_id IN (${ph}) AND deleted_at IS NULL ORDER BY created_at, id`,
      ).all(...live.map((m) => m.id)) as unknown as FileRow[];
      const byMsg = new Map<string, ReturnType<typeof fileInfo>[]>();
      for (const r of rows) {
        const list = byMsg.get(r.message_id!) ?? [];
        list.push(fileInfo(r));
        byMsg.set(r.message_id!, list);
      }
      for (const m of live) m.files = byMsg.get(m.id) ?? [];
    });

    // ---- limits ----
    app.get<{ Params: { wid: string } }>('/api/w/:wid/files/limits', pre, async (req) => {
      access.requireWorkspaceMember(req.params.wid, me(req).id);
      return { maxFileBytes: maxFileBytes(), maxFilesPerRequest: MAX_FILES_PER_REQUEST };
    });

    // ---- upload ----
    // Multipart: send the `conversationId` field BEFORE the file parts. Several files per request.
    app.post<{ Params: { wid: string } }>('/api/w/:wid/files', pre, async (req) => {
      const user = me(req);
      const wid = req.params.wid;
      access.requireWorkspaceMember(wid, user.id);
      const limit = maxFileBytes();
      let conversationId: string | null = null;
      let conv: ConversationRow | null = null;
      const created: FileRow[] = [];
      const written: string[] = [];
      try {
        const parts = req.parts({ limits: { fileSize: limit, files: MAX_FILES_PER_REQUEST, fields: 4 } });
        for await (const part of parts) {
          if (part.type === 'field') {
            if (part.fieldname === 'conversationId') conversationId = String(part.value ?? '');
            continue;
          }
          if (!conv) {
            if (!conversationId) throw badRequest('conversationId must be sent before the files');
            const r = access.requireConversationMember(conversationId, user.id);
            if (r.conv.workspace_id !== wid) throw notFound('Conversation not found');
            if (r.conv.is_archived) throw forbidden('This channel is archived');
            conv = r.conv;
          }
          if (!part.filename) throw badRequest('Every file part needs a file name');
          const id = ids.next('F');
          const path = join(uploadsDir, id);
          await pipeline(part.file, createWriteStream(path));
          written.push(path);
          if (part.file.truncated) {
            throw new HttpError(413, 'file_too_large', `Each file must be ${Math.round(limit / MB)} MB or smaller`);
          }
          const size = statSync(path).size;
          if (size === 0) throw badRequest('Empty files cannot be uploaded');
          const name = cleanName(part.filename);
          const probe = probeImage(path);
          const mime = probe?.mime ?? safeMime(part.mimetype, name);
          insertFile.run(id, wid, conv.id, user.id, name, mime, size, id, probe?.width ?? null, probe?.height ?? null, Date.now());
          created.push(getFile.get(id) as unknown as FileRow);
        }
        if (!conv || created.length === 0) throw badRequest('No files were uploaded');
      } catch (err) {
        // All-or-nothing: drop anything stored by this request.
        for (const r of created) deleteFileRow.run(r.id);
        for (const p of written) { try { unlinkSync(p); } catch { /* already gone */ } }
        throw err;
      }
      const out = created.map(fileInfo);
      for (const f of out) {
        bus.emit({ type: 'file.uploaded', workspaceId: wid, conversationId: conv!.id, actorId: user.id, payload: { file: f } });
      }
      return { files: out };
    });

    // ---- download / preview ----
    app.get<{ Params: { fid: string; name: string } }>('/files/:fid/:name', pre, async (req, reply) => {
      const user = me(req);
      const row = getFile.get(req.params.fid) as unknown as FileRow | undefined;
      if (!row || row.deleted_at) throw notFound('File not found');
      access.requireConversationRead(row.conversation_id, user.id);
      const path = join(uploadsDir, row.storage_key);
      let size: number;
      try { size = statSync(path).size; } catch { throw notFound('File is missing from storage'); }

      const inline = isInlineMime(row.mime);
      reply.header('Content-Type', row.mime);
      reply.header('Content-Disposition', contentDisposition(inline, row.name));
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Cache-Control', 'private, max-age=3600');
      // Even if a browser renders the file, it runs no scripts and loads nothing.
      if (row.mime !== 'application/pdf') reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");

      const range = parseRange(req.headers.range, size);
      if (range === 'invalid') {
        reply.status(416).header('Content-Range', `bytes */${size}`).send();
        return reply;
      }
      if (range) {
        reply.status(206);
        reply.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
        reply.header('Content-Length', range.end - range.start + 1);
        reply.send(createReadStream(path, { start: range.start, end: range.end }));
        return reply;
      }
      reply.header('Content-Length', size);
      reply.send(createReadStream(path));
      return reply;
    });

    // ---- delete (uploader, or workspace owner/admin) ----
    app.delete<{ Params: { fid: string } }>('/api/files/:fid', pre, async (req) => {
      const user = me(req);
      const row = getFile.get(req.params.fid) as unknown as FileRow | undefined;
      if (!row || row.deleted_at) throw notFound('File not found');
      access.requireConversationRead(row.conversation_id, user.id);
      if (row.user_id !== user.id) {
        const m = access.workspaceMember(row.workspace_id, user.id);
        if (!m || (m.role !== 'owner' && m.role !== 'admin')) {
          throw forbidden('Only the uploader or a workspace admin can delete this file');
        }
      }
      db.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').run(Date.now(), row.id);
      try { unlinkSync(join(uploadsDir, row.storage_key)); } catch { /* already gone */ }
      bus.emit({
        type: 'file.deleted', workspaceId: row.workspace_id, conversationId: row.conversation_id,
        actorId: user.id, payload: { fileId: row.id, messageId: row.message_id },
      });
      if (row.message_id) {
        const mr = messages.getRow(row.message_id);
        if (mr) messages.emitUpdated(mr, user.id);
      }
      return { ok: true, fileId: row.id };
    });

    // ---- per-conversation Files tab (attached files only, newest first) ----
    app.get<{ Params: { cid: string }; Querystring: { before?: string; limit?: string } }>(
      '/api/conversations/:cid/files', pre, async (req) => {
        const user = me(req);
        access.requireConversationRead(req.params.cid, user.id);
        const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
        const before = req.query.before ? Number(req.query.before) : null;
        if (req.query.before && !Number.isFinite(before)) throw badRequest('before must be a timestamp');
        const rows = (before != null
          ? db.prepare(
            `SELECT f.* FROM files f JOIN messages m ON m.id = f.message_id AND m.deleted_at IS NULL
             WHERE f.conversation_id = ? AND f.deleted_at IS NULL AND f.created_at < ?
             ORDER BY f.created_at DESC, f.id DESC LIMIT ?`,
          ).all(req.params.cid, before, limit + 1)
          : db.prepare(
            `SELECT f.* FROM files f JOIN messages m ON m.id = f.message_id AND m.deleted_at IS NULL
             WHERE f.conversation_id = ? AND f.deleted_at IS NULL
             ORDER BY f.created_at DESC, f.id DESC LIMIT ?`,
          ).all(req.params.cid, limit + 1)) as unknown as FileRow[];
        const hasMore = rows.length > limit;
        const page = rows.slice(0, limit);
        return { files: page.map(fileInfo), hasMore, nextBefore: hasMore ? page[page.length - 1].created_at : null };
      },
    );
  },
};

export default files;
