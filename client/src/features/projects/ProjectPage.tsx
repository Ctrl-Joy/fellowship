import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import type { ProjectsViewProps } from './ProjectsRoot';
import type { Project, TabConfig, TabKey } from './types';
import { TAB_LABEL } from './types';
import type { TabProps } from './tabTypes';
import { useProjects } from './store';
import { projectsApi } from './api';
import { useItemPanel } from './ui';
import { ConfirmDialog, Dropdown, Glyph, MenuItem, Popover, SPACE_COLORS, SPACE_EMOJIS, copyText, isTypingTarget, layerOpen, useFlash, useMembers } from './kit';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/Avatar';
import { Modal } from '../../components/Modal';
import { displayName } from '../../store/session';
import SummaryTab from './SummaryTab';
import ListTab from './ListTab';
import BoardTab from './BoardTab';
import DevelopmentTab from './DevelopmentTab';
import FormsTab from './FormsTab';
import TimelineTab from './TimelineTab';
import DocsTab from './DocsTab';
import './shell.css';

const TABS: Record<TabKey, ComponentType<TabProps>> = {
  summary: SummaryTab, list: ListTab, board: BoardTab, development: DevelopmentTab, forms: FormsTab, timeline: TimelineTab, docs: DocsTab,
};
const ALL_TABS = Object.keys(TAB_LABEL) as TabKey[];
const isTab = (t: string | undefined): t is TabKey => !!t && (ALL_TABS as string[]).includes(t);

