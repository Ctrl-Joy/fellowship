import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { TabProps } from './tabTypes';
import type { ItemStatus, ItemType, Priority, WorkItem } from './types';
import { PRIORITY_LABEL, PRIORITY_ORDER, STATUS_LABEL, STATUS_ORDER, TYPE_LABEL, TYPE_ORDER } from './types';
import { projectItems, useProjects } from './store';
import { projectsApi } from './api';
import { Assignee, ItemKey, PriorityIcon, StatusPill, TypeIcon, formatDate, todayIso, useItemPanel } from './ui';
import { ConfirmDialog, Dropdown, Glyph, MemberList, MenuItem, epicColor, isOverdue, memberName, usePref } from './kit';
import { EMPTY_FILTERS, FilterButton, GroupByButton, PeopleFilter, SearchInput, filterCount, matchItems, type ItemFilters } from './toolbar';
import { Icon } from '../../components/Icon';
import { useSession } from '../../store/session';
import './list.css';

type GroupBy = 'none' | 'status' | 'assignee' | 'type' | 'priority' | 'epic';
type ColKey = 'assignee' | 'reporter' | 'priority' | 'status' | 'dueDate' | 'created' | 'updated' | 'labels';
const WORK_MIN = 420;
const COLS: { key: ColKey; label: string; width: number }[] = [
  { key: 'assignee', label: 'Assignee', width: 170 },
  { key: 'reporter', label: 'Reporter', width: 150 },
  { key: 'priority', label: 'Priority', width: 120 },
  { key: 'status', label: 'Status', width: 140 },
  { key: 'dueDate', label: 'Due date', width: 120 },
  { key: 'labels', label: 'Labels', width: 150 },
  { key: 'created', label: 'Created', width: 120 },
  { key: 'updated', label: 'Updated', width: 120 },
];
const DEFAULT_COLS: Record<ColKey, boolean> = { assignee: true, reporter: true, priority: true, status: true, dueDate: true, created: true, updated: false, labels: false };
const GROUPS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'None' }, { value: 'status', label: 'Status' }, { value: 'assignee', label: 'Assignee' },
  { value: 'type', label: 'Type' }, { value: 'priority', label: 'Priority' }, { value: 'epic', label: 'Epic' },
];
const CREATE_TYPES: ItemType[] = ['task', 'story', 'bug', 'epic'];
const shortDate = (ts: number) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

interface Group { key: string; label: ReactNode; rows: WorkItem[] }

