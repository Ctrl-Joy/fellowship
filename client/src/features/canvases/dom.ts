// contentEditable <-> model text. The model is plain text where user mentions use the shared
// wire format `<@USERID>`; in the DOM a mention is an atomic, non-editable chip.

const MENTION_RE = /<@([A-Z0-9]+)>/g;

export type NameOf = (userId: string) => string;

/** Replace the element's children with the rendering of `text`. */
export function renderText(el: HTMLElement, text: string, nameOf: NameOf) {
  const nodes: Node[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    if (m.index! > last) nodes.push(document.createTextNode(text.slice(last, m.index)));
    const chip = document.createElement('span');
    chip.className = 'cv-mention';
    chip.contentEditable = 'false';
    chip.dataset.uid = m[1];
    chip.textContent = `@${nameOf(m[1])}`;
    nodes.push(chip);
    last = m.index! + m[0].length;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  // pre-wrap does not show a trailing newline without something after it.
  if (text.endsWith('\n')) {
    const br = document.createElement('br');
    br.dataset.sentinel = '1';
    nodes.push(br);
  }
  el.replaceChildren(...nodes);
}

function serializeNode(node: Node, out: string[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push((node.nodeValue ?? '').replace(/ /g, ' ').replace(/​/g, ''));
    return;
  }
  if (!(node instanceof HTMLElement)) {
    node.childNodes.forEach((c) => serializeNode(c, out));
    return;
  }
  if (node.dataset.uid) { out.push(`<@${node.dataset.uid}>`); return; }
  if (node.tagName === 'BR') { if (!node.dataset.sentinel) out.push('\n'); return; }
  const isBlock = node.tagName === 'DIV' || node.tagName === 'P';
  if (isBlock && out.length && !out[out.length - 1].endsWith('\n')) out.push('\n');
  node.childNodes.forEach((c) => serializeNode(c, out));
}

/** Model text currently shown in the element. */
export function readText(el: Node): string {
  const out: string[] = [];
  el.childNodes.forEach((c) => serializeNode(c, out));
  return out.join('');
}

/** Caret (collapsed selection focus) as a model offset, or null when the caret is elsewhere. */
export function getCaret(el: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.focusNode || !el.contains(sel.focusNode)) return null;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(sel.focusNode, sel.focusOffset);
  const frag = r.cloneContents();
  return readText(frag).length;
}

/** Model offsets of the current selection [start, end] inside el, or null. */
export function getSelectionRange(el: HTMLElement): [number, number] | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = readText(pre.cloneContents()).length;
  const end = start + readText(range.cloneContents()).length;
  return [start, end];
}

/** Put the caret at a model offset ('end' = after the last character). */
export function setCaret(el: HTMLElement, offset: number | 'end') {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  let remaining = offset === 'end' ? Number.MAX_SAFE_INTEGER : offset;
  let placed = false;
  for (let i = 0; i < el.childNodes.length && !placed; i++) {
    const n = el.childNodes[i];
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n.nodeValue ?? '').length;
      if (remaining <= len) { range.setStart(n, remaining); placed = true; } else remaining -= len;
    } else if (n instanceof HTMLElement) {
      const len = n.dataset.uid ? `<@${n.dataset.uid}>`.length : n.tagName === 'BR' && !n.dataset.sentinel ? 1 : readText(n).length;
      if (remaining <= 0) { range.setStart(el, i); placed = true; } else if (remaining < len) { range.setStart(el, i + 1); placed = true; } else remaining -= len;
    }
  }
  if (!placed) {
    const lastNode = el.lastChild;
    if (lastNode instanceof HTMLElement && lastNode.dataset.sentinel) range.setStart(el, el.childNodes.length - 1);
    else range.setStart(el, el.childNodes.length);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function caretRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0).cloneRange();
  r.collapse(true);
  const rects = r.getClientRects();
  if (rects.length) return rects[0];
  return null;
}

/** Is the caret on the first (or last) visual line of el? Used for arrow-key navigation. */
export function caretOnEdgeLine(el: HTMLElement, edge: 'first' | 'last'): boolean {
  const text = readText(el);
  const caret = getCaret(el);
  if (caret === null) return false;
  if (!text) return true;
  if (edge === 'first' && caret === 0) return true;
  if (edge === 'last' && caret === text.length) return true;
  const rect = caretRect();
  if (!rect) return edge === 'first' ? caret === 0 : caret === text.length;
  const box = el.getBoundingClientRect();
  const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
  return edge === 'first' ? rect.top - box.top < line * 0.75 : box.bottom - rect.bottom < line * 0.75;
}
