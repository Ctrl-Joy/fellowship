import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { askConfirm } from '../../components/Dialogs';
import { useNavigate } from 'react-router';
import { useDismiss } from '../../components/useDismiss';
import type { Conversation, User } from '../../types';
import { api } from '../../api';
import { ws } from '../../ws';
import { useSession, displayName } from '../../store/session';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { timeAgo } from '../../lib/time';
import { BlockEditor, type EditorCtl } from './BlockEditor';
import { CanvasDoc } from './doc';
import { setCaret } from './dom';
import { ShareDialog } from './ShareDialog';
import type { Canvas, CanvasPayload, Viewer } from './types';
import './canvases.css';

export interface CanvasViewProps {
  workspaceId: string;
  /** The channel whose canvas tab is open (standalone canvases may pass canvasId instead). */
  conversation?: Conversation;
  canvasId?: string;
  currentUser: User;
}

/** Canvas document view: the conversation "Canvas" tab and the standalone canvas page. */
export default function CanvasView(props: CanvasViewProps) {
  const key = props.conversation ? `c:${props.conversation.id}` : `d:${props.canvasId}`;
  return <CanvasLoader key={key} {...props} />;
}

function CanvasLoader({ workspaceId, conversation, canvasId, currentUser }: CanvasViewProps) {
  const [payload, setPayload] = useState<CanvasPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    const url = conversation ? `/api/conversations/${conversation.id}/canvas` : `/api/canvases/${canvasId}`;
    api.get<CanvasPayload>(url)
      .then(setPayload)
      .catch((e) => setError(e.status === 404 ? 'This canvas doesn’t exist or hasn’t been shared with you.'
        : e.status === 403 ? 'You don’t have access to this canvas.' : e.message));
  }, [conversation?.id, canvasId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (deleted) return <div className="empty">This canvas was deleted.</div>;
  if (error) return <div className="empty">{error}</div>;
  if (!payload) return <div className="loading-block"><span className="spinner" /> Opening canvas…</div>;
  return <CanvasEditor initial={payload} workspaceId={workspaceId} conversation={conversation} currentUser={currentUser} onDeleted={() => setDeleted(true)} />;
}

