import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { makeTestApp, signup, type TestClient } from './helpers';
import { keyBetween, keysAfter } from '../src/modules/canvases/fractional';

let env: Awaited<ReturnType<typeof makeTestApp>>;
let ava: TestClient, ben: TestClient, cleo: TestClient, outsider: TestClient;
let wid: string;
let generalId: string;
let privateId: string;

let seq = 0;
const bid = () => `Btest${Date.now().toString(36)}${(seq++).toString(36).padStart(4, '0')}`;

before(async () => {
  env = await makeTestApp();
  ava = await signup(env.app, 'Ava Canvas');
  ben = await signup(env.app, 'Ben Canvas');
  cleo = await signup(env.app, 'Cleo Canvas');
  outsider = await signup(env.app, 'Out Sider');
  const ws = (await ava.post('/api/workspaces', { name: 'Canvas Org' })).body.workspace;
  wid = ws.id;
  await ben.post(`/api/workspaces/join/${ws.inviteCode}`);
  await cleo.post(`/api/workspaces/join/${ws.inviteCode}`);
  const convs = (await ava.get(`/api/w/${wid}/conversations`)).body.conversations;
  generalId = convs.find((c: any) => c.name === 'general').id;
  const priv = await ava.post(`/api/w/${wid}/channels`, { name: 'secret-plans', isPrivate: true, memberIds: [ben.user.id] });
  assert.equal(priv.status, 200);
  privateId = priv.body.conversation.id;
});

after(async () => { await env.cleanup(); });

describe('fractional index', () => {
  test('keys sort between their neighbours, repeatedly', () => {
    let a: string | null = null;
    let b: string | null = null;
    const k = keyBetween(a, b);
    a = k;
    // Keep inserting right after `a` (worst case: always the same gap).
    b = keyBetween(a, null);
    let lo = a, hi = b;
    for (let i = 0; i < 200; i++) {
      const m = keyBetween(lo, hi);
      assert.ok(lo < m && m < hi, `${lo} < ${m} < ${hi}`);
      assert.ok(!m.endsWith('0'));
      if (i % 2) lo = m; else hi = m;
    }
    const seqKeys = keysAfter(null, 50);
    assert.deepEqual([...seqKeys].sort(), seqKeys);
    assert.throws(() => keyBetween('b', 'a'));
  });
});

describe('channel canvas permissions', () => {
  test('auto-created on first open, one per channel', async () => {
    const r1 = await ava.get(`/api/conversations/${generalId}/canvas`);
    assert.equal(r1.status, 200);
    assert.match(r1.body.canvas.id, /^D/);
    assert.equal(r1.body.canvas.conversationId, generalId);
    assert.equal(r1.body.blocks.length, 1);
    assert.equal(r1.body.access.canEdit, true);
    const r2 = await ben.get(`/api/conversations/${generalId}/canvas`);
    assert.equal(r2.body.canvas.id, r1.body.canvas.id);
  });

  test('non-member cannot read a private channel canvas (via channel or id)', async () => {
    const own = await ben.get(`/api/conversations/${privateId}/canvas`);
    assert.equal(own.status, 200);
    const canvasId = own.body.canvas.id;
    assert.equal((await cleo.get(`/api/conversations/${privateId}/canvas`)).status, 403);
    assert.equal((await cleo.get(`/api/canvases/${canvasId}`)).status, 403);
    const ops = await cleo.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'insert', blockId: bid(), text: 'sneaky' }] });
    assert.equal(ops.status, 403);
    // Someone outside the workspace learns nothing.
    assert.equal((await outsider.get(`/api/canvases/${canvasId}`)).status, 404);
    // And it is absent from cleo's list.
    const list = (await cleo.get(`/api/w/${wid}/canvases`)).body.canvases;
    assert.ok(!list.some((c: any) => c.id === canvasId));
    assert.ok((await ben.get(`/api/w/${wid}/canvases`)).body.canvases.some((c: any) => c.id === canvasId));
  });

  test('public channel non-member may view but not edit', async () => {
    const pub = await ava.post(`/api/w/${wid}/channels`, { name: 'open-notes' });
    const cid = pub.body.conversation.id;
    const c = (await ava.get(`/api/conversations/${cid}/canvas`)).body.canvas;
    const v = await cleo.get(`/api/canvases/${c.id}`);
    assert.equal(v.status, 200);
    assert.equal(v.body.access.role, 'viewer');
    assert.equal(v.body.access.canEdit, false);
    const ops = await cleo.post(`/api/canvases/${c.id}/ops`, { ops: [{ op: 'insert', blockId: bid() }] });
    assert.equal(ops.status, 403);
    assert.equal((await cleo.patch(`/api/canvases/${c.id}`, { title: 'x' })).status, 403);
  });
});

