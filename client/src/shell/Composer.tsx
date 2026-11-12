import { useEffect, useMemo, useRef, useState } from 'react';
import type { Conversation, Member } from '../types';
import { useSession, displayName } from '../store/session';
import { useConversations, conversationTitle } from '../store/conversations';
import { useMessages, isRootLevel } from '../store/messages';
import { sendMessage, joinConversation } from '../store/actions';
import { ws } from '../ws';
import { loadDraft, saveDraft } from '../lib/drafts';
import { encodeMentions, mentionHandle } from '../lib/mentions';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useUpload } from '../features/files/useUpload';
import { useAppCommands, NO_COMMANDS, commandSuggestions, parseKnownCommand } from '../features/apps/commands';
import { runSlashCommand } from '../features/apps/api';

export interface ComposerProps {
  conversation: Conversation;
  workspaceId: string;
  threadRootId?: string | null;
  placeholder?: string;
}

type Suggestion =
  | { kind: 'user'; id: string; label: string; sub: string; insert: string; member: Member }
  | { kind: 'special'; id: string; label: string; sub: string; insert: string }
  | { kind: 'channel'; id: string; label: string; sub: string; insert: string }
  | { kind: 'command'; id: string; label: string; sub: string; insert: string };

interface AcState { sigil: '@' | '#' | '/'; query: string; start: number; index: number }

const TYPING_THROTTLE = 3000;

/** Formatting toolbar: inline marks wrap the selection, line marks prefix each selected line. */
type Format = { icon: string; title: string } & ({ wrap: [string, string] } | { line: (i: number) => string } | { block: true });
const FORMATS: (Format | 'sep')[] = [
  { icon: 'bold', title: 'Bold', wrap: ['*', '*'] },
  { icon: 'italic', title: 'Italic', wrap: ['_', '_'] },
  { icon: 'strike', title: 'Strikethrough', wrap: ['~', '~'] },
  'sep',
  { icon: 'link', title: 'Link', wrap: ['<https://', '|link text>'] },
  'sep',
  { icon: 'listOl', title: 'Numbered list', line: (i) => `${i + 1}. ` },
  { icon: 'listUl', title: 'Bulleted list', line: () => '• ' },
  'sep',
  { icon: 'quote', title: 'Quote', line: () => '> ' },
  { icon: 'code', title: 'Code', wrap: ['`', '`'] },
  { icon: 'codeBlock', title: 'Code block', block: true },
];

function applyFormat(text: string, start: number, end: number, f: Format): { text: string; start: number; end: number } {
  const sel = text.slice(start, end);
  if ('wrap' in f) {
    const [a, b] = f.wrap;
    return { text: text.slice(0, start) + a + sel + b + text.slice(end), start: start + a.length, end: end + a.length };
  }
  if ('block' in f) {
    const inner = `\`\`\`\n${sel}\n\`\`\``;
    return { text: text.slice(0, start) + inner + text.slice(end), start: start + 4, end: start + 4 + sel.length };
  }
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lines = text.slice(lineStart, end).split('\n').map((l, i) => f.line(i) + l);
  const replaced = lines.join('\n');
  return { text: text.slice(0, lineStart) + replaced + text.slice(end), start: lineStart + replaced.length, end: lineStart + replaced.length };
}

function loadToolbarPref(): boolean {
  try {
    const saved = localStorage.getItem('fs:composerToolbar');
    // On phones the formatting row starts hidden so the composer stays compact; the Aa button brings it back.
    if (saved === null) return !window.matchMedia('(max-width: 760px)').matches;
    return saved !== '0';
  } catch { return true; }
}

