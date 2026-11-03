/**
 * Realtime huddle behaviour over real WebSockets: signalling relay (offer/answer/ICE) between two
 * users, relay restrictions, and auto-leave / auto-end on disconnect with a reconnect grace period.
 * (A real two-browser media test is not possible headlessly; this drives the protocol instead.)
 */
process.env.HUDDLE_GRACE_MS = '300';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { makeTestApp, signup, type TestClient } from './helpers';

let env: Awaited<ReturnType<typeof makeTestApp>>;
let base: string;
let ava: TestClient, ben: TestClient, cleo: TestClient;
let wid: string, generalId: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Sock {
  ws: WebSocket;
  frames: any[];
  /** Frames other than hello/pong, as received. */
  seen(): any[];
  next(pred: (f: any) => boolean, timeout?: number): Promise<any>;
  send(type: string, payload: any): void;
  close(): Promise<void>;
}

async function connect(c: TestClient): Promise<Sock> {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { cookie: c.cookie } });
  const frames: any[] = [];
  const waiters: { pred: (f: any) => boolean; resolve: (f: any) => void; from: number }[] = [];
  ws.on('message', (raw) => {
    const f = JSON.parse(String(raw));
    frames.push(f);
    for (const w of [...waiters]) {
      if (w.pred(f)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(f); }
    }
  });
  const sock: Sock = {
    ws, frames,
    seen: () => frames.filter((f) => f.type !== 'hello' && f.type !== 'pong'),
    next(pred, timeout = 2000) {
      const found = frames.find((f) => !(f as any).__consumed && pred(f));
      if (found) { found.__consumed = true; return Promise.resolve(found); }
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timed out waiting for frame')), timeout);
        waiters.push({ pred, from: frames.length, resolve: (f) => { clearTimeout(t); f.__consumed = true; resolve(f); } });
      });
    },
    send(type, payload) { ws.send(JSON.stringify({ type, payload })); },
    close() {
      return new Promise((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.once('close', () => resolve());
        ws.close();
      });
    },
  };
  await sock.next((f) => f.type === 'hello');
  return sock;
}

/** Round-trip a ping so every frame sent before it has been processed and delivered. */
async function flush(...socks: Sock[]) {
  for (const s of socks) {
    const before = s.frames.filter((f) => f.type === 'pong').length;
    s.send('ping', {});
    await s.next((f) => f.type === 'pong' && s.frames.filter((x) => x.type === 'pong').length > before);
  }
}

const types = (s: Sock, from = 0) => s.seen().slice(from).map((f) => f.type);
const signals = (s: Sock) => s.frames.filter((f) => f.type === 'huddle.signal');

before(async () => {
  env = await makeTestApp();
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = env.app.server.address() as any;
  base = `http://127.0.0.1:${addr.port}`;
  ava = await signup(env.app, 'Ava Wire');
  ben = await signup(env.app, 'Ben Wire');
  cleo = await signup(env.app, 'Cleo Wire');
  const w = (await ava.post('/api/workspaces', { name: 'Wire Co' })).body.workspace;
  wid = w.id;
  await ben.post(`/api/workspaces/join/${w.inviteCode}`);
  await cleo.post(`/api/workspaces/join/${w.inviteCode}`);
  generalId = (await ava.get(`/api/w/${wid}/conversations`)).body.conversations.find((c: any) => c.name === 'general').id;
});

after(async () => { await env.cleanup(); });