describe('standalone canvases', () => {
  let canvasId: string;

  test('create from template, list, rename, owner-only delete', async () => {
    const r = await ava.post(`/api/w/${wid}/canvases`, { templateId: 'meeting-notes' });
    assert.equal(r.status, 200);
    canvasId = r.body.canvas.id;
    assert.equal(r.body.canvas.title, 'Meeting notes');
    // The title is shown above the body, so the template doesn't repeat it as a heading.
    assert.notEqual(r.body.blocks[0].text, 'Meeting notes');
    assert.ok(r.body.blocks.length > 5);
    const positions = r.body.blocks.map((b: any) => b.position);
    assert.deepEqual([...positions].sort(), positions);
    assert.equal(r.body.access.role, 'owner');

    assert.equal((await ben.get(`/api/canvases/${canvasId}`)).status, 404);
    const ren = await ava.patch(`/api/canvases/${canvasId}`, { title: 'Sync notes' });
    assert.equal(ren.body.canvas.title, 'Sync notes');
    const list = (await ava.get(`/api/w/${wid}/canvases`)).body.canvases;
    assert.ok(list.some((c: any) => c.id === canvasId && c.title === 'Sync notes'));

    const tpl = (await ava.get(`/api/w/${wid}/canvas-templates`)).body.templates;
    assert.deepEqual(tpl.filter((t: any) => t.builtin).map((t: any) => t.id), ['meeting-notes', 'project-brief', 'weekly-update']);
    assert.equal((await ava.post(`/api/w/${wid}/canvases`, { templateId: 'nope' })).status, 404);
  });

  test('share to a user as viewer, then editor; viewers cannot edit or delete', async () => {
    const s = await ava.post(`/api/canvases/${canvasId}/share`, { userIds: [ben.user.id], role: 'viewer' });
    assert.equal(s.status, 200);
    assert.deepEqual(s.body.sharedWith, [{ userId: ben.user.id, role: 'viewer' }]);
    const v = await ben.get(`/api/canvases/${canvasId}`);
    assert.equal(v.body.access.role, 'viewer');
    assert.equal((await ben.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'insert', blockId: bid() }] })).status, 403);
    assert.equal((await ben.del(`/api/canvases/${canvasId}`)).status, 403);
    await ava.post(`/api/canvases/${canvasId}/share`, { userIds: [ben.user.id], role: 'editor' });
    assert.equal((await ben.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'insert', blockId: bid(), text: 'from ben' }] })).status, 200);
    assert.ok((await ben.get(`/api/w/${wid}/canvases`)).body.canvases.some((c: any) => c.id === canvasId));
    // Outsiders cannot be granted access.
    assert.equal((await ava.post(`/api/canvases/${canvasId}/share`, { userIds: [outsider.user.id] })).status, 400);
  });

  test('share into a channel posts a canvas_share message and grants members access', async () => {
    assert.equal((await cleo.get(`/api/canvases/${canvasId}`)).status, 404);
    const s = await ava.post(`/api/canvases/${canvasId}/share`, { conversationId: generalId, role: 'viewer' });
    assert.equal(s.status, 200);
    assert.equal(s.body.message.subtype, 'canvas_share');
    assert.equal(s.body.message.meta.canvasId, canvasId);
    const msgs = (await cleo.get(`/api/conversations/${generalId}/messages`)).body.messages;
    assert.ok(msgs.some((m: any) => m.subtype === 'canvas_share' && m.meta?.canvasId === canvasId));
    const v = await cleo.get(`/api/canvases/${canvasId}`);
    assert.equal(v.status, 200);
    assert.equal(v.body.access.role, 'viewer');
    // Cannot share into a channel you are not in.
    assert.equal((await cleo.post(`/api/canvases/${canvasId}/share`, { conversationId: privateId })).status, 403);
  });

  test('delete by owner removes it', async () => {
    const r = await ava.post(`/api/w/${wid}/canvases`, { title: 'Scratch' });
    assert.equal((await ava.del(`/api/canvases/${r.body.canvas.id}`)).status, 200);
    assert.equal((await ava.get(`/api/canvases/${r.body.canvas.id}`)).status, 404);
  });
});

