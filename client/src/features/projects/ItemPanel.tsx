import { useEffect, useRef } from 'react';
import type { ProjectsViewProps } from './ProjectsRoot';
import { useItemPanel } from './ui';
import { layerOpen } from './kit';
import ItemDetail from './ItemDetail';
import './item.css';

/** Right-side drawer over the projects area showing the open work item. Esc closes it. */
export default function ItemPanel({ workspaceId, currentUser }: ProjectsViewProps) {
  const openId = useItemPanel((s) => s.openItemId);
  const close = useItemPanel((s) => s.closeItem);
  const ref = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // Leaving the projects area closes the panel.
  useEffect(() => () => useItemPanel.getState().closeItem(), []);

  useEffect(() => {
    if (!openId) return;
    if (!returnFocus.current) returnFocus.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || layerOpen()) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, close]);

  useEffect(() => {
    if (openId) return;
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el && document.contains(el)) el.focus({ preventScroll: true });
  }, [openId]);

  if (!openId) return null;
  return (
    <div ref={ref} className="pj-drawer" role="dialog" aria-label="Work item" tabIndex={-1}>
      <ItemDetail key={openId} itemId={openId} workspaceId={workspaceId} currentUser={currentUser} mode="panel" onClose={close} />
    </div>
  );
}
