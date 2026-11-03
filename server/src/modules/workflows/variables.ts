// Variables ({{trigger.user}}, {{steps.s1.field}}, {{vars.x}}, {{now}}), conditions and
// step-tree navigation helpers. Pure functions — unit-tested directly.
import type { BranchConfig, Condition, Cursor, RunContext, Step } from './types';
import { CONTAINER_TYPES } from './types';

export const VAR_RE = /\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g;

/** Resolve a dotted path against the run context. Unknown → undefined. */
export function resolvePath(ctx: RunContext, path: string, now: number): any {
  if (path === 'now') return new Date(now).toISOString();
  const parts = path.split('.');
  let cur: any;
  const head = parts.shift();
  if (head === 'trigger') cur = ctx.trigger;
  else if (head === 'steps') cur = ctx.steps;
  else if (head === 'vars') cur = ctx.vars;
  else return undefined;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(p)) cur = cur[Number(p)];
    else if (typeof cur === 'object') cur = Object.prototype.hasOwnProperty.call(cur, p) ? cur[p] : undefined;
    else return undefined;
  }
  return cur;
}

export const USER_ID_RE = /^U[0-9A-HJKMNP-TV-Z]{20}$/;
export const CONV_ID_RE = /^C[0-9A-HJKMNP-TV-Z]{20}$/;

export interface RenderOpts {
  /** Render user / channel ids as mention tokens (<@U…>, <#C…>) — for message text. */
  mentions?: boolean;
  /** Optional check that an id really is a user / channel (avoids mangling look-alike strings). */
  isUser?(id: string): boolean;
  isChannel?(id: string): boolean;
}

function stringify(v: any, opts: RenderOpts): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => stringify(x, opts)).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  if (opts.mentions) {
    if (USER_ID_RE.test(s) && (!opts.isUser || opts.isUser(s))) return `<@${s}>`;
    if (CONV_ID_RE.test(s) && (!opts.isChannel || opts.isChannel(s))) return `<#${s}>`;
  }
  return s;
}

/** Replace every {{var}} in a template. Unknown variables render as empty strings. */
export function render(template: string, ctx: RunContext, now: number, opts: RenderOpts = {}): string {
  if (typeof template !== 'string') return '';
  return template.replace(VAR_RE, (_m, path) => stringify(resolvePath(ctx, path, now), opts));
}

/**
 * Like render(), but a template that is exactly one variable keeps the raw value
 * (arrays / numbers / objects), e.g. a multi-select or HTTP JSON.
 */
export function renderValue(template: any, ctx: RunContext, now: number): any {
  if (typeof template !== 'string') return template;
  const m = /^\s*\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}\s*$/.exec(template);
  if (m) return resolvePath(ctx, m[1], now);
  return render(template, ctx, now);
}

/** Every variable path referenced by a template string. */
export function referencedVars(template: string): string[] {
  const out: string[] = [];
  if (typeof template !== 'string') return out;
  for (const m of template.matchAll(VAR_RE)) out.push(m[1]);
  return out;
}

// ---------------------------------------------------------------------------- conditions

function isEmpty(v: any) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && !v.trim());
}

function toNum(v: any): number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  if (s === '') return NaN;
  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  const d = Date.parse(s);
  return Number.isNaN(d) ? NaN : d;
}

export function evalCondition(c: Condition, ctx: RunContext, now: number): boolean {
  const left = renderValue(c.left, ctx, now);
  const right = renderValue(c.right ?? '', ctx, now);
  const ls = Array.isArray(left) ? left.map(String) : String(left ?? '');
  const rs = String(right ?? '');
  switch (c.op) {
    case 'is_empty': return isEmpty(left);
    case 'not_empty': return !isEmpty(left);
    case 'equals': return Array.isArray(ls) ? ls.join(', ').toLowerCase() === rs.toLowerCase() : ls.trim().toLowerCase() === rs.trim().toLowerCase();
    case 'not_equals': return !evalCondition({ ...c, op: 'equals' }, ctx, now);
    case 'contains': return Array.isArray(ls)
      ? ls.some((x) => x.toLowerCase() === rs.toLowerCase())
      : ls.toLowerCase().includes(rs.toLowerCase());
    case 'gt': { const a = toNum(left); const b = toNum(right); return !Number.isNaN(a) && !Number.isNaN(b) && a > b; }
    case 'lt': { const a = toNum(left); const b = toNum(right); return !Number.isNaN(a) && !Number.isNaN(b) && a < b; }
    default: return false;
  }
}

export function evalBranch(cfg: BranchConfig, ctx: RunContext, now: number): boolean {
  const groups = cfg.groups ?? [];
  if (!groups.length) return true;
  const results = groups.map((g) => {
    const rs = (g.conditions ?? []).map((c) => evalCondition(c, ctx, now));
    if (!rs.length) return true;
    return g.match === 'any' ? rs.some(Boolean) : rs.every(Boolean);
  });
  return cfg.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

// ---------------------------------------------------------------------------- step tree

/** The step list that the last cursor segment indexes into. */
export function listAt(root: Step[], cursor: Cursor): Step[] {
  let list = root;
  for (let d = 0; d < cursor.length - 1; d++) {
    const step = list[cursor[d].i];
    const arm = cursor[d + 1].arm!;
    list = step?.[arm] ?? [];
  }
  return list;
}

export function stepAt(root: Step[], cursor: Cursor): Step | null {
  if (!cursor.length) return null;
  return listAt(root, cursor)[cursor[cursor.length - 1].i] ?? null;
}

/** Move past the current step (optionally entering one of its arms first). Returns null when done. */
export function advance(root: Step[], cursor: Cursor, enterArm?: 'then' | 'else'): Cursor | null {
  if (enterArm) {
    const step = stepAt(root, cursor);
    if (step && (step[enterArm]?.length ?? 0) > 0) return [...cursor.map((s) => ({ ...s })), { arm: enterArm, i: 0 }];
  }
  const c = cursor.map((s) => ({ ...s }));
  while (c.length) {
    c[c.length - 1].i++;
    if (c[c.length - 1].i < listAt(root, c).length) return c;
    if (c.length === 1) return null;
    c.pop();
  }
  return null;
}

/** Depth-first walk over every step (with its parent chain). */
export function walkSteps(steps: Step[], fn: (step: Step, ancestors: Step[]) => void, ancestors: Step[] = []) {
  for (const s of steps ?? []) {
    fn(s, ancestors);
    if (CONTAINER_TYPES.includes(s.type)) {
      walkSteps(s.then ?? [], fn, [...ancestors, s]);
      walkSteps(s.else ?? [], fn, [...ancestors, s]);
    }
  }
}

/**
 * Ids of the steps whose outputs are guaranteed to exist when `targetId` runs: preceding siblings
 * at every level plus enclosing container steps (their nested arms may not have run).
 */
export function stepsBefore(steps: Step[], targetId: string): string[] | null {
  function search(list: Step[], acc: string[]): string[] | null {
    const seen: string[] = [];
    for (const s of list) {
      if (s.id === targetId) return [...acc, ...seen];
      if (CONTAINER_TYPES.includes(s.type)) {
        for (const arm of ['then', 'else'] as const) {
          const r = search(s[arm] ?? [], [...acc, ...seen, s.id]);
          if (r) return r;
        }
      }
      seen.push(s.id);
    }
    return null;
  }
  return search(steps, []);
}
