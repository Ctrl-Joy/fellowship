import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { useSession, displayName } from '../../store/session';
import type { Member } from '../../types';
import './summary.css';

/** Active workspace members, sorted by name. */
export function useWorkspaceMembers(): Member[] {
  const members = useSession((s) => s.members);
  return useMemo(() => Object.values(members).filter((m) => !m.deactivated)
    .sort((a, b) => displayName(a).localeCompare(displayName(b))), [members]);
}

/**
 * Avatar stack of workspace members; clicking an avatar toggles it in `selected`.
 * 'none' stands for "Unassigned". Members beyond `max` are in a "+N" popover.
 */
export function PeopleFilter({ selected, onChange, max = 5, includeUnassigned = true }: {
  selected: string[]; onChange(next: string[]): void; max?: number; includeUnassigned?: boolean;
}) {
  const people = useWorkspaceMembers();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  // Keep selected people visible in the stack even when they would overflow.
  const ordered = [...people.filter((p) => selected.includes(p.id)), ...people.filter((p) => !selected.includes(p.id))];
  const shown = people.length > max ? ordered.slice(0, max) : people;
  const rest = people.length - shown.length;

  return (
    <div className="pjs-people" ref={ref} role="group" aria-label="Filter by assignee">
      <div className="pjs-people-stack">
        {shown.map((m) => (
          <button key={m.id} type="button" className={`pjs-people-av${selected.includes(m.id) ? ' on' : ''}`}
            aria-pressed={selected.includes(m.id)} title={displayName(m)} aria-label={`Show work for ${displayName(m)}`}
            onClick={() => toggle(m.id)}>
            <Avatar user={m} size={28} />
          </button>
        ))}
        {(rest > 0 || includeUnassigned) && (
          <button type="button" className={`pjs-people-more${open ? ' on' : ''}`} aria-expanded={open} aria-haspopup="true"
            title="More people" onClick={() => setOpen((o) => !o)}>
            {rest > 0 ? `+${rest}` : <span className="pjs-people-dots" aria-hidden="true">···</span>}
            <span className="pjs-sr">More people</span>
          </button>
        )}
      </div>
      {selected.length > 0 && (
        <button type="button" className="pjs-people-clear" onClick={() => onChange([])}>Clear</button>
      )}
      {open && (
        <div className="pjs-pop" role="dialog" aria-label="People">
          {includeUnassigned && (
            <label className="pjs-pop-row">
              <input type="checkbox" checked={selected.includes('none')} onChange={() => toggle('none')} />
              <span className="pj-unassigned" style={{ width: 22, height: 22 }} aria-hidden="true" />
              <span>Unassigned</span>
            </label>
          )}
          {people.map((m) => (
            <label key={m.id} className="pjs-pop-row">
              <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
              <Avatar user={m} size={22} />
              <span className="pjs-pop-name">{displayName(m)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