describe('block ops', () => {
  let canvasId: string;
  let first: any;

  before(async () => {
    const r = await ava.post(`/api/w/${wid}/canvases`, { title: 'Ops' });
    canvasId = r.body.canvas.id;
    first = r.body.blocks[0];
    await ava.post(`/api/canvases/${canvasId}/share`, { userIds: [ben.user.id], role: 'editor' });
  });

  const order = async () => (await ava.get(`/api/canvases/${canvasId}`)).body.blocks.map((b: any) => b.text);

  test('insert by afterId, at start, at end; batch ordering', async () => {
    const a = bid(), b = bid(), c = bid(), d = bid();
    const r = await ava.post(`/api/canvases/${canvasId}/ops`, {
      ops: [
        { op: 'update', blockId: first.id, baseVersion: first.version, text: 'one' },
        { op: 'insert', blockId: a, afterId: first.id, text: 'three' },
        { op: 'insert', blockId: b, afterId: first.id, text: 'two' },
        { op: 'insert', blockId: c, afterId: null, text: 'zero' },
        { op: 'insert', blockId: d, text: 'four', type: 'todo' },
      ],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.results.map((x: any) => x.status), ['ok', 'ok', 'ok', 'ok', 'ok']);
    assert.deepEqual(await order(), ['zero', 'one', 'two', 'three', 'four']);
    // Retrying an insert is idempotent.
    const again = await ava.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'insert', blockId: a, text: 'dup' }] });
    assert.equal(again.body.results[0].status, 'noop');
    assert.equal((await order()).length, 5);
  });

  test('concurrent inserts at the same spot never conflict (same key is de-duplicated)', async () => {
    const blocks = (await ava.get(`/api/canvases/${canvasId}`)).body.blocks;
    const zero = blocks[0], one = blocks[1];
    const key = keyBetween(zero.position, one.position);
    const x = bid(), y = bid();
    const r1 = await ava.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'insert', blockId: x, position: key, text: 'ava-mid' }] });
    const r2 = await ben.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'insert', blockId: y, position: key, text: 'ben-mid' }] });
    assert.equal(r1.body.results[0].status, 'ok');
    assert.equal(r2.body.results[0].status, 'ok');
    assert.notEqual(r2.body.results[0].block.position, key);
    const texts = await order();
    assert.deepEqual(texts.slice(0, 4), ['zero', 'ava-mid', 'ben-mid', 'one']);
  });

  test('stale baseVersion: same field conflicts, different field merges', async () => {
    const blk = (await ava.get(`/api/canvases/${canvasId}`)).body.blocks.find((b: any) => b.text === 'four');
    const base = blk.version;
    // Ben edits the text.
    const rb = await ben.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'update', blockId: blk.id, baseVersion: base, text: 'four (ben)' }] });
    assert.equal(rb.body.results[0].status, 'ok');
    assert.equal(rb.body.results[0].block.version, base + 1);
    // Ava, still on the old version, edits the text too → conflict with the current block.
    const ra = await ava.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'update', blockId: blk.id, baseVersion: base, text: 'four (ava)' }] });
    assert.equal(ra.body.results[0].status, 'conflict');
    assert.deepEqual(ra.body.results[0].conflictFields, ['text']);
    assert.equal(ra.body.results[0].block.text, 'four (ben)');
    // Ava ticks the checkbox on the stale version → no one else touched `checked`, so it applies.
    const rc = await ava.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'update', blockId: blk.id, baseVersion: base, checked: true }] });
    assert.equal(rc.body.results[0].status, 'ok');
    assert.equal(rc.body.results[0].block.checked, true);
    assert.equal(rc.body.results[0].block.text, 'four (ben)');
    // Rebased text edit succeeds.
    const rr = await ava.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'update', blockId: blk.id, baseVersion: rc.body.results[0].block.version, text: 'four (merged)' }] });
    assert.equal(rr.body.results[0].status, 'ok');
    // Unchanged values are a noop, not a conflict.
    const rn = await ben.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'update', blockId: blk.id, baseVersion: base, text: 'four (merged)' }] });
    assert.equal(rn.body.results[0].status, 'noop');
  });

  test('move, delete, gone and validation', async () => {
    let blocks = (await ava.get(`/api/canvases/${canvasId}`)).body.blocks;
    const zero = blocks.find((b: any) => b.text === 'zero');
    const last = blocks[blocks.length - 1];
    const mv = await ava.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'move', blockId: zero.id, baseVersion: zero.version, afterId: last.id }] });
    assert.equal(mv.body.results[0].status, 'ok');
    let texts = await order();
    assert.equal(texts[texts.length - 1], 'zero');
    // A second move from the stale version conflicts on position.
    const mv2 = await ben.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'move', blockId: zero.id, baseVersion: zero.version, afterId: null }] });
    assert.equal(mv2.body.results[0].status, 'conflict');

    const del = await ava.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'delete', blockId: zero.id }] });
    assert.equal(del.body.results[0].status, 'ok');
    const upd = await ben.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'update', blockId: zero.id, baseVersion: 9, text: 'x' }] });
    assert.equal(upd.body.results[0].status, 'gone');
    const del2 = await ben.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'delete', blockId: zero.id }] });
    assert.equal(del2.body.results[0].status, 'noop');

    // Deleting a block someone else just wrote into (stale base) is refused.
    blocks = (await ava.get(`/api/canvases/${canvasId}`)).body.blocks;
    const one = blocks.find((b: any) => b.text === 'one');
    await ben.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'update', blockId: one.id, baseVersion: one.version, text: 'one!' }] });
    const del3 = await ava.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'delete', blockId: one.id, baseVersion: one.version }] });
    assert.equal(del3.body.results[0].status, 'conflict');

    assert.equal((await ava.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'insert', blockId: bid(), type: 'banner' }] })).status, 400);
    assert.equal((await ava.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'insert', blockId: bid(), position: 'ab0' }] })).status, 400);
    assert.equal((await ava.post(`/api/canvases/${canvasId}/ops`, { ops: [] })).status, 400);
    // Blocks from another canvas cannot be touched through this one.
    const other = (await ava.post(`/api/w/${wid}/canvases`, { title: 'Other' })).body;
    const cross = await ava.post(`/api/canvases/${canvasId}/ops`, { ops: [{ op: 'update', blockId: other.blocks[0].id, baseVersion: 1, text: 'hijack' }] });
    assert.equal(cross.body.results[0].status, 'error');
  });

  test('canvas.updated is emitted on the bus to everyone with access', async () => {
    const events: any[] = [];
    const off = env.app.ctx.bus.on('canvas.updated', (e) => events.push(e));
    await ava.post(`/api/canvases/${canvasId}/ops`, { clientId: 'c1', ops: [{ op: 'insert', blockId: bid(), text: 'evt' }] });
    off();
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.canvasId, canvasId);
    assert.equal(events[0].payload.actorId, ava.user.id);
    assert.equal(events[0].payload.clientId, 'c1');
    assert.equal(events[0].payload.ops[0].op, 'insert');
    assert.deepEqual([...events[0].audience].sort(), [ava.user.id, ben.user.id].sort());
  });
});

