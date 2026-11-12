import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { askConfirm } from '../../components/Dialogs';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { useSession, displayName } from '../../store/session';
import type { ProjectsViewProps } from './ProjectsRoot';
import type { Dashboard, SavedFilter, Widget, WidgetType, WorkItem } from './types';
import { projectsApi } from './api';
import { useProjects } from './store';
import { Assignee, ItemKey, StatusPill, TypeIcon, formatDate, useItemPanel } from './ui';
import { Card, SummaryWidget, useSummary, type SummaryWidgetType } from './widgets';
import './summary.css';

const WIDGET_INFO: Record<WidgetType, { name: string; description: string }> = {
  stats: { name: 'Activity in numbers', description: 'Completed, updated, created and due-soon counts.' },
  status: { name: 'Status overview', description: 'Donut chart of work by status.' },
  priority: { name: 'Priority breakdown', description: 'Bar chart of work by priority.' },
  types: { name: 'Types of work', description: 'Share of epics, stories, tasks, bugs and subtasks.' },
  workload: { name: 'Team workload', description: 'How work is spread across people.' },
  epics: { name: 'Epic progress', description: 'Done, in progress and to do for every epic.' },
  activity: { name: 'Recent activity', description: 'The latest changes in a space.' },
  filter: { name: 'Filter results', description: 'A table of work matching a saved filter.' },
};
const WIDGET_TYPES = Object.keys(WIDGET_INFO) as WidgetType[];

const errMsg = (e: any) => e?.message || 'Something went wrong';
const newId = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export default function DashboardsPage({ workspaceId, currentUser }: ProjectsViewProps) {
  const { did } = useParams();
  return did
    ? <DashboardView key={did} workspaceId={workspaceId} currentUserId={currentUser.id} dashboardId={did} />
    : <DashboardList workspaceId={workspaceId} currentUserId={currentUser.id} />;
}

// ---------------------------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------------------------

function OwnerName({ id }: { id: string }) {
  const m = useSession((s) => s.members[id]);
  return <span className="pjd-muted">{m ? displayName(m) : 'Former member'}</span>;
}

