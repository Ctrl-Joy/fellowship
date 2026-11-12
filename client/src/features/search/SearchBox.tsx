import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../../components/Icon';
import { useConversations } from '../../store/conversations';
import { useSession, displayName } from '../../store/session';
import { mentionHandle } from '../../lib/mentions';
import { recentSearches, rememberSearch, forgetSearches } from './recent';
import './search.css';

export interface SearchBoxProps {
  workspaceId: string;
  workspaceName: string;
}

interface Suggestion { key: string; label: string; hint?: string; insert: string }

const MODIFIERS: { key: string; label: string; hint: string; insert: string }[] = [
  { key: 'in', label: 'in:#channel', hint: 'Only in one channel', insert: 'in:#' },
  { key: 'from', label: 'from:@person', hint: 'Written by one person', insert: 'from:@' },
  { key: 'has', label: 'has:link', hint: 'Links, files, reactions or pins', insert: 'has:' },
  { key: 'is', label: 'is:thread', hint: 'Thread roots and replies', insert: 'is:thread ' },
  { key: 'on', label: 'on:YYYY-MM-DD', hint: 'Sent on a day (UTC)', insert: 'on:' },
  { key: 'before', label: 'before:YYYY-MM-DD', hint: 'Sent before a day', insert: 'before:' },
  { key: 'after', label: 'after:YYYY-MM-DD', hint: 'Sent after a day', insert: 'after:' },
];

const HAS_VALUES = ['link', 'file', 'reaction', 'pin'];

