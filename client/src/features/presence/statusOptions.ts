/** Custom status presets and expiry options. Expiry is computed in the browser's timezone. */

export type ExpiryKey = '30m' | '1h' | '4h' | 'today' | 'week' | 'never';

export const EXPIRY_OPTIONS: { key: ExpiryKey; label: string }[] = [
  { key: '30m', label: '30 minutes' },
  { key: '1h', label: '1 hour' },
  { key: '4h', label: '4 hours' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'never', label: 'Don’t clear' },
];

export interface StatusPreset {
  emoji: string;
  text: string;
  expiry: ExpiryKey;
}

export const STATUS_PRESETS: StatusPreset[] = [
  { emoji: '📅', text: 'In a meeting', expiry: '1h' },
  { emoji: '🚌', text: 'Commuting', expiry: '1h' },
  { emoji: '🤒', text: 'Out sick', expiry: 'today' },
  { emoji: '🌴', text: 'Vacationing', expiry: 'week' },
  { emoji: '🏠', text: 'Working remotely', expiry: 'today' },
];

/** Epoch ms when a status chosen with `key` should clear, or null for "don't clear". */
export function expiryFor(key: ExpiryKey, now = new Date()): number | null {
  const MIN = 60_000;
  switch (key) {
    case '30m': return now.getTime() + 30 * MIN;
    case '1h': return now.getTime() + 60 * MIN;
    case '4h': return now.getTime() + 240 * MIN;
    case 'today': {
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return end.getTime();
    }
    case 'week': {
      // Weeks end on Sunday night.
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      end.setDate(end.getDate() + ((7 - end.getDay()) % 7));
      return end.getTime();
    }
    case 'never':
      return null;
  }
}

/** Closest expiry option for an existing expiry timestamp (used to pre-fill the editor). */
export function expiryKeyFor(expires: number | null, now = Date.now()): ExpiryKey {
  if (expires == null) return 'never';
  const left = expires - now;
  if (left <= 30 * 60_000) return '30m';
  if (left <= 60 * 60_000) return '1h';
  if (left <= 4 * 60 * 60_000) return '4h';
  const today = new Date(now);
  today.setHours(23, 59, 59, 999);
  return expires <= today.getTime() ? 'today' : 'week';
}

export function formatUntil(ts: number | null): string {
  if (ts == null) return '';
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `until ${time}` : `until ${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}
