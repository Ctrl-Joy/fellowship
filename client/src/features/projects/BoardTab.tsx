import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { TabProps } from './tabTypes';
import type { ItemStatus, WorkItem } from './types';
import { STATUS_LABEL, STATUS_ORDER } from './types';
import { projectItems, useProjects } from './store';
import { projectsApi } from './api';
import { Assignee, ItemKey, PriorityIcon, STATUS_COLOR, TypeIcon, formatDate, todayIso, useItemPanel } from './ui';
import { Dropdown, Glyph, MenuItem, epicColor, isOverdue, memberName, usePref } from './kit';
import { EMPTY_FILTERS, FilterButton, GroupByButton, PeopleFilter, SearchInput, matchItems, type ItemFilters } from './toolbar';
import { Icon } from '../../components/Icon';
import { useSession } from '../../store/session';
import './board.css';

type GroupBy = 'none' | 'assignee' | 'epic';
const GROUPS: { value: GroupBy; label: string }[] = [{ value: 'none', label: 'None' }, { value: 'assignee', label: 'Assignee' }, { value: 'epic', label: 'Epic' }];
interface ViewOpts { dueDate: boolean; epic: boolean; priority: boolean }
interface Lane { key: string; label: ReactNode; items: WorkItem[] }
interface DropAt { lane: string; status: ItemStatus; index: number }

