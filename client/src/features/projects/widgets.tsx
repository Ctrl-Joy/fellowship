import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { useSession, displayName } from '../../store/session';
import { timeAgo } from '../../lib/time';
import { projectsApi } from './api';
import { useProjects } from './store';
import type { Activity, ItemStatus, ItemType, Priority, Summary } from './types';
import { PRIORITY_LABEL, PRIORITY_ORDER, STATUS_LABEL, STATUS_ORDER, TYPE_LABEL, TYPE_ORDER } from './types';
import { ItemKey, PRIORITY_COLOR, STATUS_COLOR, StatusPill, TypeIcon } from './ui';
import './summary.css';

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------

/** Where "View all" links go: the space's List tab, optionally pre-filtered. */
export function listPath(workspaceId: string, projectId: string, params: Record<string, string> = {}) {
  const q = new URLSearchParams(params).toString();
  return `/w/${workspaceId}/projects/p/${projectId}/list${q ? `?${q}` : ''}`;
}

/** Same request issued by several widgets at once (dashboards) shares one fetch. */
const inflight = new Map<string, { version: number; at: number; promise: Promise<Summary> }>();

/**
 * Fetch a space's summary and keep it live: refetches (debounced 400 ms) whenever
 * `useProjects.version` changes, i.e. on any project/item change in this workspace.
 */
