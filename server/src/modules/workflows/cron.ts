// Schedule matching: our own 5-field cron parser plus once / daily / weekly helpers.
import type { Schedule } from './types';

interface CronField { values: Set<number>; star: boolean }
export interface CronExpr { minute: CronField; hour: CronField; dom: CronField; month: CronField; dow: CronField }

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function parseValue(raw: string, names: string[] | null, nameBase: number): number {
  const up = raw.toUpperCase();
  if (names) {
    const idx = names.indexOf(up);
    if (idx >= 0) return idx + nameBase;
  }
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid value "${raw}"`);
  return Number(raw);
}

function parseField(src: string, min: number, max: number, names: string[] | null = null, nameBase = 0): CronField {
  const values = new Set<number>();
  let star = false;
  for (const part of src.split(',')) {
    if (!part) throw new Error('Empty list item');
    const [rangePart, stepPart, extra] = part.split('/');
    if (extra !== undefined) throw new Error(`Invalid step in "${part}"`);
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid step in "${part}"`);
    let lo: number; let hi: number;
    if (rangePart === '*') {
      lo = min; hi = max;
      if (stepPart === undefined) star = true;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      lo = parseValue(a, names, nameBase); hi = parseValue(b, names, nameBase);
    } else {
      lo = parseValue(rangePart, names, nameBase);
      hi = stepPart === undefined ? lo : max;
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`Value out of range in "${part}" (${min}-${max})`);
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { values, star };
}

/** Parse "m h dom mon dow". Throws Error with a readable message on invalid input. */
export function parseCron(expr: string): CronExpr {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('A cron expression needs 5 fields: minute hour day-of-month month day-of-week');
  const dow = parseField(parts[4], 0, 7, DAYS, 0);
  if (dow.values.has(7)) { dow.values.delete(7); dow.values.add(0); }
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dom: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12, MONTHS, 1),
    dow,
  };
}

/** Local wall-clock parts for a UTC ms timestamp at a fixed offset (minutes east of UTC). */
export function localParts(ms: number, tzOffset = 0) {
  const d = new Date(ms + tzOffset * 60_000);
  return {
    minute: d.getUTCMinutes(), hour: d.getUTCHours(), dom: d.getUTCDate(),
    month: d.getUTCMonth() + 1, dow: d.getUTCDay(),
  };
}

export function cronMatches(cron: CronExpr, ms: number, tzOffset = 0): boolean {
  const p = localParts(ms, tzOffset);
  if (!cron.minute.values.has(p.minute) || !cron.hour.values.has(p.hour) || !cron.month.values.has(p.month)) return false;
  const domOk = cron.dom.values.has(p.dom);
  const dowOk = cron.dow.values.has(p.dow);
  // Classic cron semantics: if both day fields are restricted, either may match.
  if (!cron.dom.star && !cron.dow.star) return domOk || dowOk;
  return domOk && dowOk;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseTime(time: string): { h: number; m: number } {
  const m = TIME_RE.exec(time ?? '');
  if (!m) throw new Error('Time must be HH:MM (24-hour)');
  return { h: Number(m[1]), m: Number(m[2]) };
}

/** Validate a schedule; returns an error message or null. */
export function scheduleError(s: Schedule | undefined): string | null {
  if (!s) return 'Choose a schedule';
  try {
    switch (s.kind) {
      case 'once': if (!Number.isFinite(s.at) || s.at <= 0) return 'Pick a date and time'; return null;
      case 'daily': parseTime(s.time); return null;
      case 'weekly':
        parseTime(s.time);
        if (!Array.isArray(s.days) || !s.days.length || s.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Pick at least one weekday';
        return null;
      case 'cron': parseCron(s.expr); return null;
      default: return 'Unknown schedule kind';
    }
  } catch (e: any) {
    return e.message;
  }
}

/** Does the recurring schedule fire in the minute that contains `ms`? ('once' handled separately.) */
export function scheduleMatchesMinute(s: Schedule, ms: number, tzOffset = 0): boolean {
  const p = localParts(ms, tzOffset);
  switch (s.kind) {
    case 'daily': { const t = parseTime(s.time); return p.hour === t.h && p.minute === t.m; }
    case 'weekly': { const t = parseTime(s.time); return s.days.includes(p.dow) && p.hour === t.h && p.minute === t.m; }
    case 'cron': return cronMatches(parseCron(s.expr), ms, tzOffset);
    default: return false;
  }
}

/** Next fire time strictly after `from` (minute resolution), searching up to ~1 year. Null if none. */
export function nextFireAt(s: Schedule, from: number, tzOffset = 0): number | null {
  if (s.kind === 'once') return s.at > from ? s.at : null;
  const cron = s.kind === 'cron' ? parseCron(s.expr) : null;
  let minute = Math.floor(from / 60_000) + 1;
  for (let i = 0; i < 366 * 1440; i++, minute++) {
    const ms = minute * 60_000;
    if (cron ? cronMatches(cron, ms, tzOffset) : scheduleMatchesMinute(s, ms, tzOffset)) return ms;
  }
  return null;
}
