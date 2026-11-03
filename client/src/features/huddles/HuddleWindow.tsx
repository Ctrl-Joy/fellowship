import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { User } from '../../types';
import { Avatar } from '../../components/Avatar';
import { useSession, displayName } from '../../store/session';
import { useConversations, conversationTitle } from '../../store/conversations';
import { useUi } from '../../store/ui';
import { useHuddles, type CallState, type HuddleParticipant, type RemotePeer } from './store';
import { dismissNotice, leaveHuddle, selectCam, selectMic, toggleCamera, toggleMute, toggleScreen } from './call';
import { listDevices, type DeviceLists } from './media';
import { HIcon, type HuddleIconName } from './icons';
import './huddles.css';

export interface HuddleWindowProps {
  workspaceId: string;
  currentUser: User;
}

/** Floating / docked / expanded window for the huddle you're in. Always mounted in the shell. */
export default function HuddleWindow({ workspaceId, currentUser }: HuddleWindowProps) {
  const call = useHuddles((s) => s.call);
  const error = useHuddles((s) => s.error);
  if (!call) {
    return error ? (
      <div className="huddle-toast" role="alert">
        <span>{error}</span>
        <button className="icon-btn" aria-label="Dismiss" onClick={() => useHuddles.setState({ error: null })}><HIcon name="x" size={14} /></button>
      </div>
    ) : null;
  }
  return <LiveWindow key={call.huddleId} call={call} workspaceId={workspaceId} currentUser={currentUser} />;
}

function LiveWindow({ call, workspaceId, currentUser }: { call: CallState; workspaceId: string; currentUser: User }) {
  const huddle = useHuddles((s) => s.byConversation[call.conversationId]);
  const mode = useHuddles((s) => s.mode);
  const setMode = useHuddles((s) => s.setMode);
  const conv = useConversations((s) => s.byId[call.conversationId]);
  const members = useSession((s) => s.members);
  const navigate = useNavigate();
  const [devicesOpen, setDevicesOpen] = useState(false);
  const pos = useDrag(mode === 'floating');

  const title = conv ? conversationTitle(conv, members, currentUser) : 'Huddle';
  const prefix = conv?.kind === 'channel' ? '#' : '';
  const participants: HuddleParticipant[] = huddle?.participants ?? [{ userId: currentUser.id, joinedAt: Date.now(), muted: call.muted, video: call.video, screen: call.screen }];

  // Who is sharing? Prefer a remote share; fall back to my own preview.
  const share = useMemo(() => {
    for (const p of Object.values(call.peers)) {
      const s = p.screenStreamId ? p.streams[p.screenStreamId] : undefined;
      if (s && s.getVideoTracks().some((t) => t.readyState === 'live')) return { userId: p.userId, stream: s, mine: false };
    }
    if (call.screenStream) return { userId: currentUser.id, stream: call.screenStream, mine: true };
    return null;
  }, [call.peers, call.screenStream, currentUser.id]);

  const openThread = () => {
    if (!huddle?.messageId) return;
    navigate(`/w/${workspaceId}/c/${call.conversationId}`);
    setTimeout(() => useUi.getState().openRightPanel({ kind: 'thread', conversationId: call.conversationId, rootId: huddle.messageId! }), 0);
  };

  const audioEls = Object.values(call.peers).map((p) => <PeerAudio key={p.userId} peer={p} />);
  const elapsed = <Elapsed since={huddle?.startedAt ?? Date.now()} />;

  if (mode === 'docked') {
    return (
      <section className="huddle-dock" aria-label="Huddle">
        {audioEls}
        <button className="huddle-dock-title" onClick={() => setMode('floating')} title="Open huddle window">
          <span className="huddle-live-dot" aria-hidden="true" />
          <span className="huddle-dock-name">{prefix}{title}</span>
          {elapsed}
        </button>
        <div className="huddle-dock-people">
          {participants.slice(0, 5).map((p) => (
            <span key={p.userId} className={`huddle-dock-avatar${call.speaking[p.userId] ? ' speaking' : ''}`} title={displayName(members[p.userId])}>
              <Avatar userId={p.userId} size={22} />
            </span>
          ))}
          {participants.length > 5 && <span className="huddle-more">+{participants.length - 5}</span>}
        </div>
        <Controls call={call} compact onDevices={() => { setMode('floating'); setDevicesOpen(true); }} onThread={openThread} />
      </section>
    );
  }

  return (
    <section className={`huddle-win huddle-${mode}`} style={mode === 'floating' ? pos.style : undefined} aria-label="Huddle">
      {audioEls}
      <header className="huddle-head" onPointerDown={mode === 'floating' ? pos.onPointerDown : undefined}>
        <span className="huddle-live-dot" aria-hidden="true" />
        <span className="huddle-title" title={`${prefix}${title}`}>{prefix}{title}</span>
        {elapsed}
        <span className="huddle-head-spacer" />
        <button className="icon-btn" title={mode === 'expanded' ? 'Shrink' : 'Expand'} aria-label={mode === 'expanded' ? 'Shrink' : 'Expand'}
          onClick={() => setMode(mode === 'expanded' ? 'floating' : 'expanded')}>
          <HIcon name={mode === 'expanded' ? 'collapse' : 'expand'} size={15} />
        </button>
        <button className="icon-btn" title="Dock to corner" aria-label="Dock to corner" onClick={() => setMode('docked')}>
          <HIcon name="dock" size={15} />
        </button>
      </header>

      {call.notice && (
        <div className="huddle-notice" role="status">
          <span>{call.notice}</span>
          <button className="icon-btn" aria-label="Dismiss" onClick={dismissNotice}><HIcon name="x" size={13} /></button>
        </div>
      )}

      {share && (
        <div className="huddle-stage">
          <VideoEl stream={share.stream} muted className="huddle-stage-video" />
          <span className="huddle-stage-label">
            {share.mine ? 'You are sharing your screen' : `${displayName(members[share.userId])} is sharing`}
          </span>
        </div>
      )}

      <div className={`huddle-tiles n${Math.min(participants.length, 8)}${share ? ' with-stage' : ''}`}>
        {participants.map((p) => (
          <Tile key={p.userId} participant={p} self={p.userId === currentUser.id} call={call}
            peer={call.peers[p.userId]} name={displayName(members[p.userId])} />
        ))}
      </div>

      <Controls call={call} onDevices={() => setDevicesOpen((v) => !v)} onThread={openThread} devicesOpen={devicesOpen} />
      {devicesOpen && <DevicePicker call={call} onClose={() => setDevicesOpen(false)} />}
    </section>
  );
}

