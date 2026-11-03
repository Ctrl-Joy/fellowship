import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, signup, type TestClient } from './helpers';

/**
 * Two-user WebSocket checks: thread replies, thread.updated (unread) and reaction events must
 * reach the other user's open socket without a reload. Uses a real listening server.
 */

let env: Awaited<ReturnType<typeof makeTestApp>>;
let ava: TestClient, ben: TestClient;
let wid: string;
let cid: string;
let base: string;

interface Live {
  frames: any[];
  waitFor(pred: (f: any) => boolean, label: string, timeoutMs?: number): Promise<any>;
  close(): void;
}

function connect(cookie: string): Promise<Live> {
  return new Promise((resolve, reject) => {
    const frames: any[] = [];
    const waiters: { pred: (f: any) => boolean; resolve: (f: any) => void; label: string }[] = [];
    const socket = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { cookie } } as any);
    const live: Live = {
      frames,
      waitFor(pred, label, timeoutMs = 3000) {
        const hit = frames.find(pred);
        if (hit) return Promise.resolve(hit);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error(`timed out waiting for ${label}`)), timeoutMs);
          waiters.push({ pred, label, resolve: (f) => { clearTimeout(timer); res(f); } });
        });
      },
      close() { socket.close(); },
    };
    socket.onmessage = (ev) => {
      const frame = JSON.parse(String(ev.data));
      frames.push(frame);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(frame)) {
          const [w] = waiters.splice(i, 1);
          w.resolve(frame);
        }
      }
    };
    socket.onerror = () => reject(new Error('websocket error'));
    socket.onopen = () => resolve(live);
  });
}

before(async () => {
  env = await makeTestApp();
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = env.app.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;

  ava = await signup(env.app, 'Ava Live');
  ben = await signup(env.app, 'Ben Live');
  wid = (await ava.post('/api/workspaces', { name: 'Live WS' })).body.workspace.id;
  const invite = (await ava.get(`/api/w/${wid}`)).body.workspace.inviteCode;
  await ben.post(`/api/workspaces/join/${invite}`);
  cid = (await ava.post(`/api/w/${wid}/channels`, { name: 'live' })).body.conversation.id;
  await ben.post(`/api/conversations/${cid}/join`);
});

after(async () => { await env.cleanup(); });

describe('two users over WebSocket', () => {
  test('a socket with a valid session says hello; a bad cookie is refused', async () => {
    const live = await connect(ava.cookie);
    const hello = await live.waitFor((f) => f.type === 'hello', 'hello');
    assert.equal(hello.payload.userId, ava.user.id);
    live.close();

    const bad = await connect('fs_session=bogus');
    const err = await bad.waitFor((f) => f.type === 'error', 'unauthorized error frame');
    assert.equal(err.payload.code, 'unauthorized');
    assert.ok(!bad.frames.some((f) => f.type === 'hello'));
  });

  test('a reply and its thread update reach the other user live, and unread counts follow', async () => {
    const avaWs = await connect(ava.cookie);
    const benWs = await connect(ben.cookie);
    try {
      await avaWs.waitFor((f) => f.type === 'hello', 'ava hello');
      await benWs.waitFor((f) => f.type === 'hello', 'ben hello');

      const root = (await ava.post(`/api/conversations/${cid}/messages`, { text: 'live root' })).body.message;
      await benWs.waitFor((f) => f.type === 'message.created' && f.payload.message.id === root.id, 'root reaches ben');

      // Ben replies; Ava (root author, now a follower) should get the reply and an unread update.
      const reply = (await ben.post(`/api/conversations/${cid}/messages`, { text: 'live reply', threadRootId: root.id })).body.message;
      const created = await avaWs.waitFor(
        (f) => f.type === 'message.created' && f.payload.message.id === reply.id,
        'reply reaches ava',
      );
      assert.equal(created.payload.message.threadRootId, root.id);

      const updated = await avaWs.waitFor(
        (f) => f.type === 'thread.updated' && f.payload.rootId === root.id && f.payload.unreadCount === 1,
        'thread.updated with unread 1',
      );
      assert.equal(updated.payload.following, true);

      // Ben is not following-by-audience for Ava's own updates; his own reply is not unread.
      const benUpdate = await benWs.waitFor(
        (f) => f.type === 'thread.updated' && f.payload.rootId === root.id,
        'ben thread.updated',
      );
      assert.equal(benUpdate.payload.unreadCount, 0);

      // Ava reads the thread: she gets an update with zero unread, live.
      await ava.post(`/api/threads/${root.id}/read`);
      await avaWs.waitFor(
        (f) => f.type === 'thread.updated' && f.payload.rootId === root.id && f.payload.unreadCount === 0,
        'unread cleared',
      );
    } finally {
      avaWs.close();
      benWs.close();
    }
  });

  test('reaction.added and reaction.removed reach both users live with the enriched reactions', async () => {
    const avaWs = await connect(ava.cookie);
    const benWs = await connect(ben.cookie);
    try {
      await avaWs.waitFor((f) => f.type === 'hello', 'ava hello');
      await benWs.waitFor((f) => f.type === 'hello', 'ben hello');

      const msg = (await ava.post(`/api/conversations/${cid}/messages`, { text: 'react here' })).body.message;
      await benWs.waitFor((f) => f.type === 'message.created' && f.payload.message.id === msg.id, 'ben has msg');

      await ben.post(`/api/messages/${msg.id}/reactions`, { emoji: '🎉' });
      const added = await avaWs.waitFor((f) => f.type === 'reaction.added' && f.payload.messageId === msg.id, 'reaction.added at ava');
      assert.equal(added.payload.emoji, '🎉');
      assert.equal(added.payload.userId, ben.user.id);
      assert.deepEqual(added.payload.reactions, [{ emoji: '🎉', userIds: [ben.user.id] }]);
      await benWs.waitFor((f) => f.type === 'reaction.added' && f.payload.messageId === msg.id, 'reaction.added at ben');

      await ben.del(`/api/messages/${msg.id}/reactions/${encodeURIComponent('🎉')}`);
      const removed = await avaWs.waitFor((f) => f.type === 'reaction.removed' && f.payload.messageId === msg.id, 'reaction.removed at ava');
      assert.deepEqual(removed.payload.reactions, []);
    } finally {
      avaWs.close();
      benWs.close();
    }
  });
});
