import { create } from 'zustand';
import type { ItemStatus, ItemType, Priority, WorkItem } from './types';
import { PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from './types';
import { Avatar } from '../../components/Avatar';
import { useSession, displayName } from '../../store/session';
import './projects.css';

/** Which work item is open in the detail panel, and the Create dialog state. Any view may call these. */
interface PanelState {
  openItemId: string | null;
  create: { projectId?: string; parentId?: string; status?: ItemStatus; type?: ItemType } | null;
  openItem(id: string): void;
  closeItem(): void;
  openCreate(defaults?: PanelState['create']): void;
  closeCreate(): void;
}
export const useItemPanel = create<PanelState>()((set) => ({
  openItemId: null,
  create: null,
  openItem: (id) => set({ openItemId: id }),
  closeItem: () => set({ openItemId: null }),
  openCreate: (defaults = {}) => set({ create: defaults ?? {} }),
  closeCreate: () => set({ create: null }),
}));

const TYPE_GLYPH: Record<ItemType, { color: string; path: string }> = {
  epic: { color: '#9F7AEA', path: 'M13 3 5 14h6l-1 7 8-11h-6z' },
  story: { color: '#48BB78', path: 'M7 4h10v16l-5-4-5 4z' },
  task: { color: '#4299E1', path: 'M5 5h14v14H5zM8.5 12l2.5 2.5 4.5-5' },
  bug: { color: '#E53E3E', path: 'M12 7a4 4 0 0 0-4 4v3a4 4 0 0 0 8 0v-3a4 4 0 0 0-4-4zM12 7V5M8 12H5M19 12h-3M8.5 17 6 19M15.5 17l2.5 2M9 8 7 6M15 8l2-2' },
  subtask: { color: '#38B2AC', path: 'M6 4h6v6H6zM12 14h6v6h-6zM9 10v7h3' },
};
export function TypeIcon({ type, size = 16 }: { type: ItemType; size?: number }) {
  const g = TYPE_GLYPH[type];
  return (
    <svg className="pj-type" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={TYPE_LABEL[type]}>
      <title>{TYPE_LABEL[type]}</title>
      <path d={g.path} fill="none" stroke={g.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const PRIORITY_GLYPH: Record<Priority, { color: string; path: string }> = {
  highest: { color: '#E53E3E', path: 'm6 13 6-6 6 6M6 18l6-6 6 6' },
  high: { color: '#F56565', path: 'm6 15 6-6 6 6' },
  medium: { color: '#ED8936', path: 'M6 9h12M6 15h12' },
  low: { color: '#4299E1', path: 'm6 9 6 6 6-6' },
  lowest: { color: '#3182CE', path: 'm6 6 6 6 6-6M6 11l6 6 6-6' },
  none: { color: '#718096', path: 'M7 12h10' },
};
export function PriorityIcon({ priority, size = 16 }: { priority: Priority; size?: number }) {
  const g = PRIORITY_GLYPH[priority];
  return (
    <svg className="pj-prio" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={`${PRIORITY_LABEL[priority]} priority`}>
      <title>{PRIORITY_LABEL[priority]}</title>
      <path d={g.path} fill="none" stroke={g.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export const PRIORITY_COLOR: Record<Priority, string> = Object.fromEntries(Object.entries(PRIORITY_GLYPH).map(([k, v]) => [k, v.color])) as any;
export const TYPE_COLOR: Record<ItemType, string> = Object.fromEntries(Object.entries(TYPE_GLYPH).map(([k, v]) => [k, v.color])) as any;
export const STATUS_COLOR: Record<ItemStatus, string> = { todo: '#8A8F98', in_progress: '#4C8DF6', in_review: '#B57CF0', done: '#5DBB63' };

/** Status pill; when `onChange` is given it is a dropdown. */
export function StatusPill({ status, onChange }: { status: ItemStatus; onChange?: (s: ItemStatus) => void }) {
  const pill = <span className={`pj-status pj-status-${status}`}>{STATUS_LABEL[status]}</span>;
  if (!onChange) return pill;
  return (
    <label className={`pj-status pj-status-${status} pj-status-select`} onClick={(e) => e.stopPropagation()}>
      <select aria-label="Status" value={status} onChange={(e) => onChange(e.target.value as ItemStatus)}>
        {(Object.keys(STATUS_LABEL) as ItemStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
      {STATUS_LABEL[status]} <span aria-hidden="true">▾</span>
    </label>
  );
}

/** Assignee avatar with an "unassigned" placeholder. */
export function Assignee({ userId, size = 24, showName = false }: { userId: string | null; size?: number; showName?: boolean }) {
  const member = useSession((s) => (userId ? s.members[userId] : undefined));
  const name = member ? displayName(member) : 'Unassigned';
  return (
    <span className="pj-assignee" title={name}>
      {member ? <Avatar user={member} size={size} /> : <span className="pj-unassigned" style={{ width: size, height: size }} aria-hidden="true" />}
      {showName && <span className="pj-assignee-name">{name}</span>}
    </span>
  );
}

/** Clickable item key ("BIL-12") that opens the detail panel. */
export function ItemKey({ item }: { item: Pick<WorkItem, 'id' | 'key'> }) {
  return <button type="button" className="pj-key" onClick={(e) => { e.stopPropagation(); useItemPanel.getState().openItem(item.id); }}>{item.key}</button>;
}

/** "Nov 18, 2026" for a YYYY-MM-DD date, without timezone drift. */
export function formatDate(d: string | null | undefined) {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
export const todayIso = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
