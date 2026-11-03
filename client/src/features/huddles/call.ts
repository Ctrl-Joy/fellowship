/**
 * Huddle call controller: REST (join/leave/media state), the WebRTC mesh engine, local media
 * (mic / camera / screen), speaking detection and chimes. UI components call these functions and
 * read `useHuddles`.
 */
import { api, ApiError } from '../../api';
import { ws } from '../../ws';
import { useHuddles, type Huddle } from './store';
import { MeshEngine, type SignalData } from './engine';
import { chime, describeMediaError, SpeakingDetector } from './media';

let engine: MeshEngine | null = null;
let detector: SpeakingDetector | null = null;
let selfId: string | null = null;
/** Signals that arrive between the join request and the engine existing (replayed after). */
let early: { huddleId: string; from: string; data: SignalData }[] = [];

const MIC_KEY = 'fs:huddleMic';
const CAM_KEY = 'fs:huddleCam';
const pref = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const savePref = (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* ignore */ } };

export function currentEngine() { return engine; }

function st() { return useHuddles.getState(); }

function micConstraints(deviceId: string | null): MediaTrackConstraints {
  return { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) };
}

async function getMic(deviceId: string | null): Promise<MediaStreamTrack> {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no media'), { name: 'NotSupportedError' });
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId) });
    return s.getAudioTracks()[0];
  } catch (err: any) {
    // A remembered device may be gone: fall back to the default one.
    if (deviceId && (err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError')) {
      savePref(MIC_KEY, null);
      const s = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(null) });
      return s.getAudioTracks()[0];
    }
    throw err;
  }
}

async function getCam(deviceId: string | null): Promise<MediaStreamTrack> {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no media'), { name: 'NotSupportedError' });
  const video: MediaTrackConstraints = { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) };
  try {
    return (await navigator.mediaDevices.getUserMedia({ video })).getVideoTracks()[0];
  } catch (err: any) {
    if (deviceId && (err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError')) {
      savePref(CAM_KEY, null);
      return (await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 } } })).getVideoTracks()[0];
    }
    throw err;
  }
}

function sendSignal(to: string, data: SignalData) {
  const call = st().call;
  if (!call) return;
  ws.send('huddle.signal', { huddleId: call.huddleId, to, data });
}

async function pushMedia(p: { muted?: boolean; video?: boolean; screen?: boolean }) {
  const call = st().call;
  if (!call) return;
  try {
    const r = await api.patch<{ huddle: Huddle }>(`/api/conversations/${call.conversationId}/huddle/me`, p);
    st().upsertHuddle(r.huddle);
  } catch { /* the next huddle.updated will resync */ }
}

/** Join (or start) the conversation's huddle. */
export async function joinHuddle(conversationId: string, me: string) {
  const s = st();
  if (s.call?.conversationId === conversationId) return;
  if (s.joining) return;
  if (s.call) await leaveHuddle();
  selfId = me;
  useHuddles.setState({ joining: conversationId, error: null });
  early = [];

  // Ask for the mic first so the permission prompt happens before we appear in the huddle.
  let mic: MediaStreamTrack | null = null;
  let notice: string | null = null;
  const micId = pref(MIC_KEY);
  try {
    mic = await getMic(micId);
  } catch (err) {
    notice = `${describeMediaError(err, 'microphone')} You joined listen-only.`;
  }

  let huddle: Huddle;
  try {
    huddle = (await api.post<{ huddle: Huddle }>(`/api/conversations/${conversationId}/huddle/join`, { muted: !mic })).huddle;
  } catch (err) {
    mic?.stop();
    const msg = err instanceof ApiError ? err.message : 'Could not join the huddle';
    useHuddles.setState({ joining: null, error: msg });
    early = [];
    return;
  }

  st().upsertHuddle(huddle);
  detector = new SpeakingDetector((key, on) => st().setSpeaking(key, on));
  engine = new MeshEngine(me, {
    send: sendSignal,
    onPeer: (userId, snap) => {
      st().patchPeer(userId, snap);
      // Watch the stream that carries the peer's audio.
      const audio = Object.values(snap.streams).find((x) => x.getAudioTracks().length > 0) ?? null;
      detector?.watch(userId, audio);
    },
    onPeerRemoved: (userId) => { detector?.unwatch(userId); st().removePeer(userId); },
  });
  st().setCall({
    huddleId: huddle.id, conversationId, status: 'live', listenOnly: !mic, notice,
    muted: !mic, video: false, screen: false,
    localStream: engine.localStream, cameraStream: null, screenStream: null,
    peers: {}, speaking: {}, micId: mic?.getSettings().deviceId ?? micId, camId: pref(CAM_KEY),
  });
  useHuddles.setState({ joining: null });
  if (mic) {
    await engine.setMic(mic);
    detector.watch(me, engine.localStream);
  }
  ws.send('huddle.attach', { huddleId: huddle.id });
  for (const p of huddle.participants) if (p.userId !== me) engine.ensurePeer(p.userId);
  for (const sig of early.splice(0)) if (sig.huddleId === huddle.id) engine.handleSignal(sig.from, sig.data);
  chime('join');
}