function DashboardList({ workspaceId, currentUserId }: { workspaceId: string; currentUserId: string }) {
  const navigate = useNavigate();
  const [list, setList] = useState<Dashboard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    projectsApi.dashboards(workspaceId).then((d) => alive && setList(d), (e) => alive && setError(errMsg(e)));
    return () => { alive = false; };
  }, [workspaceId]);

  const create = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const d = await projectsApi.createDashboard(workspaceId, n);
      navigate(`/w/${workspaceId}/projects/dashboards/${d.id}`);
    } catch (e) { setError(errMsg(e)); setBusy(false); }
  };
  const remove = async (d: Dashboard) => {
    if (!await askConfirm(`Delete the dashboard “${d.name}”?`, { body: 'This can’t be undone.', danger: true, action: 'Delete' })) return;
    try {
      await projectsApi.deleteDashboard(d.id);
      setList((l) => (l ?? []).filter((x) => x.id !== d.id));
    } catch (e) { setError(errMsg(e)); }
  };

  return (
    <div className="pjd-root">
      <div className="pjd-head">
        <h1>Dashboards</h1>
        <div className="pjs-toolbar-spacer" />
        {!creating && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Create dashboard</button>}
      </div>
      <p className="pjd-intro">Bring the charts that matter from any space into one view everyone in the workspace can see.</p>
      {creating && (
        <form className="pjd-create" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <input className="input" autoFocus value={name} maxLength={80} placeholder="Dashboard name, e.g. Launch readiness" aria-label="Dashboard name"
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setCreating(false); setName(''); } }} />
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || busy}>Create</button>
          <button type="button" className="btn btn-ghost" onClick={() => { setCreating(false); setName(''); }}>Cancel</button>
        </form>
      )}
      {error && <div className="pjs-error" role="alert">{error}</div>}
      {!list && !error && <div className="pjs-skel short" aria-busy="true" />}
      {list && list.length === 0 && (
        <div className="pjs-empty">
          <div className="pjs-empty-art" aria-hidden="true"><Icon name="grid" size={30} /></div>
          <h3>No dashboards yet</h3>
          <p>Create one, then add status charts, workload, epic progress or a saved filter.</p>
          {!creating && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Create dashboard</button>}
        </div>
      )}
      {list && list.length > 0 && (
        <table className="pjd-table">
          <thead><tr><th>Name</th><th>Owner</th><th>Widgets</th><th>Updated</th><th><span className="pjs-sr">Actions</span></th></tr></thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <td><Link to={`/w/${workspaceId}/projects/dashboards/${d.id}`}>{d.name}</Link></td>
                <td><OwnerName id={d.ownerId} /></td>
                <td className="pjd-muted">{d.widgets.length}</td>
                <td className="pjd-muted">{new Date(d.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                <td style={{ textAlign: 'right' }}>
                  {d.ownerId === currentUserId && (
                    <button type="button" className="icon-btn danger" onClick={() => remove(d)} aria-label={`Delete ${d.name}`} title="Delete"><Icon name="trash" size={16} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One dashboard
// ---------------------------------------------------------------------------------------------

function DashboardView({ workspaceId, currentUserId, dashboardId }: { workspaceId: string; currentUserId: string; dashboardId: string }) {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<SavedFilter[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const saveSeq = useRef(0);
  const renameDone = useRef(false);

  useEffect(() => {
    let alive = true;
    api.get<{ dashboard: Dashboard }>(`/api/dashboards/${dashboardId}`).then((r) => alive && setDash(r.dashboard), (e) => alive && setError(errMsg(e)));
    projectsApi.filters(workspaceId).then((f) => alive && setFilters(f), () => alive && setFilters([]));
    return () => { alive = false; };
  }, [dashboardId, workspaceId]);

  if (error && !dash) {
    return (
      <div className="pjd-root">
        <div className="pjd-crumb"><Link to={`/w/${workspaceId}/projects/dashboards`}>Dashboards</Link></div>
        <div className="pjs-error" role="alert">{error}</div>
      </div>
    );
  }
  if (!dash) return <div className="pjd-root"><div className="pjs-grid"><div className="pjs-skel short" /><div className="pjs-skel" /><div className="pjs-skel" /></div></div>;

  const isOwner = dash.ownerId === currentUserId;

  /** Optimistic save; rolls back on failure. */
  const save = async (patch: { name?: string; widgets?: Widget[] }) => {
    const before = dash;
    setDash({ ...dash, ...patch });
    const my = ++saveSeq.current;
    try {
      const d = await projectsApi.updateDashboard(dash.id, patch);
      if (saveSeq.current === my) setDash(d);
      setError(null);
    } catch (e) {
      if (saveSeq.current === my) setDash(before);
      setError(errMsg(e));
    }
  };
  const move = (idx: number, dir: -1 | 1) => {
    const w = dash.widgets.slice();
    const j = idx + dir;
    if (j < 0 || j >= w.length) return;
    [w[idx], w[j]] = [w[j], w[idx]];
    save({ widgets: w });
  };
  const removeWidget = (id: string) => save({ widgets: dash.widgets.filter((w) => w.id !== id) });
  const commitName = () => {
    if (renameDone.current) return;
    renameDone.current = true;
    const n = nameDraft.trim();
    setEditingName(false);
    if (n && n !== dash.name) save({ name: n });
  };

  return (
    <div className="pjd-root">
      <div className="pjd-crumb"><Link to={`/w/${workspaceId}/projects/dashboards`}>Dashboards</Link> <Icon name="chevronRight" size={12} /></div>
      <div className="pjd-head">
        {editingName ? (
          <input className="input pjd-name-input" autoFocus value={nameDraft} maxLength={80} aria-label="Dashboard name"
            onChange={(e) => setNameDraft(e.target.value)} onBlur={commitName}
            onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { renameDone.current = true; setEditingName(false); } }} />
        ) : isOwner ? (
          <button type="button" className="pjd-name-btn" title="Rename" onClick={() => { renameDone.current = false; setNameDraft(dash.name); setEditingName(true); }}>{dash.name}</button>
        ) : <h1>{dash.name}</h1>}
        <div className="pjs-toolbar-spacer" />
        {isOwner
          ? <button type="button" className="btn btn-primary" onClick={() => setAdding(true)} disabled={dash.widgets.length >= 24}><Icon name="plus" size={16} /> Add widget</button>
          : <span className="pjd-readonly"><Icon name="lock" size={14} /> View only · owned by <OwnerName id={dash.ownerId} /></span>}
      </div>
      {error && <div className="pjs-error" role="alert">{error}</div>}

      {dash.widgets.length === 0 ? (
        <div className="pjs-empty">
          <div className="pjs-empty-art" aria-hidden="true"><Icon name="grid" size={30} /></div>
          <h3>This dashboard is empty</h3>
          <p>{isOwner ? 'Add widgets to see status, priorities, workload and more from your spaces.' : 'The owner has not added any widgets yet.'}</p>
          {isOwner && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add widget</button>}
        </div>
      ) : (
        <div className="pjs-grid">
          {dash.widgets.map((w, i) => (
            <DashWidget key={w.id} widget={w} workspaceId={workspaceId} filters={filters} isOwner={isOwner}
              actions={isOwner ? (
                <span className="pjd-widget-tools">
                  <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move left" title="Move left"><Icon name="back" size={15} /></button>
                  <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === dash.widgets.length - 1} aria-label="Move right" title="Move right"><Icon name="forward" size={15} /></button>
                  <button type="button" className="icon-btn danger" onClick={() => removeWidget(w.id)} aria-label="Remove widget" title="Remove"><Icon name="x" size={15} /></button>
                </span>
              ) : undefined} />
          ))}
        </div>
      )}

      {adding && (
        <AddWidgetDialog filters={filters ?? []} onClose={() => setAdding(false)}
          onAdd={(w) => { setAdding(false); save({ widgets: [...dash.widgets, w] }); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------------------------

function DashWidget({ widget, workspaceId, filters, actions, isOwner }: { widget: Widget; workspaceId: string; filters: SavedFilter[] | null; actions?: ReactNode; isOwner: boolean }) {
  if (widget.type === 'filter') return <FilterWidget widget={widget} workspaceId={workspaceId} filters={filters} actions={actions} isOwner={isOwner} />;
  return <SpaceWidget widget={widget} workspaceId={workspaceId} actions={actions} />;
}

function SpaceWidget({ widget, workspaceId, actions }: { widget: Widget; workspaceId: string; actions?: ReactNode }) {
  const project = useProjects((s) => (widget.projectId ? s.projects[widget.projectId] : undefined));
  const projectsLoaded = useProjects((s) => s.loaded);
  const { summary, error } = useSummary(project ? project.id : null);
  const info = WIDGET_INFO[widget.type];
  const wide = widget.type === 'stats';
  const title = widget.title || (project ? `${info.name} · ${project.name}` : info.name);
  if (!project) {
    return (
      <Card title={title} description={info.description} actions={actions} wide={wide}>
        <p className="pjd-gone">{projectsLoaded ? 'This space was deleted or you no longer have access to it.' : 'Loading…'}</p>
      </Card>
    );
  }
  if (!summary) {
    return error
      ? <Card title={title} actions={actions} wide={wide}><div className="pjs-error">{error}</div></Card>
      : <div className={`pjs-skel${wide ? ' short' : ''}`} aria-busy="true" />;
  }
  return <SummaryWidget type={widget.type as SummaryWidgetType} summary={summary} workspaceId={workspaceId} projectId={project.id} actions={actions} titleOverride={title} />;
}

function FilterWidget({ widget, workspaceId, filters, actions, isOwner }: { widget: Widget; workspaceId: string; filters: SavedFilter[] | null; actions?: ReactNode; isOwner: boolean }) {
  const filter = filters?.find((f) => f.id === widget.filterId);
  const version = useProjects((s) => s.version);
  const [items, setItems] = useState<WorkItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);
  const queryKey = filter ? JSON.stringify(filter.query) : '';

  useEffect(() => {
    if (!filter) return;
    let alive = true;
    const run = () => projectsApi.searchItems(workspaceId, filter.query).then(
      (r) => { if (alive) { setItems(r.items); setError(null); } },
      (e) => { if (alive) setError(errMsg(e)); });
    if (first.current) { first.current = false; run(); return () => { alive = false; }; }
    const t = setTimeout(run, 400);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, workspaceId, version]);

  const projects = useProjects((s) => s.projects);
  const title = widget.title || (filter ? filter.name : WIDGET_INFO.filter.name);
  const rows = useMemo(() => (items ?? []).slice(0, 50), [items]);
  return (
    <Card title={title} description={filter ? `${items?.length ?? '…'} matching work item${items?.length === 1 ? '' : 's'}` : undefined}
      viewAll={filter ? `/w/${workspaceId}/projects/filters` : undefined} actions={actions}>
      {!filters ? <p className="pjd-gone">Loading…</p>
        : !filter ? <p className="pjd-gone">{isOwner ? 'This saved filter was deleted.' : 'This widget shows a saved filter that only the dashboard owner can see.'}</p>
        : error ? <div className="pjs-error">{error}</div>
        : !items ? <p className="pjd-gone">Loading…</p>
        : items.length === 0 ? <p className="pjs-none">No work matches this filter.</p> : (
          <div className="pjd-filter-scroll">
            <table className="pjd-filter-table">
              <thead><tr><th>Work</th><th>Status</th><th>Assignee</th><th>Due</th></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} onClick={() => useItemPanel.getState().openItem(i.id)}>
                    <td>
                      <div className="pjd-cell-work">
                        <TypeIcon type={i.type} size={14} />
                        <ItemKey item={i} />
                        <span title={`${i.summary}${projects[i.projectId] ? ` · ${projects[i.projectId].name}` : ''}`}>{i.summary}</span>
                      </div>
                    </td>
                    <td><StatusPill status={i.status} /></td>
                    <td><Assignee userId={i.assigneeId} size={22} /></td>
                    <td className="pjd-muted">{formatDate(i.dueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {items.length > rows.length && <p className="pjd-muted" style={{ fontSize: 12.5, marginTop: 6 }}>Showing {rows.length} of {items.length}.</p>}
          </div>
        )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Add widget dialog
// ---------------------------------------------------------------------------------------------

function AddWidgetDialog({ filters, onClose, onAdd }: { filters: SavedFilter[]; onClose(): void; onAdd(w: Widget): void }) {
  const projectsMap = useProjects((s) => s.projects);
  const projects = useMemo(() => Object.values(projectsMap).sort((a, b) => a.name.localeCompare(b.name)), [projectsMap]);
  const [type, setType] = useState<WidgetType>('status');
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [filterId, setFilterId] = useState(filters[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const needsFilter = type === 'filter';
  const ok = needsFilter ? !!filterId : !!projectId;

  const add = () => {
    if (!ok) return;
    onAdd({
      id: newId(), type,
      projectId: needsFilter ? null : projectId,
      filterId: needsFilter ? filterId : null,
      ...(title.trim() ? { title: title.trim().slice(0, 80) } : {}),
    });
  };

  return (
    <Modal title="Add widget" onClose={onClose} width={620}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={!ok} onClick={add}>Add widget</button></>}>
      <form className="pjd-form" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <div className="pjd-types" role="radiogroup" aria-label="Widget type">
          {WIDGET_TYPES.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={type === t} className="pjd-type" onClick={() => setType(t)}>
              <strong>{WIDGET_INFO[t].name}</strong>
              <span>{WIDGET_INFO[t].description}</span>
            </button>
          ))}
        </div>
        {needsFilter ? (
          <label className="field">Saved filter
            {filters.length === 0
              ? <small className="pjd-muted">You have no saved filters yet. Save one from the Filters page first.</small>
              : (
                <select className="input" value={filterId} onChange={(e) => setFilterId(e.target.value)}>
                  {filters.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              )}
          </label>
        ) : (
          <label className="field">Space
            {projects.length === 0
              ? <small className="pjd-muted">There are no spaces in this workspace yet.</small>
              : (
                <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.iconEmoji ? `${p.iconEmoji} ` : ''}{p.name} ({p.key})</option>)}
                </select>
              )}
          </label>
        )}
        <label className="field">Title <small className="pjd-muted">(optional)</small>
          <input className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={WIDGET_INFO[type].name} />
        </label>
      </form>
    </Modal>
  );
}