export function useSummary(projectId: string | null | undefined, opts: { days?: number; assignee?: string[] } = {}) {
  const version = useProjects((s) => s.version);
  const [state, setState] = useState<{ key: string; data: Summary | null; error: string | null }>({ key: '', data: null, error: null });
  const assigneeKey = (opts.assignee ?? []).slice().sort().join(',');
  const key = `${projectId}|${opts.days ?? 7}|${assigneeKey}`;
  const seq = useRef(0);
  const lastKey = useRef('');

  useEffect(() => {
    if (!projectId) return;
    const keyChanged = lastKey.current !== key;
    lastKey.current = key;
    const my = ++seq.current;
    const run = () => {
      const cached = inflight.get(key);
      let promise: Promise<Summary>;
      if (cached && cached.version === version && Date.now() - cached.at < 3000) promise = cached.promise;
      else {
        promise = projectsApi.summary(projectId, { days: opts.days, assignee: assigneeKey ? assigneeKey.split(',') : undefined });
        inflight.set(key, { version, at: Date.now(), promise });
        promise.catch(() => inflight.delete(key));
      }
      promise.then(
        (data) => { if (seq.current === my) setState({ key, data, error: null }); },
        (e) => { if (seq.current === my) setState((s) => ({ key, data: s.key === key ? s.data : null, error: e?.message || 'Could not load the summary' })); },
      );
    };
    // A new filter loads straight away; background changes are batched.
    if (keyChanged) { run(); return; }
    const t = setTimeout(run, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, projectId]);

  const fresh = state.key === key;
  return { summary: state.data, loading: !fresh || (!state.data && !state.error), error: fresh ? state.error : null, stale: !fresh && !!state.data };
}

// ---------------------------------------------------------------------------------------------
// Card shell
// ---------------------------------------------------------------------------------------------

export function Card({ title, description, viewAll, actions, children, className = '', wide = false }: {
  title: string; description?: string; viewAll?: string; actions?: ReactNode; children: ReactNode; className?: string; wide?: boolean;
}) {
  return (
    <section className={`pjs-card${wide ? ' pjs-wide' : ''} ${className}`} aria-label={title}>
      <header className="pjs-card-head">
        <div className="pjs-card-titles">
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        <div className="pjs-card-actions">
          {viewAll && <Link className="pjs-viewall" to={viewAll}>View all</Link>}
          {actions}
        </div>
      </header>
      <div className="pjs-card-body">{children}</div>
    </section>
  );
}

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

interface WidgetProps { summary: Summary; workspaceId: string; projectId: string; actions?: ReactNode; titleOverride?: string }

// ---------------------------------------------------------------------------------------------
// Stat cards
// ---------------------------------------------------------------------------------------------

export function StatCards({ summary }: { summary: Summary }) {
  const d = summary.days;
  const cards: { n: number; label: string; sub: string; icon: string; tone: string }[] = [
    { n: summary.stats.completed, label: 'completed', sub: `in the last ${d} days`, icon: 'check', tone: 'done' },
    { n: summary.stats.updated, label: 'updated', sub: `in the last ${d} days`, icon: 'edit', tone: 'upd' },
    { n: summary.stats.created, label: 'created', sub: `in the last ${d} days`, icon: 'plus', tone: 'new' },
    { n: summary.stats.dueSoon, label: 'due soon', sub: `in the next ${d} days`, icon: 'clock', tone: 'due' },
  ];
  return (
    <div className="pjs-stats" role="list" aria-label="Activity in numbers">
      {cards.map((c) => (
        <div key={c.label} className="pjs-stat" role="listitem">
          <span className={`pjs-stat-icon pjs-tone-${c.tone}`} aria-hidden="true"><Icon name={c.icon} size={20} /></span>
          <div>
            <div className="pjs-stat-main"><strong>{c.n}</strong> {c.label}</div>
            <div className="pjs-stat-sub">{c.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Status donut
// ---------------------------------------------------------------------------------------------

export function StatusDonut({ summary, workspaceId, projectId, actions, titleOverride }: WidgetProps) {
  const navigate = useNavigate();
  const [hover, setHover] = useState<ItemStatus | null>(null);
  const total = STATUS_ORDER.reduce((a, s) => a + (summary.status[s] ?? 0), 0);
  const R = 70, W = 22, C = 2 * Math.PI * R;
  // 2px surface gap between segments (only when there is more than one segment).
  const nonZero = STATUS_ORDER.filter((s) => (summary.status[s] ?? 0) > 0);
  const gap = nonZero.length > 1 ? 2 : 0;
  let offset = 0;
  const segs = STATUS_ORDER.map((s) => {
    const n = summary.status[s] ?? 0;
    const len = total ? (n / total) * C : 0;
    const seg = { s, n, len: Math.max(0, len - gap), offset };
    offset += len;
    return seg;
  });
  const label = `Status overview: ${STATUS_ORDER.map((s) => `${STATUS_LABEL[s]} ${summary.status[s] ?? 0}`).join(', ')}`;
  const go = (s: ItemStatus) => navigate(listPath(workspaceId, projectId, { status: s }));
  const focus = hover ? { n: summary.status[hover] ?? 0, text: STATUS_LABEL[hover] } : { n: total, text: total === 1 ? 'total work item' : 'total work items' };

  return (
    <Card title={titleOverride ?? 'Status overview'} description="Get a snapshot of the status of your work items." viewAll={listPath(workspaceId, projectId)} actions={actions}>
      <div className="pjs-donut-wrap">
        <svg className="pjs-donut" viewBox="0 0 180 180" width="180" height="180" role="img" aria-label={label}>
          <circle cx="90" cy="90" r={R} fill="none" stroke="var(--border)" strokeWidth={W} />
          {segs.map((g) => g.n > 0 && (
            <circle key={g.s} cx="90" cy="90" r={R} fill="none" stroke={STATUS_COLOR[g.s]}
              strokeWidth={hover === g.s ? W + 6 : W}
              strokeDasharray={`${g.len} ${C - g.len}`} strokeDashoffset={-g.offset}
              transform="rotate(-90 90 90)"
              className={`pjs-donut-seg${hover && hover !== g.s ? ' dim' : ''}`}
              onPointerEnter={() => setHover(g.s)} onPointerLeave={() => setHover(null)}
              onClick={() => go(g.s)}>
              <title>{`${STATUS_LABEL[g.s]}: ${g.n} (${pct(g.n, total)}%)`}</title>
            </circle>
          ))}
          <text x="90" y="88" textAnchor="middle" className="pjs-donut-n">{focus.n}</text>
          <text x="90" y="108" textAnchor="middle" className="pjs-donut-t">{focus.text}</text>
        </svg>
        <ul className="pjs-legend">
          {STATUS_ORDER.map((s) => (
            <li key={s}>
              <button type="button" className={`pjs-legend-item${hover === s ? ' on' : ''}`}
                onPointerEnter={() => setHover(s)} onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(s)} onBlur={() => setHover(null)}
                onClick={() => go(s)} aria-label={`${STATUS_LABEL[s]}: ${summary.status[s] ?? 0}. Show in list`}>
                <span className="pjs-swatch" style={{ background: STATUS_COLOR[s] }} aria-hidden="true" />
                <span className="pjs-legend-label">{STATUS_LABEL[s]}</span>
                <span className="pjs-legend-n">{summary.status[s] ?? 0}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------------------------

const FIELD_VERB: Record<string, string> = {
  created: 'created', comment: 'commented on', form: 'submitted a form for', summary: 'updated the summary of',
  description: 'updated the description of', status: 'changed status of', priority: 'changed priority of', type: 'changed the type of',
  assignee: 'changed the assignee of', reporter: 'changed the reporter of', parent: 'changed the parent of',
  startDate: 'changed the start date of', dueDate: 'changed the due date of', labels: 'updated labels on',
};

function dayBucket(ts: number) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t.getTime() - d.getTime()) / 86400000);
  return diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : 'Earlier';
}

function ActivityRow({ a }: { a: Activity }) {
  const actor = useSession((s) => (a.actorId ? s.members[a.actorId] : undefined));
  const name = a.actorId ? (actor ? displayName(actor) : 'Someone') : 'Fellowship';
  const verb = FIELD_VERB[a.field] ?? `changed ${a.field} of`;
  return (
    <li className="pjs-act">
      {actor ? <Avatar user={actor} size={28} /> : <span className="pj-unassigned" style={{ width: 28, height: 28 }} aria-hidden="true" />}
      <div className="pjs-act-body">
        <div className="pjs-act-line">
          <strong>{name}</strong> {verb}
          {a.itemKey && (
            <span className="pjs-act-item">
              {a.itemType && <TypeIcon type={a.itemType} size={14} />}
              <ItemKey item={{ id: a.itemId, key: a.itemKey }} />
              <span className="pjs-act-summary">{a.itemSummary}</span>
              {a.itemStatus && <StatusPill status={a.itemStatus} />}
            </span>
          )}
        </div>
        <time className="pjs-act-time" dateTime={new Date(a.createdAt).toISOString()} title={new Date(a.createdAt).toLocaleString()}>{timeAgo(a.createdAt)}</time>
      </div>
    </li>
  );
}

export function RecentActivity({ summary, actions, titleOverride }: Omit<WidgetProps, 'workspaceId' | 'projectId'> & { workspaceId?: string; projectId?: string }) {
  const groups = useMemo(() => {
    const out: { label: string; items: Activity[] }[] = [];
    for (const a of summary.activity) {
      const label = dayBucket(a.createdAt);
      const g = out[out.length - 1];
      if (g && g.label === label) g.items.push(a); else out.push({ label, items: [a] });
    }
    return out;
  }, [summary.activity]);
  return (
    <Card title={titleOverride ?? 'Recent activity'} description="Stay up to date with what's happening across the space." actions={actions}>
      {groups.length === 0 ? <p className="pjs-none">Nothing has happened here yet.</p> : (
        <div className="pjs-feed" tabIndex={0} aria-label="Recent activity feed">
          {groups.map((g) => (
            <div key={g.label}>
              <h4 className="pjs-feed-day">{g.label}</h4>
              <ul>{g.items.map((a) => <ActivityRow key={a.id} a={a} />)}</ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Priority bars
// ---------------------------------------------------------------------------------------------

function niceMax(n: number) {
  if (n <= 4) return Math.max(n, 1) <= 2 ? 2 : 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= n) return m * pow;
  return 10 * pow;
}

export function PriorityBars({ summary, workspaceId, projectId, actions, titleOverride }: WidgetProps) {
  const [hover, setHover] = useState<Priority | null>(null);
  const navigate = useNavigate();
  const values = PRIORITY_ORDER.map((p) => ({ p, n: summary.priority[p] ?? 0 }));
  const max = niceMax(Math.max(0, ...values.map((v) => v.n)));
  const ticks = useMemo(() => {
    let step = 1;
    for (let pow = 1; ; pow *= 10) {
      const s = [1, 2, 2.5, 5].map((m) => m * pow).find((c) => Number.isInteger(c) && max % c === 0 && max / c <= 5);
      if (s) { step = s; break; }
      if (pow > max) { step = max; break; }
    }
    const out: number[] = [];
    for (let v = 0; v <= max; v += step) out.push(v);
    return out;
  }, [max]);
  const W = 420, H = 220, L = 34, B = 30, T = 14, Rr = 8;
  const plotW = W - L - Rr, plotH = H - T - B;
  const slot = plotW / values.length;
  const bw = Math.min(36, slot * 0.56);
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const label = `Priority breakdown: ${values.map((v) => `${PRIORITY_LABEL[v.p]} ${v.n}`).join(', ')}`;
  return (
    <Card title={titleOverride ?? 'Priority breakdown'} description="Get a holistic view of how work is being prioritised." viewAll={listPath(workspaceId, projectId)} actions={actions}>
      <svg className="pjs-bars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - Rr} y1={y(t)} y2={y(t)} className={t === 0 ? 'pjs-axis' : 'pjs-gridline'} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="pjs-tick">{t}</text>
          </g>
        ))}
        {values.map((v, i) => {
          const cx = L + slot * i + slot / 2;
          const h = Math.max(0, y(0) - y(v.n));
          const r = Math.min(4, h / 2, bw / 2);
          const x0 = cx - bw / 2, top = y(v.n);
          // Rounded top corners only; the bar stands flat on the baseline.
          const d = h > 0 ? `M${x0},${y(0)} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${y(0)} Z` : '';
          return (
            <g key={v.p} className={`pjs-bar${hover && hover !== v.p ? ' dim' : ''}`}
              onPointerEnter={() => setHover(v.p)} onPointerLeave={() => setHover(null)}
              onClick={() => navigate(listPath(workspaceId, projectId, { priority: v.p }))}>
              <title>{`${PRIORITY_LABEL[v.p]}: ${v.n}`}</title>
              <rect x={cx - slot / 2} y={T} width={slot} height={plotH} fill="transparent" />
              {d && <path d={d} fill={PRIORITY_COLOR[v.p]} />}
              {(hover === v.p || v.n > 0) && <text x={cx} y={top - 5} textAnchor="middle" className={`pjs-val${hover === v.p ? ' on' : ''}`}>{v.n}</text>}
              <text x={cx} y={H - 10} textAnchor="middle" className="pjs-xlab">{PRIORITY_LABEL[v.p]}</text>
            </g>
          );
        })}
      </svg>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Horizontal distribution rows (types, workload)
// ---------------------------------------------------------------------------------------------

function DistRow({ icon, label, n, total, color, onClick }: { icon: ReactNode; label: string; n: number; total: number; color?: string; onClick?: () => void }) {
  const p = pct(n, total);
  return (
    <li className="pjs-dist">
      <button type="button" className="pjs-dist-label" onClick={onClick} disabled={!onClick} title={label}>
        {icon}<span>{label}</span>
      </button>
      <div className="pjs-dist-bar" role="img" aria-label={`${label}: ${n} of ${total} (${p}%)`} title={`${n} of ${total}`}>
        <div className="pjs-dist-fill" style={{ width: `${Math.max(p, n > 0 ? 2 : 0)}%`, background: color }} />
        <span className="pjs-dist-pct">{p}%</span>
      </div>
    </li>
  );
}

export function TypesOfWork({ summary, workspaceId, projectId, actions, titleOverride }: WidgetProps) {
  const navigate = useNavigate();
  const total = TYPE_ORDER.reduce((a, t) => a + (summary.types[t] ?? 0), 0);
  const rows = TYPE_ORDER.filter((t) => (summary.types[t] ?? 0) > 0) as ItemType[];
  return (
    <Card title={titleOverride ?? 'Types of work'} description="Get a breakdown of work items by their types." viewAll={listPath(workspaceId, projectId)} actions={actions}>
      {rows.length === 0 ? <p className="pjs-none">No work items yet.</p> : (
        <>
          <div className="pjs-dist-head"><span>Type</span><span>Distribution</span></div>
          <ul className="pjs-dist-list">
            {rows.map((t) => (
              <DistRow key={t} icon={<TypeIcon type={t} />} label={TYPE_LABEL[t]} n={summary.types[t] ?? 0} total={total}
                onClick={() => navigate(listPath(workspaceId, projectId, { type: t }))} />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function WorkloadRow({ assigneeId, n, total, onClick }: { assigneeId: string | null; n: number; total: number; onClick(): void }) {
  const m = useSession((s) => (assigneeId ? s.members[assigneeId] : undefined));
  const name = assigneeId ? (m ? displayName(m) : 'Former member') : 'Unassigned';
  const icon = m ? <Avatar user={m} size={22} /> : <span className="pj-unassigned" style={{ width: 22, height: 22 }} aria-hidden="true" />;
  return <DistRow icon={icon} label={name} n={n} total={total} color="var(--brand)" onClick={onClick} />;
}

export function TeamWorkload({ summary, workspaceId, projectId, actions, titleOverride }: WidgetProps) {
  const navigate = useNavigate();
  const total = summary.workload.reduce((a, w) => a + w.count, 0);
  return (
    <Card title={titleOverride ?? 'Team workload'} description="Monitor the capacity of your team." viewAll={listPath(workspaceId, projectId)} actions={actions}>
      {summary.workload.length === 0 ? <p className="pjs-none">No work items yet.</p> : (
        <>
          <div className="pjs-dist-head"><span>Assignee</span><span>Work distribution</span></div>
          <ul className="pjs-dist-list">
            {summary.workload.map((w) => (
              <WorkloadRow key={w.assigneeId ?? 'none'} assigneeId={w.assigneeId} n={w.count} total={total}
                onClick={() => navigate(listPath(workspaceId, projectId, { assignee: w.assigneeId ?? 'none' }))} />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Epic progress
// ---------------------------------------------------------------------------------------------

const EPIC_PARTS = [
  { k: 'done' as const, label: 'Done', color: STATUS_COLOR.done },
  { k: 'inProgress' as const, label: 'In progress', color: STATUS_COLOR.in_progress },
  { k: 'todo' as const, label: 'To do', color: STATUS_COLOR.todo },
];

export function EpicProgress({ summary, workspaceId, projectId, actions, titleOverride }: WidgetProps) {
  return (
    <Card title={titleOverride ?? 'Epic progress'} description="See how your epics are progressing at a glance." viewAll={listPath(workspaceId, projectId, { type: 'epic' })} actions={actions}>
      {summary.epics.length === 0 ? <p className="pjs-none">No epics yet. Group related work under an epic to track its progress here.</p> : (
        <>
          <ul className="pjs-epic-legend" aria-label="Legend">
            {EPIC_PARTS.map((p) => <li key={p.k}><span className="pjs-swatch" style={{ background: p.color }} aria-hidden="true" />{p.label}</li>)}
          </ul>
          <ul className="pjs-epics">
            {summary.epics.map((e) => {
              const label = `${e.key} ${e.summary}: ${EPIC_PARTS.map((p) => `${p.label} ${pct(e[p.k], e.total)}%`).join(', ')}`;
              return (
                <li key={e.id} className="pjs-epic">
                  <div className="pjs-epic-title">
                    <TypeIcon type="epic" />
                    <ItemKey item={{ id: e.id, key: e.key }} />
                    <span className="pjs-epic-summary" title={e.summary}>{e.summary}</span>
                  </div>
                  {e.total === 0 ? <div className="pjs-epic-bar empty"><span>No child work items</span></div> : (
                    <div className="pjs-epic-bar" role="img" aria-label={label}>
                      {EPIC_PARTS.map((p) => {
                        const v = e[p.k];
                        if (!v) return null;
                        const share = pct(v, e.total);
                        return (
                          <div key={p.k} className="pjs-epic-seg" style={{ flexGrow: v, background: p.color }} title={`${p.label}: ${v} of ${e.total}`}>
                            {share >= 12 && <span>{share}%</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Dispatcher (dashboards)
// ---------------------------------------------------------------------------------------------

export type SummaryWidgetType = 'stats' | 'status' | 'priority' | 'types' | 'workload' | 'epics' | 'activity';

export function SummaryWidget({ type, ...p }: WidgetProps & { type: SummaryWidgetType }) {
  switch (type) {
    case 'stats': return <Card title={p.titleOverride ?? 'Activity in numbers'} description="Completed, updated, created and due-soon work." actions={p.actions} wide><StatCards summary={p.summary} /></Card>;
    case 'status': return <StatusDonut {...p} />;
    case 'priority': return <PriorityBars {...p} />;
    case 'types': return <TypesOfWork {...p} />;
    case 'workload': return <TeamWorkload {...p} />;
    case 'epics': return <EpicProgress {...p} />;
    case 'activity': return <RecentActivity {...p} />;
  }
}
