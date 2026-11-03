import type { Db } from '../../db';
import type { Level } from './rules';

export interface PrefRow {
  user_id: string;
  workspace_id: string;
  level: Level;
  keywords: string;
  dnd_enabled: number;
  dnd_start: string;
  dnd_end: string;
  snooze_until: number | null;
  updated_at: number;
}

export const DEFAULT_PREFS = {
  level: 'mentions' as Level,
  keywords: '[]',
  dnd_enabled: 0,
  dnd_start: '22:00',
  dnd_end: '08:00',
  snooze_until: null,
};

export function createPrefsStore(db: Db) {
  const get = db.prepare('SELECT * FROM notification_prefs WHERE user_id = ? AND workspace_id = ?');

  function load(userId: string, workspaceId: string): PrefRow & { keywordList: string[] } {
    const row = (get.get(userId, workspaceId) as unknown as PrefRow | undefined)
      ?? { user_id: userId, workspace_id: workspaceId, ...DEFAULT_PREFS, updated_at: 0 };
    return { ...row, keywordList: parseKeywords(row.keywords) };
  }

  function save(userId: string, workspaceId: string, patch: Partial<Omit<PrefRow, 'user_id' | 'workspace_id' | 'updated_at'>>) {
    const cur = load(userId, workspaceId);
    const next = { ...cur, ...patch, updated_at: Date.now() };
    db.prepare(
      `INSERT INTO notification_prefs (user_id, workspace_id, level, keywords, dnd_enabled, dnd_start, dnd_end, snooze_until, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, workspace_id) DO UPDATE SET level = excluded.level, keywords = excluded.keywords,
         dnd_enabled = excluded.dnd_enabled, dnd_start = excluded.dnd_start, dnd_end = excluded.dnd_end,
         snooze_until = excluded.snooze_until, updated_at = excluded.updated_at`,
    ).run(userId, workspaceId, next.level, next.keywords, next.dnd_enabled, next.dnd_start, next.dnd_end,
      next.snooze_until, next.updated_at);
    return load(userId, workspaceId);
  }

  return { load, save };
}

export type PrefsStore = ReturnType<typeof createPrefsStore>;

export function parseKeywords(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function prefsDto(p: PrefRow & { keywordList: string[] }, now: number) {
  const dnd = { enabled: !!p.dnd_enabled, start: p.dnd_start, end: p.dnd_end };
  return {
    level: p.level,
    keywords: p.keywordList,
    dnd,
    snoozeUntil: p.snooze_until != null && p.snooze_until > now ? p.snooze_until : null,
  };
}
