import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ProjectsViewProps } from './ProjectsRoot';
import { useProjects } from './store';
import { projectsApi } from './api';
import { Assignee } from './ui';
import { Glyph } from './kit';
import { Icon } from '../../components/Icon';
import CreateSpaceDialog from './CreateSpaceDialog';
import type { Project } from './types';
import { displayName, useSession } from '../../store/session';
import './shell.css';

type SortKey = 'name' | 'key' | 'items' | 'lead';

/** /projects/all — every space in the workspace. */
export default function AllSpaces({ workspaceId }: ProjectsViewProps) {
  const navigate = useNavigate();
  const all = useProjects((s) => s.projects);
  const loaded = useProjects((s) => s.loaded);
  const members = useSession((s) => s.members);
  const [q, setQ] = useState('');
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [creating, setCreating] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [err, setErr] = useState('');

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const lead = (p: Project) => displayName(members[p.leadId ?? p.createdBy]);
    return Object.values(all).filter((p) => p.workspaceId === workspaceId)
      .filter((p) => !onlyStarred || p.starred)
      .filter((p) => !s || p.name.toLowerCase().includes(s) || p.key.toLowerCase().includes(s) || lead(p).toLowerCase().includes(s))
      .sort((a, b) => {
        const v = sort.key === 'items' ? a.itemCount - b.itemCount
          : sort.key === 'key' ? a.key.localeCompare(b.key)
            : sort.key === 'lead' ? lead(a).localeCompare(lead(b))
              : a.name.localeCompare(b.name);
        return v * sort.dir;
      });
  }, [all, workspaceId, q, onlyStarred, sort, members]);
  const total = Object.values(all).filter((p) => p.workspaceId === workspaceId).length;

  const trySample = async () => {
    setSampleBusy(true); setErr('');
    try {
      const p = await projectsApi.createSample(workspaceId);
      navigate(`/w/${workspaceId}/projects/p/${p.id}`);
    } catch (e: any) { setErr(e?.message || 'Could not create the sample space'); setSampleBusy(false); }
  };
  const th = (key: SortKey, label: string, cls = '') => (
    <th className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="pj-th-btn" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}{sort.key === key && <Icon name={sort.dir === 1 ? 'chevronDown' : 'chevronRight'} size={12} />}
      </button>
    </th>
  );

  return (
    <div className="view pj-page">
      <div className="pj-page-head">
        <div>
          <div className="pj-crumbs"><span>Projects</span></div>
          <h1 className="pj-page-title">Spaces</h1>
        </div>
        <div className="row gap-sm">
          <button className="btn" onClick={trySample} disabled={sampleBusy}>{sampleBusy ? <span className="spinner" /> : <Glyph name="sparkle" size={15} />} Try a sample space</button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={15} /> Create space</button>
        </div>
      </div>
      <div className="pj-toolbar">
        <label className="pj-search">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search spaces" aria-label="Search spaces" />
          {q && <button aria-label="Clear" onClick={() => setQ('')}><Icon name="x" size={13} /></button>}
        </label>
        <button className={`pj-btn${onlyStarred ? ' active' : ''}`} aria-pressed={onlyStarred} onClick={() => setOnlyStarred((v) => !v)}>
          <Icon name="star" size={15} /> Starred only
        </button>
        <span className="grow" />
        <span className="muted small">{list.length} of {total} space{total === 1 ? '' : 's'}</span>
      </div>
      {err && <p className="form-error" style={{ margin: '0 24px 8px' }}>{err}</p>}
      <div className="view-scroll pj-scroll">
        {!loaded ? <div className="loading-block"><span className="spinner" /> Loading spaces…</div>
          : total === 0 ? (
            <div className="pj-empty-hero">
              <div className="pj-empty-art"><Glyph name="layers" size={40} /></div>
              <h2>No spaces yet</h2>
              <p className="muted">Spaces hold your team's work items: plan them in a list, move them across a board and see them on a timeline.</p>
              <div className="row gap-sm" style={{ justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={() => setCreating(true)}>Create space</button>
                <button className="btn" onClick={trySample} disabled={sampleBusy}>Try a sample space</button>
              </div>
            </div>
          ) : (
            <table className="pj-table pj-spaces-table">
              <thead>
                <tr>
                  <th className="pj-col-star"><span className="sr-only">Starred</span></th>
                  {th('name', 'Name')}
                  {th('key', 'Key', 'pj-col-key')}
                  {th('lead', 'Lead')}
                  {th('items', 'Work items', 'pj-col-num')}
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const pct = p.itemCount ? Math.round((p.doneCount / p.itemCount) * 100) : 0;
                  return (
                    <tr key={p.id} className="pj-row-click" onClick={() => navigate(`/w/${workspaceId}/projects/p/${p.id}`)}>
                      <td className="pj-col-star">
                        <button className={`pj-star${p.starred ? ' on' : ''}`} aria-pressed={p.starred} aria-label={p.starred ? `Unstar ${p.name}` : `Star ${p.name}`}
                          title={p.starred ? 'Unstar' : 'Star'} onClick={(e) => { e.stopPropagation(); projectsApi.toggleStar(p.id).catch(() => {}); }}>
                          <Glyph name="starFill" size={16} fill={p.starred} />
                        </button>
                      </td>
                      <td>
                        <a className="pj-space-name" href={`/w/${workspaceId}/projects/p/${p.id}`} onClick={(e) => { e.preventDefault(); }}>
                          <span className="pj-space-icon" style={{ background: p.color }}>{p.iconEmoji}</span>
                          <span>{p.name}</span>
                        </a>
                        {p.description && <div className="muted small pj-space-desc">{p.description}</div>}
                      </td>
                      <td className="pj-col-key"><code className="pj-code">{p.key}</code></td>
                      <td><Assignee userId={p.leadId ?? p.createdBy} size={22} showName /></td>
                      <td className="pj-col-num">{p.itemCount}</td>
                      <td>
                        <div className="pj-progress-inline" title={`${p.doneCount} of ${p.itemCount} done`}>
                          <div className="pj-progress"><span style={{ width: `${pct}%` }} /></div>
                          <span className="muted small">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!list.length && <tr><td colSpan={6} className="pj-empty-row">No spaces match “{q}”.</td></tr>}
              </tbody>
            </table>
          )}
      </div>
      {creating && <CreateSpaceDialog workspaceId={workspaceId} onClose={() => setCreating(false)} />}
    </div>
  );
}
