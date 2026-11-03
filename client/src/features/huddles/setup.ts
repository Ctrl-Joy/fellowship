import type { FeatureSetup } from '../types';
import { api } from '../../api';
import { ws } from '../../ws';
import { useHuddles, type Huddle } from './store';
import { applyHuddleEvent, applySignal, joinHuddle, leaveHuddle, leaveOnUnload, reattach } from './call';

/** Load active huddles for the workspace and keep them (and the live call) in sync over WS. */
const setup: FeatureSetup = ({ workspaceId, me }) => {
  let alive = true;
  const load = () => api.get<{ huddles: Huddle[] }>(`/api/w/${workspaceId}/huddles`)
    .then((r) => { if (alive) useHuddles.getState().setHuddles(r.huddles); })
    .catch(() => {});
  useHuddles.getState().setHuddles([]);
  load();

  const inWs = (frame: any) => !frame.workspaceId || frame.workspaceId === workspaceId;
  const offs = [
    ...(['huddle.started', 'huddle.updated', 'huddle.ended'] as const).map((type) =>
      ws.on(type, (payload, frame) => { if (inWs(frame) && payload?.huddle) applyHuddleEvent(type, payload.huddle, payload.change); })),
    ws.on('huddle.signal', (payload) => applySignal(payload)),
    ws.on('hello', () => { reattach(); load(); }),
  ];
  window.addEventListener('pagehide', leaveOnUnload);

  // Other features (profile panel, composer) start a huddle by dispatching this event.
  const onStart = (e: Event) => {
    const d = (e as CustomEvent<{ workspaceId?: string; conversationId: string }>).detail;
    if (d?.conversationId && (!d.workspaceId || d.workspaceId === workspaceId)) joinHuddle(d.conversationId, me.id).catch(() => {});
  };
  window.addEventListener('fellowship:start-huddle', onStart);

  return () => {
    alive = false;
    offs.forEach((off) => off());
    window.removeEventListener('pagehide', leaveOnUnload);
    window.removeEventListener('fellowship:start-huddle', onStart);
    // Switching workspace ends your call there.
    if (useHuddles.getState().call) leaveHuddle({ silent: true });
  };
};

export default setup;
