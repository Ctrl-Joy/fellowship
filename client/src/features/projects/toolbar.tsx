/** Toolbar pieces shared by the List and Board tabs: search, people filter, filter popover, group-by. */
import { useMemo } from 'react';
import type { ItemStatus, ItemType, Priority, WorkItem } from './types';
import { PRIORITY_LABEL, PRIORITY_ORDER, STATUS_LABEL, STATUS_ORDER, TYPE_LABEL, TYPE_ORDER } from './types';
import { PriorityIcon, StatusPill, TypeIcon } from './ui';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { displayName, useSession } from '../../store/session';
import { Dropdown, MenuItem } from './kit';

export interface ItemFilters { type: ItemType[]; status: ItemStatus[]; priority: Priority[] }
export const EMPTY_FILTERS: ItemFilters = { type: [], status: [], priority: [] };
export const filterCount = (f: ItemFilters) => f.type.length + f.status.length + f.priority.length;

/** Apply text search, people and field filters locally (so live updates show at once). */
export function matchItems(items: WorkItem[], opts: { search: string; people: string[]; filters: ItemFilters }) {
  const s = opts.search.trim().toLowerCase();
  const { type, status, priority } = opts.filters;
  return items.filter((i) => {
    if (s && !i.summary.toLowerCase().includes(s) && !i.key.toLowerCase().includes(s) && !i.labels.some((l) => l.toLowerCase().includes(s))) return false;
    if (opts.people.length && !opts.people.includes(i.assigneeId ?? 'none')) return false;
    if (type.length && !type.includes(i.type)) return false;
    if (status.length && !status.includes(i.status)) return false;
    if (priority.length && !priority.includes(i.priority)) return false;
    return true;
  });
}

export function SearchInput({ value, onChange, placeholder = 'Search work' }: { value: string; onChange(v: string): void; placeholder?: string }) {
  return (
    <label className="pj-search">
      <Icon name="search" size={15} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        onKeyDown={(e) => { if (e.key === 'Escape' && value) { e.stopPropagation(); onChange(''); } }} />
      {value && <button type="button" aria-label="Clear search" onClick={() => onChange('')}><Icon name="x" size={13} /></button>}
    </label>
  );
}

/** Avatar stack of the people who have work in this space; click to toggle. */
export function PeopleFilter({ items, value, onChange }: { items: WorkItem[]; value: string[]; onChange(v: string[]): void }) {
  const members = useSession((s) => s.members);
  const meId = useSession((s) => s.me?.id);
  const people = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i.assigneeId ?? 'none', (counts.get(i.assigneeId ?? 'none') ?? 0) + 1);
    const ids = [...counts.keys()].filter((id) => id === 'none' || members[id]);
    if (meId && !counts.has(meId)) ids.push(meId);
    return ids.sort((a, b) => (a === 'none' ? 1 : b === 'none' ? -1 : (counts.get(b) ?? 0) - (counts.get(a) ?? 0)));
  }, [items, members, meId]);
  const shown = people.slice(0, 6);
  const extra = people.slice(6);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const label = (id: string) => (id === 'none' ? 'Unassigned' : displayName(members[id]) + (id === meId ? ' (you)' : ''));
  return (
    <div className="pj-people" role="group" aria-label="Filter by assignee">
      {shown.map((id) => (
        <button key={id} type="button" className={`pj-people-btn${value.includes(id) ? ' on' : ''}`} title={label(id)} aria-pressed={value.includes(id)}
          aria-label={`Filter by ${label(id)}`} onClick={() => toggle(id)}>
          {id === 'none' ? <span className="pj-unassigned pj-people-none" style={{ width: 28, height: 28 }} /> : <Avatar user={members[id]} size={28} />}
        </button>
      ))}
      {extra.length > 0 && (
        <Dropdown className="pj-people-more" label={`+${extra.length}`} ariaLabel="More people" width={240}>
          {() => extra.map((id) => <MenuItem key={id} checked={value.includes(id)} onClick={() => toggle(id)}>{label(id)}</MenuItem>)}
        </Dropdown>
      )}
      {value.length > 0 && <button type="button" className="pj-link-btn" onClick={() => onChange([])}>Clear</button>}
    </div>
  );
}

export function FilterButton({ value, onChange }: { value: ItemFilters; onChange(v: ItemFilters): void }) {
  const n = filterCount(value);
  const toggle = <K extends keyof ItemFilters>(k: K, v: ItemFilters[K][number]) => {
    const cur = value[k] as string[];
    onChange({ ...value, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };
  return (
    <Dropdown className={`pj-btn${n ? ' active' : ''}`} width={520} popClass="pj-filter-pop"
      label={<><Icon name="filter" size={15} /> Filter{n > 0 && <span className="pj-count-badge">{n}</span>}</>}>
      {() => (
        <div className="pj-filter">
          <div className="pj-filter-col">
            <div className="pj-pop-title">Type</div>
            {TYPE_ORDER.map((t) => (
              <label key={t} className="pj-check-row"><input type="checkbox" checked={value.type.includes(t)} onChange={() => toggle('type', t)} />
                <TypeIcon type={t} /> {TYPE_LABEL[t]}</label>
            ))}
          </div>
          <div className="pj-filter-col">
            <div className="pj-pop-title">Status</div>
            {STATUS_ORDER.map((s) => (
              <label key={s} className="pj-check-row"><input type="checkbox" checked={value.status.includes(s)} onChange={() => toggle('status', s)} />
                <StatusPill status={s} /></label>
            ))}
          </div>
          <div className="pj-filter-col">
            <div className="pj-pop-title">Priority</div>
            {PRIORITY_ORDER.map((p) => (
              <label key={p} className="pj-check-row"><input type="checkbox" checked={value.priority.includes(p)} onChange={() => toggle('priority', p)} />
                <PriorityIcon priority={p} /> {PRIORITY_LABEL[p]}</label>
            ))}
          </div>
          <div className="pj-filter-foot">
            <span className="muted small">{n ? `${n} filter${n === 1 ? '' : 's'} applied` : 'No filters applied'}</span>
            <button type="button" className="pj-link-btn" disabled={!n} onClick={() => onChange(EMPTY_FILTERS)}>Clear filters</button>
          </div>
        </div>
      )}
    </Dropdown>
  );
}

export function GroupByButton<G extends string>({ value, options, onChange }: { value: G; options: { value: G; label: string }[]; onChange(v: G): void }) {
  const cur = options.find((o) => o.value === value);
  return (
    <Dropdown className={`pj-btn${value !== 'none' ? ' active' : ''}`} width={200}
      label={<><Glyphish /> Group{value !== 'none' ? `: ${cur?.label}` : ''}</>}>
      {(close) => (
        <div className="pj-menu" role="menu">
          <div className="pj-pop-title">Group by</div>
          {options.map((o) => <MenuItem key={o.value} checked={o.value === value} onClick={() => { onChange(o.value); close(); }}>{o.label}</MenuItem>)}
        </div>
      )}
    </Dropdown>
  );
}
function Glyphish() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 5h16M4 12h10M4 19h6" /></svg>;
}

export { STATUS_LABEL };
