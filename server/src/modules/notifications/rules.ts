/**
 * Pure notification rules. No database access here so every rule can be unit-tested directly.
 */

export const NOTIFICATION_KINDS = [
  'mention', 'dm', 'thread_reply', 'reaction', 'keyword', 'channel_broadcast',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** all: every message in your conversations + reactions. mentions: DMs, mentions, broadcasts, followed threads, keywords. nothing: none. */
export type Level = 'all' | 'mentions' | 'nothing';
/** Per-conversation override; 'default' inherits the user's global level. */
export type ConversationLevel = Level | 'default';

/** When a recipient matches several kinds, the first allowed one in this order is used. */
export const KIND_PRIORITY: NotificationKind[] = ['dm', 'mention', 'channel_broadcast', 'thread_reply', 'keyword', 'reaction'];

const ALLOWED: Record<Level, Set<NotificationKind>> = {
  all: new Set(NOTIFICATION_KINDS),
  mentions: new Set<NotificationKind>(['dm', 'mention', 'channel_broadcast', 'thread_reply', 'keyword']),
  nothing: new Set<NotificationKind>(),
};

export function levelAllows(level: Level, kind: NotificationKind): boolean {
  return ALLOWED[level].has(kind);
}

/** Resolve the effective level: a conversation override wins unless it is 'default'. */
export function effectiveLevel(global: Level, conversation: ConversationLevel): Level {
  return conversation === 'default' ? global : conversation;
}

export interface ParsedMentions {
  /** <@U…> user mentions. */
  users: Set<string>;
  /** <!channel> or <!everyone>: every conversation member. */
  channel: boolean;
  /** <!here>: only members who are active right now. */
  here: boolean;
}

export function parseMentions(text: string): ParsedMentions {
  const users = new Set<string>();
  for (const m of text.matchAll(/<@([A-Za-z0-9]+)>/g)) users.add(m[1]);
  return {
    users,
    channel: /<!(channel|everyone)>/.test(text),
    here: /<!here>/.test(text),
  };
}

/** Message text with markup removed and lower-cased, for keyword matching. */
export function plainText(text: string): string {
  return text.replace(/<[^>]*>/g, ' ').toLowerCase();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);

/** Keywords match whole words (letters/digits boundaries), case-insensitively. */
export function matchKeywords(text: string, keywords: string[]): boolean {
  const plain = plainText(text);
  return keywords.some((kw) => {
    const k = kw.trim().toLowerCase();
    if (!k) return false;
    const word = '[^\\p{L}\\p{N}]';
    return new RegExp(`(^|${word})${escapeRe(k)}($|${word})`, 'u').test(plain);
  });
}

const tzFormatters = new Map<string, Intl.DateTimeFormat>();

/** Minutes since local midnight in the given IANA zone (UTC if the zone is unknown). */
export function localMinutes(now: number, timeZone: string): number {
  let fmt = tzFormatters.get(timeZone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    } catch {
      fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    }
    tzFormatters.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(new Date(now));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Daily window [start, end). When end <= start the window wraps past midnight (22:00 to 08:00). */
export function inDailyWindow(minute: number, start: string, end: string): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  return s < e ? minute >= s && minute < e : minute >= s || minute < e;
}

export interface DndPrefs {
  dnd_enabled: number;
  dnd_start: string;
  dnd_end: string;
  snooze_until: number | null;
}

/** Do-not-disturb: manual snooze or the daily schedule (evaluated in the user's timezone). */
export function isSilenced(p: DndPrefs, timeZone: string, now: number): boolean {
  if (p.snooze_until != null && p.snooze_until > now) return true;
  if (!p.dnd_enabled) return false;
  return inDailyWindow(localMinutes(now, timeZone), p.dnd_start, p.dnd_end);
}
