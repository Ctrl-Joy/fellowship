import { useEffect, useState } from 'react';
import { Route, Routes, useNavigate, useParams } from 'react-router';
import type { User } from '../../types';
import { api } from '../../api';
import { ws } from '../../ws';
import { useConversations } from '../../store/conversations';
import { Icon } from '../../components/Icon';
import { timeAgo } from '../../lib/time';
import CanvasView from './CanvasView';
import type { Canvas, CanvasPayload, Template } from './types';
import './canvases.css';

/** Route /w/:wid/canvases/* — the canvas list + templates, and standalone canvas pages. */
export default function CanvasesPage({ workspaceId, currentUser }: { workspaceId: string; currentUser: User }) {
  return (
    <Routes>
      <Route index element={<CanvasList workspaceId={workspaceId} />} />
      <Route path=":canvasId" element={<StandaloneCanvas workspaceId={workspaceId} currentUser={currentUser} />} />
    </Routes>
  );
}

function StandaloneCanvas({ workspaceId, currentUser }: { workspaceId: string; currentUser: User }) {
  const { canvasId } = useParams<{ canvasId: string }>();
  const navigate = useNavigate();
  return (
    <div className="view cv-standalone">
      <div className="view-head cv-standalone-head">
        <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/w/${workspaceId}/canvases`)}><Icon name="back" size={14} /> All canvases</button>
      </div>
      <div className="tab-body">
        <CanvasView workspaceId={workspaceId} canvasId={canvasId} currentUser={currentUser} />
      </div>
    </div>
  );
}

function CanvasList({ workspaceId }: { workspaceId: string }) {
  const [canvases, setCanvases] = useState<Canvas[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversations = useConversations((s) => s.byId);
  const navigate = useNavigate();

  useEffect(() => {
    const load = () => {
      api.get<{ canvases: Canvas[] }>(`/api/w/${workspaceId}/canvases`).then((r) => setCanvases(r.canvases)).catch((e) => setError(e.message));
      api.get<{ templates: Template[] }>(`/api/w/${workspaceId}/canvas-templates`).then((r) => setTemplates(r.templates)).catch(() => {});
    };
    load();
    const offs = [
      ws.on('canvas.shared', load),
      ws.on('canvas.deleted', (p) => setCanvases((list) => list?.filter((c) => c.id !== p.canvasId) ?? list)),
      ws.on('canvas.updated', (p) => setCanvases((list) => list?.map((c) => (c.id === p.canvasId
        ? { ...c, ...(p.canvas ?? {}), updatedAt: p.canvas?.updatedAt ?? Date.now() } : c)) ?? list)),
    ];
    return () => offs.forEach((off) => off());
  }, [workspaceId]);

  const create = async (templateId?: string) => {
    setBusy(true);
    try {
      const r = await api.post<CanvasPayload>(`/api/w/${workspaceId}/canvases`, { templateId });
      navigate(`/w/${workspaceId}/canvases/${r.canvas.id}`);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  const open = (c: Canvas) => {
    if (c.conversationId) navigate(`/w/${workspaceId}/c/${c.conversationId}?tab=canvas`);
    else navigate(`/w/${workspaceId}/canvases/${c.id}`);
  };

  const q = filter.trim().toLowerCase();
  const shown = (canvases ?? []).filter((c) => !q || label(c).toLowerCase().includes(q));
  function label(c: Canvas) {
    return c.title || (c.conversationId ? `#${conversations[c.conversationId]?.name ?? 'channel'} canvas` : 'Untitled canvas');
  }

  return (
    <div className="view cv-list-page">
      <div className="view-head">
        <h1><Icon name="canvas" size={20} /> Canvases</h1>
        <button className="btn btn-primary" disabled={busy} onClick={() => create()}><Icon name="plus" size={14} /> New canvas</button>
      </div>
      <div className="cv-list-body">
        <section>
          <h2 className="cv-section-title">Start from a template</h2>
          <div className="cv-templates">
            {templates.map((t) => (
              <button key={t.id} className="cv-template" disabled={busy} onClick={() => create(t.id)}>
                <span className="cv-template-art" aria-hidden="true"><span /><span /><span /></span>
                <b>{t.title}</b>
                <span className="muted small">{t.description}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <div className="cv-list-head">
            <h2 className="cv-section-title">Your canvases</h2>
            <input className="input cv-filter" placeholder="Filter by title" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {error && <div className="form-error">{error}</div>}
          {!canvases ? <div className="loading-block"><span className="spinner" /> Loading…</div>
            : shown.length === 0 ? <div className="empty">{q ? 'No canvases match that filter.' : 'No canvases yet — start one above, or open a channel’s Canvas tab.'}</div>
            : (
              <ul className="cv-list">
                {shown.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => open(c)}>
                      <span className="cv-list-icon"><Icon name={c.conversationId ? 'hash' : 'canvas'} size={16} /></span>
                      <span className="cv-list-title">{label(c)}</span>
                      {c.isTemplate && <span className="cv-badge">Template</span>}
                      {c.role === 'viewer' && <span className="cv-badge">View only</span>}
                      <span className="muted small">Edited {timeAgo(c.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>
    </div>
  );
}