export function Composer({ conversation, threadRootId = null, placeholder }: ComposerProps) {
  const me = useSession((s) => s.me)!;
  const members = useSession((s) => s.members);
  const conversations = useConversations((s) => s.byId);
  const [text, setText] = useState(() => loadDraft(conversation.id, threadRootId));
  const [alsoSend, setAlsoSend] = useState(false);
  const [ac, setAc] = useState<AcState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolbar, setToolbar] = useState(loadToolbarPref);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const upload = useUpload(conversation.id);
  const commandList = useAppCommands((s) => s.byWorkspace[conversation.workspaceId] ?? NO_COMMANDS);

  // Switch drafts when the conversation/thread changes.
  useEffect(() => {
    setText(loadDraft(conversation.id, threadRootId));
    setAc(null);
    setError(null);
    ref.current?.focus();
  }, [conversation.id, threadRootId]);

  useEffect(() => { saveDraft(conversation.id, threadRootId, text); }, [text, conversation.id, threadRootId]);

  // Auto-grow.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!ac) return [];
    if (ac.sigil === '/') {
      return commandSuggestions(commandList, ac.query).map((c): Suggestion => ({
        kind: 'command', id: c.command, label: `/${c.command}`, sub: c.description || c.usage, insert: `/${c.command} `,
      }));
    }
    const q = ac.query.toLowerCase();
    if (ac.sigil === '@') {
      const users: Suggestion[] = Object.values(members)
        .filter((m) => !m.deactivated)
        .filter((m) => !q || mentionHandle(m).includes(q) || m.fullName.toLowerCase().includes(q))
        .slice(0, 8)
        .map((m) => ({ kind: 'user', id: m.id, label: displayName(m), sub: m.fullName, insert: `@${mentionHandle(m)} `, member: m }));
      const specials: Suggestion[] = conversation.kind === 'channel'
        ? (['here', 'channel', 'everyone'] as const)
            .filter((s) => s.startsWith(q))
            .map((s) => ({ kind: 'special', id: s, label: `@${s}`, sub: s === 'here' ? 'Notify active members' : 'Notify everyone in this channel', insert: `@${s} ` }))
        : [];
      return [...users, ...specials];
    }
    return Object.values(conversations)
      .filter((c) => c.kind === 'channel' && c.name && (!q || c.name.includes(q)))
      .slice(0, 8)
      .map((c) => ({ kind: 'channel', id: c.id, label: `#${c.name}`, sub: c.topic || c.description, insert: `#${c.name} ` }));
  }, [ac, members, conversations, conversation.kind, commandList]);

  function updateAutocomplete(value: string, caret: number) {
    const before = value.slice(0, caret);
    const slash = /^\/([\w-]*)$/.exec(before);
    if (slash) {
      setAc((prev) => ({ sigil: '/', query: slash[1], start: 0, index: prev && prev.sigil === '/' ? prev.index : 0 }));
      return;
    }
    const m = /(^|[\s(])([@#])([\w.-]*)$/.exec(before);
    if (m) setAc((prev) => ({ sigil: m[2] as '@' | '#', query: m[3], start: caret - m[3].length - 1, index: prev && prev.sigil === m[2] ? prev.index : 0 }));
    else setAc(null);
  }

  function pick(s: Suggestion) {
    if (!ac) return;
    const el = ref.current!;
    const caret = el.selectionStart;
    const next = text.slice(0, ac.start) + s.insert + text.slice(caret);
    setText(next);
    setAc(null);
    const pos = ac.start + s.insert.length;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
  }

  function format(f: Format) {
    const el = ref.current!;
    const r = applyFormat(text, el.selectionStart, el.selectionEnd, f);
    setText(r.text);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.start, r.end); });
  }

  /** Insert a trigger character at the caret (opens the matching autocomplete). */
  function insertAtCaret(s: string) {
    const el = ref.current!;
    const pos = el.selectionStart;
    const needsSpace = pos > 0 && !/\s/.test(text[pos - 1]) && s !== '/';
    const ins = (needsSpace ? ' ' : '') + s;
    const next = s === '/' && text.trim() === '' ? '/' : text.slice(0, pos) + ins + text.slice(el.selectionEnd);
    const caret = s === '/' && text.trim() === '' ? 1 : pos + ins.length;
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      updateAutocomplete(next, caret);
    });
  }

  function toggleToolbar() {
    setToolbar((v) => {
      try { localStorage.setItem('fs:composerToolbar', v ? '0' : '1'); } catch { /* ignore */ }
      return !v;
    });
  }

  function notifyTyping() {
    const now = Date.now();
    if (now - lastTyping.current > TYPING_THROTTLE) {
      lastTyping.current = now;
      ws.send('typing', { conversationId: conversation.id, threadRootId });
    }
  }

  async function submit() {
    const raw = text.replace(/\s+$/, '');
    if ((!raw.trim() && upload.fileIds.length === 0) || upload.uploading) return;
    const known = threadRootId ? null : parseKnownCommand(raw, commandList);
    if (known && upload.fileIds.length === 0) {
      setText('');
      setAc(null);
      setError(null);
      try {
        await runSlashCommand(conversation.id, known.name, encodeMentions(known.text, members, Object.values(conversations)));
      } catch (e: any) {
        setText(raw);
        setError(e.message);
      }
      return;
    }
    const encoded = encodeMentions(raw, members, Object.values(conversations));
    const fileIds = upload.fileIds;
    setText('');
    setAc(null);
    upload.clear();
    setError(null);
    lastTyping.current = 0;
    try {
      await sendMessage({ conversationId: conversation.id, text: encoded, threadRootId, alsoSendToChannel: alsoSend, fileIds });
    } catch (e: any) {
      setError(e.message);
    }
  }

  function editLast() {
    const st = useMessages.getState();
    const ids = threadRootId ? st.threads[threadRootId]?.ids : st.channels[conversation.id]?.ids;
    if (!ids) return false;
    for (let i = ids.length - 1; i >= 0; i--) {
      const m = st.byId[ids[i]];
      if (m && m.userId === me.id && !m.deletedAt && !m.pending && !m.id.startsWith('tmp_') && (threadRootId || isRootLevel(m))) {
        st.setEditing(m.id);
        return true;
      }
    }
    return false;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (ac && suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAc({ ...ac, index: (ac.index + 1) % suggestions.length }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAc({ ...ac, index: (ac.index - 1 + suggestions.length) % suggestions.length }); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[Math.min(ac.index, suggestions.length - 1)]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setAc(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'ArrowUp' && !text) {
      if (editLast()) e.preventDefault();
    }
  }

  if (conversation.isArchived) {
    return <div className="composer composer-blocked">This channel is archived. You can read it, but no one can post.</div>;
  }
  if (!conversation.isMember) {
    return (
      <div className="composer composer-blocked">
        <span>You’re previewing <strong>#{conversation.name}</strong>.</span>
        <button className="btn btn-primary" onClick={() => joinConversation(conversation.id)}>Join channel</button>
      </div>
    );
  }

  const title = conversationTitle(conversation, members, me);
  const ph = placeholder ?? (conversation.kind === 'channel' ? `Message #${title}` : `Message ${title}`);

  return (
    <div className="composer"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); upload.upload([...e.dataTransfer.files]); } }}>
      {ac && suggestions.length > 0 && (
        <ul className="autocomplete" role="listbox">
          {suggestions.map((s, i) => (
            <li key={s.kind + s.id} role="option" aria-selected={i === ac.index}
              className={i === ac.index ? 'active' : ''}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setAc({ ...ac, index: i })}>
              {s.kind === 'user' ? <Avatar user={s.member} size={20} /> : <span className="ac-icon">{s.kind === 'channel' ? '#' : s.kind === 'command' ? '/' : '@'}</span>}
              <span className="ac-label">{s.label}</span>
              <span className="ac-sub">{s.sub}</span>
            </li>
          ))}
        </ul>
      )}
      {upload.items.length > 0 && (
        <div className="composer-uploads">
          {upload.items.map((it) => (
            <span key={it.key} className={`upload-chip upload-${it.status}`}>
              {it.name} {it.status === 'uploading' ? `${Math.round(it.progress * 100)}%` : ''}
              <button className="icon-btn" aria-label="Remove" onClick={() => upload.remove(it.key)}><Icon name="x" size={12} /></button>
            </span>
          ))}
        </div>
      )}
      {toolbar && (
        <div className="composer-toolbar" role="toolbar" aria-label="Formatting">
          {FORMATS.map((f, i) => f === 'sep'
            ? <span key={i} className="composer-sep" />
            : <button key={f.icon} className="icon-btn" title={f.title} aria-label={f.title}
                onMouseDown={(e) => e.preventDefault()} onClick={() => format(f)}><Icon name={f.icon} size={17} /></button>)}
        </div>
      )}
      <textarea
        ref={ref}
        className="composer-input"
        value={text}
        rows={1}
        placeholder={ph}
        aria-label={ph}
        onChange={(e) => { setText(e.target.value); updateAutocomplete(e.target.value, e.target.selectionStart); if (e.target.value) notifyTyping(); }}
        onKeyDown={onKeyDown}
        onClick={(e) => updateAutocomplete(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={() => setTimeout(() => setAc(null), 100)}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.length) { e.preventDefault(); upload.upload(files); }
        }}
      />
      <div className="composer-bar">
        <button className="icon-btn composer-plus" title="Attach files" onClick={() => fileRef.current?.click()}><Icon name="plus" size={18} /></button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) upload.upload([...e.target.files]); e.target.value = ''; }} />
        <button className={`icon-btn${toolbar ? ' on' : ''}`} title={toolbar ? 'Hide formatting' : 'Show formatting'} onClick={toggleToolbar}><Icon name="type" size={19} /></button>
        <button className="icon-btn" title="Emoji" onClick={() => insertAtCaret(':')}><Icon name="smile" size={18} /></button>
        <button className="icon-btn" title="Mention someone" onClick={() => insertAtCaret('@')}><Icon name="at" size={18} /></button>
        {!threadRootId && (
          <button className="icon-btn" title="Start a huddle"
            onClick={() => window.dispatchEvent(new CustomEvent('fellowship:start-huddle', { detail: { workspaceId: conversation.workspaceId, conversationId: conversation.id } }))}>
            <Icon name="video" size={18} />
          </button>
        )}
        <span className="composer-sep" />
        <button className="icon-btn" title="Shortcuts and commands" onClick={() => insertAtCaret('/')}><Icon name="slash" size={18} /></button>
        <span className="composer-hint" />
        {threadRootId && conversation.kind === 'channel' && (
          <label className="composer-also">
            <input type="checkbox" checked={alsoSend} onChange={(e) => setAlsoSend(e.target.checked)} /> Also send to #{conversation.name}
          </label>
        )}
        <button className="send-btn" title="Send" disabled={!text.trim() && upload.fileIds.length === 0} onClick={submit}>
          <Icon name="send" size={16} />
        </button>
      </div>
      {error && <div className="composer-error">{error}</div>}
    </div>
  );
}
