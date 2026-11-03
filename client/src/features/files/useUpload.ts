import { useCallback, useState } from 'react';
import type { FileInfo } from '../../types';

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

/**
 * Composer upload state for one conversation. Core stub (does nothing) — the files
 * feature implements uploading to the server.
 */
export function useUpload(_conversationId: string): UseUpload {
  const [items, setItems] = useState<UploadItem[]>([]);
  const upload = useCallback((_files: File[]) => {
    console.info('[files] uploads not implemented yet');
  }, []);
  const remove = useCallback((key: string) => setItems((xs) => xs.filter((x) => x.key !== key)), []);
  const clear = useCallback(() => setItems([]), []);
  return {
    items,
    uploading: items.some((i) => i.status === 'uploading'),
    fileIds: items.filter((i) => i.status === 'done' && i.file).map((i) => i.file!.id),
    upload, remove, clear,
  };
}

export default useUpload;
