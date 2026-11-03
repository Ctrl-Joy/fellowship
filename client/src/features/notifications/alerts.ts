import { isViewing } from '../../store/realtime';
import { playChime } from './sound';
import { deviceSettings } from './settings';
import { describeNotification, channelLabel, previewText } from './describe';
import type { NotificationItem } from './store';

export const BASE_TITLE = 'Fellowship';

/** Browser-tab title with the unread count, e.g. "(3) Fellowship". */
export function titleFor(unread: number): string {
  return unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${BASE_TITLE}` : BASE_TITLE;
}

/** Route change without a reload: react-router listens for popstate. */
function navigateInApp(url: string) {
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
}

/**
 * Sound and desktop alerts for a new notification. Never on page load, and never for
 * silenced (do-not-disturb) notifications or the conversation you are looking at.
 */
export function alertFor(n: NotificationItem, actorName: string) {
  if (n.silenced) return;
  if (n.conversationId && isViewing(n.conversationId)) return;
  if (deviceSettings.soundOn()) playChime();
  const desktopAllowed = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  if (!deviceSettings.desktopOn() || !desktopAllowed) return;
  if (!document.hidden && document.hasFocus()) return;
  const body = `${describeNotification(n, actorName, channelLabel(n))}\n${previewText(n.text)}`;
  try {
    const note = new Notification(BASE_TITLE, { body, tag: n.id, silent: true });
    note.onclick = () => {
      window.focus();
      note.close();
      if (n.conversationId) {
        navigateInApp(`/w/${n.workspaceId}/c/${n.conversationId}`);
      }
    };
  } catch {
    /* some browsers only allow notifications from a service worker: skip quietly */
  }
}