/** /projects/p/:pid/:tab? — a space with its header and tabs. */
export default function ProjectPage({ workspaceId, currentUser }: ProjectsViewProps) {
  const { pid = '', tab } = useParams();
  const navigate = useNavigate();
  const project = useProjects((s) => s.projects[pid]);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(null);
    projectsApi.getProject(pid).then((p) => {
      if (!alive) return;
      projectsApi.visit(pid);
      useProjects.getState().upsertProject({ ...p, visitedAt: Date.now() });
      projectsApi.listItems(pid).catch(() => {});
    }).catch((e) => { if (alive) setError(e?.status === 404 ? 'This space does not exist or was deleted.' : (e?.message || 'Could not load the space')); });
    return () => { alive = false; };
  }, [pid]);

  // "c" opens the Create dialog for this space.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'c' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target) || layerOpen() || useItemPanel.getState().create) return;
      e.preventDefault();
      useItemPanel.getState().openCreate({ projectId: pid });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pid]);

  // Leaving full-width with Escape when nothing else wants it.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !layerOpen() && !useItemPanel.getState().openItemId && !isTypingTarget(e.target)) setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  if (error && !project) {
    return (
      <div className="view pj-page">
        <div className="pj-empty-hero">
          <h2>Space not found</h2>
          <p className="muted">{error}</p>
          <Link className="btn btn-primary" to={`/w/${workspaceId}/projects/all`}>View all spaces</Link>
        </div>
      </div>
    );
  }
  if (!project) return <div className="view pj-page"><div className="loading-block"><span className="spinner" /> Loading space…</div></div>;

  const tabs = project.tabs;
  const visible = tabs.order.filter((t) => !tabs.hidden.includes(t));
  if (!isTab(tab) || tabs.hidden.includes(tab)) {
    const target = visible.includes(tabs.default) ? tabs.default : visible[0] ?? 'summary';
    return <Navigate to={`/w/${workspaceId}/projects/p/${pid}/${target}`} replace />;
  }
  const Tab = TABS[tab];

  return (
    <div className={`view pj-page pj-project${full ? ' pj-full' : ''}`}>
      <ProjectHeader project={project} workspaceId={workspaceId} full={full} onToggleFull={() => setFull((f) => !f)} />
      <TabBar project={project} active={tab} onSelect={(t) => navigate(`/w/${workspaceId}/projects/p/${pid}/${t}`)} />
      <div className="pj-tab-content">
        <Tab key={`${pid}:${tab}`} workspaceId={workspaceId} project={project} currentUser={currentUser} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- header

function ProjectHeader({ project, workspaceId, full, onToggleFull }: { project: Project; workspaceId: string; full: boolean; onToggleFull(): void }) {
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const [flash, setFlash] = useFlash();
  const [err, setErr] = useState('');
  const iconBtn = useRef<HTMLButtonElement>(null);

  const save = async (body: Parameters<typeof projectsApi.updateProject>[1]) => {
    setErr('');
    try { await projectsApi.updateProject(project.id, body); } catch (e: any) { setErr(e?.message || 'Could not save'); }
  };

  return (
    <div className="pj-proj-head">
      <div className="pj-crumbs">
        <Link to={`/w/${workspaceId}/projects/all`}>Spaces</Link>
      </div>
      <div className="pj-proj-row">
        <button ref={iconBtn} className="pj-space-icon pj-space-icon-lg pj-icon-btn" style={{ background: project.color }} title="Change icon"
          aria-label="Change icon" onClick={() => setIconOpen((v) => !v)}>{project.iconEmoji}</button>
        {renaming
          ? <InlineName value={project.name} onDone={(v) => { setRenaming(false); if (v && v !== project.name) save({ name: v }); }} />
          : <h1 className="pj-proj-name" title="Click to rename" onClick={() => setRenaming(true)}>{project.name}</h1>}
        <MembersButton />
        <Dropdown className="icon-btn pj-icon-ghost" ariaLabel="Space actions" title="More actions" label={<Icon name="more" size={18} />} width={220}>
          {(close) => (
            <div className="pj-menu" role="menu">
              <MenuItem icon={<Icon name="edit" size={15} />} onClick={() => { close(); setRenaming(true); }}>Rename space</MenuItem>
              <MenuItem icon={<Icon name="smile" size={15} />} onClick={() => { close(); setIconOpen(true); }}>Change icon</MenuItem>
              <MenuItem icon={<Glyph name="starFill" size={15} fill={project.starred} />} onClick={() => { close(); projectsApi.toggleStar(project.id).catch(() => {}); }}>
                {project.starred ? 'Remove from starred' : 'Add to starred'}
              </MenuItem>
              <MenuItem icon={<Glyph name="list" size={15} />} onClick={() => { close(); navigate(`/w/${workspaceId}/projects/all`); }}>View all spaces</MenuItem>
              <div className="pj-menu-sep" />
              <MenuItem danger icon={<Icon name="trash" size={15} />} onClick={() => { close(); setDeleting(true); }}>Delete space</MenuItem>
            </div>
          )}
        </Dropdown>
        <span className="grow" />
        {flash && <span className="pj-flash" role="status">{flash}</span>}
        <button className="icon-btn pj-icon-ghost" title="Copy link to space" aria-label="Copy link to space"
          onClick={async () => { if (await copyText(`${location.origin}/w/${workspaceId}/projects/p/${project.id}`)) setFlash('Link copied'); }}>
          <Icon name="link" size={17} />
        </button>
        <button className="pj-btn" title="Automate this space with workflows" onClick={() => navigate(`/w/${workspaceId}/workflows`)}>
          <Glyph name="bolt" size={15} /> Automate
        </button>
        <button className="icon-btn pj-icon-ghost" title="Give feedback" aria-label="Give feedback" onClick={() => setFeedback(true)}><Glyph name="feedback" size={17} /></button>
        <button className={`icon-btn pj-icon-ghost${full ? ' active' : ''}`} title={full ? 'Exit full width' : 'Full width'} aria-label={full ? 'Exit full width' : 'Full width'}
          aria-pressed={full} onClick={onToggleFull}>
          <Glyph name={full ? 'shrink' : 'expand'} size={17} />
        </button>
        <button className="btn btn-primary pj-create-btn" title="Create work item (C)" onClick={() => useItemPanel.getState().openCreate({ projectId: project.id })}>
          <Icon name="plus" size={15} /> Create
        </button>
      </div>
      {err && <p className="form-error pj-head-err">{err}</p>}

      {iconOpen && (
        <Popover anchor={iconBtn.current} onClose={() => setIconOpen(false)} width={300}>
          <div className="pj-pop-title">Icon</div>
          <div className="pj-emoji-grid pj-emoji-grid-pop">
            {SPACE_EMOJIS.map((e) => (
              <button key={e} className={`pj-emoji${e === project.iconEmoji ? ' on' : ''}`} onClick={() => save({ iconEmoji: e })}>{e}</button>
            ))}
          </div>
          <div className="pj-pop-title">Colour</div>
          <div className="pj-swatches pj-swatches-pop">
            {SPACE_COLORS.map((c) => (
              <button key={c} aria-label={c} className={`pj-swatch${c === project.color ? ' on' : ''}`} style={{ background: c }} onClick={() => save({ color: c })} />
            ))}
          </div>
        </Popover>
      )}
      {deleting && (
        <ConfirmDialog title="Delete space?" confirmLabel="Delete space"
          body={<p>“{project.name}” and all {project.itemCount} of its work items will be deleted for everyone. This can’t be undone.</p>}
          onClose={() => setDeleting(false)}
          onConfirm={async () => { await projectsApi.deleteProject(project.id); navigate(`/w/${workspaceId}/projects/all`); }} />
      )}
      {feedback && <FeedbackDialog onClose={() => setFeedback(false)} />}
    </div>
  );
}

function InlineName({ value, onDone }: { value: string; onDone(v: string | null): void }) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  const finish = (val: string | null) => { if (done.current) return; done.current = true; onDone(val); };
  return (
    <input className="pj-proj-name-input" autoFocus value={v} maxLength={80} aria-label="Space name"
      onFocus={(e) => e.target.select()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(v.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(v.trim() || null); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      }} />
  );
}

