/** Starred conversations, kept per viewer in localStorage. */
import { useSyncExternalStore } from 'react';

const KEY = 'fs:starred';
const listeners = new Set<() => void>();
let cache: string[] = read();

function read(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

export function toggleStar(conversationId: string) {
  cache = cache.includes(conversationId) ? cache.filter((id) => id !== conversationId) : [...cache, conversationId];
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function useStarred(): string[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => cache);
}
