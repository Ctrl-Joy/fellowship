import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, signup, type TestClient } from './helpers';

let env: Awaited<ReturnType<typeof makeTestApp>>;
let ava: TestClient, ben: TestClient, cleo: TestClient, outsider: TestClient;
let wid: string;
let cid: string;
let privCid: string;

before(async () => {
  env = await makeTestApp();
  ava = await signup(env.app, 'Ava React');
  ben = await signup(env.app, 'Ben React');
  cleo = await signup(env.app, 'Cleo React');
  outsider = await signup(env.app, 'Out React');

  wid = (await ava.post('/api/workspaces', { name: 'Reactions WS' })).body.workspace.id;
  const invite = (await ava.get(`/api/w/${wid}`)).body.workspace.inviteCode;
  await ben.post(`/api/workspaces/join/${invite}`);
  await cleo.post(`/api/workspaces/join/${invite}`);
  cid = (await ava.post(`/api/w/${wid}/channels`, { name: 'social' })).body.conversation.id;
  await ben.post(`/api/conversations/${cid}/join`);
  privCid = (await ava.post(`/api/w/${wid}/channels`, { name: 'secret', isPrivate: true })).body.conversation.id;
});

after(async () => { await env.cleanup(); });

async function postMsg(client: TestClient, text: string, conversationId = cid) {
  const r = await client.post(`/api/conversations/${conversationId}/messages`, { text });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.message;
}

describe('toggle and idempotency', () => {
  test('POST adds a reaction and POST again removes it', async () => {
    const m = await postMsg(ava, 'react to me');
    const on = await ben.post(`/api/messages/${m.id}/reactions`, { emoji: '👍' });
    assert.equal(on.status, 200);
    assert.equal(on.body.added, true);
    assert.deepEqual(on.body.message.reactions, [{ emoji: '👍', userIds: [ben.user.id] }]);

    const off = await ben.post(`/api/messages/${m.id}/reactions`, { emoji: '👍' });
    assert.equal(off.body.added, false);
    assert.deepEqual(off.body.message.reactions, []);
  });

  test('DELETE removes and is idempotent when the reaction is already gone', async () => {
    const m = await postMsg(ava, 'delete path');
    await ben.post(`/api/messages/${m.id}/reactions`, { emoji: '🎉' });
    const first = await ben.del(`/api/messages/${m.id}/reactions/${encodeURIComponent('🎉')}`);
    assert.equal(first.status, 200);
    assert.equal(first.body.removed, true);
    assert.deepEqual(first.body.message.reactions, []);
    const second = await ben.del(`/api/messages/${m.id}/reactions/${encodeURIComponent('🎉')}`);
    assert.equal(second.status, 200);
    assert.equal(second.body.removed, false);
  });

  test('the same user can hold several different emoji; one row per (message, user, emoji)', async () => {
    const m = await postMsg(ava, 'many emoji');
    await ben.post(`/api/messages/${m.id}/reactions`, { emoji: '👍' });
    await ben.post(`/api/messages/${m.id}/reactions`, { emoji: '🚀' });
    await ben.post(`/api/messages/${m.id}/reactions`, { emoji: '🚀' }); // toggles off
    const got = (await ava.get(`/api/messages/${m.id}`)).body.message;
    assert.deepEqual(got.reactions, [{ emoji: '👍', userIds: [ben.user.id] }]);
  });

  test('invalid emoji values are rejected', async () => {
    const m = await postMsg(ava, 'bad emoji');
    assert.equal((await ben.post(`/api/messages/${m.id}/reactions`, { emoji: '' })).status, 400);
    assert.equal((await ben.post(`/api/messages/${m.id}/reactions`, { emoji: 'two words' })).status, 400);
    assert.equal((await ben.post(`/api/messages/${m.id}/reactions`, {})).status, 400);
  });
});