describe('signalling relay', () => {
  test('two users: join → offer/answer/ICE relay → leave, every frame asserted', async () => {
    const a = await connect(ava);
    const b = await connect(ben);
    const c = await connect(cleo); // conversation member, not in the huddle

    // Ava starts the huddle.
    const h = (await ava.post(`/api/conversations/${generalId}/huddle/join`)).body.huddle;
    await a.next((f) => f.type === 'huddle.started');
    a.send('huddle.attach', { huddleId: h.id });
    assert.deepEqual((await a.next((f) => f.type.startsWith('huddle.attach'))).payload, { huddleId: h.id });

    // Ben joins and attaches.
    await ben.post(`/api/conversations/${generalId}/huddle/join`);
    await b.next((f) => f.type === 'huddle.updated');
    b.send('huddle.attach', { huddleId: h.id });
    assert.equal((await b.next((f) => f.type.startsWith('huddle.attach'))).type, 'huddle.attached');

    // Offer (impolite peer = lower id offers first, but either works), answer, ICE both ways.
    const offer = { sid: 'b1', description: { type: 'offer', sdp: 'v=0 fake-offer' } };
    b.send('huddle.signal', { huddleId: h.id, to: ava.user.id, data: offer });
    const gotOffer = await a.next((f) => f.type === 'huddle.signal');
    assert.deepEqual(gotOffer.payload, { huddleId: h.id, from: ben.user.id, data: offer });

    const answer = { sid: 'a1', description: { type: 'answer', sdp: 'v=0 fake-answer' } };
    a.send('huddle.signal', { huddleId: h.id, to: ben.user.id, data: answer });
    assert.deepEqual((await b.next((f) => f.type === 'huddle.signal')).payload, { huddleId: h.id, from: ava.user.id, data: answer });

    const iceA = { sid: 'a1', candidate: { candidate: 'candidate:1 1 udp 2122260223 10.0.0.1 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 } };
    const iceB = { sid: 'b1', candidate: { candidate: 'candidate:2 1 udp 2122260223 10.0.0.2 50001 typ host', sdpMid: '0', sdpMLineIndex: 0 } };
    a.send('huddle.signal', { huddleId: h.id, to: ben.user.id, data: iceA });
    b.send('huddle.signal', { huddleId: h.id, to: ava.user.id, data: iceB });
    assert.deepEqual((await b.next((f) => f.type === 'huddle.signal')).payload.data, iceA);
    assert.deepEqual((await a.next((f) => f.type === 'huddle.signal')).payload.data, iceB);

    // Rejected relays: outsider sender, outsider recipient, self, malformed, unknown huddle.
    c.send('huddle.signal', { huddleId: h.id, to: ava.user.id, data: { sid: 'x' } });
    assert.equal((await c.next((f) => f.type === 'huddle.signal_error')).payload.reason, 'sender_not_participant');
    b.send('huddle.signal', { huddleId: h.id, to: cleo.user.id, data: { sid: 'x' } });
    assert.equal((await b.next((f) => f.type === 'huddle.signal_error')).payload.reason, 'recipient_not_participant');
    b.send('huddle.signal', { huddleId: h.id, to: ben.user.id, data: { sid: 'x' } });
    assert.equal((await b.next((f) => f.type === 'huddle.signal_error')).payload.reason, 'invalid');
    b.send('huddle.signal', { huddleId: h.id, to: ava.user.id, data: 'nope' });
    assert.equal((await b.next((f) => f.type === 'huddle.signal_error')).payload.reason, 'invalid');
    b.send('huddle.signal', { huddleId: 'Hnope', to: ava.user.id, data: { sid: 'x' } });
    assert.equal((await b.next((f) => f.type === 'huddle.signal_error')).payload.reason, 'sender_not_participant');
    c.send('huddle.attach', { huddleId: h.id });
    assert.equal((await c.next((f) => f.type.startsWith('huddle.attach'))).type, 'huddle.attach_error');

    // Ben leaves; further signals to him are refused.
    await ben.post(`/api/conversations/${generalId}/huddle/leave`);
    const left = await a.next((f) => f.type === 'huddle.updated' && f.payload.change?.type === 'left');
    assert.equal(left.payload.change.userId, ben.user.id);
    a.send('huddle.signal', { huddleId: h.id, to: ben.user.id, data: { sid: 'a1', candidate: null } });
    assert.equal((await a.next((f) => f.type === 'huddle.signal_error')).payload.reason, 'recipient_not_participant');

    // Ava leaves → huddle ends, summary message updated.
    await ava.post(`/api/conversations/${generalId}/huddle/leave`);
    await a.next((f) => f.type === 'huddle.ended');
    await flush(a, b, c);

    // Every frame, in order.
    assert.deepEqual(types(a), [
      'message.created', 'huddle.started', 'huddle.attached',
      'huddle.updated', // ben joined
      'huddle.signal', 'huddle.signal', // offer, ICE from ben
      'huddle.updated', // ben left
      'huddle.signal_error',
      'message.updated', 'huddle.ended',
    ]);
    assert.deepEqual(types(b), [
      'message.created', 'huddle.started', 'huddle.updated', 'huddle.attached',
      'huddle.signal', 'huddle.signal', // answer, ICE from ava
      'huddle.signal_error', 'huddle.signal_error', 'huddle.signal_error', 'huddle.signal_error',
      'huddle.updated', 'message.updated', 'huddle.ended',
    ]);
    assert.deepEqual(types(c), [
      'message.created', 'huddle.started', 'huddle.updated',
      'huddle.signal_error', 'huddle.attach_error',
      'huddle.updated', 'message.updated', 'huddle.ended',
    ]);
    assert.equal(signals(c).length, 0, 'non-participant never receives signals');
    assert.deepEqual(signals(a).map((f) => f.payload.from), [ben.user.id, ben.user.id]);
    assert.deepEqual(signals(b).map((f) => f.payload.from), [ava.user.id, ava.user.id]);

    await Promise.all([a.close(), b.close(), c.close()]);
  });

  test('signals go only to the attached tab when the recipient has several sockets', async () => {
    const a1 = await connect(ava);
    const a2 = await connect(ava);
    const b = await connect(ben);
    const h = (await ava.post(`/api/conversations/${generalId}/huddle/join`)).body.huddle;
    a1.send('huddle.attach', { huddleId: h.id });
    await a1.next((f) => f.type === 'huddle.attached');
    await ben.post(`/api/conversations/${generalId}/huddle/join`);
    b.send('huddle.signal', { huddleId: h.id, to: ava.user.id, data: { sid: 'b', description: { type: 'offer', sdp: 'x' } } });
    await a1.next((f) => f.type === 'huddle.signal');
    await flush(a1, a2, b);
    assert.equal(signals(a1).length, 1);
    assert.equal(signals(a2).length, 0);
    await ben.post(`/api/conversations/${generalId}/huddle/leave`);
    await ava.post(`/api/conversations/${generalId}/huddle/leave`);
    await Promise.all([a1.close(), a2.close(), b.close()]);
  });
});

describe('disconnect handling', () => {
  const participants = async () =>
    ((await ava.get(`/api/conversations/${generalId}/huddle`)).body.huddle?.participants ?? []).map((p: any) => p.userId);

  test('reconnecting within the grace period keeps you in the huddle', async () => {
    const a = await connect(ava);
    let b = await connect(ben);
    const h = (await ava.post(`/api/conversations/${generalId}/huddle/join`)).body.huddle;
    a.send('huddle.attach', { huddleId: h.id });
    await ben.post(`/api/conversations/${generalId}/huddle/join`);
    b.send('huddle.attach', { huddleId: h.id });
    await b.next((f) => f.type === 'huddle.attached');

    await b.close();
    await sleep(80);
    b = await connect(ben);
    b.send('huddle.attach', { huddleId: h.id });
    await b.next((f) => f.type === 'huddle.attached');
    await sleep(500); // past the 300 ms grace
    assert.deepEqual((await participants()).sort(), [ava.user.id, ben.user.id].sort());
    await b.close();
    await a.close();
    await sleep(500);
  });

  test('closing the last socket auto-leaves after the grace period, and the empty huddle ends', async () => {
    assert.deepEqual(await participants(), [], 'previous test cleaned up via disconnect');
    const a = await connect(ava);
    const b = await connect(ben);
    const h = (await ava.post(`/api/conversations/${generalId}/huddle/join`)).body.huddle;
    a.send('huddle.attach', { huddleId: h.id });
    await ben.post(`/api/conversations/${generalId}/huddle/join`);
    b.send('huddle.attach', { huddleId: h.id });
    await b.next((f) => f.type === 'huddle.attached');

    await b.close();
    assert.deepEqual((await participants()).sort(), [ava.user.id, ben.user.id].sort(), 'still there during grace');
    const left = await a.next((f) => f.type === 'huddle.updated' && f.payload.change?.type === 'left', 2000);
    assert.deepEqual(left.payload.change, { type: 'left', userId: ben.user.id, reason: 'disconnected' });
    assert.deepEqual(await participants(), [ava.user.id]);

    const watcher = await connect(cleo);
    await a.close();
    const ended = await watcher.next((f) => f.type === 'huddle.ended', 2000);
    assert.equal(ended.payload.huddle.id, h.id);
    const msg = (await cleo.get(`/api/messages/${h.messageId}`)).body.message;
    assert.match(msg.text, /^Huddle ended · .+ · Ava, Ben$/);
    await watcher.close();
  });

  test('closing the attached tab drops you even if another tab stays open', async () => {
    const aMedia = await connect(ava);
    const aOther = await connect(ava);
    const b = await connect(ben);
    const h = (await ava.post(`/api/conversations/${generalId}/huddle/join`)).body.huddle;
    aMedia.send('huddle.attach', { huddleId: h.id });
    await aMedia.next((f) => f.type === 'huddle.attached');
    await ben.post(`/api/conversations/${generalId}/huddle/join`);
    b.send('huddle.attach', { huddleId: h.id });
    await b.next((f) => f.type === 'huddle.attached');

    await aMedia.close();
    const left = await b.next((f) => f.type === 'huddle.updated' && f.payload.change?.type === 'left', 2000);
    assert.equal(left.payload.change.userId, ava.user.id);
    await ben.post(`/api/conversations/${generalId}/huddle/leave`);
    await Promise.all([aOther.close(), b.close()]);
  });

  test('a participant who never connects a socket is dropped after the grace period', async () => {
    const watcher = await connect(cleo);
    await ava.post(`/api/conversations/${generalId}/huddle/join`);
    const ended = await watcher.next((f) => f.type === 'huddle.ended', 2000);
    assert.ok(ended.payload.huddle.endedAt);
    await watcher.close();
  });
});
