/**
 * WebRTC full mesh for one huddle. One RTCPeerConnection per remote participant, negotiated with
 * the "perfect negotiation" pattern: the peer with the greater user id is polite (rolls back on
 * offer collision), the other is impolite (ignores the colliding offer), so simultaneous joins and
 * simultaneous track changes never glare.
 *
 * Signals travel over the app WebSocket (`huddle.signal`), and each carries `sid`, a random id of
 * this browser session: when a peer reloads and rejoins, its new sid tells us to rebuild the
 * connection instead of feeding a fresh offer to a stale one.
 */

export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export interface SignalData {
  sid: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
  meta?: { screen: string | null };
}

export interface PeerSnapshot {
  streams: Record<string, MediaStream>;
  screenStreamId: string | null;
  state: RTCPeerConnectionState | 'new';
}

export interface EngineCallbacks {
  send(to: string, data: SignalData): void;
  onPeer(userId: string, snap: PeerSnapshot): void;
  onPeerRemoved(userId: string): void;
}

interface Peer {
  userId: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  remoteSid: string | null;
  senders: { mic?: RTCRtpSender; cam?: RTCRtpSender; screen?: RTCRtpSender };
  streams: Record<string, MediaStream>;
  screenStreamId: string | null;
  pendingCandidates: RTCIceCandidateInit[];
}

export class MeshEngine {
  readonly sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
  /** Mic + camera tracks share this stream so remote sides see them together. */
  readonly localStream = new MediaStream();
  private screenStream: MediaStream | null = null;
  private mic: MediaStreamTrack | null = null;
  private cam: MediaStreamTrack | null = null;
  private screen: MediaStreamTrack | null = null;
  private peers = new Map<string, Peer>();
  private closed = false;

  constructor(private selfId: string, private cb: EngineCallbacks) {}

  peerIds() { return [...this.peers.keys()]; }

  /** Create (or return) the connection to a participant and attach our current tracks. */
  ensurePeer(userId: string): Peer {
    let p = this.peers.get(userId);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    p = {
      userId, pc, polite: this.selfId > userId, makingOffer: false, ignoreOffer: false, remoteSid: null,
      senders: {}, streams: {}, screenStreamId: null, pendingCandidates: [],
    };
    const peer = p;
    this.peers.set(userId, peer);

    pc.onnegotiationneeded = async () => {
      if (this.peers.get(userId) !== peer) return;
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) this.cb.send(userId, { sid: this.sid, description: pc.localDescription.toJSON() });
      } catch (err) {
        console.warn('[huddle] negotiation failed', err);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = (ev) => {
      if (this.peers.get(userId) !== peer) return;
      this.cb.send(userId, { sid: this.sid, candidate: ev.candidate ? ev.candidate.toJSON() : null });
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      peer.streams[stream.id] = stream;
      const update = () => {
        if (stream.getTracks().length === 0) delete peer.streams[stream.id];
        this.emitPeer(peer);
      };
      stream.onremovetrack = update;
      ev.track.onended = update;
      ev.track.onmute = update;
      ev.track.onunmute = update;
      this.emitPeer(peer);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
      this.emitPeer(peer);
    };

    if (this.mic) peer.senders.mic = pc.addTrack(this.mic, this.localStream);
    // Listen-only: still negotiate so we receive audio (a later addTrack reuses this transceiver).
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    if (this.cam) peer.senders.cam = pc.addTrack(this.cam, this.localStream);
    if (this.screen && this.screenStream) {
      peer.senders.screen = pc.addTrack(this.screen, this.screenStream);
      this.cb.send(userId, { sid: this.sid, meta: { screen: this.screenStream.id } });
    }
    this.emitPeer(peer);
    return peer;
  }

  /** Tear down and rebuild the connection to a participant (they rejoined). */
  resetPeer(userId: string) {
    this.dropPeer(userId, false);
    return this.ensurePeer(userId);
  }

  removePeer(userId: string) { this.dropPeer(userId, true); }