describe('enricher output', () => {
  test('reactions are grouped per emoji in first-reacted order, with user ids', async () => {
    const m = await postMsg(ava, 'ordering');
    await ben.post(`/api/messages/${m.id}/reactions`, { emoji: '🎉' });
    await ava.post(`/api/messages/${m.id}/reactions`, { emoji: '👍' });
    await ben.post(`/api/messages/${m.id}/reactions`, { emoji: '👍' });

    const fetched = (await ava.get(`/api/messages/${m.id}`)).body.message;
    assert.deepEqual(fetched.reactions, [
      { emoji: '🎉', userIds: [ben.user.id] },
      { emoji: '👍', userIds: [ava.user.id, ben.user.id] },
    ]);

    // The channel listing carries the same enriched shape.
    const list = (await ava.get(`/api/conversations/${cid}/messages?limit=100`)).body.messages;
    const inList = list.find((x: any) => x.id === m.id);
    assert.deepEqual(inList.reactions, fetched.reactions);
  });

  test('reactions are also present on thread replies', async () => {
    const root = await postMsg(ava, 'thread root');
    const reply = (await ben.post(`/api/conversations/${cid}/messages`, { text: 'a reply', threadRootId: root.id })).body.message;
    await ava.post(`/api/messages/${reply.id}/reactions`, { emoji: '✅' });
    const replies = (await ben.get(`/api/messages/${root.id}/replies`)).body.replies;
    assert.deepEqual(replies.find((r: any) => r.id === reply.id).reactions, [{ emoji: '✅', userIds: [ava.user.id] }]);
  });

  test('a message with no reactions has an empty array', async () => {
    const m = await postMsg(ava, 'plain');
    assert.deepEqual(m.reactions, []);
  });
});

describe('permissions', () => {
  test('unauthenticated requests are rejected', async () => {
    const m = await postMsg(ava, 'auth check');
    const r = await env.app.inject({ method: 'POST', url: `/api/messages/${m.id}/reactions`, payload: { emoji: '👍' } });
    assert.equal(r.statusCode, 401);
  });

  test('a non-member of the public channel cannot react', async () => {
    const m = await postMsg(ava, 'members only');
    const r = await cleo.post(`/api/messages/${m.id}/reactions`, { emoji: '👍' });
    assert.equal(r.status, 403);
    assert.equal((await cleo.del(`/api/messages/${m.id}/reactions/${encodeURIComponent('👍')}`)).status, 403);
  });

  test('a workspace outsider gets 404 for a message they cannot see', async () => {
    const m = await postMsg(ava, 'hidden from outsiders');
    const r = await outsider.post(`/api/messages/${m.id}/reactions`, { emoji: '👍' });
    assert.equal(r.status, 404);
  });

  test('private channel: non-members get 403, members can react', async () => {
    const secret = await postMsg(ava, 'secret note', privCid);
    assert.equal((await ben.post(`/api/messages/${secret.id}/reactions`, { emoji: '👍' })).status, 403);
    assert.equal((await ava.post(`/api/messages/${secret.id}/reactions`, { emoji: '👍' })).status, 200);
  });

  test('deleted and unknown messages cannot be reacted to', async () => {
    const m = await postMsg(ava, 'to delete');
    await ava.del(`/api/messages/${m.id}`);
    assert.equal((await ben.post(`/api/messages/${m.id}/reactions`, { emoji: '👍' })).status, 404);
    assert.equal((await ben.post('/api/messages/M_nope/reactions', { emoji: '👍' })).status, 404);
  });
});

describe('domain events', () => {
  test('reaction.added and reaction.removed are emitted with the message reactions', async () => {
    const seen: { type: string; payload: any }[] = [];
    const unsubs = ['reaction.added', 'reaction.removed'].map((t) =>
      env.app.ctx.bus.on(t as any, (e) => seen.push({ type: e.type, payload: e.payload })));
    try {
      const m = await postMsg(ava, 'event target');
      await ben.post(`/api/messages/${m.id}/reactions`, { emoji: '🔥' });
      await ben.post(`/api/messages/${m.id}/reactions`, { emoji: '🔥' });
      assert.deepEqual(seen.map((s) => s.type), ['reaction.added', 'reaction.removed']);
      assert.equal(seen[0].payload.messageId, m.id);
      assert.equal(seen[0].payload.emoji, '🔥');
      assert.equal(seen[0].payload.userId, ben.user.id);
      assert.deepEqual(seen[0].payload.reactions, [{ emoji: '🔥', userIds: [ben.user.id] }]);
      assert.deepEqual(seen[1].payload.reactions, []);
    } finally {
      unsubs.forEach((u) => u());
    }
  });

  test('a no-op DELETE emits nothing', async () => {
    const seen: string[] = [];
    const unsub = env.app.ctx.bus.on('reaction.removed', (e) => seen.push(e.type));
    try {
      const m = await postMsg(ava, 'no-op delete');
      await ben.del(`/api/messages/${m.id}/reactions/${encodeURIComponent('😀')}`);
      assert.equal(seen.length, 0);
    } finally {
      unsub();
    }
  });
});
