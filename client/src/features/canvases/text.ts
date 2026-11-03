// Text helpers: single-range diffs, 3-way merge for rebasing, caret transforms.

export interface Change { start: number; endOld: number; insert: string }

/** The single contiguous replacement turning `a` into `b` (common prefix/suffix trimmed). */
export function diffRange(a: string, b: string): Change {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a[start] === b[start]) start++;
  let ea = a.length, eb = b.length;
  while (ea > start && eb > start && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  return { start, endOld: ea, insert: b.slice(start, eb) };
}

/**
 * Three-way merge of two edits made to the same `base` text. Edits to disjoint regions are both
 * kept; overlapping edits return `conflict: true` and keep `mine` (the person typing right now).
 */
export function merge3(base: string, mine: string, theirs: string): { text: string; conflict: boolean } {
  if (mine === theirs || theirs === base) return { text: mine, conflict: false };
  if (mine === base) return { text: theirs, conflict: false };
  const m = diffRange(base, mine);
  const t = diffRange(base, theirs);
  if (m.endOld <= t.start) {
    return { text: base.slice(0, m.start) + m.insert + base.slice(m.endOld, t.start) + t.insert + base.slice(t.endOld), conflict: false };
  }
  if (t.endOld <= m.start) {
    return { text: base.slice(0, t.start) + t.insert + base.slice(t.endOld, m.start) + m.insert + base.slice(m.endOld), conflict: false };
  }
  return { text: mine, conflict: true };
}

/** Where a caret at `offset` in the old text lands after the old text became the new one. */
export function transformCaret(oldText: string, newText: string, offset: number): number {
  const c = diffRange(oldText, newText);
  if (offset <= c.start) return offset;
  if (offset >= c.endOld) return offset + (c.insert.length - (c.endOld - c.start));
  return c.start + c.insert.length;
}

export function randomId(prefix = 'B'): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZabcdefghijkmnpqrstuvwxyz';
  return prefix + Array.from(a, (n) => chars[n % chars.length]).join('');
}