/** Leave the huddle and release every device. */
export async function leaveHuddle(opts: { silent?: boolean; skipServer?: boolean } = {}) {
  const call = st().call;
  if (!call) return;
  teardown();
  if (!opts.silent) chime('leave');
  if (!opts.skipServer) {
    try {
      const r = await api.post<{ huddle: Huddle | null }>(`/api/conversations/${call.conversationId}/huddle/leave`, {});
      if (r.huddle) st().upsertHuddle(r.huddle);
    } catch { /* server will drop us after the grace period */ }
  }
}

function teardown() {
  engine?.close();
  engine = null;
  detector?.stop();
  detector = null;
  const call = st().call;
  call?.cameraStream?.getTracks().forEach((t) => t.stop());
  call?.screenStream?.getTracks().forEach((t) => t.stop());
  st().setCall(null);
  if (st().mode === 'expanded') st().setMode('floating');
}

/** Best effort leave when the tab is closing (the server's grace timer covers the rest). */
export function leaveOnUnload() {
  const call = st().call;
  if (!call) return;
  try {
    navigator.sendBeacon?.(`/api/conversations/${call.conversationId}/huddle/leave`, new Blob(['{}'], { type: 'application/json' }));
  } catch { /* ignore */ }
  teardown();
}

export async function toggleMute() {
  const call = st().call;
  if (!call || !engine) return;
  if (call.listenOnly) {
    // Try again to get a mic (the user may have just granted permission).
    try {
      const mic = await getMic(call.micId);
      await engine.setMic(mic);
      detector?.watch(selfId!, engine.localStream);
      st().patchCall({ listenOnly: false, muted: false, notice: null, micId: mic.getSettings().deviceId ?? call.micId });
      pushMedia({ muted: false });
    } catch (err) {
      st().patchCall({ notice: `${describeMediaError(err, 'microphone')} You're listen-only.` });
    }
    return;
  }
  const muted = !call.muted;
  for (const t of engine.localStream.getAudioTracks()) t.enabled = !muted;
  if (muted) st().setSpeaking(selfId!, false);
  st().patchCall({ muted });
  pushMedia({ muted });
}

export async function toggleCamera() {
  const call = st().call;
  if (!call || !engine) return;
  if (call.video) {
    await engine.setCamera(null);
    st().patchCall({ video: false, cameraStream: null });
    pushMedia({ video: false });
    return;
  }
  try {
    const track = await getCam(call.camId);
    if (!st().call || !engine) { track.stop(); return; }
    track.addEventListener('ended', () => { if (st().call?.video) toggleCamera(); });
    await engine.setCamera(track);
    st().patchCall({ video: true, cameraStream: new MediaStream([track]), camId: track.getSettings().deviceId ?? call.camId, notice: null });
    pushMedia({ video: true });
  } catch (err) {
    st().patchCall({ notice: describeMediaError(err, 'camera') });
  }
}

