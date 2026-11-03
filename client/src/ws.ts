import type { Frame } from './types';

type Handler = (payload: any, frame: Frame) => void;
type Status = 'connecting' | 'open' | 'closed';

const handlers = new Map<string, Set<Handler>>();
const statusListeners = new Set<(s: Status) => void>();
let socket: WebSocket | null = null;
let status: Status = 'closed';
let wanted = false;
let attempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
const queue: string[] = [];

function setStatus(s: Status) {
  status = s;
  for (const fn of statusListeners) fn(s);
}

function dispatch(frame: Frame) {
  for (const key of [frame.type, '*']) {
    const set = handlers.get(key);
    if (!set) continue;
    for (const fn of [...set]) {
      try { fn(frame.payload, frame); } catch (err) { console.error('[ws handler]', frame.type, err); }
    }
  }
}

function open() {
  if (!wanted) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  setStatus('connecting');
  const s = new WebSocket(`${proto}://${location.host}/ws`);
  socket = s;
  s.onopen = () => {
    attempts = 0;
    setStatus('open');
    while (queue.length) s.send(queue.shift()!);
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => send('ping', {}), 25_000);
  };
  s.onmessage = (ev) => {
    let frame: Frame;
    try { frame = JSON.parse(ev.data); } catch { return; }
    if (frame && typeof frame.type === 'string') dispatch(frame);
  };
  s.onclose = (ev) => {
    if (socket !== s) return;
    socket = null;
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    setStatus('closed');
    if (!wanted || ev.code === 4401) return;
    const delay = Math.min(30_000, 500 * 2 ** attempts) + Math.random() * 400;
    attempts++;
    reconnectTimer = setTimeout(open, delay);
  };
}

/** Single app-wide socket with auto-reconnect. Frames are `{ type, payload }`. */
export const ws = {
  connect() {
    if (wanted) return;
    wanted = true;
    open();
  },
  disconnect() {
    wanted = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close(1000, 'bye');
    socket = null;
    setStatus('closed');
  },
  /** Subscribe to a frame type ('*' = all). Returns an unsubscribe function. */
  on(type: string, fn: Handler): () => void {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type)!.add(fn);
    return () => { handlers.get(type)?.delete(fn); };
  },
  /** Send a client → server frame (queued while reconnecting, except pings/typing). */
  send(type: string, payload: unknown = {}) {
    const data = JSON.stringify({ type, payload });
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(data);
    else if (type !== 'ping' && type !== 'typing') queue.push(data);
  },
  status: () => status,
  onStatus(fn: (s: Status) => void) {
    statusListeners.add(fn);
    return () => { statusListeners.delete(fn); };
  },
};

export const send = ws.send;
export const on = ws.on;
