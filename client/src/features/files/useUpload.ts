import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileInfo } from '../../types';
import { api } from '../../api';
import { useSession } from '../../store/session';

export interface UploadItem {
  /** Local key while uploading; becomes the server file id when done. */
  key: string;
  name: string;
  size: number;
  mimeType: string;
  progress: number; // 0..1
  status: 'uploading' | 'done' | 'error';
  file?: FileInfo;
  error?: string;
  previewUrl?: string;
}

export interface UseUpload {
  items: UploadItem[];
  uploading: boolean;
  /** Server ids of finished uploads, passed as `fileIds` when the message is sent. */
  fileIds: string[];
  upload(files: File[]): void;
  remove(key: string): void;
  clear(): void;
}

/** A message can carry at most this many attachments (see the messages route). */
const MAX_ATTACHMENTS = 20;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

interface Limits { maxFileBytes: number; maxFilesPerRequest: number }
let limitsCache: { workspaceId: string; value: Promise<Limits> } | null = null;

/** Per-workspace upload limits, fetched once. Falls back to the default when the call fails. */
function loadLimits(workspaceId: string): Promise<Limits> {
  if (limitsCache?.workspaceId === workspaceId) return limitsCache.value;
  const value = api.get<Limits>(`/api/w/${workspaceId}/files/limits`)
    .catch(() => ({ maxFileBytes: DEFAULT_MAX_BYTES, maxFilesPerRequest: 10 }));
  limitsCache = { workspaceId, value };
  return value;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function newKey() {
  return `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Composer upload state for one conversation. Each file uploads on its own XHR (for progress),
 * and finished uploads are passed as `fileIds` when the message is sent.
 */
export function useUpload(conversationId: string): UseUpload {
  const workspaceId = useSession((s) => s.workspaceId);
  const [items, setItems] = useState<UploadItem[]>([]);
  const xhrs = useRef(new Map<string, XMLHttpRequest>());
  const itemsRef = useRef<UploadItem[]>([]);
  itemsRef.current = items;

  const patch = useCallback((key: string, p: Partial<UploadItem>) => {
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));
  }, []);

  const revoke = (it: UploadItem) => { if (it.previewUrl) URL.revokeObjectURL(it.previewUrl); };

  const send = useCallback((key: string, file: File) => {
    if (!workspaceId) return;
    const form = new FormData();
    form.append('conversationId', conversationId);
    form.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    xhrs.current.set(key, xhr);
    xhr.open('POST', `/api/w/${workspaceId}/files`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) patch(key, { progress: e.loaded / e.total });
    };
    xhr.onload = () => {
      xhrs.current.delete(key);
      let body: any = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && body?.files?.[0]) {
        patch(key, { status: 'done', progress: 1, file: body.files[0] as FileInfo });
      } else {
        patch(key, { status: 'error', error: body?.error?.message ?? `Upload failed (${xhr.status})` });
      }
    };
    xhr.onerror = () => {
      xhrs.current.delete(key);
      patch(key, { status: 'error', error: 'Network error. Try again.' });
    };
    xhr.send(form);
  }, [workspaceId, conversationId, patch]);

  const upload = useCallback((files: File[]) => {
    if (!workspaceId || files.length === 0) return;
    loadLimits(workspaceId).then((limits) => {
      const room = MAX_ATTACHMENTS - itemsRef.current.length;
      const picked = files.slice(0, Math.max(0, room));
      const dropped = files.length - picked.length;
      for (const file of picked) {
        const key = newKey();
        const tooBig = file.size > limits.maxFileBytes;
        const isImage = file.type.startsWith('image/') && file.type !== 'image/svg+xml';
        const item: UploadItem = {
          key, name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream', progress: 0,
          status: tooBig ? 'error' : 'uploading',
          error: tooBig ? `Larger than ${formatBytes(limits.maxFileBytes)}` : undefined,
          previewUrl: isImage && !tooBig ? URL.createObjectURL(file) : undefined,
        };
        setItems((xs) => [...xs, item]);
        if (!tooBig) send(key, file);
      }
      if (dropped > 0) {
        const key = newKey();
        setItems((xs) => [...xs, {
          key, name: `${dropped} more file${dropped > 1 ? 's' : ''}`, size: 0, mimeType: '', progress: 0,
          status: 'error', error: `A message can have at most ${MAX_ATTACHMENTS} files`,
        }]);
      }
    });
  }, [workspaceId, send]);

  const remove = useCallback((key: string) => {
    const xhr = xhrs.current.get(key);
    if (xhr) { xhr.abort(); xhrs.current.delete(key); }
    const it = itemsRef.current.find((x) => x.key === key);
    if (it) {
      revoke(it);
      // Attachment was uploaded but the user dropped it before sending: remove the stored copy.
      if (it.status === 'done' && it.file) api.del(`/api/files/${it.file.id}`).catch(() => { /* best effort */ });
    }
    setItems((xs) => xs.filter((x) => x.key !== key));
  }, []);

  const clear = useCallback(() => {
    for (const it of itemsRef.current) revoke(it);
    setItems([]);
  }, []);

  // Attachments belong to the conversation they were uploaded to: switching conversation drops them.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    for (const [, xhr] of xhrs.current) xhr.abort();
    xhrs.current.clear();
    for (const it of itemsRef.current) {
      revoke(it);
      if (it.status === 'done' && it.file) api.del(`/api/files/${it.file.id}`).catch(() => { /* best effort */ });
    }
    setItems([]);
  }, [conversationId]);

  // Abort in-flight uploads when the composer unmounts.
  useEffect(() => () => {
    for (const [, xhr] of xhrs.current) xhr.abort();
    xhrs.current.clear();
    for (const it of itemsRef.current) revoke(it);
  }, []);

  return {
    items,
    uploading: items.some((i) => i.status === 'uploading'),
    fileIds: items.filter((i) => i.status === 'done' && i.file).map((i) => i.file!.id),
    upload, remove, clear,
  };
}

export default useUpload;
