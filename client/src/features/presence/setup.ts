import type { FeatureSetup } from '../types';
import { api } from '../../api';
import { ws } from '../../ws';
import { usePresence, type PresenceState } from './store';

/** Send at most one presence.active frame per this interval while the user is active. */
const ACTIVE_THROTTLE_MS = 30_000;
/** No input for this long and we tell the server we are away. */
const IDLE_MS = 5 * 60_000;
const IDLE_CHECK_MS = 15_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'mousemove', 'wheel', 'touchstart', 'focus'] as const;

/**
 * Presence for the current workspace: loads everyone's state, applies presence.changed frames and
 * reports the user's own activity (throttled) and idleness to the server.
 */
const setup: FeatureSetup = ({ workspaceId }) => {
  let alive = true;
  let lastActivity = Date.now();
  let lastSentActive = 0;
  let idleSent = false;

  const load = () => {
    api.get<{ presence: Record<string, PresenceState> }>(`/api/w/${workspaceId}/presence`)
      .then((r) => { if (alive) usePresence.getState().setAll(r.presence); })
      .catch(() => {});
    api.get<{ manualAway: boolean }>('/api/presence/me')
      .then((r) => { if (alive) usePresence.getState().setManualAway(!!r.manualAway); })
      .catch(() => {});
  };

  const sendActive = () => {
    if (ws.status() !== 'open') return;
    lastSentActive = Date.now();
    idleSent = false;
    ws.send('presence.active');
  };

  const onActivity = () => {
    lastActivity = Date.now();
    if (document.visibilityState === 'hidden') return;
    if (idleSent || Date.now() - lastSentActive > ACTIVE_THROTTLE_MS) sendActive();
  };

  const idleTimer = setInterval(() => {
    if (!idleSent && Date.now() - lastActivity > IDLE_MS && ws.status() === 'open') {
      idleSent = true;
      ws.send('presence.away');
    }
  }, IDLE_CHECK_MS);

  for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { passive: true });

  const offChanged = ws.on('presence.changed', (p: { userId: string; presence: PresenceState }, frame) => {
    if (!alive || (frame.workspaceId && frame.workspaceId !== workspaceId)) return;
    usePresence.getState().setOne(p.userId, p.presence);
  });
  const offHello = ws.on('hello', () => {
    load();
    sendActive();
  });

  load();
  if (ws.status() === 'open') sendActive();

  return () => {
    alive = false;
    clearInterval(idleTimer);
    for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity);
    offChanged();
    offHello();
  };
};

export default setup;