/** The List tab: a filterable, groupable table of the space's work items. */
export default function ListTab({ project, currentUser }: TabProps) {
  const pid = project.id;
  const allItems = useProjects((s) => s.items);
  const items = useMemo(() => projectItems(allItems, pid), [allItems, pid]);
  const byId = allItems;
  const members = useSession((s) => s.members);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [searchParams] = useSearchParams();
  const fromUrl = useMemo(() => filtersFromQuery(searchParams), [searchParams]);
  const [people, setPeople] = useState<string[]>(fromUrl.people);
  const [filters, setFilters] = useState<ItemFilters>(fromUrl.filters);
  // Links from Summary / Dashboards (e.g. ?status=todo) re-apply when the query changes.
  const urlKey = searchParams.toString();
  const firstUrl = useRef(true);
  useEffect(() => {
    if (firstUrl.current) { firstUrl.current = false; return; }
    setPeople(fromUrl.people);
    setFilters(fromUrl.filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);
  const [groupBy, setGroupBy] = usePref<GroupBy>(`list:group:${pid}`, 'none');
  const [cols, setCols] = usePref<Record<ColKey, boolean>>('list:cols', DEFAULT_COLS);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedWhileFiltering, setCollapsedWhileFiltering] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Ask (plain-English query, parsed by the server).
  const [ask, setAsk] = useState('');
  const [asking, setAsking] = useState(false);
  const [askRes, setAskRes] = useState<{ q: string; ids: Set<string>; explanation: string[] } | null>(null);

  const load = async () => {
    try { await projectsApi.listItems(pid); setErr(''); } catch (e: any) { setErr(e?.message || 'Could not load work items'); }
  };
  useEffect(() => { let alive = true; load().finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  const runAsk = async (q = ask) => {
    if (!q.trim()) { setAskRes(null); return; }
    setAsking(true);
    try {
      const r = await projectsApi.listItems(pid, { ask: q.trim() });
      setAskRes({ q: q.trim(), ids: new Set(r.items.map((i) => i.id)), explanation: r.explanation });
      setErr('');
    } catch (e: any) { setErr(e?.message || 'Could not run that query'); }
    setAsking(false);
  };
  const clearAsk = () => { setAsk(''); setAskRes(null); };

  const refresh = async () => {
    setRefreshing(true);
    await load();
    if (askRes) await runAsk(askRes.q);
    setRefreshing(false);
  };

  const filtering = !!(search.trim() || people.length || filterCount(filters) || askRes);
  const matched = useMemo(
    () => matchItems(askRes ? items.filter((i) => askRes.ids.has(i.id)) : items, { search, people, filters }),
    [items, askRes, search, people, filters],
  );
  const matchedIds = useMemo(() => new Set(matched.map((i) => i.id)), [matched]);
  const childrenOf = useMemo(() => {
    const m = new Map<string, WorkItem[]>();
    for (const i of matched) if (i.parentId && matchedIds.has(i.parentId)) {
      if (!m.has(i.parentId)) m.set(i.parentId, []);
      m.get(i.parentId)!.push(i);
    }
    return m;
  }, [matched, matchedIds]);

  const groups = useMemo<Group[]>(() => {
    const isRoot = (i: WorkItem) => !i.parentId || !matchedIds.has(i.parentId);
    if (groupBy === 'epic') {
      const epics = matched.filter((i) => i.type === 'epic');
      const rows = matched.filter((i) => i.type !== 'epic' && (isRoot(i) || byId[i.parentId!]?.type === 'epic'));
      const out: Group[] = epics.map((e) => ({
        key: e.id,
        label: <span className="pj-group-epic"><span className="pj-epic-dot" style={{ background: epicColor(e.id) }} /><TypeIcon type="epic" size={14} /> <b>{e.key}</b> {e.summary}</span>,
        rows: rows.filter((r) => r.parentId === e.id),
      }));
      out.push({ key: 'none', label: 'No epic', rows: rows.filter((r) => !r.parentId || byId[r.parentId]?.type !== 'epic' || !matchedIds.has(r.parentId)) });
      return out.filter((g) => g.key !== 'none' || g.rows.length);
    }
    const roots = matched.filter(isRoot);
    if (groupBy === 'none') return [{ key: 'all', label: null, rows: roots }];
    const keyOf = (i: WorkItem): string => (groupBy === 'status' ? i.status : groupBy === 'type' ? i.type : groupBy === 'priority' ? i.priority : (i.assigneeId ?? 'none'));
    let keys: string[];
    if (groupBy === 'status') keys = STATUS_ORDER;
    else if (groupBy === 'type') keys = TYPE_ORDER;
    else if (groupBy === 'priority') keys = PRIORITY_ORDER;
    else {
      const ids = [...new Set(roots.map(keyOf))].filter((k) => k !== 'none');
      ids.sort((a, b) => memberName(a).localeCompare(memberName(b)));
      keys = [...ids, 'none'];
    }
    const label = (k: string): ReactNode => (groupBy === 'status' ? <StatusPill status={k as ItemStatus} />
      : groupBy === 'type' ? <span className="row gap-sm"><TypeIcon type={k as ItemType} /> {TYPE_LABEL[k as ItemType]}</span>
        : groupBy === 'priority' ? <span className="row gap-sm"><PriorityIcon priority={k as Priority} /> {PRIORITY_LABEL[k as Priority]}</span>
          : <Assignee userId={k === 'none' ? null : k} size={20} showName />);
    return keys.map((k) => ({ key: k, label: label(k), rows: roots.filter((r) => keyOf(r) === k) })).filter((g) => g.rows.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, matchedIds, groupBy, byId, members]);

  const isExpanded = (id: string) => (filtering ? !collapsedWhileFiltering.has(id) : expanded.has(id));
  const toggleExpand = (id: string) => {
    const flip = (s: Set<string>) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; };
    if (filtering) setCollapsedWhileFiltering(flip); else setExpanded(flip);
  };

  // Drop selections that no longer exist.
  useEffect(() => {
    setSelected((s) => { const n = new Set([...s].filter((id) => matchedIds.has(id))); return n.size === s.size ? s : n; });
  }, [matchedIds]);

  const run = (p: Promise<unknown>) => p.then(() => setErr('')).catch((e) => setErr(e?.message || 'Could not save the change'));
  const update = (id: string, body: Parameters<typeof projectsApi.updateItem>[1]) => run(projectsApi.updateItem(id, body));
  const bulk = (body: Parameters<typeof projectsApi.updateItem>[1]) => run(Promise.all([...selected].map((id) => projectsApi.updateItem(id, body))));

  const shownCols = COLS.filter((c) => cols[c.key]);
  const allSelected = matched.length > 0 && matched.every((i) => selected.has(i.id));
  const someSelected = selected.size > 0 && !allSelected;
  const headerCheck = useRef<HTMLInputElement>(null);
  useEffect(() => { if (headerCheck.current) headerCheck.current.indeterminate = someSelected; }, [someSelected]);
  const today = todayIso();
  const colSpan = 2 + shownCols.length;

  const renderRows = (list: WorkItem[], depth: number): ReactNode => list.map((item) => {
    const kids = childrenOf.get(item.id) ?? [];
    const open = kids.length > 0 && isExpanded(item.id);
    return (
      <Fragment key={item.id}>
        <Row item={item} depth={depth} hasChildren={kids.length > 0} hiddenChildren={item.childCount - kids.length} expanded={open} onToggle={() => toggleExpand(item.id)}
          selected={selected.has(item.id)} onSelect={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(item.id); else n.delete(item.id); return n; })}
          cols={shownCols.map((c) => c.key)} today={today} update={update} meId={currentUser.id} />
        {open && renderRows(kids, depth + 1)}
      </Fragment>
    );
  });

  return (
    <div className="pj-list">
      <div className="pj-ask-row">
        <form className={`pj-ask${askRes ? ' active' : ''}`} onSubmit={(e) => { e.preventDefault(); runAsk(); }}>
          <Glyph name="sparkle" size={16} className="pj-ask-icon" />
          <input value={ask} onChange={(e) => setAsk(e.target.value)} aria-label="Ask about your work"
            placeholder="Ask in plain English, e.g. “my open bugs due this week” or “high priority unassigned”"
            onKeyDown={(e) => { if (e.key === 'Escape' && (ask || askRes)) { e.stopPropagation(); clearAsk(); } }} />
          {asking ? <span className="spinner" /> : (ask || askRes) && <button type="button" className="pj-ask-clear" aria-label="Clear question" onClick={clearAsk}><Icon name="x" size={14} /></button>}
          <button type="submit" className="pj-btn pj-ask-go" disabled={!ask.trim() || asking}>Ask</button>
        </form>
        {askRes && (
          <div className="pj-ask-chips" aria-live="polite">
            <span className="muted small">Showing</span>
            {askRes.explanation.length ? askRes.explanation.map((x) => <span key={x} className="pj-chip">{x}</span>)
              : <span className="pj-chip pj-chip-warn">all work (no conditions recognised)</span>}
            <span className="muted small">· {askRes.ids.size} match{askRes.ids.size === 1 ? '' : 'es'}</span>
            <button className="pj-link-btn" onClick={clearAsk}>Clear</button>
          </div>
        )}
      </div>

      <div className="pj-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search list" />
        <PeopleFilter items={items} value={people} onChange={setPeople} />
        <FilterButton value={filters} onChange={setFilters} />
        <GroupByButton value={groupBy} options={GROUPS} onChange={(g) => { setGroupBy(g); setCollapsedGroups(new Set()); }} />
        <span className="grow" />
        <Dropdown className="pj-btn" label={<><Glyph name="columns" size={15} /> Columns</>} align="end" width={200}>
          {() => (
            <div className="pj-menu">
              <div className="pj-pop-title">Show columns</div>
              <label className="pj-check-row muted"><input type="checkbox" checked disabled /> Work</label>
              {COLS.map((c) => (
                <label key={c.key} className="pj-check-row"><input type="checkbox" checked={cols[c.key]} onChange={() => setCols((p) => ({ ...p, [c.key]: !p[c.key] }))} /> {c.label}</label>
              ))}
              <div className="pj-pop-foot"><button className="pj-link-btn" onClick={() => setCols(DEFAULT_COLS)}>Reset to default</button></div>
            </div>
          )}
        </Dropdown>
      </div>

      {selected.size > 0 && (
        <div className="pj-bulk" role="toolbar" aria-label="Bulk actions">
          <b>{selected.size} selected</b>
          <Dropdown className="pj-btn" label={<>Change status <Icon name="chevronDown" size={13} /></>} width={190}>
            {(close) => <div className="pj-menu">{STATUS_ORDER.map((s) => <MenuItem key={s} onClick={() => { close(); bulk({ status: s }); }}><StatusPill status={s} /></MenuItem>)}</div>}
          </Dropdown>
          <Dropdown className="pj-btn" label={<>Assign <Icon name="chevronDown" size={13} /></>} width={260}>
            {(close) => <MemberList meId={currentUser.id} onPick={(id) => { close(); bulk({ assigneeId: id }); }} />}
          </Dropdown>
          <Dropdown className="pj-btn" label={<>Priority <Icon name="chevronDown" size={13} /></>} width={180}>
            {(close) => <div className="pj-menu">{PRIORITY_ORDER.map((p) => <MenuItem key={p} icon={<PriorityIcon priority={p} />} onClick={() => { close(); bulk({ priority: p }); }}>{PRIORITY_LABEL[p]}</MenuItem>)}</div>}
          </Dropdown>
          <button className="pj-btn pj-btn-danger-ghost" onClick={() => setConfirmBulkDelete(true)}><Icon name="trash" size={14} /> Delete</button>
          <span className="grow" />
          <button className="pj-link-btn" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}
      {err && <div className="form-error pj-inline-err" role="alert">{err} <button className="pj-link-btn" onClick={() => setErr('')}>Dismiss</button></div>}

      <div className="pj-table-wrap">
        {/* Reserve room for the Work column; the wrapper scrolls sideways on narrow screens. */}
        <table className="pj-table pj-list-table" style={{ minWidth: 40 + WORK_MIN + shownCols.reduce((n, c) => n + c.width, 0) }}>
          <colgroup>
            <col style={{ width: 40 }} />
            <col style={{ minWidth: WORK_MIN }} />
            {shownCols.map((c) => <col key={c.key} style={{ width: c.width }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="pj-col-check">
                <input ref={headerCheck} type="checkbox" aria-label="Select all" checked={allSelected} disabled={!matched.length}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(matched.map((i) => i.id)))} />
              </th>
              <th>Work</th>
              {shownCols.map((c) => <th key={c.key}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && !items.length ? (
              <tr><td colSpan={colSpan}><div className="loading-block"><span className="spinner" /> Loading work…</div></td></tr>
            ) : !items.length ? (
              <tr><td colSpan={colSpan} className="pj-empty-row">
                <b>No work items yet.</b> Create the first one below or press <kbd className="pj-kbd">C</kbd>.
              </td></tr>
            ) : !matched.length ? (
              <tr><td colSpan={colSpan} className="pj-empty-row">
                No work matches these filters. <button className="pj-link-btn" onClick={() => { setSearch(''); setPeople([]); setFilters(EMPTY_FILTERS); clearAsk(); }}>Clear all filters</button>
              </td></tr>
            ) : groups.map((g) => {
              const collapsed = collapsedGroups.has(g.key);
              return (
                <Fragment key={g.key}>
                  {groupBy !== 'none' && (
                    <tr className="pj-group-row">
                      <td colSpan={colSpan}>
                        <button className="pj-group-toggle" aria-expanded={!collapsed}
                          onClick={() => setCollapsedGroups((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}>
                          <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={14} />
                          {g.label}
                          <span className="pj-group-count">{g.rows.length}</span>
                        </button>
                      </td>
                    </tr>
                  )}
                  {!collapsed && renderRows(g.rows, 0)}
                  {!collapsed && groupBy === 'epic' && g.key !== 'none' && !g.rows.length && (
                    <tr><td /><td colSpan={colSpan - 1} className="muted small pj-group-empty">No work in this epic matches.</td></tr>
                  )}
                </Fragment>
              );
            })}
            <InlineCreate projectId={pid} colSpan={colSpan} onError={setErr} />
          </tbody>
        </table>
      </div>

      <div className="pj-list-foot">
        <span className="muted small">{matched.length} of {items.length} work item{items.length === 1 ? '' : 's'}</span>
        <button className="icon-btn" title="Refresh" aria-label="Refresh" onClick={refresh} disabled={refreshing}>
          {refreshing ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
        </button>
      </div>

      {confirmBulkDelete && (
        <ConfirmDialog title={`Delete ${selected.size} work item${selected.size === 1 ? '' : 's'}?`} confirmLabel="Delete"
          body={<p>The selected items and their child items will be deleted for everyone. This can’t be undone.</p>}
          onClose={() => setConfirmBulkDelete(false)}
          onConfirm={async () => {
            // Delete parents first; children go with them.
            const ids = [...selected].filter((id) => useProjects.getState().items[id]);
            for (const id of ids) if (useProjects.getState().items[id]) await projectsApi.deleteItem(id);
            setSelected(new Set());
          }} />
      )}
    </div>
  );
}

function Row({ item, depth, hasChildren, hiddenChildren, expanded, onToggle, selected, onSelect, cols, today, update, meId }: {
  item: WorkItem; depth: number; hasChildren: boolean; hiddenChildren: number; expanded: boolean; onToggle(): void; selected: boolean; onSelect(v: boolean): void;
  cols: ColKey[]; today: string; update(id: string, body: Parameters<typeof projectsApi.updateItem>[1]): void; meId: string;
}) {
  const open = () => useItemPanel.getState().openItem(item.id);
  const active = useItemPanel((s) => s.openItemId === item.id);
  const canHaveChildren = item.type !== 'subtask';
  const cell = (k: ColKey) => {
    switch (k) {
      case 'assignee':
        return (
          <td key={k} onClick={(e) => e.stopPropagation()}>
            <Dropdown className="pj-cell-btn" ariaLabel={`Assignee: ${memberName(item.assigneeId)}`} width={260}
              label={<><Assignee userId={item.assigneeId} size={22} showName /><Icon name="chevronDown" size={12} className="pj-cell-caret" /></>}>
              {(close) => <MemberList value={item.assigneeId} meId={meId} onPick={(id) => { close(); update(item.id, { assigneeId: id }); }} />}
            </Dropdown>
          </td>
        );
      case 'reporter':
        return <td key={k}><Assignee userId={item.reporterId} size={22} showName /></td>;
      case 'priority':
        return (
          <td key={k} onClick={(e) => e.stopPropagation()}>
            <Dropdown className="pj-cell-btn" ariaLabel={`Priority: ${PRIORITY_LABEL[item.priority]}`} width={170}
              label={<><PriorityIcon priority={item.priority} /> <span>{PRIORITY_LABEL[item.priority]}</span><Icon name="chevronDown" size={12} className="pj-cell-caret" /></>}>
              {(close) => (
                <div className="pj-menu" role="menu">
                  {PRIORITY_ORDER.map((p) => <MenuItem key={p} checked={p === item.priority} icon={<PriorityIcon priority={p} />} onClick={() => { close(); update(item.id, { priority: p }); }}>{PRIORITY_LABEL[p]}</MenuItem>)}
                </div>
              )}
            </Dropdown>
          </td>
        );
      case 'status':
        return <td key={k} onClick={(e) => e.stopPropagation()}><StatusPill status={item.status} onChange={(s) => update(item.id, { status: s })} /></td>;
      case 'dueDate':
        return <td key={k} className={isOverdue(item, today) ? 'pj-overdue' : ''}>{item.dueDate ? formatDate(item.dueDate) : <span className="pj-faint">—</span>}</td>;
      case 'labels':
        return <td key={k}><span className="pj-labels">{item.labels.length ? item.labels.map((l) => <span key={l} className="pj-label">{l}</span>) : <span className="pj-faint">—</span>}</span></td>;
      case 'created':
        return <td key={k} className="muted">{shortDate(item.createdAt)}</td>;
      case 'updated':
        return <td key={k} className="muted">{shortDate(item.updatedAt)}</td>;
    }
  };
  return (
    <tr className={`pj-row${selected ? ' selected' : ''}${active ? ' active' : ''}${item.status === 'done' ? ' done' : ''}`} tabIndex={0}
      onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); }} aria-label={`${item.key} ${item.summary}`}>
      <td className="pj-col-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" aria-label={`Select ${item.key}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} />
      </td>
      <td className="pj-work-cell">
        <div className="pj-work" style={{ paddingLeft: depth * 22 }}>
          {hasChildren
            ? <button className="pj-expand" aria-label={expanded ? 'Collapse' : 'Expand'} aria-expanded={expanded} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
              <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} />
            </button>
            : <span className="pj-expand-spacer" />}
          <TypeIcon type={item.type} />
          <ItemKey item={item} />
          <span className="pj-summary" title={item.summary}>{item.summary}</span>
          {item.childCount > 0 && (
            <span className="pj-child-count" title={`${item.childDone} of ${item.childCount} child items done${hiddenChildren > 0 ? ` · ${hiddenChildren} hidden by filters` : ''}`}>
              {item.childDone}/{item.childCount}
            </span>
          )}
          <span className="pj-row-actions">
            {canHaveChildren && (
              <button className="pj-row-act" title="Add child item" aria-label={`Add child to ${item.key}`}
                onClick={(e) => { e.stopPropagation(); useItemPanel.getState().openCreate({ projectId: item.projectId, parentId: item.id, type: item.type === 'epic' ? 'task' : 'subtask' }); }}>
                <Icon name="plus" size={14} />
              </button>
            )}
            <button className="pj-row-act" title="Open" aria-label={`Open ${item.key}`} onClick={(e) => { e.stopPropagation(); open(); }}>
              <Glyph name="open" size={14} />
            </button>
          </span>
        </div>
      </td>
      {cols.map(cell)}
    </tr>
  );
}

function InlineCreate({ projectId, colSpan, onError }: { projectId: string; colSpan: number; onError(e: string): void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ItemType>('task');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const submit = async () => {
    const s = summary.trim();
    if (!s || busy) return;
    setBusy(true);
    try {
      await projectsApi.createItem(projectId, { summary: s, type });
      setSummary('');
      onError('');
    } catch (e: any) { onError(e?.message || 'Could not create the work item'); }
    setBusy(false);
    input.current?.focus();
  };
  if (!open) {
    return (
      <tr className="pj-create-row">
        <td colSpan={colSpan}>
          <button className="pj-create-open" onClick={() => setOpen(true)}><Icon name="plus" size={15} /> Create</button>
        </td>
      </tr>
    );
  }
  return (
    <tr className="pj-create-row editing">
      <td colSpan={colSpan}>
        <div className="pj-create-inline">
          <Dropdown className="pj-cell-btn pj-type-pick" ariaLabel={`Type: ${TYPE_LABEL[type]}`} width={170}
            label={<><TypeIcon type={type} /><Icon name="chevronDown" size={12} /></>}>
            {(close) => (
              <div className="pj-menu">
                {CREATE_TYPES.map((t) => <MenuItem key={t} checked={t === type} icon={<TypeIcon type={t} />} onClick={() => { close(); setType(t); input.current?.focus(); }}>{TYPE_LABEL[t]}</MenuItem>)}
              </div>
            )}
          </Dropdown>
          <input ref={input} autoFocus className="pj-create-input" value={summary} maxLength={255} placeholder="What needs to be done?" aria-label="Summary of new work item"
            onChange={(e) => setSummary(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); setSummary(''); }
            }} />
          {busy && <span className="spinner" />}
          <button className="btn btn-primary btn-sm" disabled={!summary.trim() || busy} onClick={submit}>Create</button>
          <button className="btn btn-sm btn-ghost" onClick={() => { setOpen(false); setSummary(''); }}>Cancel</button>
          <span className="muted small pj-create-hint">Enter to create · Esc to close</span>
        </div>
      </td>
    </tr>
  );
}

/** Initial filters from `?status=todo,done&priority=high&type=bug&assignee=<id>|none`. */
function filtersFromQuery(sp: URLSearchParams): { people: string[]; filters: ItemFilters } {
  const list = (k: string) => (sp.get(k) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const meId = useSession.getState().me?.id;
  return {
    people: list('assignee').map((a) => (a === 'me' && meId ? meId : a)),
    filters: {
      status: list('status').filter((s): s is ItemStatus => (STATUS_ORDER as string[]).includes(s)),
      priority: list('priority').filter((p): p is Priority => (PRIORITY_ORDER as string[]).includes(p)),
      type: list('type').filter((t): t is ItemType => (TYPE_ORDER as string[]).includes(t)),
    },
  };
}
