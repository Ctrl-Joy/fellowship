// Small form controls shared by the builder: variable-aware inputs, channel / person pickers.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession, displayName } from '../../store/session';
import { useConversations } from '../../store/conversations';
import type { VarOption } from './model';

export function VarPicker({ vars, onPick }: { vars: VarOption[]; onPick(token: string): void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const filtered = vars.filter((v) => !q || `${v.label} ${v.token} ${v.group}`.toLowerCase().includes(q.toLowerCase()));
  const groups = [...new Set(filtered.map((v) => v.group))];
  return (
    <div className="wf-varpicker" ref={ref}>
      <button type="button" className="wf-var-btn" title="Insert a variable" onClick={() => setOpen((o) => !o)}>{'{x}'}</button>
      {open && (
        <div className="wf-var-menu">
          <input className="input" placeholder="Search variables" value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
          <div className="wf-var-list">
            {groups.length === 0 && <div className="menu-note">No variables available here yet.</div>}
            {groups.map((g) => (
              <div key={g}>
                <div className="wf-var-group">{g}</div>
                {filtered.filter((v) => v.group === g).map((v) => (
                  <button type="button" key={v.token} className="wf-var-item" onClick={() => { onPick(v.token); setOpen(false); setQ(''); }}>
                    <span>{v.label}</span><code>{v.token}</code>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Text input / textarea with a variable picker that inserts at the caret. */
export function VarInput({ value, onChange, vars, multiline, placeholder, rows = 3 }: {
  value: string; onChange(v: string): void; vars: VarOption[]; multiline?: boolean; placeholder?: string; rows?: number;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  function insert(token: string) {
    const el = ref.current;
    const v = value ?? '';
    const start = el?.selectionStart ?? v.length;
    const end = el?.selectionEnd ?? v.length;
    const next = v.slice(0, start) + token + v.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = token.endsWith('.}}') ? start + token.length - 2 : start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }
  return (
    <div className="wf-varinput">
      {multiline
        ? <textarea ref={ref} className="input" rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <input ref={ref} className="input" value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
      <VarPicker vars={vars} onPick={insert} />
    </div>
  );
}

export function ChannelSelect({ value, onChange, allowEmpty = true, placeholder = 'Choose a channel…' }: {
  value: string; onChange(v: string): void; allowEmpty?: boolean; placeholder?: string;
}) {
  const byId = useConversations((s) => s.byId);
  const channels = useMemo(() => Object.values(byId).filter((c) => c.kind === 'channel' && !c.isArchived)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')), [byId]);
  const unknown = value && !value.includes('{{') && !byId[value];
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">{placeholder}</option>}
      {unknown && <option value={value}>(channel you can't see)</option>}
      {channels.map((c) => <option key={c.id} value={c.id}>{c.isPrivate ? '🔒 ' : '# '}{c.name}</option>)}
    </select>
  );
}

export function PersonSelect({ value, onChange }: { value: string; onChange(v: string): void }) {
  const members = useSession((s) => s.members);
  const people = useMemo(() => Object.values(members).filter((m) => !m.deactivated && !m.isBot)
    .sort((a, b) => displayName(a).localeCompare(displayName(b))), [members]);
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a person…</option>
      {people.map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
    </select>
  );
}

/** Channel picker that can also take a variable (e.g. a channel created earlier). */
export function ChannelOrVar({ value, onChange, vars }: { value: string; onChange(v: string): void; vars: VarOption[] }) {
  const isVar = (value ?? '').includes('{{');
  const [mode, setMode] = useState<'pick' | 'var'>(isVar ? 'var' : 'pick');
  return (
    <div className="wf-stack">
      <div className="wf-seg">
        <button type="button" className={mode === 'pick' ? 'active' : ''} onClick={() => { setMode('pick'); if (isVar) onChange(''); }}>Pick a channel</button>
        <button type="button" className={mode === 'var' ? 'active' : ''} onClick={() => setMode('var')}>Use a variable</button>
      </div>
      {mode === 'pick' ? <ChannelSelect value={isVar ? '' : value} onChange={onChange} />
        : <VarInput value={value} onChange={onChange} vars={vars} placeholder="{{steps.channel1.channel}}" />}
    </div>
  );
}
