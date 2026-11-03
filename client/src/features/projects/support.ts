/** Small helpers shared by the Development, Forms, Docs, For you and Filters views. */

/** Copy text to the clipboard; resolves false when the browser refuses (insecure context, no permission). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** "Mar 4, 2026" for a millisecond timestamp. */
export function fmtDay(ts: number | null | undefined): string {
  if (ts == null) return '—';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Mar 4, 2026, 14:05" for a millisecond timestamp. */
export function fmtDateTime(ts: number | null | undefined): string {
  if (ts == null) return '—';
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Absolute URL of a path in this app, e.g. the public hook or form link. */
export const absoluteUrl = (path: string) => `${window.location.origin}${path}`;
