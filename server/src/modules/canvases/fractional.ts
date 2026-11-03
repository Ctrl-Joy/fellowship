// Fractional index keys for block ordering. Keys are base-62 "decimal fractions" compared as
// plain strings (byte order), never ending in '0', so a key can always be generated between any
// two distinct keys. Mirrored in client/src/features/canvases/fractional.ts.

export const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const POSITION_RE = /^[0-9A-Za-z]{0,254}[1-9A-Za-z]$/;

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[da] + midpoint(a.slice(1), null);
}

/** A key strictly between a and b (null = open end). Throws if a >= b. */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error(`keyBetween: ${a} >= ${b}`);
  return midpoint(a ?? '', b);
}

/** n ascending keys after `a` (null = from the start). */
export function keysAfter(a: string | null, n: number): string[] {
  const out: string[] = [];
  let prev = a;
  for (let i = 0; i < n; i++) { prev = keyBetween(prev, null); out.push(prev); }
  return out;
}
