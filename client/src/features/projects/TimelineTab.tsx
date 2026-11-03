import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { Icon } from '../../components/Icon';
import type { TabProps } from './tabTypes';
import type { ItemStatus, ItemType, WorkItem } from './types';
import { STATUS_LABEL, STATUS_ORDER, TYPE_LABEL, TYPE_ORDER } from './types';
import { projectsApi } from './api';
import { projectItems, useProjects } from './store';
import { Assignee, ItemKey, STATUS_COLOR, StatusPill, TYPE_COLOR, TypeIcon, formatDate, todayIso, useItemPanel } from './ui';
import { PeopleFilter } from './PeopleFilter';
import { showToast } from './toast';
import './timeline.css';

// ---------------------------------------------------------------------------------------------
// Day maths. A "day" is an integer count of days since 1970-01-01 computed with UTC arithmetic
// from the YYYY-MM-DD string, so local time zones and DST never shift a date.
// ---------------------------------------------------------------------------------------------
const DAY_MS = 86_400_000;
const fromYmd = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m, d) / DAY_MS);
const toDay = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return fromYmd(y, m - 1, d); };
const toIso = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const parts = (n: number) => { const d = new Date(n * DAY_MS); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay() }; };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Zoom = 'weeks' | 'months' | 'quarters';
const DAY_WIDTH: Record<Zoom, number> = { weeks: 32, months: 9, quarters: 2.6 };
const ROW_H = 40;
const LEFT_W = 460;
const DRAG_THRESHOLD = 4;

interface Unit { start: number; end: number; label: string }

/** Header units for a zoom level: [top row, bottom row]. */
function buildUnits(zoom: Zoom, start: number, end: number): [Unit[], Unit[]] {
  const months: Unit[] = [], quarters: Unit[] = [], weeks: Unit[] = [], days: Unit[] = [];
  let { y, m } = parts(start);
  for (;;) {
    const s = fromYmd(y, m, 1);
    if (s > end) break;
    const e = fromYmd(y, m + 1, 1) - 1;
    months.push({ start: s, end: e, label: zoom === 'months' ? `${MONTHS_LONG[m]} ${y}` : zoom === 'weeks' ? `${MONTHS_LONG[m]} ${y}` : MONTHS[m] });
    if (m % 3 === 0) quarters.push({ start: s, end: fromYmd(y, m + 3, 1) - 1, label: `Q${m / 3 + 1} ${y}` });
    m++; if (m === 12) { m = 0; y++; }
  }
  if (zoom === 'quarters') return [quarters, months];
  if (zoom === 'months') {
    // Weeks start on Monday.
    let w = start - ((parts(start).wd + 6) % 7);
    for (; w <= end; w += 7) weeks.push({ start: Math.max(w, start), end: Math.min(w + 6, end), label: String(parts(w).d) });
    return [months, weeks.filter((u) => u.end - u.start >= 3)];
  }
  for (let d = start; d <= end; d++) days.push({ start: d, end: d, label: String(parts(d).d) });
  return [months, days];
}

/** Bar span for an item; null when it has no dates. Only a due date → a 1-day bar ending there. */
function spanOf(i: WorkItem): { s: number; e: number } | null {
  const s = i.startDate ? toDay(i.startDate) : i.dueDate ? toDay(i.dueDate) : null;
  const e = i.dueDate ? toDay(i.dueDate) : s;
  if (s == null || e == null) return null;
  return s <= e ? { s, e } : { s: e, e: s };
}

const barColor = (i: WorkItem) => (i.type === 'epic' ? TYPE_COLOR.epic : STATUS_COLOR[i.status]);

interface Row { item: WorkItem; depth: number; hasChildren: boolean; expanded: boolean; match: boolean }

interface DragState { id: string; mode: 'move' | 'start' | 'end'; x0: number; scroll0: number; s0: number; e0: number; s: number; e: number; moved: boolean; pointerId: number; el: Element }

