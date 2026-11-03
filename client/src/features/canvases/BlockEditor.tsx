import { memo, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import type { Member } from '../../types';
import { Avatar } from '../../components/Avatar';
import { mentionHandle } from '../../lib/mentions';
import { caretOnEdgeLine, getCaret, getSelectionRange, readText, renderText, setCaret, type NameOf } from './dom';
import { transformCaret } from './text';
import { BLOCK_TYPES, type Block, type BlockType } from './types';
import type { CanvasDoc } from './doc';

/** Stable callbacks/data shared by every block (one object per CanvasView). */
export interface EditorCtl {
  doc: CanvasDoc;
  canEdit: boolean;
  nameOf: NameOf;
  members(): Member[];
  register(id: string, el: HTMLElement | null): void;
  focus(id: string, offset: number | 'end'): void;
  prev(id: string): Block | undefined;
  next(id: string): Block | undefined;
  onBlockFocus(id: string | null): void;
}

const LIST_TYPES: BlockType[] = ['bullet', 'numbered', 'todo'];
const SHORTCUTS: [string, BlockType, boolean?][] = [
  ['### ', 'h3'], ['## ', 'h2'], ['# ', 'h1'], ['- ', 'bullet'], ['* ', 'bullet'], ['1. ', 'numbered'],
  ['[] ', 'todo'], ['[ ] ', 'todo'], ['[x] ', 'todo', true], ['> ', 'quote'], ['```', 'code'], ['---', 'divider'],
];
const PLACEHOLDER: Partial<Record<BlockType, string>> = {
  paragraph: "Type '/' for blocks, '@' to mention", h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3',
  bullet: 'List item', numbered: 'List item', todo: 'To-do', quote: 'Quote', code: 'Code', callout: 'Something worth noticing',
};

type Menu =
  | { kind: 'slash'; query: string; index: number }
  | { kind: 'mention'; query: string; start: number; index: number }
  | null;

export interface BlockEditorProps {
  block: Block;
  number: number;
  ctl: EditorCtl;
  editors: string[];
  isFirst: boolean;
}

export const BlockEditor = memo(function BlockEditor({ block, number, ctl, editors, isFirst }: BlockEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const [menu, setMenu] = useState<Menu>(null);
  const [handleMenu, setHandleMenu] = useState(false);
  const { doc, canEdit } = ctl;

  // Keep the DOM in step with the model without disturbing the caret.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const domText = readText(el);
    if (domText === block.text && el.dataset.rendered) return;
    const focused = document.activeElement === el;
    const caret = focused ? getCaret(el) : null;
    renderText(el, block.text, ctl.nameOf);
    el.dataset.rendered = '1';
    if (focused && caret !== null) setCaret(el, transformCaret(domText, block.text, caret));
  }, [block.text, block.type, ctl]);

  const setRef = (el: HTMLDivElement | null) => { ref.current = el; ctl.register(block.id, el); };

  /** Replace [start,end) of the model text, re-render and put the caret after the insert. */
  function replaceRange(start: number, end: number, insert: string) {
    const el = ref.current!;
    const text = readText(el);
    const next = text.slice(0, start) + insert + text.slice(end);
    renderText(el, next, ctl.nameOf);
    setCaret(el, start + insert.length);
    doc.update(block.id, { text: next });
  }

  function changeType(type: BlockType, text?: string, checked?: boolean) {
    const patch: Partial<Block> = { type };
    if (text !== undefined) patch.text = text;
    if (checked !== undefined) patch.checked = checked;
    if (type === 'divider') {
      doc.update(block.id, { ...patch, text: '' });
      const after = ctl.next(block.id);
      if (after && after.type === 'paragraph' && !after.text) ctl.focus(after.id, 0);
      else ctl.focus(doc.insertAfter(block.id, { type: 'paragraph', text: text ?? '' }), 0);
      return;
    }
    doc.update(block.id, patch);
    ctl.focus(block.id, text !== undefined ? 0 : 'end');
  }

  function onInput() {
    const el = ref.current;
    if (!el || composing.current) return;
    let text = readText(el);
    if (!text && el.childNodes.length) el.replaceChildren();
    const caret = getCaret(el) ?? text.length;
    const before = text.slice(0, caret);

    // Markdown-style shortcuts at the start of a plain paragraph.
    if (block.type === 'paragraph') {
      for (const [prefix, type, checked] of SHORTCUTS) {
        if (before === prefix) {
          text = text.slice(prefix.length);
          renderText(el, text, ctl.nameOf);
          setMenu(null);
          changeType(type, text, checked ?? (type === 'todo' ? false : undefined));
          return;
        }
      }
    }
    doc.update(block.id, { text });

    const slash = block.type !== 'code' ? /^\/([a-z0-9]{0,20})$/i.exec(before) : null;
    const mention = block.type !== 'code' ? /(^|\s)@([\w.-]{0,30})$/.exec(before) : null;
    if (slash) setMenu({ kind: 'slash', query: slash[1].toLowerCase(), index: 0 });
    else if (mention) setMenu({ kind: 'mention', query: mention[2].toLowerCase(), start: caret - mention[2].length - 1, index: 0 });
    else if (menu) setMenu(null);
  }

  // ---- menus ----
  const slashItems = menu?.kind === 'slash'
    ? BLOCK_TYPES.filter((t) => !menu.query || t.keys.includes(menu.query) || t.label.toLowerCase().includes(menu.query))
    : [];
  const mentionItems = menu?.kind === 'mention'
    ? ctl.members().filter((m) => !m.deactivated && (mentionHandle(m).includes(menu.query) || m.fullName.toLowerCase().includes(menu.query))).slice(0, 8)
    : [];
  const items = menu?.kind === 'slash' ? slashItems.length : mentionItems.length;

  function pick(index: number) {
    if (!menu) return;
    if (menu.kind === 'slash') {
      const t = slashItems[index];
      setMenu(null);
      if (!t) return;
      const el = ref.current!;
      renderText(el, '', ctl.nameOf);
      changeType(t.type, '', t.type === 'todo' ? false : undefined);
    } else {
      const m = mentionItems[index];
      setMenu(null);
      if (!m) return;
      const el = ref.current!;
      const caret = getCaret(el) ?? readText(el).length;
      replaceRange(menu.start, caret, `<@${m.id}> `);
    }
  }

  // ---- keys ----
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const el = ref.current!;
    if (e.nativeEvent.isComposing) return;
    if (menu && items) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenu({ ...menu, index: (menu.index + 1) % items }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMenu({ ...menu, index: (menu.index - 1 + items) % items }); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(menu.index); return; }
    }
    if (menu && e.key === 'Escape') { e.preventDefault(); setMenu(null); return; }

    const mod = e.metaKey || e.ctrlKey;
    const text = readText(el);
    const range = getSelectionRange(el) ?? [text.length, text.length];
    const [s, t] = range;

    if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveBlock(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.key === 'Enter' && mod) {
      e.preventDefault();
      ctl.focus(doc.insertAfter(block.id, { type: 'paragraph' }), 0);
      return;
    }
    if (e.key === 'Enter' && (e.shiftKey || block.type === 'code')) {
      e.preventDefault();
      replaceRange(s, t, '\n');
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!text && block.type !== 'paragraph') { changeType('paragraph'); return; }
      if (s === 0 && t === 0 && text) {
        const prev = ctl.prev(block.id);
        doc.insertAfter(prev ? prev.id : null, { type: 'paragraph' });
        ctl.focus(block.id, 0);
        return;
      }
      const before = text.slice(0, s);
      const after = text.slice(t);
      renderText(el, before, ctl.nameOf);
      doc.update(block.id, { text: before });
      const type: BlockType = LIST_TYPES.includes(block.type) ? block.type : 'paragraph';
      ctl.focus(doc.insertAfter(block.id, { type, text: after, checked: false }), 0);
      return;
    }
    if (e.key === 'Backspace' && s === 0 && t === 0) {
      e.preventDefault();
      if (block.type !== 'paragraph') { doc.update(block.id, { type: 'paragraph' }); return; }
      const prev = ctl.prev(block.id);
      if (!prev) return;
      if (prev.type === 'divider') { doc.remove(prev.id); return; }
      const joinAt = prev.text.length;
      doc.update(prev.id, { text: prev.text + text });
      doc.remove(block.id);
      ctl.focus(prev.id, joinAt);
      return;
    }
    if (e.key === 'Delete' && s === text.length && t === text.length) {
      const next = ctl.next(block.id);
      if (!next) return;
      e.preventDefault();
      if (next.type === 'divider') { doc.remove(next.id); return; }
      const joinAt = text.length;
      doc.update(block.id, { text: text + next.text });
      doc.remove(next.id);
      ctl.focus(block.id, joinAt);
      return;
    }
    if (e.key === 'ArrowUp' && !e.shiftKey && caretOnEdgeLine(el, 'first')) {
      const prev = ctl.prev(block.id);
      if (prev) { e.preventDefault(); ctl.focus(prev.id, 'end'); }
      return;
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && caretOnEdgeLine(el, 'last')) {
      const next = ctl.next(block.id);
      if (next) { e.preventDefault(); ctl.focus(next.id, 0); }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (block.type === 'code') replaceRange(s, t, '  ');
    }
  }

  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!canEdit) return;
    const el = ref.current!;
    const pasted = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    if (!pasted) return;
    const text = readText(el);
    const [s, t] = getSelectionRange(el) ?? [text.length, text.length];
    const lines = pasted.split('\n');
    if (block.type === 'code' || lines.length === 1) { replaceRange(s, t, pasted); return; }
    const before = text.slice(0, s), after = text.slice(t);
    renderText(el, before + lines[0], ctl.nameOf);
    doc.update(block.id, { text: before + lines[0] });
    let prevId = block.id;
    for (let i = 1; i < lines.length; i++) {
      const last = i === lines.length - 1;
      prevId = doc.insertAfter(prevId, { type: 'paragraph', text: last ? lines[i] + after : lines[i] });
    }
    ctl.focus(prevId, lines[lines.length - 1].length);
  }

  function moveBlock(dir: -1 | 1) {
    if (dir === -1) {
      const prev = ctl.prev(block.id);
      if (!prev) return;
      doc.move(block.id, ctl.prev(prev.id)?.id ?? null);
    } else {
      const next = ctl.next(block.id);
      if (!next) return;
      doc.move(block.id, next.id);
    }
    ctl.focus(block.id, getCaret(ref.current!) ?? 'end');
  }

  const editing = editors.length > 0;
  const cls = `cv-block cv-${block.type}${editing ? ' cv-remote' : ''}${block.type === 'todo' && block.checked ? ' cv-done' : ''}`;

  const handle = canEdit && (
    <div className="cv-handle-wrap">
      <button className="cv-handle" title="Block options" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => setHandleMenu((v) => !v)}>⋮⋮</button>
      {handleMenu && (
        <div className="cv-menu cv-handle-menu" onMouseLeave={() => setHandleMenu(false)}>
          <div className="cv-menu-label">Turn into</div>
          {BLOCK_TYPES.map((t) => (
            <button key={t.type} className={t.type === block.type ? 'active' : ''} onClick={() => { setHandleMenu(false); changeType(t.type, undefined, t.type === 'todo' ? block.checked : undefined); }}>
              <span className="cv-menu-icon">{t.icon}</span>{t.label}
            </button>
          ))}
          <div className="cv-menu-sep" />
          <button onClick={() => { setHandleMenu(false); moveBlock(-1); }} disabled={isFirst}><span className="cv-menu-icon">↑</span>Move up</button>
          <button onClick={() => { setHandleMenu(false); moveBlock(1); }} disabled={!ctl.next(block.id)}><span className="cv-menu-icon">↓</span>Move down</button>
          <button onClick={() => { setHandleMenu(false); ctl.focus(doc.insertAfter(block.id, { type: 'paragraph' }), 0); }}><span className="cv-menu-icon">+</span>Add block below</button>
          <button className="danger" onClick={() => { setHandleMenu(false); const p = ctl.prev(block.id); doc.remove(block.id); if (p) ctl.focus(p.id, 'end'); }}><span className="cv-menu-icon">×</span>Delete</button>
        </div>
      )}
    </div>
  );

  const presence = editing && (
    <div className="cv-editors" title={`${editors.map((u) => ctl.nameOf(u)).join(', ')} editing`}>
      {editors.slice(0, 3).map((u) => <Avatar key={u} userId={u} size={18} />)}
    </div>
  );

  if (block.type === 'divider') {
    return (
      <div className={cls} data-block={block.id}>
        {handle}
        <div className="cv-divider" tabIndex={canEdit ? 0 : -1} ref={(el) => ctl.register(block.id, el)}
          onFocus={() => ctl.onBlockFocus(block.id)}
          onKeyDown={(e) => {
            if (!canEdit) return;
            if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); const p = ctl.prev(block.id); doc.remove(block.id); if (p) ctl.focus(p.id, 'end'); }
            else if (e.key === 'Enter') { e.preventDefault(); ctl.focus(doc.insertAfter(block.id, { type: 'paragraph' }), 0); }
            else if (e.key === 'ArrowUp') { const p = ctl.prev(block.id); if (p) { e.preventDefault(); ctl.focus(p.id, 'end'); } }
            else if (e.key === 'ArrowDown') { const n = ctl.next(block.id); if (n) { e.preventDefault(); ctl.focus(n.id, 0); } }
          }}><hr /></div>
        {presence}
      </div>
    );
  }

  return (
    <div className={cls} data-block={block.id}>
      {handle}
      {block.type === 'bullet' && <span className="cv-marker" aria-hidden="true">•</span>}
      {block.type === 'numbered' && <span className="cv-marker cv-num" aria-hidden="true">{number}.</span>}
      {block.type === 'todo' && (
        <input type="checkbox" className="cv-check" checked={block.checked} disabled={!canEdit}
          aria-label={block.checked ? 'Mark not done' : 'Mark done'}
          onChange={() => doc.update(block.id, { checked: !block.checked })} />
      )}
      {block.type === 'callout' && <span className="cv-marker cv-callout-icon" aria-hidden="true">✦</span>}
      <div
        ref={setRef}
        className="cv-text"
        contentEditable={canEdit}
        suppressContentEditableWarning
        spellCheck={block.type !== 'code'}
        role="textbox"
        aria-multiline="true"
        aria-label={BLOCK_TYPES.find((t) => t.type === block.type)?.label}
        data-placeholder={PLACEHOLDER[block.type] ?? ''}
        onInput={onInput}
        onKeyDown={canEdit ? onKeyDown : undefined}
        onPaste={onPaste}
        onFocus={() => ctl.onBlockFocus(block.id)}
        onBlur={() => setTimeout(() => setMenu(null), 150)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; onInput(); }}
      />
      {presence}
      {menu && items > 0 && (
        <div className="cv-menu cv-popup" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {menu.kind === 'slash' && <div className="cv-menu-label">Turn into</div>}
          {menu.kind === 'slash' && slashItems.map((t, i) => (
            <button key={t.type} role="option" aria-selected={i === menu.index} className={i === menu.index ? 'active' : ''}
              onMouseEnter={() => setMenu({ ...menu, index: i })} onClick={() => pick(i)}>
              <span className="cv-menu-icon">{t.icon}</span>
              <span className="cv-menu-text"><b>{t.label}</b><small>{t.hint}</small></span>
            </button>
          ))}
          {menu.kind === 'mention' && mentionItems.map((m, i) => (
            <button key={m.id} role="option" aria-selected={i === menu.index} className={i === menu.index ? 'active' : ''}
              onMouseEnter={() => setMenu({ ...menu, index: i })} onClick={() => pick(i)}>
              <Avatar user={m} size={20} />
              <span className="cv-menu-text"><b>{m.displayName || m.fullName}</b><small>{m.fullName}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