function MembersButton() {
  const members = useMembers();
  const [q, setQ] = useState('');
  const shown = members.filter((m) => !q.trim() || displayName(m).toLowerCase().includes(q.trim().toLowerCase()) || m.email.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Dropdown className="pj-members-btn" ariaLabel={`People: ${members.length}`} title="People in this workspace" width={300}
      label={<>
        <span className="pj-avatar-stack">{members.slice(0, 3).map((m) => <Avatar key={m.id} user={m} size={22} />)}</span>
        <span className="pj-members-count">{members.length}</span>
      </>}>
      {() => (
        <div>
          <div className="pj-pop-title">People · {members.length}</div>
          <p className="pj-pop-note">Everyone in the workspace can see and work on this space.</p>
          <input className="pj-pop-search" autoFocus placeholder="Search people" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="pj-pop-scroll">
            {shown.map((m) => (
              <div key={m.id} className="pj-person-row">
                <Avatar user={m} size={28} />
                <div className="grow">
                  <div className="pj-person-name">{displayName(m)}</div>
                  <div className="muted small">{m.title || m.email}</div>
                </div>
                {m.role !== 'member' && <span className="tag cap">{m.role}</span>}
              </div>
            ))}
            {!shown.length && <div className="pj-pop-empty">No matching people</div>}
          </div>
        </div>
      )}
    </Dropdown>
  );
}