function Controls({ call, compact, onDevices, onThread, devicesOpen }: {
  call: CallState; compact?: boolean; onDevices(): void; onThread(): void; devicesOpen?: boolean;
}) {
  const btn = (icon: HuddleIconName, label: string, onClick: () => void, cls = '', pressed?: boolean) => (
    <button className={`huddle-ctl ${cls}`} title={label} aria-label={label} aria-pressed={pressed} onClick={onClick}>
      <HIcon name={icon} size={compact ? 16 : 18} />
    </button>
  );
  const micLabel = call.listenOnly ? 'Microphone unavailable — try again' : call.muted ? 'Unmute' : 'Mute';
  return (
    <div className={`huddle-controls${compact ? ' compact' : ''}`}>
      {btn(call.muted || call.listenOnly ? 'micOff' : 'mic', micLabel, toggleMute, call.muted || call.listenOnly ? 'off' : '', call.muted)}
      {!compact && btn(call.video ? 'video' : 'videoOff', call.video ? 'Turn camera off' : 'Turn camera on', toggleCamera, call.video ? 'on' : '', call.video)}
      {!compact && btn(call.screen ? 'screenOff' : 'screen', call.screen ? 'Stop sharing' : 'Share your screen', toggleScreen, call.screen ? 'on' : '', call.screen)}
      {!compact && btn('gear', 'Devices', onDevices, devicesOpen ? 'on' : '', devicesOpen)}
      {btn('thread', 'Open huddle thread', onThread)}
      {btn('leave', 'Leave huddle', () => { leaveHuddle(); }, 'leave')}
    </div>
  );
}

function Tile({ participant, self, call, peer, name }: {
  participant: HuddleParticipant; self: boolean; call: CallState; peer?: RemotePeer; name: string;
}) {
  const camStream = self ? call.cameraStream : cameraStreamOf(peer);
  const showVideo = (self ? call.video : participant.video) && !!camStream && camStream.getVideoTracks().length > 0;
  const muted = self ? call.muted || call.listenOnly : participant.muted;
  const speaking = !!call.speaking[participant.userId] && !muted;
  const connecting = !self && (!peer || (peer.state !== 'connected'));
  return (
    <div className={`huddle-tile${speaking ? ' speaking' : ''}${showVideo ? ' has-video' : ''}`}>
      {showVideo
        ? <VideoEl stream={camStream!} muted className={`huddle-tile-video${self ? ' mirror' : ''}`} />
        : <Avatar userId={participant.userId} size={52} />}
      <div className="huddle-tile-name">
        {muted && <HIcon name="micOff" size={12} className="huddle-tile-muted" />}
        <span>{self ? `${name} (you)` : name}</span>
        {participant.screen && <HIcon name="screen" size={12} />}
      </div>
      {connecting && <span className="huddle-tile-state">connecting…</span>}
    </div>
  );
}