describe('realtime (two users over WebSocket)', () => {
  let port: number;
  before(async () => {
    await env.app.listen({ port: 0, host: '127.0.0.1' });
    port = (env.app.server.address() as any).port;
  });

  function connect(client: TestClient) {
    return new Promise<{ sock: WebSocket; frames: any[]; next(type: string, pred?: (p: any) => boolean, ms?: number): Promise<any> }>((resolve, reject) => {
      const sock = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: client.cookie } });
      const frames: any[] = [];
      const waiters: { type: string; pred: (p: any) => boolean; res: (p: any) => void }[] = [];
      sock.on('message', (raw) => {
        const f = JSON.parse(String(raw));
        frames.push(f);
        for (const w of [...waiters]) if (w.type === f.type && w.pred(f.payload)) { waiters.splice(waiters.indexOf(w), 1); w.res(f.payload); }
        if (f.type === 'hello') resolve(api);
      });
      sock.on('error', reject);
      const api = {
        sock, frames,
        next(type: string, pred: (p: any) => boolean = () => true, ms = 2000) {
          const hit = frames.find((f) => f.type === type && pred(f.payload));
          if (hit) { frames.splice(frames.indexOf(hit), 1); return Promise.resolve(hit.payload); }
          return new Promise<any>((res, rej) => {
            const t = setTimeout(() => rej(new Error(`timeout waiting for ${type}`)), ms);
            waiters.push({ type, pred, res: (p) => { clearTimeout(t); res(p); } });
          });
        },
      };
    });
  }

  test('canvas.updated reaches the other editor live; cursor presence is relayed', async () => {
    const canvas = (await ava.get(`/api/conversations/${privateId}/canvas`)).body.canvas;
    const a = await connect(ava);
    const b = await connect(ben);
    const c = await connect(cleo); // not a member of the private channel
    try {
      const blockId = bid();
      await ben.post(`/api/canvases/${canvas.id}/ops`, { clientId: 'ben-tab', ops: [{ op: 'insert', blockId, text: 'live!' }] });
      const evt = await a.next('canvas.updated', (p) => p.canvasId === canvas.id);
      assert.equal(evt.actorId, ben.user.id);
      assert.equal(evt.clientId, 'ben-tab');
      assert.equal(evt.ops[0].block.text, 'live!');
      // Ben's own sockets get it too (other tabs); the client filters by clientId.
      await b.next('canvas.updated', (p) => p.canvasId === canvas.id);

      // Presence: both open the canvas, ava moves into the block → ben sees it.
      a.sock.send(JSON.stringify({ type: 'canvas.cursor', payload: { canvasId: canvas.id, blockId: null } }));
      await a.next('canvas.presence', (p) => p.viewers.length === 1);
      b.sock.send(JSON.stringify({ type: 'canvas.cursor', payload: { canvasId: canvas.id, blockId: null } }));
      const snap = await a.next('canvas.presence', (p) => p.viewers.length === 2);
      assert.deepEqual(snap.viewers.map((v: any) => v.userId).sort(), [ava.user.id, ben.user.id].sort());
      a.sock.send(JSON.stringify({ type: 'canvas.cursor', payload: { canvasId: canvas.id, blockId } }));
      const cur = await b.next('canvas.cursor', (p) => p.userId === ava.user.id);
      assert.equal(cur.blockId, blockId);

      // Cleo (no access) cannot join presence and never receives updates.
      c.sock.send(JSON.stringify({ type: 'canvas.cursor', payload: { canvasId: canvas.id, blockId: null } }));
      await new Promise((r) => setTimeout(r, 100));
      await ava.post(`/api/canvases/${canvas.id}/ops`, { ops: [{ op: 'update', blockId, baseVersion: 1, text: 'live!!' }] });
      await b.next('canvas.updated', (p) => p.ops[0]?.block?.text === 'live!!');
      assert.ok(!c.frames.some((f) => f.type.startsWith('canvas.')));

      // Leaving updates the snapshot.
      b.sock.close();
      const after = await a.next('canvas.presence', (p) => p.viewers.length === 1);
      assert.equal(after.viewers[0].userId, ava.user.id);
    } finally {
      // Wait for the server to see the closes before the app (and its db) shuts down.
      await Promise.all([a, b, c].map((x) => new Promise<void>((r) => {
        if (x.sock.readyState === WebSocket.CLOSED) return r();
        x.sock.once('close', () => r());
        x.sock.close();
      })));
      await new Promise((r) => setTimeout(r, 50));
    }
  });
});
