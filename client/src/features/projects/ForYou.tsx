import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { projectsApi } from './api';
import { useProjects } from './store';
import type { Project, WorkItem } from './types';
import { ItemKey, StatusPill, TypeIcon, formatDate, todayIso, useItemPanel } from './ui';
import { displayName, useSession } from '../../store/session';
import type { ProjectsViewProps } from './ProjectsRoot';
import { fmtDay } from './support';
import './home.css';

interface ForYouData { assigned: WorkItem[]; recentItems: WorkItem[]; recentSpaces: Project[] }

function greetingFor(now: Date) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Landing page of the Projects area: what is on your plate and where you worked last. */
export default function ForYou({ workspaceId, currentUser }: ProjectsViewProps) {
  const version = useProjects((s) => s.version);
  const projects = useProjects((s) => s.projects);
  const items = useProjects((s) => s.items);
  const loaded = useProjects((s) => s.loaded);
  const navigate = useNavigate();
  const [data, setData] = useState<ForYouData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    projectsApi.forYou(workspaceId)
      .then((r) => { if (alive) { setData(r); setError(null); } })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [workspaceId, version]);

  const trySample = async () => {
    if (sampleBusy) return;
    setSampleBusy(true);
    setError(null);
    try {
      const p = await projectsApi.createSample(workspaceId);
      navigate(`/w/${workspaceId}/projects/p/${p.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the sample space');
      setSampleBusy(false);
    }
  };

  const firstName = (displayName(currentUser) || '').split(' ')[0] || 'there';
  const spaceName = (id: string) => projects[id]?.name ?? '';
  const live = (i: WorkItem) => items[i.id] ?? i;
  const assigned = (data?.assigned ?? []).map(live);
  const recent = (data?.recentItems ?? []).map(live);
  const spaces = (data?.recentSpaces ?? []).map((p) => projects[p.id] ?? p);
  const noSpaces = loaded && Object.keys(projects).length === 0;

  return (
    <div className="hm">
      <div className="hm-head">
        <div>
          <h1 className="hm-greeting">{greetingFor(new Date())}, {firstName}</h1>
          <p className="hm-sub">Your work across every space in this workspace.</p>
        </div>
        <div className="hm-onboard-actions">
          <button type="button" className="btn" onClick={() => useItemPanel.getState().openCreate({})}>Create work item</button>
          <Link className="btn" to={`/w/${workspaceId}/projects/all`}>All spaces</Link>
        </div>
      </div>

      {error && <div className="hm-error" role="alert">{error}</div>}

      {noSpaces ? (
        <section className="hm-onboard">
          <h2 className="hm-section-title">Start with a space</h2>
          <p className="hm-sub">
            A space holds the work for one team or project: its work items, board, timeline, forms and docs.
            Create your own, or try a sample space with a board already filled in.
          </p>
          <div className="hm-onboard-actions">
            <button type="button" className="btn btn-primary" onClick={() => navigate(`/w/${workspaceId}/projects/all`)}>Create a space</button>
            <button type="button" className="btn" onClick={trySample} disabled={sampleBusy}>{sampleBusy ? 'Creating sample…' : 'Try a sample space'}</button>
          </div>
        </section>
      ) : (
        <>
          <section className="hm-section">
            <div className="hm-section-head">
              <h2 className="hm-section-title">Assigned to me</h2>
            </div>
            {!data ? <div className="hm-loading">Loading…</div> : assigned.length === 0 ? (
              <div className="hm-empty">Nothing is assigned to you right now. Work items assigned to you appear here.</div>
            ) : (
              <ul className="hm-list">
                {assigned.map((i) => <WorkRow key={i.id} item={i} space={spaceName(i.projectId)} />)}
              </ul>
            )}
          </section>

          <section className="hm-section">
            <div className="hm-section-head">
              <h2 className="hm-section-title">Recently worked on</h2>
            </div>
            {!data ? null : recent.length === 0 ? (
              <div className="hm-empty">Items you view, create or change show up here.</div>
            ) : (
              <ul className="hm-list">
                {recent.map((i) => <WorkRow key={i.id} item={i} space={spaceName(i.projectId)} />)}
              </ul>
            )}
          </section>

          <section className="hm-section">
            <div className="hm-section-head">
              <h2 className="hm-section-title">Recent spaces</h2>
              <Link className="hm-link" to={`/w/${workspaceId}/projects/all`}>View all spaces</Link>
            </div>
            {!data ? null : spaces.length === 0 ? (
              <div className="hm-empty">Spaces you open appear here.</div>
            ) : (
              <div className="hm-spaces">
                {spaces.map((p) => {
                  const pct = p.itemCount ? Math.round((p.doneCount / p.itemCount) * 100) : 0;
                  return (
                    <Link key={p.id} to={`/w/${workspaceId}/projects/p/${p.id}`} className="hm-space" style={{ borderLeftColor: p.color || 'var(--brand)' }}>
                      <span className="hm-space-top">
                        <span className="hm-space-icon" aria-hidden="true">{p.iconEmoji || '▣'}</span>
                        <span style={{ minWidth: 0 }}>
                          <span className="hm-space-name" style={{ display: 'block' }}>{p.name}</span>
                          <span className="hm-space-key">{p.key}</span>
                        </span>
                      </span>
                      <span className="hm-progress" aria-hidden="true"><span className="hm-progress-bar" style={{ width: `${pct}%` }} /></span>
                      <span className="hm-progress-text">{p.doneCount} of {p.itemCount} done</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** One work item row: opens the detail panel from the summary, key or row. */
function WorkRow({ item, space }: { item: WorkItem; space: string }) {
  const assignee = useSession((s) => (item.assigneeId ? s.members[item.assigneeId] : undefined));
  const overdue = !!item.dueDate && item.status !== 'done' && item.dueDate < todayIso();
  return (
    <li className="hm-row">
      <TypeIcon type={item.type} />
      <ItemKey item={item} />
      <button type="button" className="hm-row-summary" onClick={() => useItemPanel.getState().openItem(item.id)}>{item.summary}</button>
      <span className="hm-row-space" title={space}>{space}</span>
      <StatusPill status={item.status} />
      <span className={`hm-row-due${overdue ? ' is-overdue' : ''}`} title={assignee ? displayName(assignee) : undefined}>
        {item.dueDate ? formatDate(item.dueDate) : fmtDay(item.updatedAt)}
      </span>
    </li>
  );
}
