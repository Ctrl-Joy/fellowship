import { useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { Icon } from '../../components/Icon';
import { useProjects } from './store';
import type { Project } from './types';
import { Glyph, Popover } from './kit';
import CreateSpaceDialog from './CreateSpaceDialog';
import './shell.css';

const MAX_SPACES = 6;

function loadOpen(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem('fs:sidebar:projects') ?? '{}'); } catch { return {}; }
}

/** The "Projects" section of the main sidebar (between Direct messages and Apps). */
export default function SidebarSection({ workspaceId }: { workspaceId: string }) {
  const all = useProjects((s) => s.projects);
  const navigate = useNavigate();
  const [state, setState] = useState(loadOpen);
  const [pop, setPop] = useState<'recent' | 'starred' | 'more' | null>(null);
  const [creating, setCreating] = useState(false);
  const recentBtn = useRef<HTMLButtonElement>(null);
  const starredBtn = useRef<HTMLButtonElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const open = !state.collapsed;
  const base = `/w/${workspaceId}/projects`;

  const toggle = () => setState((c) => {
    const next = { ...c, collapsed: !c.collapsed };
    try { localStorage.setItem('fs:sidebar:projects', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  const { spaces, recent, starred } = useMemo(() => {
    const list = Object.values(all).filter((p) => p.workspaceId === workspaceId);
    const byName = (a: Project, b: Project) => a.name.localeCompare(b.name);
    const recent = list.filter((p) => p.visitedAt).sort((a, b) => (b.visitedAt ?? 0) - (a.visitedAt ?? 0)).slice(0, 8);
    const starred = list.filter((p) => p.starred).sort(byName);
    // Starred first, then most recently visited, then by name.
    const spaces = list.slice().sort((a, b) => Number(b.starred) - Number(a.starred) || (b.visitedAt ?? 0) - (a.visitedAt ?? 0) || byName(a, b));
    return { spaces, recent, starred };
  }, [all, workspaceId]);

  const go = (to: string) => { setPop(null); navigate(to); };
  const navItem = (to: string, icon: React.ReactNode, label: string, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}>
      <span className="sb-icon">{icon}</span><span className="sb-label">{label}</span>
    </NavLink>
  );

  return (
    <div className="sb-section pj-sb">
      <div className="sb-section-head">
        <button className="sb-section-toggle" onClick={toggle} aria-expanded={open}>
          <span className="sb-icon"><Glyph name="layers" size={16} /></span> Projects
        </button>
        <button className="sb-section-add" title="Create space" aria-label="Create space" onClick={() => setCreating(true)}><Icon name="plus" size={14} /></button>
      </div>
      {open && (
        <div className="sb-section-body">
          {navItem(base, <Icon name="home" size={15} />, 'For you', true)}
          <button ref={recentBtn} className={`sb-item${pop === 'recent' ? ' pj-sb-open' : ''}`} aria-haspopup="true" aria-expanded={pop === 'recent'}
            onClick={() => setPop(pop === 'recent' ? null : 'recent')}>
            <span className="sb-icon"><Icon name="clock" size={15} /></span><span className="sb-label">Recent</span>
            <Icon name="chevronRight" size={13} className="pj-sb-caret" />
          </button>
          <button ref={starredBtn} className={`sb-item${pop === 'starred' ? ' pj-sb-open' : ''}`} aria-haspopup="true" aria-expanded={pop === 'starred'}
            onClick={() => setPop(pop === 'starred' ? null : 'starred')}>
            <span className="sb-icon"><Icon name="star" size={15} /></span><span className="sb-label">Starred</span>
            <Icon name="chevronRight" size={13} className="pj-sb-caret" />
          </button>

          <div className="pj-sb-sub">
            <span>Spaces</span>
            <button className="pj-sb-sub-btn" title="View all spaces" aria-label="View all spaces" onClick={() => navigate(`${base}/all`)}><Icon name="more" size={14} /></button>
          </div>
          {spaces.slice(0, MAX_SPACES).map((p) => (
            <NavLink key={p.id} to={`${base}/p/${p.id}`} className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`} title={p.name}>
              <span className="sb-icon"><span className="pj-space-icon pj-space-icon-sm" style={{ background: p.color }}>{p.iconEmoji}</span></span>
              <span className="sb-label">{p.name}</span>
              {p.starred && <Glyph name="starFill" size={11} fill className="pj-sb-star" />}
            </NavLink>
          ))}
          {!spaces.length && (
            <button className="sb-item sb-add" onClick={() => setCreating(true)}>
              <span className="sb-icon"><Icon name="plus" size={15} /></span><span className="sb-label">Create your first space</span>
            </button>
          )}
          {spaces.length > MAX_SPACES && (
            <button ref={moreBtn} className={`sb-item sb-add${pop === 'more' ? ' pj-sb-open' : ''}`} aria-haspopup="true" aria-expanded={pop === 'more'}
              onClick={() => setPop(pop === 'more' ? null : 'more')}>
              <span className="sb-icon"><Icon name="more" size={15} /></span><span className="sb-label">More spaces</span>
              <Icon name="chevronRight" size={13} className="pj-sb-caret" />
            </button>
          )}
          {spaces.length > 0 && spaces.length <= MAX_SPACES && (
            <NavLink to={`${base}/all`} className={({ isActive }) => `sb-item sb-add${isActive ? ' active' : ''}`}>
              <span className="sb-icon"><Glyph name="list" size={15} /></span><span className="sb-label">All spaces</span>
            </NavLink>
          )}
          {navItem(`${base}/filters`, <Icon name="filter" size={15} />, 'Filters')}
          {navItem(`${base}/dashboards`, <Glyph name="chart" size={15} />, 'Dashboards')}
        </div>
      )}

      {pop === 'recent' && (
        <Popover anchor={recentBtn.current} onClose={() => setPop(null)} placement="right" width={280}>
          <SpaceList title="Recent spaces" list={recent} empty="Spaces you visit show up here." onPick={(p) => go(`${base}/p/${p.id}`)} />
          <div className="pj-pop-foot"><button className="pj-menu-item" onClick={() => go(`${base}/all`)}>View all spaces</button></div>
        </Popover>
      )}
      {pop === 'starred' && (
        <Popover anchor={starredBtn.current} onClose={() => setPop(null)} placement="right" width={280}>
          <SpaceList title="Starred spaces" list={starred} empty="Star a space to keep it here." onPick={(p) => go(`${base}/p/${p.id}`)} />
          <div className="pj-pop-foot"><button className="pj-menu-item" onClick={() => go(`${base}/all`)}>View all spaces</button></div>
        </Popover>
      )}
      {pop === 'more' && (
        <Popover anchor={moreBtn.current} onClose={() => setPop(null)} placement="right" width={300}>
          <SpaceList title="Spaces" list={spaces} searchable empty="No spaces yet." onPick={(p) => go(`${base}/p/${p.id}`)} />
          <div className="pj-pop-foot">
            <button className="pj-menu-item" onClick={() => go(`${base}/all`)}><Glyph name="list" size={15} /> View all spaces</button>
            <button className="pj-menu-item" onClick={() => { setPop(null); setCreating(true); }}><Icon name="plus" size={15} /> Create space</button>
          </div>
        </Popover>
      )}
      {creating && <CreateSpaceDialog workspaceId={workspaceId} onClose={() => setCreating(false)} />}
    </div>
  );
}

function SpaceList({ title, list, empty, onPick, searchable }: { title: string; list: Project[]; empty: string; onPick(p: Project): void; searchable?: boolean }) {
  const [q, setQ] = useState('');
  const shown = list.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()) || p.key.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div>
      <div className="pj-pop-title">{title}</div>
      {searchable && (
        <input className="pj-pop-search" autoFocus placeholder="Search spaces" aria-label="Search spaces" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) onPick(shown[0]); }} />
      )}
      <div className="pj-pop-scroll">
        {shown.map((p) => (
          <button key={p.id} className="pj-menu-item" onClick={() => onPick(p)}>
            <span className="pj-space-icon pj-space-icon-sm" style={{ background: p.color }}>{p.iconEmoji}</span>
            <span className="pj-menu-label">{p.name}</span>
            <span className="pj-menu-hint">{p.key}</span>
          </button>
        ))}
        {!shown.length && <div className="pj-pop-empty">{q ? 'No matching spaces' : empty}</div>}
      </div>
    </div>
  );
}
