/**
 * Recent searches, per workspace, kept in this browser only (a per-viewer convenience).
 * Every storage access is guarded: private windows and blocked storage just mean no history.
 */
const MAX = 8;
const keyFor = (workspaceId: string) => `fs:recent-search:${workspaceId}`;

export function recentSearches(workspaceId: string): string[] {
  try {
    const raw = localStorage.getItem(keyFor(workspaceId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberSearch(workspaceId: string, query: string): void {
  const q = query.trim();
  if (!q) return;
  try {
    const next = [q, ...recentSearches(workspaceId).filter((x) => x !== q)].slice(0, MAX);
    localStorage.setItem(keyFor(workspaceId), JSON.stringify(next));
  } catch {
    /* storage unavailable: skip history */
  }
}

export function forgetSearches(workspaceId: string): void {
  try {
    localStorage.removeItem(keyFor(workspaceId));
  } catch {
    /* storage unavailable */
  }
}
