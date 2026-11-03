import type { FeatureSetup } from '../types';
import { ws } from '../../ws';
import { useSession, displayName } from '../../store/session';
import { useNotifications, refreshUnread, type NotificationItem } from './store';
import { alertFor, BASE_TITLE, titleFor } from './alerts';

/**
 * Per-workspace notification wiring: live notification.created frames, the unread count, the
 * browser-tab title and desktop/sound alerts.
 */
const setup: FeatureSetup = ({ workspaceId, me }) => {
  useNotifications.getState().reset(workspaceId);
  void refreshUnread(workspaceId);
  document.title = titleFor(useNotifications.getState().unread);

  const offCreated = ws.on('notification.created', (p: { notification: NotificationItem }, frame) => {
    if (frame.workspaceId && frame.workspaceId !== workspaceId) return;
    const n = p?.notification;
    if (!n || n.actorId === me.id) return;
    useNotifications.getState().receive(n);
    const actor = displayName(useSession.getState().members[n.actorId ?? '']);
    alertFor(n, actor);
  });
  // Opening a conversation marks its notifications read on the server; re-read the count.
  const offRead = ws.on('conversation.read', (_p, frame) => {
    if (!frame.workspaceId || frame.workspaceId === workspaceId) void refreshUnread(workspaceId);
  });
  const offHello = ws.on('hello', () => { void refreshUnread(workspaceId); });

  const unsubTitle = useNotifications.subscribe((s, prev) => {
    if (s.unread !== prev.unread) document.title = titleFor(s.unread);
  });

  return () => {
    offCreated();
    offRead();
    offHello();
    unsubTitle();
    document.title = BASE_TITLE;
  };
};

export default setup;