/** The Board tab: status columns with drag-and-drop, swimlanes, insights and view settings. */
export default function BoardTab({ project, currentUser }: TabProps) {
  const pid = project.id;
  const allItems = useProjects((s) => s.items);
  const members = useSession((s) => s.members);
  const items = useMemo(() => projectItems(allItems, pid), [allItems, pid]);
  const epics = useMemo(() => items.filter((i) => i.type === 'epic'), [items]);
  const boardItems = useMemo(() => items.filter((i) => i.type !== 'epic'), [items]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [filters, setFilters] = useState<ItemFilters>(EMPTY_FILTERS);
  const [groupBy, setGroupBy] = usePref<GroupBy>(`board:group:${pid}`, 'none');
  const [view, setView] = usePref<ViewOpts>('board:view', { dueDate: true, epic: true, priority: true });
  const [collapsedCols, setCollapsedCols] = usePref<ItemStatus[]>(`board:collapsed:${pid}`, []);
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set());
  const [insights, setInsights] = usePref<boolean>('board:insights', false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropAt | null>(null);

  useEffect(() => {
    let alive = true;
    projectsApi.listItems(pid).catch((e) => alive && setErr(e?.message || 'Could not load work items')).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [pid]);

  const matched = useMemo(() => matchItems(boardItems, { search, people, filters }), [boardItems, search, people, filters]);
  const epicOf = (i: WorkItem): string | null => {
    let cur: WorkItem | undefined = i;
    for (let n = 0; cur?.parentId && n < 4; n++) {
      const p: WorkItem | undefined = allItems[cur.parentId];
      if (p?.type === 'epic') return p.id;
      cur = p;
    }
    return null;
  };

  const lanes = useMemo<Lane[]>(() => {
    if (groupBy === 'none') return [{ key: 'all', label: null, items: matched }];
    if (groupBy === 'assignee') {
      const ids = [...new Set(matched.map((i) => i.assigneeId).filter(Boolean) as string[])].sort((a, b) => memberName(a).localeCompare(memberName(b)));
      if (!ids.includes(currentUser.id)) ids.unshift(currentUser.id);
      else ids.sort((a, b) => (a === currentUser.id ? -1 : b === currentUser.id ? 1 : 0));
      return [...ids.map((id) => ({ key: id, label: <Assignee userId={id} size={22} showName />, items: matched.filter((i) => i.assigneeId === id) })),
        { key: 'none', label: <Assignee userId={null} size={22} showName />, items: matched.filter((i) => !i.assigneeId) }];
    }
    return [...epics.map((e) => ({
      key: e.id,
      label: <span className="pj-lane-epic"><span className="pj-epic-dot" style={{ background: epicColor(e.id) }} /><TypeIcon type="epic" size={14} /><b>{e.key}</b> {e.summary}</span>,
      items: matched.filter((i) => epicOf(i) === e.id),
    })), { key: 'none', label: <span className="muted">No epic</span>, items: matched.filter((i) => !epicOf(i)) }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, groupBy, epics, allItems, members, currentUser.id]);

  const run = (p: Promise<unknown>) => p.then(() => setErr('')).catch((e) => setErr(e?.message || 'Could not save the change'));

  /** Move an item to `index` within the (lane, status) cell, as shown on the board. */
  const moveTo = (id: string, lane: Lane, status: ItemStatus, index: number) => {
    const item = allItems[id];
    if (!item) return;
    const cell = lane.items.filter((i) => i.status === status && i.id !== id);
    const afterId = cell[index - 1]?.id ?? null;
    const beforeId = cell[index]?.id ?? null;
    const current = lane.items.filter((i) => i.status === status);
    const curIdx = current.findIndex((i) => i.id === id);
    const sameSpot = item.status === status && curIdx !== -1 && current[curIdx - 1]?.id === (afterId ?? undefined) && current[curIdx + 1]?.id === (beforeId ?? undefined);
    const laneChange = groupBy !== 'none' && laneKeyOf(item) !== lane.key;
    const jobs: Promise<unknown>[] = [];
    if (!sameSpot) jobs.push(projectsApi.rankItem(id, { afterId, beforeId, status: item.status !== status ? status : undefined }));
    if (laneChange) {
      if (groupBy === 'assignee') jobs.push(projectsApi.updateItem(id, { assigneeId: lane.key === 'none' ? null : lane.key }));
      else if (item.type !== 'subtask') jobs.push(projectsApi.updateItem(id, { parentId: lane.key === 'none' ? null : lane.key }));
    }
    if (jobs.length) run(Promise.all(jobs));
  };
  const laneKeyOf = (i: WorkItem) => (groupBy === 'assignee' ? (i.assigneeId ?? 'none') : groupBy === 'epic' ? (epicOf(i) ?? 'none') : 'all');

  const onCellDragOver = (e: DragEvent<HTMLDivElement>, lane: string, status: ItemStatus) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-card-id]')].filter((c) => c.dataset.cardId !== dragId);
    let index = cards.length;
    for (let k = 0; k < cards.length; k++) {
      const r = cards[k].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { index = k; break; }
    }
    if (!drop || drop.lane !== lane || drop.status !== status || drop.index !== index) setDrop({ lane, status, index });
  };
  const onCellDrop = (e: DragEvent<HTMLDivElement>, lane: Lane, status: ItemStatus) => {
    e.preventDefault();
    const id = dragId ?? e.dataTransfer.getData('text/plain');
    const index = drop && drop.lane === lane.key && drop.status === status ? drop.index : lane.items.filter((i) => i.status === status && i.id !== id).length;
    setDragId(null); setDrop(null);
    if (id) moveTo(id, lane, status, index);
  };

  /** Keyboard moves: Shift+←/→ change column, Shift+↑/↓ reorder. */
  const keyMove = (item: WorkItem, lane: Lane, key: string) => {
    const col = STATUS_ORDER.indexOf(item.status);
    const cell = lane.items.filter((i) => i.status === item.status);
    const idx = cell.findIndex((i) => i.id === item.id);
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const next = STATUS_ORDER[col + (key === 'ArrowRight' ? 1 : -1)];
      if (!next) return;
      moveTo(item.id, lane, next, lane.items.filter((i) => i.status === next).length);
    } else if (key === 'ArrowUp' && idx > 0) moveTo(item.id, lane, item.status, idx - 1);
    else if (key === 'ArrowDown' && idx < cell.length - 1) moveTo(item.id, lane, item.status, idx + 1);
    // Keep focus on the moved card.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card-id="${item.id}"]`)?.focus());
  };

  const moveAll = (from: ItemStatus, to: ItemStatus) => run(Promise.all(matched.filter((i) => i.status === from).map((i) => projectsApi.updateItem(i.id, { status: to }))));
  const toggleCol = (s: ItemStatus) => setCollapsedCols((c) => (c.includes(s) ? c.filter((x) => x !== s) : [...c, s]));
  const today = todayIso();
  const countIn = (s: ItemStatus) => matched.filter((i) => i.status === s).length;

  return (
    <div className="pj-board-tab">
      <div className="pj-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search board" />
        <PeopleFilter items={boardItems} value={people} onChange={setPeople} />
        <FilterButton value={filters} onChange={setFilters} />
        <GroupByButton value={groupBy} options={GROUPS} onChange={(g) => { setGroupBy(g); setCollapsedLanes(new Set()); }} />
        <span className="grow" />
        <button className={`pj-btn${insights ? ' active' : ''}`} aria-pressed={insights} onClick={() => setInsights(!insights)} title="Insights">
          <Glyph name="chart" size={15} /> Insights
        </button>
        <Dropdown className="pj-btn" label={<><Glyph name="sliders" size={15} /> View</>} align="end" width={220} ariaLabel="View settings">
          {() => (
            <div className="pj-menu">
              <div className="pj-pop-title">Show on cards</div>
              <label className="pj-check-row"><input type="checkbox" checked={view.dueDate} onChange={() => setView((v) => ({ ...v, dueDate: !v.dueDate }))} /> Due date</label>
              <label className="pj-check-row"><input type="checkbox" checked={view.epic} onChange={() => setView((v) => ({ ...v, epic: !v.epic }))} /> Epic</label>
              <label className="pj-check-row"><input type="checkbox" checked={view.priority} onChange={() => setView((v) => ({ ...v, priority: !v.priority }))} /> Priority</label>
              <div className="pj-pop-note">Tip: focus a card and press Shift + arrow keys to move it.</div>
            </div>
          )}
        </Dropdown>
      </div>
      {err && <div className="form-error pj-inline-err" role="alert">{err} <button className="pj-link-btn" onClick={() => setErr('')}>Dismiss</button></div>}

      <div className="pj-board-body">
        <div className="pj-board-scroll">
          <div className="pj-board">
            <div className="pj-board-heads">
              {STATUS_ORDER.map((s) => {
                const collapsed = collapsedCols.includes(s);
                return (
                  <div key={s} className={`pj-col-head${collapsed ? ' collapsed' : ''}`} style={{ ['--col' as any]: STATUS_COLOR[s] }}>
                    {collapsed ? (
                      <button className="pj-col-expand" onClick={() => toggleCol(s)} title={`Expand ${STATUS_LABEL[s]}`} aria-label={`Expand ${STATUS_LABEL[s]} column`}>
                        <Icon name="chevronRight" size={14} />
                        <span className="pj-col-vert">{STATUS_LABEL[s]} <span className="pj-col-count">{countIn(s)}</span></span>
                      </button>
                    ) : (
                      <>
                        <span className="pj-col-title">{STATUS_LABEL[s]}</span>
                        <span className="pj-col-count">{countIn(s)}</span>
                        {s === 'done' && <Icon name="check" size={14} className="pj-col-done" />}
                        <span className="grow" />
                        <Dropdown className="icon-btn pj-col-menu" ariaLabel={`${STATUS_LABEL[s]} column options`} label={<Icon name="more" size={16} />} align="end" width={210}>
                          {(close) => (
                            <div className="pj-menu" role="menu">
                              <MenuItem onClick={() => { close(); toggleCol(s); }}>Collapse column</MenuItem>
                              <div className="pj-menu-sep" />
                              {STATUS_ORDER.filter((t) => t !== s).map((t) => (
                                <MenuItem key={t} disabled={!countIn(s)} onClick={() => { close(); moveAll(s, t); }}>Move all to {STATUS_LABEL[t]}</MenuItem>
                              ))}
                            </div>
                          )}
                        </Dropdown>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {loading && !items.length && <div className="loading-block"><span className="spinner" /> Loading board…</div>}

            {lanes.map((lane) => {
              const laneCollapsed = collapsedLanes.has(lane.key);
              return (
                <div key={lane.key} className="pj-lane">
                  {groupBy !== 'none' && (
                    <button className="pj-lane-head" aria-expanded={!laneCollapsed}
                      onClick={() => setCollapsedLanes((s) => { const n = new Set(s); if (n.has(lane.key)) n.delete(lane.key); else n.add(lane.key); return n; })}>
                      <Icon name={laneCollapsed ? 'chevronRight' : 'chevronDown'} size={14} />
                      {lane.label}
                      <span className="pj-group-count">{lane.items.length}</span>
                    </button>
                  )}
                  {!laneCollapsed && (
                    <div className="pj-lane-cells">
                      {STATUS_ORDER.map((s) => {
                        const collapsed = collapsedCols.includes(s);
                        const cell = lane.items.filter((i) => i.status === s);
                        const here = drop && drop.lane === lane.key && drop.status === s;
                        let n = 0;
                        return (
                          <div key={s} className={`pj-cell${collapsed ? ' collapsed' : ''}${here ? ' over' : ''}`}
                            onDragOver={(e) => onCellDragOver(e, lane.key, s)}
                            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node) && here) setDrop(null); }}
                            onDrop={(e) => onCellDrop(e, lane, s)}>
                            {collapsed ? (here ? <div className="pj-cell-collapsed-drop">Drop to move to {STATUS_LABEL[s]}</div> : null) : (
                              <>
                                {cell.map((item) => {
                                  const isDragged = item.id === dragId;
                                  const line = here && !isDragged && drop!.index === n;
                                  if (!isDragged) n++;
                                  return (
                                    <div key={item.id} className="pj-card-slot">
                                      {line && <div className="pj-drop-line" />}
                                      <Card item={item} view={view} epics={epics} today={today} dragging={isDragged}
                                        onDragStart={(e) => {
                                          e.dataTransfer.setData('text/plain', item.id);
                                          e.dataTransfer.effectAllowed = 'move';
                                          setDragId(item.id);
                                        }}
                                        onDragEnd={() => { setDragId(null); setDrop(null); }}
                                        onKeyMove={(k) => keyMove(item, lane, k)}
                                        onError={setErr} />
                                    </div>
                                  );
                                })}
                                {here && drop!.index >= n && <div className="pj-drop-line" />}
                                {!cell.length && !here && <div className="pj-cell-empty">{matched.length || items.length ? 'Nothing here' : ''}</div>}
                                <CellCreate projectId={pid} status={s} lane={lane.key} groupBy={groupBy} onError={setErr} />
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {!loading && !boardItems.length && (
              <div className="pj-board-empty muted">No work items on the board yet. Use the “+” under a column or press <kbd className="pj-kbd">C</kbd> to create one.</div>
            )}
          </div>
        </div>
        {insights && <Insights items={matched} onClose={() => setInsights(false)} />}
      </div>
    </div>
  );
}

function Card({ item, view, epics, today, dragging, onDragStart, onDragEnd, onKeyMove, onError }: {
  item: WorkItem; view: ViewOpts; epics: WorkItem[]; today: string; dragging: boolean;
  onDragStart(e: DragEvent<HTMLDivElement>): void; onDragEnd(): void; onKeyMove(key: string): void; onError(e: string): void;
}) {
  const parent = useProjects((s) => (item.parentId ? s.items[item.parentId] : undefined));
  const active = useItemPanel((s) => s.openItemId === item.id);
  const open = () => useItemPanel.getState().openItem(item.id);
  const overdue = isOverdue(item, today);
  const epic = parent?.type === 'epic' ? parent : undefined;
  const setEpic = (id: string | null) => projectsApi.updateItem(item.id, { parentId: id }).then(() => onError('')).catch((e) => onError(e?.message || 'Could not change the epic'));
  return (
    <div className={`pj-card${dragging ? ' dragging' : ''}${active ? ' active' : ''}`} data-card-id={item.id} role="button" tabIndex={0} draggable
      aria-label={`${item.key}: ${item.summary}. ${STATUS_LABEL[item.status]}.`}
      onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={open}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        else if (e.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); onKeyMove(e.key); }
      }}>
      <div className="pj-card-summary">{item.summary}</div>
      {(view.dueDate && item.dueDate) || (view.epic && item.type !== 'subtask') || item.type === 'subtask' ? (
        <div className="pj-card-meta">
          {view.dueDate && item.dueDate && (
            <span className={`pj-due${overdue ? ' overdue' : ''}`} title={overdue ? 'Overdue' : 'Due date'}>
              <Icon name="clock" size={12} /> {formatDate(item.dueDate)}
            </span>
          )}
          {view.epic && item.type !== 'subtask' && (
            <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <Dropdown className={`pj-epic-chip${epic ? '' : ' empty'}`} width={260} ariaLabel={epic ? `Epic: ${epic.summary}. Change epic` : 'Add to epic'}
                label={epic ? <span className="pj-epic-chip-text" style={{ ['--epic' as any]: epicColor(epic.id) }}>{epic.summary}</span> : <span className="pj-epic-chip-text">+ Epic</span>}>
                {(close) => (
                  <div className="pj-menu" role="menu">
                    <div className="pj-pop-title">Epic</div>
                    <div className="pj-pop-scroll">
                      <MenuItem checked={!epic} onClick={() => { close(); if (epic) setEpic(null); }}>No epic</MenuItem>
                      {epics.map((e) => (
                        <MenuItem key={e.id} checked={epic?.id === e.id} icon={<span className="pj-epic-dot" style={{ background: epicColor(e.id) }} />}
                          hint={e.key} onClick={() => { close(); if (epic?.id !== e.id) setEpic(e.id); }}>{e.summary}</MenuItem>
                      ))}
                      {!epics.length && <div className="pj-pop-empty">No epics in this space yet.</div>}
                    </div>
                  </div>
                )}
              </Dropdown>
            </span>
          )}
          {item.type === 'subtask' && parent && <span className="pj-card-parent" title={`Child of ${parent.key}`}>↳ {parent.key}</span>}
        </div>
      ) : null}
      <div className="pj-card-foot">
        <TypeIcon type={item.type} />
        <span onClick={(e) => e.stopPropagation()}><ItemKey item={item} /></span>
        {item.childCount > 0 && <span className="pj-child-count" title="Child items done">{item.childDone}/{item.childCount}</span>}
        <span className="grow" />
        {view.priority && item.priority !== 'none' && <PriorityIcon priority={item.priority} />}
        <Assignee userId={item.assigneeId} size={24} />
      </div>
    </div>
  );
}

function CellCreate({ projectId, status, lane, groupBy, onError }: { projectId: string; status: ItemStatus; lane: string; groupBy: GroupBy; onError(e: string): void }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const submit = async () => {
    const s = summary.trim();
    if (!s || busy) return;
    setBusy(true);
    try {
      const extra: Partial<WorkItem> = {};
      if (groupBy === 'assignee' && lane !== 'none') extra.assigneeId = lane;
      if (groupBy === 'epic' && lane !== 'none') extra.parentId = lane;
      await projectsApi.createItem(projectId, { summary: s, status, type: 'task', ...extra });
      setSummary('');
      onError('');
    } catch (e: any) { onError(e?.message || 'Could not create the work item'); }
    setBusy(false);
    ref.current?.focus();
  };
  if (!open) {
    return (
      <button className="pj-cell-add" onClick={() => setOpen(true)} aria-label={`Create in ${STATUS_LABEL[status]}`}>
        <Icon name="plus" size={15} /> <span>Create</span>
      </button>
    );
  }
  return (
    <div className="pj-card pj-card-new">
      <textarea ref={ref} autoFocus rows={2} value={summary} maxLength={255} placeholder="What needs to be done?" aria-label="Summary"
        onChange={(e) => setSummary(e.target.value)}
        onBlur={() => { if (!summary.trim()) setOpen(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); setSummary(''); }
        }} />
      <div className="row gap-sm">
        <span className="muted small grow">Enter to create</span>
        {busy && <span className="spinner" />}
        <button className="btn btn-sm btn-ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); setSummary(''); }}>Cancel</button>
        <button className="btn btn-sm btn-primary" onMouseDown={(e) => e.preventDefault()} disabled={!summary.trim() || busy} onClick={submit}>Create</button>
      </div>
    </div>
  );
}

function Insights({ items, onClose }: { items: WorkItem[]; onClose(): void }) {
  const today = todayIso();
  const total = items.length;
  const byStatus = STATUS_ORDER.map((s) => ({ s, n: items.filter((i) => i.status === s).length }));
  const byAssignee = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.assigneeId ?? 'none', (m.get(i.assigneeId ?? 'none') ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);
  const overdue = items.filter((i) => isOverdue(i, today)).length;
  const max = Math.max(1, ...byAssignee.map(([, n]) => n));
  const done = byStatus.find((x) => x.s === 'done')!.n;
  return (
    <aside className="pj-insights" aria-label="Board insights">
      <div className="pj-insights-head">
        <h3>Insights</h3>
        <button className="icon-btn" aria-label="Close insights" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div className="pj-insight-card">
        <div className="pj-insight-big">{total ? Math.round((done / total) * 100) : 0}<span>% done</span></div>
        <div className="pj-stack-bar" aria-hidden="true">
          {byStatus.map(({ s, n }) => n > 0 && <span key={s} style={{ width: `${(n / Math.max(total, 1)) * 100}%`, background: STATUS_COLOR[s] }} title={`${STATUS_LABEL[s]}: ${n}`} />)}
        </div>
        <div className="muted small">{total} work item{total === 1 ? '' : 's'} on the board{overdue ? ` · ${overdue} overdue` : ''}</div>
      </div>
      <div className="pj-insight-card">
        <h4>By status</h4>
        {byStatus.map(({ s, n }) => (
          <div key={s} className="pj-insight-row">
            <span className="pj-insight-dot" style={{ background: STATUS_COLOR[s] }} />
            <span className="grow">{STATUS_LABEL[s]}</span>
            <b>{n}</b>
          </div>
        ))}
      </div>
      <div className="pj-insight-card">
        <h4>By assignee</h4>
        {byAssignee.map(([id, n]) => (
          <div key={id} className="pj-insight-person">
            <Assignee userId={id === 'none' ? null : id} size={20} showName />
            <div className="pj-bar"><span style={{ width: `${(n / max) * 100}%` }} /></div>
            <b>{n}</b>
          </div>
        ))}
        {!byAssignee.length && <div className="muted small">No work items match.</div>}
      </div>
    </aside>
  );
}
