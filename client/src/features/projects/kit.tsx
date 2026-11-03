/**
 * Small building blocks shared by the space shell, list, board and item views:
 * popovers rendered in a portal (so they escape scrolling containers), dropdowns,
 * member pickers, confirm dialogs and a few helpers.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Member } from '../../types';
import { useSession, displayName } from '../../store/session';
import { Avatar } from '../../components/Avatar';
import { Modal } from '../../components/Modal';
import { Icon } from '../../components/Icon';
import type { WorkItem } from './types';
import './shell.css';

// ---------- glyphs not in the shared icon set ----------
const GLYPHS = {
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6z',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  shrink: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  chart: 'M5 20V10M12 20V4M19 20v-7',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  feedback: 'M4 5h16v11H9l-5 4zM9 10h.01M12 10h.01M15 10h.01',
  board: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  columns: 'M4 5h16v14H4zM9.5 5v14M14.5 5v14',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  layers: 'm12 4 8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4',
  share: 'M16 6l-4-3-4 3M12 3v12M6 11H4v9h16v-9h-2',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  starFill: 'm12 4 2.5 5.2 5.5.8-4 3.9.9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-3.9 5.5-.8z',
};
export type GlyphName = keyof typeof GLYPHS;
export function Glyph({ name, size = 16, fill = false, className }: { name: GlyphName; size?: number; fill?: boolean; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={GLYPHS[name]} />
    </svg>
  );
}

// ---------- popover ----------
/** Open popovers, top-most last: only the top one reacts to Escape. */
const stack: number[] = [];
let popSeq = 0;

/** True when any projects popover or modal dialog is open (used by Esc / shortcut handlers). */
export function layerOpen() {
  return stack.length > 0 || !!document.querySelector('.modal-backdrop');
}

/** True when the keyboard focus is in something that takes typing. */
export function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function Popover({ anchor, onClose, children, align = 'start', className = '', width, placement = 'bottom' }: {
  anchor: HTMLElement | null; onClose(): void; children: ReactNode; align?: 'start' | 'end'; className?: string; width?: number;
  placement?: 'bottom' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const place = useCallback(() => {
    const el = ref.current;
    if (!anchor || !el) return;
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let top: number, left: number;
    if (placement === 'right') {
      left = a.right + 6;
      if (left + w > vw - 8) left = Math.max(8, a.left - w - 6);
      top = Math.min(a.top, vh - h - 8);
    } else {
      top = a.bottom + 4;
      if (top + h > vh - 8 && a.top - h - 4 > 8) top = a.top - h - 4;
      left = align === 'end' ? a.right - w : a.left;
    }
    left = Math.max(8, Math.min(left, vw - w - 8));
    top = Math.max(8, Math.min(top, vh - h - 8));
    setPos({ top, left });
  }, [anchor, align, placement]);

  useLayoutEffect(() => { place(); }, [place]);
  useEffect(() => {
    // Re-place when content size changes (e.g. a search narrows the list).
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    return () => ro.disconnect();
  }, [place]);

  useEffect(() => {
    const id = ++popSeq;
    stack.push(id);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      // A click inside a popover opened from this one should not close this one.
      if ((t as HTMLElement).closest?.('.pj-pop')) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === id) {
        e.stopPropagation();
        e.preventDefault();
        closeRef.current();
        anchor?.focus?.();
      }
    };
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) place(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, place]);

  return createPortal(
    <div ref={ref} className={`pj-pop ${className}`} role="dialog"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, visibility: pos ? 'visible' : 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  );
}

/** A button that toggles a popover. `children` receives a `close` function. */
export function Dropdown({ label, children, className = 'pj-btn', align, width, title, disabled, popClass, ariaLabel, placement }: {
  label: ReactNode; children: (close: () => void) => ReactNode; className?: string; align?: 'start' | 'end'; width?: number;
  title?: string; disabled?: boolean; popClass?: string; ariaLabel?: string; placement?: 'bottom' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button ref={btn} type="button" className={`${className}${open ? ' open' : ''}`} title={title} aria-label={ariaLabel} disabled={disabled}
        aria-haspopup="true" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        {label}
      </button>
      {open && <Popover anchor={btn.current} onClose={close} align={align} width={width} className={popClass} placement={placement}>{children(close)}</Popover>}
    </>
  );
}

/** Vertical list of actions inside a popover. */
export function MenuItem({ children, onClick, danger, disabled, checked, icon, hint }: {
  children: ReactNode; onClick(): void; danger?: boolean; disabled?: boolean; checked?: boolean; icon?: ReactNode; hint?: ReactNode;
}) {
  return (
    <button type="button" className={`pj-menu-item${danger ? ' danger' : ''}${checked ? ' checked' : ''}`} disabled={disabled}
      role="menuitem" onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {checked !== undefined && <span className="pj-menu-check" aria-hidden="true">{checked ? <Icon name="check" size={14} /> : null}</span>}
      {icon && <span className="pj-menu-icon">{icon}</span>}
      <span className="pj-menu-label">{children}</span>
      {hint && <span className="pj-menu-hint">{hint}</span>}
    </button>
  );
}

// ---------- members ----------
/** Active (non-bot, non-deactivated) workspace members, sorted by name. */
export function useMembers(): Member[] {
  const members = useSession((s) => s.members);
  return useMemo(() => Object.values(members).filter((m) => !m.deactivated && !m.isBot)
    .sort((a, b) => displayName(a).localeCompare(displayName(b))), [members]);
}

