import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { ws } from '../../ws';
import { useSession, displayName } from '../../store/session';
import { timeAgo } from '../../lib/time';
import type { Canvas } from '../canvases/types';
import type { TabProps } from './tabTypes';
import './home.css';

/** Space docs are Fellowship canvases whose title starts with the space key. */
const docPrefix = (key: string) => `[${key}]`;

export default function DocsTab({ workspaceId, project, currentUser }: TabProps) {
  const [docs, setDocs] = useState<Canvas[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const members = useSession((s) => s.members);
  const navigate = useNavigate();
  const prefix = docPrefix(project.key);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.get<{ canvases: Canvas[] }>(`/api/w/${workspaceId}/canvases`)
        .then((r) => {
          if (!alive) return;
          const mine = r.canvases.filter((c) => c.title.startsWith(prefix));
          mine.sort((a, b) => b.updatedAt - a.updatedAt);
          setDocs(mine);
          setError(null);
        })
        .catch((e: Error) => { if (alive) setError(e.message); });
    };
    setDocs(null);
    load();
    const offs = [ws.on('canvas.updated', load), ws.on('canvas.shared', load), ws.on('canvas.deleted', load)];
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
  }, [workspaceId, prefix]);

  const newDoc = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ canvas: Canvas }>(`/api/w/${workspaceId}/canvases`, { title: `${prefix} Untitled doc` });
      navigate(`/w/${workspaceId}/canvases/${r.canvas.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the doc');
      setBusy(false);
    }
  };

  const titleOf = (c: Canvas) => c.title.slice(prefix.length).trim() || 'Untitled doc';

  return (
    <div className="hm-docs">
      <div className="hm-docs-head">
        <div>
          <h2 className="hm-title">Space docs</h2>
          <p className="hm-sub">Pages that explain this space: plans, specs, meeting notes and runbooks. Docs are canvases in the workspace, so anyone with access can edit them.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={newDoc} disabled={busy}>{busy ? 'Creating…' : 'New doc'}</button>
      </div>

      {error && <div className="hm-error" role="alert">{error}</div>}
      {!docs && !error && <div className="hm-loading">Loading docs…</div>}
      {docs && docs.length === 0 && (
        <div className="hm-empty">
          <p className="hm-empty-title">No docs for {project.name} yet</p>
          <p className="hm-empty-text">
            A doc belongs to this space when its title starts with <code>{prefix}</code>. Create one here and it will be
            listed on this page, next to the other {project.key} docs.
          </p>
          <button type="button" className="btn btn-primary" onClick={newDoc} disabled={busy}>New doc</button>
        </div>
      )}
      {docs && docs.length > 0 && (
        <ul className="hm-doc-list">
          {docs.map((c) => {
            const author = members[c.createdBy];
            return (
              <li key={c.id}>
                <button type="button" className="hm-doc" onClick={() => navigate(`/w/${workspaceId}/canvases/${c.id}`)}>
                  <span className="hm-doc-icon" aria-hidden="true"><Icon name="file" size={18} /></span>
                  <span className="hm-doc-main">
                    <span className="hm-doc-title">{titleOf(c)}</span>
                    <span className="hm-doc-meta">
                      Edited {timeAgo(c.updatedAt)} · Created by {c.createdBy === currentUser.id ? 'you' : displayName(author)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