function FeedbackDialog({ onClose }: { onClose(): void }) {
  const [text, setText] = useState('');
  const [mood, setMood] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  return (
    <Modal title={sent ? 'Thanks!' : 'Share feedback'} onClose={onClose} width={440}
      footer={sent ? <button className="btn btn-primary" autoFocus onClick={onClose}>Done</button> : <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!text.trim() && !mood} onClick={() => setSent(true)}>Send feedback</button>
      </>}>
      {sent ? <p>Thanks for helping us make Projects better. We read every note.</p> : (
        <div className="pj-form">
          <div className="field">How is Projects working for you?
            <div className="row gap-sm">
              {['😞', '😐', '🙂', '😍'].map((m) => (
                <button key={m} className={`pj-emoji${mood === m ? ' on' : ''}`} aria-pressed={mood === m} onClick={() => setMood(m)}>{m}</button>
              ))}
            </div>
          </div>
          <label className="field">Tell us more
            <textarea className="input" rows={4} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="What works well? What could be better?" />
          </label>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- tabs

function TabBar({ project, active, onSelect }: { project: Project; active: TabKey; onSelect(t: TabKey): void }) {
  const tabs = project.tabs;
  const visible = useMemo(() => tabs.order.filter((t) => !tabs.hidden.includes(t)), [tabs]);
  const hidden = tabs.order.filter((t) => tabs.hidden.includes(t));
  const [renaming, setRenaming] = useState<TabKey | null>(null);
  const [err, setErr] = useState('');
  const label = (t: TabKey) => tabs.labels[t] || TAB_LABEL[t];

  const persist = async (next: TabConfig) => {
    setErr('');
    const st = useProjects.getState();
    const before = st.projects[project.id];
    st.upsertProject({ ...before, tabs: next });
    try { await projectsApi.updateProject(project.id, { tabs: next }); } catch (e: any) {
      if (before) useProjects.getState().upsertProject(before);
      setErr(e?.message || 'Could not save tabs');
    }
  };
  const move = (t: TabKey, dir: -1 | 1) => {
    const i = visible.indexOf(t);
    const other = visible[i + dir];
    if (!other) return;
    const order = tabs.order.slice();
    const a = order.indexOf(t), b = order.indexOf(other);
    [order[a], order[b]] = [order[b], order[a]];
    persist({ ...tabs, order });
  };
  const hide = (t: TabKey) => {
    if (t === tabs.default || visible.length <= 1) return;
    persist({ ...tabs, hidden: [...tabs.hidden, t] });
    if (t === active) onSelect(tabs.default);
  };
  const rename = (t: TabKey, v: string | null) => {
    setRenaming(null);
    if (v == null) return;
    const labels = { ...tabs.labels };
    if (!v || v === TAB_LABEL[t]) delete labels[t]; else labels[t] = v;
    persist({ ...tabs, labels });
  };

  return (
    <div className="pj-tabs-wrap">
      <div className="pj-tabs" role="tablist" aria-label="Space views">
        {visible.map((t, i) => (
          <div key={t} className={`pj-tab${t === active ? ' active' : ''}`}>
            {renaming === t
              ? <TabRename value={label(t)} onDone={(v) => rename(t, v)} />
              : (
                <button role="tab" aria-selected={t === active} className="pj-tab-btn" onClick={() => onSelect(t)}
                  onDoubleClick={() => setRenaming(t)}>
                  {label(t)}{t === tabs.default && <span className="pj-tab-default" title="Default tab" aria-label="(default)">•</span>}
                </button>
              )}
            <Dropdown className="pj-tab-menu-btn" ariaLabel={`${label(t)} tab options`} title="Tab options" label={<Icon name="more" size={14} />} width={210}>
              {(close) => (
                <div className="pj-menu" role="menu">
                  <MenuItem disabled={t === tabs.default} onClick={() => { close(); persist({ ...tabs, default: t }); }}>
                    {t === tabs.default ? 'Default tab' : 'Set as default'}
                  </MenuItem>
                  <MenuItem onClick={() => { close(); setRenaming(t); }}>Rename</MenuItem>
                  <MenuItem disabled={i === 0} onClick={() => { close(); move(t, -1); }}>Move left</MenuItem>
                  <MenuItem disabled={i === visible.length - 1} onClick={() => { close(); move(t, 1); }}>Move right</MenuItem>
                  <div className="pj-menu-sep" />
                  <MenuItem disabled={t === tabs.default || visible.length <= 1} onClick={() => { close(); hide(t); }}
                    hint={t === tabs.default ? 'default' : undefined}>Hide tab</MenuItem>
                </div>
              )}
            </Dropdown>
          </div>
        ))}
        <Dropdown className="pj-tab-add" ariaLabel="Add a tab" title="Add a tab" label={<Icon name="plus" size={15} />} width={220}>
          {(close) => (
            <div className="pj-menu" role="menu">
              <div className="pj-pop-title">Add tab</div>
              {hidden.map((t) => (
                <MenuItem key={t} icon={<Icon name="plus" size={14} />} onClick={() => {
                  close();
                  persist({ ...tabs, hidden: tabs.hidden.filter((h) => h !== t) });
                  onSelect(t);
                }}>{label(t)}</MenuItem>
              ))}
              {!hidden.length && <div className="pj-pop-empty">All tabs are already shown. Hide a tab from its “…” menu to remove it.</div>}
            </div>
          )}
        </Dropdown>
      </div>
      {err && <span className="pj-err-text small">{err}</span>}
    </div>
  );
}

function TabRename({ value, onDone }: { value: string; onDone(v: string | null): void }) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  const finish = (val: string | null) => { if (done.current) return; done.current = true; onDone(val); };
  return (
    <input className="pj-tab-input" autoFocus value={v} maxLength={40} aria-label="Tab name" size={Math.max(4, v.length)}
      onFocus={(e) => e.target.select()} onChange={(e) => setV(e.target.value)} onBlur={() => finish(v.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(v.trim()); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      }} />
  );
}

