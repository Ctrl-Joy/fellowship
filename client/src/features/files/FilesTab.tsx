import { useCallback, useEffect, useRef, useState } from 'react';
import { askConfirm } from '../../components/Dialogs';
import { useNavigate } from 'react-router';
import type { Conversation, User } from '../../types';
import { api, ApiError } from '../../api';
import { useSession, displayName } from '../../store/session';
import { ws } from '../../ws';
import { formatFull } from '../../lib/time';
import { formatBytes } from './useUpload';
import { kindOf, FileCard, type FileDto } from './Attachments';
import './files.css';

export interface FilesTabProps {
  workspaceId: string;
  conversation: Conversation;
  currentUser: User;
}

interface FilesPage {
  files: FileDto[];
  hasMore: boolean;
  nextBefore: number | null;
}

/** Conversation header "Files" tab: every file attached in this conversation, newest first. */
export default function FilesTab({ workspaceId, conversation, currentUser }: FilesTabProps) {
  const members = useSession((s) => s.members);
  const navigate = useNavigate();
  const [files, setFiles] = useState<FileDto[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqSeq = useRef(0);
  const cid = conversation.id;
  const isAdmin = (members[currentUser.id]?.role ?? 'member') === 'owner' || members[currentUser.id]?.role === 'admin';

  const load = useCallback(async (before?: number) => {
    const seq = ++reqSeq.current;
    try {
      const page = await api.get<FilesPage>(`/api/conversations/${cid}/files?limit=30${before ? `&before=${before}` : ''}`);
      if (seq !== reqSeq.current) return;
      setFiles((prev) => (before && prev ? [...prev, ...page.files] : page.files));
      setHasMore(page.hasMore);
      setNextBefore(page.nextBefore);
      setError(null);
    } catch (e: any) {
      if (seq === reqSeq.current) setError(e instanceof ApiError ? e.message : 'Could not load files.');
    } finally {
      if (seq === reqSeq.current) setLoadingMore(false);
    }
  }, [cid]);

  useEffect(() => { setFiles(null); load(); }, [load]);

  // Refresh when something in this conversation adds or removes an attachment.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => load(), 250); };
    const offCreated = ws.on('message.created', (p, frame) => {
      if (frame.conversationId === cid && p?.message?.files?.length) refresh();
    });
    const offUpdated = ws.on('message.updated', (p, frame) => {
      if (frame.conversationId === cid && p?.message?.files?.length) refresh();
    });
    const offDeleted = ws.on('file.deleted', (_p, frame) => { if (frame.conversationId === cid) refresh(); });
    return () => {
      if (timer) clearTimeout(timer);
      offCreated(); offUpdated(); offDeleted();
    };
  }, [cid, load]);

  async function remove(f: FileDto) {
    if (!await askConfirm(`Delete “${f.name}”?`, { body: 'It will disappear from the message too.', danger: true, action: 'Delete' })) return;
    try {
      await api.del(`/api/files/${f.id}`);
      setFiles((xs) => (xs ?? []).filter((x) => x.id !== f.id));
    } catch (e: any) {
      setError(e.message);
    }
  }

  function openMessage(f: FileDto) {
    if (f.messageId) navigate(`/w/${workspaceId}/c/${cid}?m=${f.messageId}`);
  }

  if (error && !files) return <div className="empty">{error}</div>;
  if (!files) return <div className="loading-block"><span className="spinner" /> Loading files…</div>;
  if (files.length === 0) return <div className="empty">Files shared in this conversation will appear here.</div>;

  return (
    <div className="files-tab">
      {files.map((f) => {
        const uploader = members[f.userId];
        const canDelete = f.userId === currentUser.id || isAdmin;
        const kind = kindOf(f);
        return (
          <div className="files-row" key={f.id}>
            {kind === 'image' ? (
              <>
                <img className="files-thumb" src={f.thumbUrl ?? f.url} alt="" loading="lazy" />
                <div className="files-row-body">
                  <a className="att-name" href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
                  <div className="files-row-meta">{formatBytes(f.size)}{f.width && f.height ? ` · ${f.width}×${f.height}` : ''}</div>
                </div>
              </>
            ) : (
              <div className="files-row-body"><FileCard file={f} /></div>
            )}
            <div className="files-row-meta" style={{ minWidth: 140, textAlign: 'right' }}>
              {uploader ? displayName(uploader) : 'Someone'}
              <br />
              {formatFull(f.createdAt)}
            </div>
            <div className="files-row-actions">
              {f.messageId && <button className="files-btn" onClick={() => openMessage(f)}>Open message</button>}
              {canDelete && <button className="files-btn danger" onClick={() => remove(f)}>Delete</button>}
            </div>
          </div>
        );
      })}
      {error && <div className="composer-error">{error}</div>}
      {hasMore && nextBefore != null && (
        <button className="files-btn files-more" disabled={loadingMore}
          onClick={() => { setLoadingMore(true); load(nextBefore); }}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