function cameraStreamOf(peer?: RemotePeer): MediaStream | null {
  if (!peer) return null;
  for (const [id, s] of Object.entries(peer.streams)) {
    if (id === peer.screenStreamId) continue;
    if (s.getVideoTracks().length) return s;
  }
  return null;
}

function VideoEl({ stream, muted, className }: { stream: MediaStream; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) { el.srcObject = stream; el.play().catch(() => {}); }
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

/** Plays a peer's audio (the stream holding their mic track). */
function PeerAudio({ peer }: { peer: RemotePeer }) {
  const ref = useRef<HTMLAudioElement>(null);
  const stream = Object.values(peer.streams).find((s) => s.getAudioTracks().length > 0) ?? null;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) el.play().catch(() => {});
  }, [stream, peer.rev]);
  return <audio ref={ref} autoPlay className="huddle-audio" />;
}

function DevicePicker({ call, onClose }: { call: CallState; onClose(): void }) {
  const [devices, setDevices] = useState<DeviceLists>({ mics: [], cams: [] });
  useEffect(() => {
    const load = () => listDevices().then(setDevices).catch(() => {});
    load();
    navigator.mediaDevices?.addEventListener?.('devicechange', load);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', load);
  }, []);
  const label = (d: MediaDeviceInfo, i: number, kind: string) => d.label || `${kind} ${i + 1}`;
  return (
    <div className="huddle-devices" role="dialog" aria-label="Devices">
      <div className="huddle-devices-head">
        <strong>Devices</strong>
        <button className="icon-btn" aria-label="Close" onClick={onClose}><HIcon name="x" size={13} /></button>
      </div>
      <label>
        <span>Microphone</span>
        <select value={call.micId ?? ''} onChange={(e) => selectMic(e.target.value)} disabled={!devices.mics.length}>
          {!devices.mics.length && <option value="">No microphone found</option>}
          {!call.micId && devices.mics.length > 0 && <option value="">Default</option>}
          {devices.mics.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{label(d, i, 'Microphone')}</option>)}
        </select>
      </label>
      <label>
        <span>Camera</span>
        <select value={call.camId ?? ''} onChange={(e) => selectCam(e.target.value)} disabled={!devices.cams.length}>
          {!devices.cams.length && <option value="">No camera found</option>}
          {!call.camId && devices.cams.length > 0 && <option value="">Default</option>}
          {devices.cams.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{label(d, i, 'Camera')}</option>)}
        </select>
      </label>
      {devices.mics.some((d) => !d.label) && <p className="huddle-devices-hint">Device names appear once you allow access.</p>}
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return <span className="huddle-elapsed">{h ? `${h}:${String(m).padStart(2, '0')}` : m}:{sec}</span>;
}

/** Drag the floating window by its header; remembers the position. */
function useDrag(enabled: boolean) {
  const [xy, setXy] = useState<{ x: number; y: number } | null>(() => {
    try { const v = JSON.parse(localStorage.getItem('fs:huddlePos') ?? 'null'); return v && typeof v.x === 'number' ? v : null; } catch { return null; }
  });
  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!enabled || (e.target as HTMLElement).closest('button')) return;
    const win = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const dx = e.clientX - win.left;
    const dy = e.clientY - win.top;
    const move = (ev: PointerEvent) => {
      const x = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - win.width);
      const y = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 48);
      setXy({ x, y });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setXy((v) => { try { localStorage.setItem('fs:huddlePos', JSON.stringify(v)); } catch { /* ignore */ } return v; });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // Keep a remembered position on-screen if the viewport shrank.
  const style: React.CSSProperties | undefined = xy
    ? { left: Math.min(xy.x, Math.max(0, window.innerWidth - 340)), top: Math.min(xy.y, Math.max(0, window.innerHeight - 120)), right: 'auto', bottom: 'auto' }
    : undefined;
  return { style, onPointerDown };
}
