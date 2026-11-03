import { create } from 'zustand';

export interface HuddleParticipant {
  userId: string;
  joinedAt: number;
  muted: boolean;
  video: boolean;
  screen: boolean;
}

export interface Huddle {
  id: string;
  conversationId: string;
  workspaceId: string;
  startedBy: string;
  startedAt: number;
  endedAt: number | null;
  messageId: string | null;
  participants: HuddleParticipant[];
  everParticipantIds: string[];
}

export type HuddleChange =
  | { type: 'joined'; userId: string }
  | { type: 'left'; userId: string; reason: string }
  | { type: 'media'; userId: string }
  | null;

export interface RemotePeer {
  userId: string;
  /** Remote streams by id (camera/mic stream and, when sharing, a separate screen stream). */
  streams: Record<string, MediaStream>;
  /** Stream id the peer announced as its screen share. */
  screenStreamId: string | null;
  state: RTCPeerConnectionState | 'new';
  /** Bumped whenever tracks change so components re-render. */
  rev: number;
}

export type WindowMode = 'floating' | 'docked' | 'expanded';

/** My live call (null when not in a huddle). */
export interface CallState {
  huddleId: string;
  conversationId: string;
  status: 'joining' | 'live';
  listenOnly: boolean;
  notice: string | null;
  muted: boolean;
  video: boolean;
  screen: boolean;
  localStream: MediaStream | null;
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
  peers: Record<string, RemotePeer>;
  speaking: Record<string, boolean>;
  micId: string | null;
  camId: string | null;
}

interface HuddleStore {
  /** Active huddles in the current workspace, by conversation id. */
  byConversation: Record<string, Huddle>;
  call: CallState | null;
  mode: WindowMode;
  /** Join in progress for this conversation (button spinner). */
  joining: string | null;
  error: string | null;
  setHuddles(list: Huddle[]): void;
  upsertHuddle(h: Huddle): void;
  removeHuddle(conversationId: string, huddleId: string): void;
  setCall(call: CallState | null): void;
  patchCall(p: Partial<CallState>): void;
  patchPeer(userId: string, p: Partial<RemotePeer>): void;
  removePeer(userId: string): void;
  setSpeaking(userId: string, on: boolean): void;
  setMode(m: WindowMode): void;
}

export const useHuddles = create<HuddleStore>()((set) => ({
  byConversation: {},
  call: null,
  mode: 'floating',
  joining: null,
  error: null,
  setHuddles: (list) => set({ byConversation: Object.fromEntries(list.map((h) => [h.conversationId, h])) }),
  upsertHuddle: (h) => set((s) => {
    if (h.endedAt) {
      const next = { ...s.byConversation };
      if (next[h.conversationId]?.id === h.id) delete next[h.conversationId];
      return { byConversation: next };
    }
    return { byConversation: { ...s.byConversation, [h.conversationId]: h } };
  }),
  removeHuddle: (cid, hid) => set((s) => {
    if (s.byConversation[cid]?.id !== hid) return s;
    const next = { ...s.byConversation };
    delete next[cid];
    return { byConversation: next };
  }),
  setCall: (call) => set({ call }),
  patchCall: (p) => set((s) => (s.call ? { call: { ...s.call, ...p } } : s)),
  patchPeer: (userId, p) => set((s) => {
    if (!s.call) return s;
    const prev: RemotePeer = s.call.peers[userId] ?? { userId, streams: {}, screenStreamId: null, state: 'new', rev: 0 };
    return { call: { ...s.call, peers: { ...s.call.peers, [userId]: { ...prev, ...p, rev: prev.rev + 1 } } } };
  }),
  removePeer: (userId) => set((s) => {
    if (!s.call || !s.call.peers[userId]) return s;
    const peers = { ...s.call.peers };
    delete peers[userId];
    const speaking = { ...s.call.speaking };
    delete speaking[userId];
    return { call: { ...s.call, peers, speaking } };
  }),
  setSpeaking: (userId, on) => set((s) => {
    if (!s.call || !!s.call.speaking[userId] === on) return s;
    return { call: { ...s.call, speaking: { ...s.call.speaking, [userId]: on } } };
  }),
  setMode: (mode) => {
    try { localStorage.setItem('fs:huddleMode', mode); } catch { /* ignore */ }
    set({ mode });
  },
}));

try {
  const m = localStorage.getItem('fs:huddleMode');
  if (m === 'floating' || m === 'docked') useHuddles.setState({ mode: m });
} catch { /* ignore */ }

/** Live huddle for a conversation (undefined when none). */
export const useConversationHuddle = (conversationId: string | undefined) =>
  useHuddles((s) => (conversationId ? s.byConversation[conversationId] : undefined));