function CanvasEditor({ initial, workspaceId, conversation, currentUser, onDeleted }: {
  initial: CanvasPayload; workspaceId: string; conversation?: Conversation; currentUser: User; onDeleted(): void;
}) {
  const [doc] = useState(() => new CanvasDoc(initial.canvas.id, initial.blocks));
  const blocks = useSyncExternalStore(useCallback((fn) => doc.subscribe(fn), [doc]), () => doc.blocks());
  const [canvas, setCanvas] = useState<Canvas>(initial.canvas);
  const [access, setAccess] = useState(initial.access);
  const [sharing, setSharing] = useState({ sharedWith: initial.sharedWith, sharedChannels: initial.sharedChannels });
  const [viewers, setViewers] = useState<Viewer[]>(initial.viewers);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismiss(menuOpen, closeMenu);
  const members = useSession((s) => s.members);
  const membersRef = useRef(members);
  membersRef.current = members;
  const navigate = useNavigate();
  const canvasId = canvas.id;

  // ---- focus plumbing ----
  const els = useRef(new Map<string, HTMLElement>());
  const focusReq = useRef<{ id: string; offset: number | 'end' } | null>(null);
  const lastCursor = useRef<string | null | undefined>(undefined);
  const applyFocus = useCallback(() => {
    const r = focusReq.current;
    if (!r) return;
    const el = els.current.get(r.id);
    if (!el) return;
    focusReq.current = null;
    el.focus({ preventScroll: false });
    if (el.isContentEditable) setCaret(el, r.offset);
    el.scrollIntoView({ block: 'nearest' });
  }, []);
  useLayoutEffect(() => { applyFocus(); });

  const sendCursor = useCallback((blockId: string | null) => {
    if (lastCursor.current === blockId) return;
    lastCursor.current = blockId;
    ws.send('canvas.cursor', { canvasId, blockId });
  }, [canvasId]);

  const canEdit = access.canEdit;
  const ctl = useMemo<EditorCtl>(() => ({
    doc,
    canEdit,
    nameOf: (uid) => displayName(membersRef.current[uid]) || 'someone',
    members: () => Object.values(membersRef.current),
    register: (id, el) => { if (el) els.current.set(id, el); else els.current.delete(id); },
    focus: (id, offset) => { focusReq.current = { id, offset }; requestAnimationFrame(applyFocus); },
    prev: (id) => { const l = doc.blocks(); const i = l.findIndex((b) => b.id === id); return i > 0 ? l[i - 1] : undefined; },
    next: (id) => { const l = doc.blocks(); const i = l.findIndex((b) => b.id === id); return i >= 0 ? l[i + 1] : undefined; },
    onBlockFocus: (id) => sendCursor(id),
  }), [doc, canEdit, applyFocus, sendCursor]);

  // ---- realtime ----
  useEffect(() => {
    doc.open();
    doc.onSaving = setSaving;
    doc.onNotice = (m) => setNotice(m);
    let first = true;
    const offs = [
      ws.on('canvas.updated', (p) => {
        if (p.canvasId !== canvasId) return;
        if (p.canvas) setCanvas((c) => ({ ...c, ...p.canvas }));
        if (p.clientId !== doc.clientId && p.ops?.length) doc.applyRemote(p.ops);
      }),
      ws.on('canvas.presence', (p) => { if (p.canvasId === canvasId) setViewers(p.viewers); }),
      ws.on('canvas.cursor', (p) => {
        if (p.canvasId !== canvasId) return;
        setViewers((vs) => vs.some((v) => v.userId === p.userId)
          ? vs.map((v) => (v.userId === p.userId ? { ...v, blockId: p.blockId } : v))
          : [...vs, { userId: p.userId, blockId: p.blockId }]);
      }),
      ws.on('canvas.deleted', (p) => { if (p.canvasId === canvasId) onDeleted(); }),
      ws.on('hello', () => {
        // Reconnected: rejoin presence and catch up on anything we missed.
        lastCursor.current = undefined;
        sendCursor(null);
        if (first) { first = false; return; }
        api.get<CanvasPayload>(`/api/canvases/${canvasId}`).then((r) => {
          doc.resync(r.blocks);
          setCanvas(r.canvas);
          setAccess(r.access);
        }).catch(() => {});
      }),
    ];
    if (ws.status() === 'open') first = false;
    lastCursor.current = undefined;
    sendCursor(null);
    const onUnload = () => { void doc.flush(); };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener('beforeunload', onUnload);
      ws.send('canvas.leave', { canvasId });
      doc.close();
    };
  }, [doc, canvasId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // ---- derived ----
  const others = useMemo(() => viewers.filter((v) => v.userId !== currentUser.id), [viewers, currentUser.id]);
  const editorsByBlock = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const v of others) if (v.blockId) m.set(v.blockId, [...(m.get(v.blockId) ?? []), v.userId]);
    return m;
  }, [others]);
  const numbers = useMemo(() => {
    const out: number[] = [];
    blocks.forEach((b, i) => { out.push(b.type === 'numbered' && blocks[i - 1]?.type === 'numbered' ? out[i - 1] + 1 : 1); });
    return out;
  }, [blocks]);

  const addAtEnd = () => {
    if (!canEdit) return;
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'paragraph' && !last.text) ctl.focus(last.id, 'end');
    else ctl.focus(doc.insertAfter(last?.id ?? null, { type: 'paragraph' }), 0);
  };

  const fullPage = `/w/${workspaceId}/canvases/${canvasId}`;
  const isChannelCanvas = !!canvas.conversationId;

  return (
    <div className="cv-wrap">
      <div className="cv-toolbar">
        <div className="cv-crumbs muted small">
          <Icon name="canvas" size={14} />
          {isChannelCanvas ? 'Channel canvas' : canvas.isTemplate ? 'Template' : 'Canvas'}
          <span className="cv-dot">·</span>
          {saving || doc.hasPending() ? 'Saving…' : `Edited ${timeAgo(canvas.updatedAt)}`}
          {!canEdit && <span className="cv-badge">View only</span>}
        </div>
        <div className="cv-people" aria-label="People here">
          {others.slice(0, 5).map((v) => (
            <span key={v.userId} className="cv-person" title={`${displayName(members[v.userId])} is here`}>
              <Avatar userId={v.userId} size={24} />
            </span>
          ))}
          {others.length > 5 && <span className="cv-more">+{others.length - 5}</span>}
        </div>
        {canEdit && <button className="btn btn-sm btn-primary" onClick={() => setShareOpen(true)}>Share</button>}
        <div className="cv-menu-anchor">
          <button className="icon-btn" title="More" onClick={() => setMenuOpen((v) => !v)}><Icon name="more" /></button>
          {menuOpen && (
            <div className="menu menu-right">
              <button onClick={() => { navigator.clipboard?.writeText(location.origin + fullPage); setMenuOpen(false); setNotice('Link copied'); }}>Copy link</button>
              {conversation && <button onClick={() => navigate(fullPage)}>Open as a page</button>}
              {canEdit && !isChannelCanvas && (
                <button onClick={async () => {
                  setMenuOpen(false);
                  const r = await api.patch<{ canvas: Canvas }>(`/api/canvases/${canvasId}`, { isTemplate: !canvas.isTemplate });
                  setCanvas(r.canvas);
                  setNotice(r.canvas.isTemplate ? 'Saved as a template for this workspace' : 'No longer a template');
                }}>{canvas.isTemplate ? 'Stop using as template' : 'Save as template'}</button>
              )}
              {access.canManage && !isChannelCanvas && (
                <button onClick={async () => {
                  setMenuOpen(false);
                  if (!await askConfirm('Delete this canvas for everyone?', { body: 'This can’t be undone.', danger: true, action: 'Delete' })) return;
                  await api.del(`/api/canvases/${canvasId}`);
                  navigate(`/w/${workspaceId}/canvases`);
                }}>Delete canvas</button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="cv-page" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) sendCursor(null); }}>
        <TitleInput canvas={canvas} canEdit={canEdit} onSaved={setCanvas} onEnter={() => blocks[0] ? ctl.focus(blocks[0].id, 0) : addAtEnd()} />
        <div className="cv-blocks">
          {blocks.map((b, i) => (
            <BlockEditor key={b.id} block={b} number={numbers[i]} ctl={ctl} editors={editorsByBlock.get(b.id) ?? NONE} isFirst={i === 0} />
          ))}
        </div>
        {canEdit
          ? <div className="cv-tail" onMouseDown={(e) => { e.preventDefault(); addAtEnd(); }} title="Click to keep writing" />
          : blocks.length === 0 && <div className="empty">Nothing here yet.</div>}
      </div>

      {notice && <div className="cv-toast" role="status">{notice}</div>}
      {shareOpen && (
        <ShareDialog workspaceId={workspaceId} canvas={canvas} currentUser={currentUser}
          sharing={sharing} canManage={access.canManage}
          onChange={setSharing} onClose={() => setShareOpen(false)}
          onShared={(msg) => { setShareOpen(false); setNotice(msg); }} />
      )}
    </div>
  );
}

const NONE: string[] = [];

function TitleInput({ canvas, canEdit, onSaved, onEnter }: { canvas: Canvas; canEdit: boolean; onSaved(c: Canvas): void; onEnter(): void }) {
  const [value, setValue] = useState(canvas.title);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setValue(canvas.title); }, [canvas.title]);
  const save = async () => {
    const title = value.trim();
    if (title === canvas.title) return;
    try {
      const r = await api.patch<{ canvas: Canvas }>(`/api/canvases/${canvas.id}`, { title });
      onSaved(r.canvas);
    } catch { setValue(canvas.title); }
  };
  return (
    <input className="cv-title" value={value} readOnly={!canEdit} placeholder="Untitled canvas" maxLength={200} aria-label="Canvas title"
      onChange={(e) => setValue(e.target.value)}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; void save(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); void save(); onEnter(); } }} />
  );
}