function todayUtc(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

/** Top-bar search box. `/` focuses it; Enter opens /w/:wid/search?q=…; modifier suggestions as you type. */
export default function SearchBox({ workspaceId, workspaceName }: SearchBoxProps) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [focused, setFocused] = useState(false);
  const [index, setIndex] = useState(-1);
  const [recent, setRecent] = useState<string[]>(() => recentSearches(workspaceId));
  const inputRef = useRef<HTMLInputElement>(null);
  const conversations = useConversations((s) => s.byId);
  const members = useSession((s) => s.members);

  // Keep the box in step with the query on the results page.
  const urlQ = params.get('q');
  useEffect(() => { if (urlQ !== null) setQ(urlQ); }, [urlQ]);
  useEffect(() => { setRecent(recentSearches(workspaceId)); }, [workspaceId]);

  // `/` focuses the search box unless the user is already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const lastStart = useMemo(() => {
    const m = /\S*$/.exec(q);
    return m ? q.length - m[0].length : q.length;
  }, [q]);
  const last = q.slice(lastStart);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!focused) return [];
    const mod = /^(in|from|has|is|on|before|after):(.*)$/i.exec(last);
    if (mod) {
      const key = mod[1].toLowerCase();
      const v = mod[2].toLowerCase();
      if (key === 'in') {
        return Object.values(conversations)
          .filter((c) => c.kind === 'channel' && c.name && c.name.startsWith(v.replace(/^#/, '')))
          .slice(0, 8)
          .map((c) => ({ key: c.id, label: `in:#${c.name}`, hint: c.topic || 'Channel', insert: `in:#${c.name} ` }));
      }
      if (key === 'from') {
        const bare = v.replace(/^@/, '');
        return Object.values(members)
          .filter((m) => !m.deactivated && mentionHandle(m).startsWith(bare))
          .slice(0, 8)
          .map((m) => ({ key: m.id, label: `from:@${mentionHandle(m)}`, hint: displayName(m), insert: `from:@${mentionHandle(m)} ` }));
      }
      if (key === 'has') {
        return HAS_VALUES.filter((h) => h.startsWith(v)).map((h) => ({ key: h, label: `has:${h}`, insert: `has:${h} ` }));
      }
      if (key === 'is') {
        return 'thread'.startsWith(v) ? [{ key: 'thread', label: 'is:thread', hint: 'Thread roots and replies', insert: 'is:thread ' }] : [];
      }
      // on / before / after: offer today and yesterday.
      return [todayUtc(), todayUtc(-1)].map((d) => ({ key: `${key}${d}`, label: `${key}:${d}`, hint: d === todayUtc() ? 'Today' : 'Yesterday', insert: `${key}:${d} ` }));
    }
    if (last && /^[a-z]*$/i.test(last)) {
      return MODIFIERS.filter((m) => m.key.startsWith(last.toLowerCase())).map((m) => ({ key: m.key, label: m.label, hint: m.hint, insert: m.insert }));
    }
    return [];
  }, [focused, last, conversations, members]);

  const showRecent = focused && q.trim() === '' && recent.length > 0;
  const menuItems: Suggestion[] = showRecent
    ? recent.map((r) => ({ key: `recent:${r}`, label: r, insert: r }))
    : suggestions;
  const menuOpen = focused && menuItems.length > 0;

  function applySuggestion(s: Suggestion) {
    if (showRecent) {
      setQ(s.insert);
      submit(s.insert);
      return;
    }
    const next = q.slice(0, lastStart) + s.insert;
    setQ(next);
    setIndex(-1);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) { el.focus(); el.setSelectionRange(next.length, next.length); }
    });
  }

  function submit(value = q) {
    const text = value.trim();
    if (!text) return;
    rememberSearch(workspaceId, text);
    setRecent(recentSearches(workspaceId));
    setFocused(false);
    setIndex(-1);
    inputRef.current?.blur();
    navigate(`/w/${workspaceId}/search?q=${encodeURIComponent(text)}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      if (menuOpen) { e.preventDefault(); setIndex(-1); setFocused(false); }
      else inputRef.current?.blur();
      return;
    }
    if (menuOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const n = menuItems.length;
      setIndex((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i <= 0 ? n - 1 : i - 1)));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (menuOpen && index >= 0 && menuItems[index]) applySuggestion(menuItems[index]);
      else submit();
      return;
    }
    if (e.key === 'Tab' && menuOpen && menuItems.length) {
      e.preventDefault();
      applySuggestion(menuItems[Math.max(index, 0)]);
    }
  }

  return (
    <form className="srch" role="search" onSubmit={(e) => { e.preventDefault(); submit(); }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setFocused(false); setIndex(-1); } }}>
      <div className={`searchbox srch-box${focused ? ' is-open' : ''}`}>
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setIndex(-1); setFocused(true); }}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          placeholder={`Search ${workspaceName}`}
          aria-label="Search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={menuOpen}
          aria-controls="srch-menu"
          autoComplete="off"
          spellCheck={false}
        />
        {q && (
          <button type="button" className="srch-clear" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setQ(''); inputRef.current?.focus(); }}>
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
      {menuOpen && (
        <ul id="srch-menu" className="srch-menu" role="listbox" aria-label={showRecent ? 'Recent searches' : 'Search suggestions'}>
          {showRecent && (
            <li className="srch-menu-head" role="presentation">
              <span>Recent searches</span>
              <button type="button" onMouseDown={(e) => e.preventDefault()}
                onClick={() => { forgetSearches(workspaceId); setRecent([]); }}>Clear</button>
            </li>
          )}
          {menuItems.map((s, i) => (
            <li key={s.key} role="option" aria-selected={i === index}
              className={`srch-item${i === index ? ' active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); applySuggestion(s); }}
              onMouseEnter={() => setIndex(i)}>
              <Icon name={showRecent ? 'search' : 'chevronRight'} size={13} />
              <span className="srch-item-label">{s.label}</span>
              {s.hint && <span className="srch-item-hint">{s.hint}</span>}
            </li>
          ))}
          {!showRecent && (
            <li className="srch-menu-foot" role="presentation">
              Enter to search · Tab to complete · Esc to close
            </li>
          )}
        </ul>
      )}
    </form>
  );
}