export async function toggleScreen() {
  const call = st().call;
  if (!call || !engine) return;
  if (call.screen) return stopScreen();
  if (!navigator.mediaDevices?.getDisplayMedia) {
    st().patchCall({ notice: 'Screen sharing is not supported in this browser.' });
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
    const track = stream.getVideoTracks()[0];
    if (!st().call || !engine) { track.stop(); return; }
    try { (track as any).contentHint = 'detail'; } catch { /* ignore */ }
    // The browser's own "Stop sharing" button ends the track.
    track.addEventListener('ended', () => { if (st().call?.screenStream === stream) stopScreen(); });
    engine.setScreen(track, stream);
    st().patchCall({ screen: true, screenStream: stream, notice: null });
    pushMedia({ screen: true });
  } catch (err) {
    if ((err as any)?.name !== 'NotAllowedError') st().patchCall({ notice: describeMediaError(err, 'screen') });
  }
}

function stopScreen() {
  const call = st().call;
  if (!call || !engine) return;
  engine.setScreen(null, null);
  call.screenStream?.getTracks().forEach((t) => t.stop());
  st().patchCall({ screen: false, screenStream: null });
  pushMedia({ screen: false });
}

export async function selectMic(deviceId: string) {
  savePref(MIC_KEY, deviceId);
  const call = st().call;
  if (!call || !engine) return;
  try {
    const mic = await getMic(deviceId);
    mic.enabled = !call.muted;
    await engine.setMic(mic);
    detector?.watch(selfId!, engine.localStream);
    const wasListenOnly = call.listenOnly;
    st().patchCall({ micId: deviceId, listenOnly: false, notice: null, ...(wasListenOnly ? { muted: false } : {}) });
    if (wasListenOnly) { mic.enabled = true; pushMedia({ muted: false }); }
  } catch (err) {
    st().patchCall({ notice: describeMediaError(err, 'microphone') });
  }
}

export async function selectCam(deviceId: string) {
  savePref(CAM_KEY, deviceId);
  const call = st().call;
  if (!call || !engine) return;
  st().patchCall({ camId: deviceId });
  if (!call.video) return;
  try {
    const track = await getCam(deviceId);
    track.addEventListener('ended', () => { if (st().call?.video) toggleCamera(); });
    await engine.setCamera(track);
    st().patchCall({ cameraStream: new MediaStream([track]) });
  } catch (err) {
    st().patchCall({ notice: describeMediaError(err, 'camera') });
  }
}

export function dismissNotice() { st().patchCall({ notice: null }); }

// ---- server events ----

/** Apply a huddle.started/updated/ended payload to the store and the mesh. */
export function applyHuddleEvent(type: string, huddle: Huddle, change: any) {
  const s = st();
  if (type === 'huddle.ended') s.removeHuddle(huddle.conversationId, huddle.id);
  else s.upsertHuddle(huddle);

  const call = s.call;
  if (!call || call.huddleId !== huddle.id) return;
  if (type === 'huddle.ended' || !huddle.participants.some((p) => p.userId === selfId)) {
    // Ended, or we were dropped server-side (e.g. disconnected too long / left the channel).
    teardown();
    chime('leave');
    return;
  }
  if (!engine) return;
  const present = new Set(huddle.participants.map((p) => p.userId));
  for (const id of engine.peerIds()) if (!present.has(id)) engine.removePeer(id);
  if (change?.type === 'joined' && change.userId !== selfId) {
    // New (or re-joined) participant: start fresh; perfect negotiation sorts out who offers.
    engine.resetPeer(change.userId);
    chime('join');
  } else if (change?.type === 'left' && change.userId !== selfId) {
    chime('leave');
  }
  for (const id of present) if (id !== selfId) engine.ensurePeer(id);
}

export function applySignal(payload: { huddleId: string; from: string; data: SignalData }) {
  const call = st().call;
  if (!engine || !call) {
    if (st().joining && payload?.huddleId) early.push(payload);
    return;
  }
  if (payload?.huddleId !== call.huddleId) return;
  engine.handleSignal(payload.from, payload.data);
}

/** After a WS reconnect, re-claim the media socket so we aren't dropped. */
export function reattach() {
  const call = st().call;
  if (call) ws.send('huddle.attach', { huddleId: call.huddleId });
}
