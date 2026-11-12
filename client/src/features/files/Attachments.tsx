import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FileInfo, Message } from '../../types';
import { Icon } from '../../components/Icon';
import { formatBytes } from './useUpload';
import './files.css';

/** Reserve the thumbnail's final size before it loads, so messages below it do not jump. */
function thumbBox(f: { width?: number | null; height?: number | null }): React.CSSProperties | undefined {
  if (!f.width || !f.height) return undefined;
  const k = Math.min(360 / f.width, 240 / f.height, 1);
  return { width: Math.round(f.width * k), aspectRatio: `${f.width} / ${f.height}` };
}

export interface AttachmentsProps {
  message: Message;
  files: FileInfo[];
}

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'file';

/** File as the files API returns it in lists and search (FileInfo plus the server's extra fields). */
export interface FileDto extends FileInfo {
  kind?: FileKind;
  userId: string;
  messageId: string | null;
  conversationId: string;
  createdAt: number;
}

/** Kind from the server (`kind`), falling back to the MIME type for older payloads. */
export function kindOf(f: FileInfo): FileKind {
  const k = f.kind;
  if (k === 'image' || k === 'video' || k === 'audio' || k === 'pdf' || k === 'file') return k;
  const mime = f.mimeType ?? '';
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  return 'file';
}

/** Files attached to a message: image thumbnails (click for a lightbox), video players and file cards. */
export default function Attachments({ files }: AttachmentsProps) {
  const [open, setOpen] = useState<FileInfo | null>(null);
  if (!files.length) return null;
  const images = files.filter((f) => kindOf(f) === 'image');
  const videos = files.filter((f) => kindOf(f) === 'video');
  const others = files.filter((f) => kindOf(f) !== 'image' && kindOf(f) !== 'video');

  return (
    <div className="att">
      {images.length > 0 && (
        <div className="att-images">
          {images.map((f) => (
            <button key={f.id} className="att-thumb" onClick={() => setOpen(f)} title={`${f.name} (${formatBytes(f.size)})`}>
              <img src={f.thumbUrl ?? f.url} alt={f.name} loading="lazy" decoding="async" width={f.width ?? undefined} height={f.height ?? undefined} style={thumbBox(f)} />
            </button>
          ))}
        </div>
      )}
      {videos.map((f) => (
        <div key={f.id} className="att-video">
          <video controls preload="metadata" src={f.url} aria-label={f.name} />
          <div className="att-video-meta">
            <span className="att-name">{f.name}</span>
            <a href={f.url} download={f.name} className="att-link">Download</a>
          </div>
        </div>
      ))}
      {others.map((f) => <FileCard key={f.id} file={f} />)}
      {open && <Lightbox file={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function FileCard({ file }: { file: FileInfo }) {
  const kind = kindOf(file);
  return (
    <div className="att-card">
      <span className={`att-icon att-icon-${kind}`} aria-hidden="true"><Icon name="file" size={18} /></span>
      <div className="att-card-body">
        <a className="att-name" href={file.url} target={kind === 'pdf' ? '_blank' : undefined} rel="noreferrer"
          download={kind === 'pdf' ? undefined : file.name}>{file.name}</a>
        <div className="att-sub">
          {ext(file.name)} · {formatBytes(file.size)}
          {kind === 'pdf' && <> · <a href={file.url} target="_blank" rel="noreferrer">Open</a></>}
        </div>
      </div>
      <a className="att-download" href={file.url} download={file.name} title="Download" aria-label={`Download ${file.name}`}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
        </svg>
      </a>
    </div>
  );
}

function ext(name: string) {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toUpperCase() : 'FILE';
}

function Lightbox({ file, onClose }: { file: FileInfo; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="att-lightbox" role="dialog" aria-modal="true" aria-label={file.name} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="att-lightbox-bar">
        <span className="att-lightbox-name">{file.name}</span>
        <a className="att-lightbox-btn" href={file.url} download={file.name}>Download</a>
        <button className="att-lightbox-btn" onClick={onClose} aria-label="Close preview"><Icon name="x" size={16} /></button>
      </div>
      <img src={file.url} alt={file.name} />
    </div>,
    document.body,
  );
}
