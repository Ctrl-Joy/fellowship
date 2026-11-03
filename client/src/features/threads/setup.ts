import type { FeatureSetup } from '../types';
import { ws } from '../../ws';
import { useThreads } from './store';
import { refreshThreadList } from './api';
import './threads.css';

/**
 * Per workspace: load the followed-threads list, then keep it live. `thread.updated` is sent to
 * each follower with their own unread count, so the badge and the list update without reloads.
 */
const setup: FeatureSetup = ({ workspaceId }) => {
  useThreads.getState().reset();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const refresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; refreshThreadList(workspaceId).catch(() => {}); }, 250);
  };

  refresh();

  const offUpdated = ws.on('thread.updated', (p, frame) => {
    if (frame.workspaceId && frame.workspaceId !== workspaceId) return;
    if (!p?.rootId) return;
    useThreads.getState().applyUpdate(p);
    refresh();
  });
  const offHello = ws.on('hello', refresh);

  return () => {
    offUpdated();
    offHello();
    if (timer) clearTimeout(timer);
  };
};

export default setup;
