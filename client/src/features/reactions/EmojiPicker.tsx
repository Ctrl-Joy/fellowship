import { useEffect, useMemo, useRef, useState } from 'react';
import { ALL_EMOJI, EMOJI_GROUPS, shortcodeFor, type EmojiEntry } from './emojiData';
import { loadRecent, pushRecent } from './recent';

export interface EmojiPickerProps {
  onPick(emoji: string): void;
  onClose(): void;
}

interface Section {
  id: string;
  label: string;
  entries: EmojiEntry[];
}

const COLUMNS = 8; // grid width; ArrowUp/ArrowDown move by one row

const nameByEmoji = new Map(ALL_EMOJI.map((e) => [e.emoji, e.name] as const));

/** Searchable emoji picker: recents, categories, keyboard navigation. Positioned by its parent. */
export default function EmojiPicker({ onPick, onClose }: EmojiPickerProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent] = useState<string[]>(() => loadRecent());
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const sectionEls = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      // A trigger (data-emoji-trigger) toggles the picker itself; closing here would reopen it on click.
      if (target.closest?.('[data-emoji-trigger]')) return;
      if (rootRef.current && !rootRef.current.contains(target)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const sections = useMemo<Section[]>(() => {
    const q = query.trim().toLowerCase().replace(/^:+|:+$/g, '');
    if (q) {
      const code = q.replace(/\s+/g, '_');
      const hits = ALL_EMOJI.filter((e) =>
        e.name.includes(q) || shortcodeFor(e).includes(code) || e.keywords.some((k) => k.startsWith(q)));
      hits.sort((a, b) => Number(!b.name.startsWith(q)) - Number(!a.name.startsWith(q)));
      return [{ id: 'results', label: 'Results', entries: hits.slice(0, 160) }];
    }
    const out: Section[] = [];
    if (recent.length) {
      out.push({
        id: 'recent', label: 'Recently used',
        entries: recent.map((emoji) => ({ emoji, name: nameByEmoji.get(emoji) ?? 'emoji', keywords: [] })),
      });
    }
    for (const g of EMOJI_GROUPS) out.push({ id: g.id, label: g.label, entries: g.entries });
    return out;
  }, [query, recent]);

  const flat = useMemo(() => sections.flatMap((s) => s.entries), [sections]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function pick(emoji: string) {
    pushRecent(emoji);
    onPick(emoji);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const last = flat.length - 1;
    const move = (delta: number) => { e.preventDefault(); setActive((a) => Math.min(Math.max(a + delta, 0), Math.max(last, 0))); };
    switch (e.key) {
      case 'ArrowRight': move(1); break;
      case 'ArrowLeft': move(-1); break;
      case 'ArrowDown': move(COLUMNS); break;
      case 'ArrowUp': move(-COLUMNS); break;
      case 'Enter': {
        e.preventDefault();
        const hit = flat[active];
        if (hit) pick(hit.emoji);
        break;
      }
      case 'Escape': e.preventDefault(); onClose(); break;
    }
  }

  let offset = 0;
  return (
    <div className="epk" ref={rootRef} role="dialog" aria-label="Pick an emoji">
      <div className="epk-search">
        <input
          autoFocus
          className="epk-input"
          placeholder="Find an emoji"
          aria-label="Search emoji"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {!query && (
        <div className="epk-tabs" role="tablist">
          {sections.map((s) => (
            <button key={s.id} type="button" role="tab" className="epk-tab" title={s.label} aria-label={s.label}
              onClick={() => sectionEls.current[s.id]?.scrollIntoView({ block: 'start' })}>
              {s.id === 'recent' ? '🕘' : EMOJI_GROUPS.find((g) => g.id === s.id)?.icon}
            </button>
          ))}
        </div>
      )}
      <div className="epk-body" ref={gridRef}>
        {flat.length === 0 && <div className="epk-empty">No emoji match “{query}”.</div>}
        {sections.map((s) => {
          const start = offset;
          offset += s.entries.length;
          if (!s.entries.length) return null;
          return (
            <section key={s.id} className="epk-section" ref={(el) => { sectionEls.current[s.id] = el; }}>
              <h4 className="epk-heading">{s.label}</h4>
              <div className="epk-grid">
                {s.entries.map((e, i) => {
                  const idx = start + i;
                  return (
                    <button key={`${s.id}-${i}`} type="button" data-idx={idx}
                      className={`epk-emoji${idx === active ? ' is-active' : ''}`}
                      title={e.name} aria-label={e.name}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => pick(e.emoji)}>
                      {e.emoji}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {flat[active] && <div className="epk-footer"><span className="epk-preview">{flat[active].emoji}</span> :{shortcodeFor(flat[active])}:</div>}
    </div>
  );
}