export default function TimelineTab({ project }: TabProps) {
  const allItems = useProjects((s) => s.items);
  const items = useMemo(() => projectItems(allItems, project.id), [allItems, project.id]);
  const [loaded, setLoaded] = useState(items.length > 0);
  const [zoom, setZoom] = useState<Zoom>('weeks');
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [types, setTypes] = useState<ItemType[]>([]);
  const [statuses, setStatuses] = useState<ItemStatus[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<{ id: string; s: number; e: number } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; day: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [height, setHeight] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const dw = DAY_WIDTH[zoom];
  const today = toDay(todayIso());

  useEffect(() => {
    let alive = true;
    projectsApi.listItems(project.id).then(() => alive && setLoaded(true), () => alive && setLoaded(true));
    return () => { alive = false; };
  }, [project.id]);

  // Fill the viewport below the toolbar, whatever the surrounding layout does.
  useLayoutEffect(() => {
    const fit = () => {
      const el = rootRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setHeight(Math.max(360, Math.floor(window.innerHeight - top - 12)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: PointerEvent) => { if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFilterOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [filterOpen]);

  // ---------- rows ----------
  const filtering = !!query.trim() || people.length > 0 || types.length > 0 || statuses.length > 0;
  const { rows, matchCount } = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const kids = new Map<string, WorkItem[]>();
    const top: WorkItem[] = [];
    for (const i of items) {
      if (i.parentId && byId.has(i.parentId)) { const l = kids.get(i.parentId) ?? []; l.push(i); kids.set(i.parentId, l); }
      else top.push(i);
    }
    const q = query.trim().toLowerCase();
    const matches = (i: WorkItem) =>
      (!q || i.summary.toLowerCase().includes(q) || i.key.toLowerCase().includes(q))
      && (!people.length || people.includes(i.assigneeId ?? 'none'))
      && (!types.length || types.includes(i.type))
      && (!statuses.length || statuses.includes(i.status));
    let matchCount = 0;
    const memo = new Map<string, boolean>();
    const visible = (i: WorkItem, seen = new Set<string>()): boolean => {
      if (memo.has(i.id)) return memo.get(i.id)!;
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      const v = matches(i) || (kids.get(i.id) ?? []).some((c) => visible(c, seen));
      memo.set(i.id, v);
      return v;
    };
    for (const i of items) if (matches(i)) matchCount++;
    const rows: Row[] = [];
    const walk = (list: WorkItem[], depth: number, seen: Set<string>) => {
      for (const i of list) {
        if (seen.has(i.id) || !visible(i)) continue;
        seen.add(i.id);
        const children = kids.get(i.id) ?? [];
        const hasChildren = children.length > 0;
        const expanded = hasChildren && (!collapsed.has(i.id) || (filtering && !matches(i)));
        rows.push({ item: i, depth, hasChildren, expanded, match: matches(i) });
        if (expanded) walk(children, depth + 1, seen);
      }
    };
    walk(top, 0, new Set());
    return { rows, matchCount };
  }, [items, query, people, types, statuses, collapsed, filtering]);

  // ---------- range ----------
  const range = useMemo(() => {
    let lo = today - 60, hi = today + 180;
    for (const i of items) {
      const sp = spanOf(i);
      if (sp) { lo = Math.min(lo, sp.s - 30); hi = Math.max(hi, sp.e + 60); }
    }
    // Align to quarter boundaries so every header starts cleanly.
    const a = parts(lo), b = parts(hi);
    const start = fromYmd(a.y, a.m - (a.m % 3), 1);
    const end = fromYmd(b.y, b.m - (b.m % 3) + 3, 1) - 1;
    return { start, end, days: end - start + 1 };
  }, [items, today]);
  const chartW = Math.ceil(range.days * dw);
  const [topUnits, bottomUnits] = useMemo(() => buildUnits(zoom, range.start, range.end), [zoom, range.start, range.end]);
  const weekends = useMemo(() => {
    if (zoom !== 'weeks') return [];
    const out: number[] = [];
    for (let d = range.start; d <= range.end; d++) { const wd = parts(d).wd; if (wd === 6) out.push(d); else if (wd === 0 && d === range.start) out.push(d); }
    return out;
  }, [zoom, range.start, range.end]);

  // ---------- scrolling ----------
  const chartViewW = () => Math.max(0, (scrollRef.current?.clientWidth ?? 0) - LEFT_W);
  const scrollToDay = useCallback((day: number, align: 'third' | 'center' = 'third') => {
    const el = scrollRef.current;
    if (!el) return;
    const vw = chartViewW();
    el.scrollLeft = Math.max(0, (day - range.start) * dw - (align === 'center' ? vw / 2 : vw / 3));
  }, [range.start, dw]);

  // Keep the visible dates in place when the range grows to the left, and when zooming.
  const prev = useRef<{ start: number; dw: number; centre: number | null } | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const p = prev.current;
    if (!p) scrollToDay(today);
    else if (p.dw !== dw && p.centre != null) scrollToDay(p.centre, 'center');
    else if (p.start !== range.start) el.scrollLeft += (p.start - range.start) * dw;
    prev.current = { start: range.start, dw, centre: null };
  }, [range.start, dw, today, scrollToDay]);

  const changeZoom = (z: Zoom) => {
    if (z === zoom) return;
    const el = scrollRef.current;
    if (el && prev.current) prev.current.centre = range.start + (el.scrollLeft + chartViewW() / 2) / dw;
    setZoom(z);
  };

  // ---------- drag / resize ----------
  // Listeners live in one controller created once, so add/removeEventListener see the same functions.
  // Everything they read comes from refs.
  const dayWidthRef = useRef(dw); dayWidthRef.current = dw;
  const rangeRef = useRef(range); rangeRef.current = range;
  const lastX = useRef(0);
  const [ctl] = useState(() => {
    const apply = (d: DragState, clientX: number) => {
      const el = scrollRef.current;
      const dx = clientX - d.x0 + ((el?.scrollLeft ?? 0) - d.scroll0);
      if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
      if (!d.moved) { d.moved = true; document.body.classList.add('tl-dragging'); }
      const delta = Math.round(dx / dayWidthRef.current);
      let s = d.s0, e = d.e0;
      if (d.mode === 'move') { s = d.s0 + delta; e = d.e0 + delta; }
      else if (d.mode === 'start') s = Math.min(d.s0 + delta, d.e0);
      else e = Math.max(d.e0 + delta, d.s0);
      const lo = rangeRef.current.start, hi = rangeRef.current.end;
      if (s < lo) { if (d.mode === 'move') e += lo - s; s = lo; }
      if (e > hi) { if (d.mode === 'move') s -= e - hi; e = hi; }
      if (s !== d.s || e !== d.e) { d.s = s; d.e = e; setDrag({ id: d.id, s, e }); }
    };
    const end = (commit: boolean) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      try { if (d.el.hasPointerCapture(d.pointerId)) d.el.releasePointerCapture(d.pointerId); } catch { /* element gone */ }
      document.body.classList.remove('tl-dragging');
      if (commit && d.moved && (d.s !== d.s0 || d.e !== d.e0)) {
        // updateItem applies the change to the store synchronously, so the bar does not jump back.
        projectsApi.updateItem(d.id, { startDate: toIso(d.s), dueDate: toIso(d.e) })
          .catch((err) => showToast(`Could not reschedule: ${err?.message ?? 'unknown error'}`));
      } else if (commit && !d.moved) {
        useItemPanel.getState().openItem(d.id);
      }
      setDrag(null);
    };
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      lastX.current = e.clientX;
      // Nudge the chart when dragging near its edges.
      const el = scrollRef.current;
      if (el && d.moved) {
        const r = el.getBoundingClientRect();
        if (e.clientX > r.right - 40) el.scrollLeft += 16;
        else if (e.clientX < r.left + LEFT_W + 40) el.scrollLeft -= 16;
      }
      apply(d, e.clientX);
    };
    const up = (e: PointerEvent) => { if (dragRef.current && e.pointerId === dragRef.current.pointerId) end(true); };
    const cancel = () => end(false);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); end(false); } };
    const start = (e: RPointerEvent<HTMLElement>, id: string, mode: DragState['mode'], span: { s: number; e: number }) => {
      if (e.button !== 0 || dragRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      const el = e.currentTarget;
      try { el.setPointerCapture(e.pointerId); } catch { /* not supported */ }
      lastX.current = e.clientX;
      dragRef.current = { id, mode, x0: e.clientX, scroll0: scrollRef.current?.scrollLeft ?? 0, s0: span.s, e0: span.e, s: span.s, e: span.e, moved: false, pointerId: e.pointerId, el };
      setGhost(null);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', key, true);
    };
    // Scrolling the chart mid-drag changes the offset too.
    const scrolled = () => { const d = dragRef.current; if (d && d.moved) apply(d, lastX.current); };
    return { start, end, scrolled };
  });
  useEffect(() => () => ctl.end(false), [ctl]);
  const startDrag = (e: RPointerEvent<HTMLElement>, item: WorkItem, mode: DragState['mode'], span: { s: number; e: number }) => ctl.start(e, item.id, mode, span);
  const onScroll = ctl.scrolled;

  // ---------- lane interactions ----------
  const dayAt = (e: RPointerEvent<HTMLElement> | RMouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return range.start + Math.floor((e.clientX - r.left) / dw);
  };
  const onLaneMove = (e: RPointerEvent<HTMLElement>, item: WorkItem, hasSpan: boolean) => {
    if (dragRef.current || hasSpan || e.pointerType === 'touch') { if (ghost) setGhost(null); return; }
    const day = dayAt(e);
    if (!ghost || ghost.id !== item.id || ghost.day !== day) setGhost({ id: item.id, day });
  };
  const onLaneClick = (e: RMouseEvent<HTMLElement>, item: WorkItem, hasSpan: boolean) => {
    if (hasSpan) { useItemPanel.getState().openItem(item.id); return; }
    const day = dayAt(e);
    setGhost(null);
    projectsApi.updateItem(item.id, { startDate: toIso(day), dueDate: toIso(day + 6) })
      .catch((err) => showToast(`Could not schedule: ${err?.message ?? 'unknown error'}`));
  };

  // ---------- create ----------
  const submitDraft = async () => {
    const summary = draft.trim();
    if (!summary) { setCreating(false); return; }
    setDraft('');
    try { await projectsApi.createItem(project.id, { summary, type: 'epic' }); }
    catch (err: any) { showToast(`Could not create the epic: ${err?.message ?? 'unknown error'}`); setDraft(summary); }
  };

  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allParents = rows.filter((r) => r.hasChildren).map((r) => r.item.id);
  const anyExpanded = rows.some((r) => r.hasChildren && r.expanded);
  const toggleAll = () => setCollapsed(anyExpanded ? new Set(items.filter((i) => items.some((c) => c.parentId === i.id)).map((i) => i.id)) : new Set());
  const filterCount = types.length + statuses.length;
  const clearFilters = () => { setQuery(''); setPeople([]); setTypes([]); setStatuses([]); };
  const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const todayX = (today - range.start) * dw;
  const bodyH = (rows.length + 1) * ROW_H;

  return (
    <div className="tl-root" ref={rootRef} style={height ? { height } : undefined}>
      <div className="tl-toolbar">
        <label className="tl-search">
          <Icon name="search" size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search timeline" aria-label="Search timeline" />
          {query && <button type="button" className="tl-search-x" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="x" size={13} /></button>}
        </label>
        <PeopleFilter selected={people} onChange={setPeople} />
        <div className="tl-filter" ref={filterRef}>
          <button type="button" className={`btn btn-sm${filterCount ? ' tl-active' : ''}`} aria-expanded={filterOpen} aria-haspopup="true" onClick={() => setFilterOpen((o) => !o)}>
            <Icon name="filter" size={15} /> Filter{filterCount ? ` (${filterCount})` : ''}
          </button>
          {filterOpen && (
            <div className="tl-pop" role="dialog" aria-label="Filter timeline">
              <fieldset>
                <legend>Type</legend>
                {TYPE_ORDER.map((t) => (
                  <label key={t} className="tl-pop-row"><input type="checkbox" checked={types.includes(t)} onChange={() => setTypes((l) => flip(l, t))} /><TypeIcon type={t} />{TYPE_LABEL[t]}</label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Status</legend>
                {STATUS_ORDER.map((s) => (
                  <label key={s} className="tl-pop-row"><input type="checkbox" checked={statuses.includes(s)} onChange={() => setStatuses((l) => flip(l, s))} /><StatusPill status={s} /></label>
                ))}
              </fieldset>
              {filterCount > 0 && <button type="button" className="tl-link" onClick={() => { setTypes([]); setStatuses([]); }}>Clear filters</button>}
            </div>
          )}
        </div>
        {filtering && <button type="button" className="tl-link" onClick={clearFilters}>Clear all</button>}
        <div className="tl-spacer" />
        {allParents.length > 0 && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={toggleAll}>{anyExpanded ? 'Collapse all' : 'Expand all'}</button>
        )}
      </div>

      <div className="tl-frame">
        <div className="tl-scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="tl-canvas" style={{ width: LEFT_W + chartW }}>
            {/* header */}
            <div className="tl-head">
              <div className="tl-head-left" style={{ width: LEFT_W }}>
                <span className="tl-col-work">Work</span><span className="tl-col-status">Status</span><span className="tl-col-assignee">Assignee</span>
              </div>
              <div className="tl-head-chart" style={{ width: chartW }} aria-hidden="true">
                <div className="tl-head-row top">
                  {topUnits.map((u) => (
                    <div key={u.start} className="tl-unit" style={{ left: (u.start - range.start) * dw, width: (u.end - u.start + 1) * dw }}><span>{u.label}</span></div>
                  ))}
                </div>
                <div className="tl-head-row bottom">
                  {bottomUnits.map((u) => (
                    <div key={u.start} className={`tl-unit${zoom === 'weeks' && (u.start === today) ? ' today' : ''}`}
                      style={{ left: (u.start - range.start) * dw, width: (u.end - u.start + 1) * dw }}><span>{u.label}</span></div>
                  ))}
                </div>
              </div>
            </div>

            {/* body */}
            <div className="tl-body" style={{ height: bodyH }}>
              <div className="tl-gridlayer" style={{ left: LEFT_W, width: chartW }} aria-hidden="true">
                {weekends.map((d) => <div key={`w${d}`} className="tl-weekend" style={{ left: (d - range.start) * dw, width: (d === range.start && parts(d).wd === 0 ? 1 : 2) * dw }} />)}
                {bottomUnits.map((u) => <div key={u.start} className="tl-gridline" style={{ left: (u.start - range.start) * dw }} />)}
                {topUnits.map((u) => <div key={`t${u.start}`} className="tl-gridline strong" style={{ left: (u.start - range.start) * dw }} />)}
              </div>
              {today >= range.start && today <= range.end && (
                <div className="tl-today" style={{ left: LEFT_W + todayX + dw / 2 }} aria-hidden="true"><span>Today</span></div>
              )}

              {rows.map((r) => {
                const i = r.item;
                const live = drag && drag.id === i.id ? drag : null;
                const span = live ?? spanOf(i);
                const left = span ? (span.s - range.start) * dw : 0;
                const width = span ? (span.e - span.s + 1) * dw : 0;
                const wide = width >= 72;
                const dateLabel = span ? `${formatDate(toIso(span.s))} – ${formatDate(toIso(span.e))}` : '';
                const ghostHere = ghost && ghost.id === i.id && !span;
                return (
                  <div key={i.id} className={`tl-row${r.match ? '' : ' context'}${live ? ' dragging' : ''}`} style={{ height: ROW_H }}>
                    <div className="tl-left" style={{ width: LEFT_W }} role="button" tabIndex={0}
                      aria-label={`${i.key} ${i.summary}`}
                      onClick={() => useItemPanel.getState().openItem(i.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); useItemPanel.getState().openItem(i.id); } }}>
                      <div className="tl-col-work" style={{ paddingLeft: 8 + r.depth * 20 }}>
                        {r.hasChildren ? (
                          <button type="button" className={`tl-chev${r.expanded ? ' open' : ''}`} aria-expanded={r.expanded}
                            aria-label={r.expanded ? `Collapse ${i.key}` : `Expand ${i.key}`}
                            onClick={(e) => { e.stopPropagation(); toggle(i.id); }}>
                            <Icon name="chevronRight" size={14} />
                          </button>
                        ) : <span className="tl-chev-space" />}
                        <TypeIcon type={i.type} />
                        <ItemKey item={i} />
                        <span className={`tl-summary${i.status === 'done' ? ' done' : ''}`} title={i.summary}>{i.summary}</span>
                      </div>
                      <div className="tl-col-status">
                        {i.type === 'epic' && i.childCount > 0 ? <EpicBar item={i} /> : <StatusPill status={i.status} />}
                      </div>
                      <div className="tl-col-assignee"><Assignee userId={i.assigneeId} size={24} /></div>
                    </div>
                    <div className={`tl-lane${span ? '' : ' unscheduled'}`} style={{ width: chartW }}
                      onPointerMove={(e) => onLaneMove(e, i, !!span)} onPointerLeave={() => ghost?.id === i.id && setGhost(null)}
                      onClick={(e) => onLaneClick(e, i, !!span)}>
                      {span && (
                        <div className={`tl-bar${wide ? '' : ' narrow'}`} role="button" tabIndex={-1}
                          style={{ left, width, ['--bar' as string]: barColor(i) }}
                          title={`${i.key} ${i.summary}\n${dateLabel}`} aria-label={`${i.key} ${i.summary}, ${dateLabel}. Drag to move, drag an edge to change dates.`}
                          onPointerDown={(e) => startDrag(e, i, 'move', span)}
                          onClick={(e) => e.stopPropagation()}>
                          <span className="tl-handle l" onPointerDown={(e) => startDrag(e, i, 'start', span)} aria-hidden="true" />
                          {wide && <span className="tl-bar-text">{i.summary}</span>}
                          <span className="tl-handle r" onPointerDown={(e) => startDrag(e, i, 'end', span)} aria-hidden="true" />
                          {live && <span className="tl-bar-dates">{dateLabel}</span>}
                        </div>
                      )}
                      {span && !wide && !live && <span className="tl-bar-outside" style={{ left: left + width + 6 }}>{i.summary}</span>}
                      {ghostHere && (
                        <div className="tl-ghost" style={{ left: (ghost.day - range.start) * dw, width: 7 * dw }}>
                          <span>Click to schedule</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="tl-row tl-create-row" style={{ height: ROW_H }}>
                <div className="tl-left" style={{ width: LEFT_W }}>
                  {creating ? (
                    <div className="tl-create-form">
                      <TypeIcon type="epic" />
                      <input autoFocus className="tl-create-input" value={draft} placeholder="What's the epic called? Press Enter to add"
                        aria-label="New epic summary"
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') submitDraft(); if (e.key === 'Escape') { setDraft(''); setCreating(false); } }}
                        onBlur={() => { if (!draft.trim()) setCreating(false); }} />
                    </div>
                  ) : (
                    <button type="button" className="tl-create" onClick={() => setCreating(true)}><Icon name="plus" size={15} /> Create</button>
                  )}
                  <span className="tl-count" aria-live="polite">{matchCount} of {items.length}</span>
                </div>
                <div className="tl-lane" style={{ width: chartW }} />
              </div>
            </div>

            {loaded && items.length === 0 && (
              <div className="tl-empty" style={{ left: LEFT_W + 24 }}>
                <strong>Plan your work on a timeline</strong>
                <span>Create an epic, then drag across its row to give it dates.</span>
              </div>
            )}
            {loaded && items.length > 0 && rows.length === 0 && (
              <div className="tl-empty" style={{ left: LEFT_W + 24 }}>
                <strong>No work matches these filters</strong>
                <button type="button" className="tl-link" onClick={clearFilters}>Clear filters</button>
              </div>
            )}
          </div>
        </div>

        <div className="tl-zoom" role="group" aria-label="Timeline zoom">
          <button type="button" onClick={() => scrollToDay(today)}>Today</button>
          <span className="tl-zoom-sep" />
          {(['weeks', 'months', 'quarters'] as Zoom[]).map((z) => (
            <button key={z} type="button" aria-pressed={zoom === z} onClick={() => changeZoom(z)}>{z[0].toUpperCase() + z.slice(1)}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EpicBar({ item }: { item: WorkItem }) {
  const total = item.childCount;
  const done = item.childDone, prog = item.childInProgress;
  const todo = Math.max(0, total - done - prog);
  const pct = Math.round((done / total) * 100);
  return (
    <div className="tl-epicbar" role="img" aria-label={`${done} of ${total} done, ${prog} in progress, ${todo} to do`}
      title={`${STATUS_LABEL.done}: ${done} · ${STATUS_LABEL.in_progress}: ${prog} · ${STATUS_LABEL.todo}: ${todo}`}>
      <div className="tl-epicbar-track">
        {done > 0 && <div style={{ flexGrow: done, background: STATUS_COLOR.done }} />}
        {prog > 0 && <div style={{ flexGrow: prog, background: STATUS_COLOR.in_progress }} />}
        {todo > 0 && <div style={{ flexGrow: todo, background: 'var(--border-strong)' }} />}
      </div>
      <span>{pct}%</span>
    </div>
  );
}
