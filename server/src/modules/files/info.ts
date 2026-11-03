import { openSync, readSync, closeSync } from 'node:fs';

/** Row shape of the `files` table (see index.ts migrations). */
export interface FileRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  user_id: string;
  name: string;
  mime: string;
  size: number;
  storage_key: string;
  width: number | null;
  height: number | null;
  created_at: number;
  deleted_at: number | null;
  message_id: string | null;
}

/** Public shape (matches FileInfo in core/messages.ts; extra fields are additive). */
export type FileInfoDto = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  kind: 'image' | 'video' | 'audio' | 'pdf' | 'file';
  conversationId: string;
  workspaceId: string;
  userId: string;
  messageId: string | null;
  createdAt: number;
};

export function fileKind(mime: string): FileInfoDto['kind'] {
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  return 'file';
}

/** Types the browser may display in place. Everything else is a download (never rendered inline). */
export function isInlineMime(mime: string): boolean {
  return fileKind(mime) !== 'file' && fileKind(mime) !== 'audio';
}

export function fileUrl(id: string, name: string): string {
  return `/files/${id}/${encodeURIComponent(name)}`;
}

export function fileInfo(r: FileRow): FileInfoDto {
  const url = fileUrl(r.id, r.name);
  const kind = fileKind(r.mime);
  return {
    id: r.id,
    name: r.name,
    mimeType: r.mime,
    size: r.size,
    url,
    thumbUrl: kind === 'image' ? url : null,
    width: r.width,
    height: r.height,
    kind,
    conversationId: r.conversation_id,
    workspaceId: r.workspace_id,
    userId: r.user_id,
    messageId: r.message_id,
    createdAt: r.created_at,
  };
}

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain', '.md': 'text/markdown',
  '.csv': 'text/csv', '.json': 'application/json', '.zip': 'application/zip',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

/** Declared type when it is well formed, else guessed from the extension, else octet-stream. */
export function safeMime(declared: string | undefined, name: string): string {
  const d = (declared ?? '').split(';')[0].trim().toLowerCase();
  if (d && d !== 'application/octet-stream' && MIME_RE.test(d)) return d;
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  return EXT_MIME[ext] ?? 'application/octet-stream';
}

/** Keep only the base name, strip control and path characters, cap the length. */
export function cleanName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f"\\/]/g, '_').trim().slice(0, 200);
  return cleaned || 'file';
}

export interface Probe { mime: string; width: number | null; height: number | null }

/**
 * Sniff the real type of an image from its header bytes (never trusts the client's
 * Content-Type) and read its pixel size for PNG, GIF and JPEG. Returns null for other files.
 */
export function probeImage(path: string): Probe | null {
  let fd: number;
  try { fd = openSync(path, 'r'); } catch { return null; }
  try {
    const buf = Buffer.alloc(512 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const b = buf.subarray(0, n);
    if (n >= 24 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') {
      return { mime: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (n >= 10 && b.toString('latin1', 0, 3) === 'GIF') {
      return { mime: 'image/gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    }
    if (n >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
      return { mime: 'image/webp', width: null, height: null };
    }
    if (n >= 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < n) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker === 0xff) { i++; continue; }
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) {
          return { mime: 'image/jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        }
        i += 2 + b.readUInt16BE(i + 2);
      }
      return { mime: 'image/jpeg', width: null, height: null };
    }
    return null;
  } finally {
    closeSync(fd);
  }
}
