import type { FileInfo, Message } from '../../types';

export interface AttachmentsProps {
  message: Message;
  files: FileInfo[];
}

/** Files attached to a message. Core stub — owned by `files`. */
export default function Attachments({ files }: AttachmentsProps) {
  if (!files.length) return null;
  return (
    <div className="attachments">
      {files.map((f) =>
        f.mimeType.startsWith('image/') ? (
          <a key={f.id} href={f.url} target="_blank" rel="noreferrer"><img className="attachment-img" src={f.thumbUrl ?? f.url} alt={f.name} /></a>
        ) : (
          <a key={f.id} className="attachment-file" href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
        ),
      )}
    </div>
  );
}
