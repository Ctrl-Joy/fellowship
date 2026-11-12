import { useEffect } from 'react';

/** Close an open menu on a click or tap outside it, or on Escape. Works the same with mouse and touch. */
export function useDismiss(open: boolean, close: () => void, inside = '.menu') {
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (!(e.target as Element | null)?.closest?.(inside)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    // Registered a tick later so the click that opened the menu does not close it again.
    const t = setTimeout(() => document.addEventListener('click', onClick), 0);
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
  }, [open, close, inside]);
}