export function memberName(id: string | null | undefined, fallback = 'Unassigned') {
  if (!id) return fallback;
  const m = useSession.getState().members[id];
  return m ? displayName(m) : 'Someone';
}

/** Searchable list of members; `null` = unassigned. */
export function MemberList({ value, onPick, allowNone = true, noneLabel = 'Unassigned', meId }: {
  value?: string | null; onPick(id: string | null): void; allowNone?: boolean; noneLabel?: string; meId?: string;
}) {
  const members = useMembers();
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const ms = members.filter((m) => !s || displayName(m).toLowerCase().includes(s) || m.fullName.toLowerCase().includes(s) || m.email.toLowerCase().includes(s));
    if (meId) ms.sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0));
    const out: { id: string | null; label: string; m?: Member }[] = ms.map((m) => ({ id: m.id, label: displayName(m) + (m.id === meId ? ' (you)' : ''), m }));
    if (allowNone && (!s || noneLabel.toLowerCase().includes(s))) out.unshift({ id: null, label: noneLabel });
    return out;
  }, [members, q, allowNone, noneLabel, meId]);
  useEffect(() => setHi(0), [q]);
  return (
    <div className="pj-member-list">
      <input className="pj-pop-search" autoFocus placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)}
        aria-label="Search people"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === 'Enter' && list[hi]) { e.preventDefault(); onPick(list[hi].id); }
        }} />
      <div className="pj-pop-scroll" role="listbox">
        {list.map((o, i) => (
          <button key={o.id ?? 'none'} type="button" role="option" aria-selected={o.id === value}
            className={`pj-menu-item${o.id === value ? ' checked' : ''}${i === hi ? ' hi' : ''}`}
            onMouseEnter={() => setHi(i)} onClick={(e) => { e.stopPropagation(); onPick(o.id); }}>
            <span className="pj-menu-icon">{o.m ? <Avatar user={o.m} size={20} /> : <span className="pj-unassigned" style={{ width: 20, height: 20 }} />}</span>
            <span className="pj-menu-label">{o.label}</span>
            {o.id === value && <Icon name="check" size={14} />}
          </button>
        ))}
        {!list.length && <div className="pj-pop-empty">No matching people</div>}
      </div>
    </div>
  );
}

// ---------- dialogs ----------
export function ConfirmDialog({ title, body, confirmLabel = 'Delete', onConfirm, onClose, danger = true }: {
  title: string; body: ReactNode; confirmLabel?: string; onConfirm(): Promise<unknown> | void; onClose(): void; danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Modal title={title} onClose={onClose} width={440}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className={`btn ${danger ? 'pj-btn-danger' : 'btn-primary'}`} autoFocus disabled={busy} onClick={async () => {
          setBusy(true); setErr('');
          try { await onConfirm(); onClose(); } catch (e: any) { setErr(e?.message || 'Something went wrong'); setBusy(false); }
        }}>{busy ? <span className="spinner" /> : confirmLabel}</button>
      </>}>
      <div className="pj-confirm-body">{body}</div>
      {err && <p className="form-error">{err}</p>}
    </Modal>
  );
}

// ---------- helpers ----------
const EPIC_COLORS = ['#9F7AEA', '#4C8DF6', '#38B2AC', '#ED8936', '#E35D9B', '#5DBB63', '#D69E2E', '#E25B4C'];
/** Stable colour for an epic (epics have no colour field of their own). */
export function epicColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return EPIC_COLORS[h % EPIC_COLORS.length];
}

export function isOverdue(item: Pick<WorkItem, 'dueDate' | 'status'>, today: string) {
  return !!item.dueDate && item.status !== 'done' && item.dueDate < today;
}

/** Persisted per-browser view preference. */
export function usePref<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`fs:pj:${key}`);
      if (!raw) return initial;
      const parsed = JSON.parse(raw);
      const plain = initial && typeof initial === 'object' && !Array.isArray(initial);
      return plain ? { ...(initial as object), ...parsed } : parsed;
    } catch { return initial; }
  });
  const set = useCallback((n: T | ((p: T) => T)) => {
    setV((prev) => {
      const next = typeof n === 'function' ? (n as (p: T) => T)(prev) : n;
      try { localStorage.setItem(`fs:pj:${key}`, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [key]);
  return [v, set];
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); return true; } catch { return false; } finally { ta.remove(); }
  }
}

/** Small "Copied" flash state for copy buttons. */
export function useFlash(ms = 1500): [string | null, (s: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(t.current), []);
  return [msg, (s: string) => { setMsg(s); window.clearTimeout(t.current); t.current = window.setTimeout(() => setMsg(null), ms); }];
}

export const SPACE_EMOJIS = ['🧭', '🚀', '💳', '🛠️', '📦', '🎯', '🧪', '📈', '🐞', '🌱', '🔒', '🎨', '📱', '🌐', '⚡', '🧩', '📚', '🏗️', '🤝', '🔥', '🛰️', '🧠', '🗂️', '🏁'];
export const SPACE_COLORS = ['#6E5BD8', '#1F6F5C', '#2A7DE1', '#E2574C', '#F2A541', '#38B2AC', '#D53F8C', '#718096'];
