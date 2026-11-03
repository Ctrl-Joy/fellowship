import { randomBytes } from 'node:crypto';

// Crockford base32 — ULID-like ids: <prefix><10 time chars><10 random chars>.
// Lexicographically sortable by creation time (monotonic within one process).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = 0;
let lastRand: number[] = [];

function encodeTime(ms: number): string {
  let out = '';
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

function randomDigits(): number[] {
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => b % 32);
}

function increment(digits: number[]): number[] {
  const d = digits.slice();
  for (let i = d.length - 1; i >= 0; i--) {
    if (d[i] < 31) { d[i]++; return d; }
    d[i] = 0;
  }
  return d;
}

export function nextId(prefix = ''): string {
  const now = Date.now();
  if (now <= lastTime) {
    lastRand = increment(lastRand);
  } else {
    lastTime = now;
    lastRand = randomDigits();
  }
  return prefix + encodeTime(lastTime) + lastRand.map((n) => ALPHABET[n]).join('');
}

export const ids = { next: nextId };
export type Ids = typeof ids;

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