  private dropPeer(userId: string, notify: boolean) {
    const p = this.peers.get(userId);
    if (!p) return;
    this.peers.delete(userId);
    p.pc.onnegotiationneeded = null;
    p.pc.onicecandidate = null;
    p.pc.ontrack = null;
    p.pc.onconnectionstatechange = null;
    p.pc.close();
    if (notify) this.cb.onPeerRemoved(userId);
  }

  async handleSignal(from: string, data: SignalData) {
    if (this.closed || !data || typeof data.sid !== 'string') return;
    let peer = this.peers.get(from) ?? this.ensurePeer(from);
    if (peer.remoteSid && peer.remoteSid !== data.sid) peer = this.resetPeer(from);
    peer.remoteSid = data.sid;
    const pc = peer.pc;

    if (data.meta) {
      peer.screenStreamId = data.meta.screen;
      this.emitPeer(peer);
      return;
    }

    try {
      if (data.description) {
        const description = data.description;
        const offerCollision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(description); // implicit rollback when polite
        for (const c of peer.pendingCandidates.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          if (pc.localDescription) this.cb.send(from, { sid: this.sid, description: pc.localDescription.toJSON() });
        }
      } else if (data.candidate !== undefined) {
        if (!pc.remoteDescription) {
          if (data.candidate) peer.pendingCandidates.push(data.candidate);
          return;
        }
        try {
          await pc.addIceCandidate(data.candidate ?? undefined);
        } catch (err) {
          if (!peer.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.warn('[huddle] signal handling failed', err);
    }
  }

  /** Set/replace/remove the microphone track on every connection. */
  async setMic(track: MediaStreamTrack | null) {
    const old = this.mic;
    if (old) this.localStream.removeTrack(old);
    this.mic = track;
    if (track) this.localStream.addTrack(track);
    for (const p of this.peers.values()) {
      if (track && p.senders.mic) await p.senders.mic.replaceTrack(track).catch(() => {});
      else if (track) p.senders.mic = p.pc.addTrack(track, this.localStream);
      else if (p.senders.mic) { p.pc.removeTrack(p.senders.mic); delete p.senders.mic; }
    }
    if (old && old !== track) old.stop();
  }

  /** Camera on (add track → renegotiate), device switch (replaceTrack) or off (removeTrack). */
  async setCamera(track: MediaStreamTrack | null) {
    const old = this.cam;
    if (old) this.localStream.removeTrack(old);
    this.cam = track;
    if (track) this.localStream.addTrack(track);
    for (const p of this.peers.values()) {
      if (track && p.senders.cam) await p.senders.cam.replaceTrack(track).catch(() => {});
      else if (track) p.senders.cam = p.pc.addTrack(track, this.localStream);
      else if (p.senders.cam) { p.pc.removeTrack(p.senders.cam); delete p.senders.cam; }
    }
    if (old && old !== track) old.stop();
  }

  /** Screen share goes out as an extra track in its own stream, announced via `meta`. */
  setScreen(track: MediaStreamTrack | null, stream: MediaStream | null) {
    const old = this.screen;
    this.screen = track;
    this.screenStream = track ? stream : null;
    for (const p of this.peers.values()) {
      if (track && stream) {
        this.cb.send(p.userId, { sid: this.sid, meta: { screen: stream.id } });
        if (p.senders.screen) p.senders.screen.replaceTrack(track).catch(() => {});
        else p.senders.screen = p.pc.addTrack(track, stream);
      } else {
        this.cb.send(p.userId, { sid: this.sid, meta: { screen: null } });
        if (p.senders.screen) { p.pc.removeTrack(p.senders.screen); delete p.senders.screen; }
      }
    }
    if (old && old !== track) old.stop();
  }

  close() {
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.dropPeer(id, false);
    for (const t of [this.mic, this.cam, this.screen]) t?.stop();
    this.mic = this.cam = this.screen = null;
  }

  private emitPeer(p: Peer) {
    if (this.peers.get(p.userId) !== p) return;
    this.cb.onPeer(p.userId, { streams: { ...p.streams }, screenStreamId: p.screenStreamId, state: p.pc.connectionState });
  }
}
