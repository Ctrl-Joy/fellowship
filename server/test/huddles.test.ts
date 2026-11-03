import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, signup, type TestClient } from './helpers';
import { formatDuration, MAX_PARTICIPANTS } from '../src/modules/huddles/service';

let env: Awaited<ReturnType<typeof makeTestApp>>;
let ava: TestClient, ben: TestClient, cleo: TestClient, outsider: TestClient;
let wid: string, generalId: string, privateId: string, dmId: string;
const events: any[] = [];

before(async () => {
  env = await makeTestApp();
  env.app.ctx.bus.on('*', (e) => { if (e.type.startsWith('huddle.') || e.type.startsWith('message.')) events.push(e); });
  ava = await signup(env.app, 'Ava Huddle');
  ben = await signup(env.app, 'Ben Huddle');
  cleo = await signup(env.app, 'Cleo Huddle');
  outsider = await signup(env.app, 'Out Sider');
  const ws = (await ava.post('/api/workspaces', { name: 'Huddle Co' })).body.workspace;
  wid = ws.id;
  await ben.post(`/api/workspaces/join/${ws.inviteCode}`);
  await cleo.post(`/api/workspaces/join/${ws.inviteCode}`);
  const convs = (await ava.get(`/api/w/${wid}/conversations`)).body.conversations;
  generalId = convs.find((c: any) => c.name === 'general').id;
  privateId = (await ava.post(`/api/w/${wid}/channels`, { name: 'secret', isPrivate: true, memberIds: [ben.user.id] })).body.conversation.id;
  dmId = (await ava.post(`/api/w/${wid}/dms`, { userIds: [ben.user.id] })).body.conversation.id;
});

after(async () => { await env.cleanup(); });

const since = (n: number) => events.slice(n);

describe('huddle lifecycle', () => {
  test('no active huddle initially', async () => {
    const r = await ava.get(`/api/conversations/${generalId}/huddle`);
    assert.equal(r.status, 200);
    assert.equal(r.body.huddle, null);
  });

  test('join starts a huddle, posts a system message and emits huddle.started', async () => {
    const mark = events.length;
    const r = await ava.post(`/api/conversations/${generalId}/huddle/join`, {});
    assert.equal(r.status, 200);
    const h = r.body.huddle;
    assert.match(h.id, /^H/);
    assert.equal(h.conversationId, generalId);
    assert.equal(h.startedBy, ava.user.id);
    assert.deepEqual(h.participants.map((p: any) => p.userId), [ava.user.id]);
    assert.ok(h.messageId);
    const evs = since(mark);
    const created = evs.find((e) => e.type === 'message.created');
    assert.equal(created.payload.message.subtype, 'huddle');
    assert.equal(created.payload.message.meta.huddleId, h.id);
    assert.equal(created.payload.message.id, h.messageId);
    const started = evs.find((e) => e.type === 'huddle.started');
    assert.equal(started.conversationId, generalId);
    assert.equal(started.payload.huddle.messageId, h.messageId);
    assert.deepEqual(started.payload.change, { type: 'joined', userId: ava.user.id });
  });

  test('second member joins the same huddle (one active per conversation)', async () => {
    const mark = events.length;
    const before = (await ava.get(`/api/conversations/${generalId}/huddle`)).body.huddle;
    const r = await ben.post(`/api/conversations/${generalId}/huddle/join`, {});
    assert.equal(r.status, 200);
    assert.equal(r.body.huddle.id, before.id);
    assert.deepEqual(r.body.huddle.participants.map((p: any) => p.userId).sort(), [ava.user.id, ben.user.id].sort());
    const upd = since(mark).find((e) => e.type === 'huddle.updated');
    assert.deepEqual(upd.payload.change, { type: 'joined', userId: ben.user.id });
    assert.equal(since(mark).filter((e) => e.type === 'message.created').length, 0, 'no second system message');
  });

  test('joining twice is idempotent', async () => {
    const r = await ben.post(`/api/conversations/${generalId}/huddle/join`, {});
    assert.equal(r.status, 200);
    assert.equal(r.body.huddle.participants.length, 2);
  });

  test('media state update is broadcast', async () => {
    const mark = events.length;
    const r = await ben.patch(`/api/conversations/${generalId}/huddle/me`, { muted: true, video: true });
    assert.equal(r.status, 200);
    const mine = r.body.huddle.participants.find((p: any) => p.userId === ben.user.id);
    assert.equal(mine.muted, true);
    assert.equal(mine.video, true);
    assert.equal(mine.screen, false);
    const upd = since(mark).find((e) => e.type === 'huddle.updated');
    assert.deepEqual(upd.payload.change, { type: 'media', userId: ben.user.id });
  });

  test('media update validates body and requires being in the huddle', async () => {
    assert.equal((await ben.patch(`/api/conversations/${generalId}/huddle/me`, { muted: 'yes' })).status, 400);
    assert.equal((await ben.patch(`/api/conversations/${generalId}/huddle/me`, { bogus: true })).status, 400);
    assert.equal((await cleo.patch(`/api/conversations/${generalId}/huddle/me`, { muted: true })).status, 403);
    assert.equal((await ava.patch(`/api/conversations/${dmId}/huddle/me`, { muted: true })).status, 404);
  });

  test('workspace listing shows active huddles in my conversations', async () => {
    const r = await cleo.get(`/api/w/${wid}/huddles`);
    assert.equal(r.status, 200);
    assert.equal(r.body.huddles.length, 1);
    assert.equal(r.body.huddles[0].conversationId, generalId);
    assert.equal((await outsider.get(`/api/w/${wid}/huddles`)).status, 404);
  });

  test('leave keeps the huddle while others remain', async () => {
    const mark = events.length;
    const r = await ben.post(`/api/conversations/${generalId}/huddle/leave`, {});
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.huddle.participants.map((p: any) => p.userId), [ava.user.id]);
    const upd = since(mark).find((e) => e.type === 'huddle.updated');
    assert.equal(upd.payload.change.type, 'left');
    assert.equal(upd.payload.change.userId, ben.user.id);
    // Leaving again is a no-op.
    const again = await ben.post(`/api/conversations/${generalId}/huddle/leave`, {});
    assert.equal(again.status, 200);
    assert.equal(again.body.huddle, null);
  });

  test('last one out ends the huddle and rewrites the system message as a summary', async () => {
    const h = (await ava.get(`/api/conversations/${generalId}/huddle`)).body.huddle;
    const mark = events.length;
    const r = await ava.post(`/api/conversations/${generalId}/huddle/leave`, {});
    assert.equal(r.status, 200);
    assert.ok(r.body.huddle.endedAt);
    const evs = since(mark);
    const ended = evs.find((e) => e.type === 'huddle.ended');
    assert.ok(ended);
    assert.equal(ended.payload.huddle.id, h.id);
    const msgUpd = evs.find((e) => e.type === 'message.updated' && e.payload.message.id === h.messageId);
    assert.ok(msgUpd, 'message.updated emitted for summary');
    const msg = (await ava.get(`/api/messages/${h.messageId}`)).body.message;
    assert.equal(msg.text, 'Huddle ended · under a minute · Ava, Ben');
    assert.equal(msg.meta.status, 'ended');
    assert.deepEqual(msg.meta.participantIds, [ava.user.id, ben.user.id]);
    assert.equal((await ava.get(`/api/conversations/${generalId}/huddle`)).body.huddle, null);
    assert.equal((await ava.get(`/api/w/${wid}/huddles`)).body.huddles.length, 0);
  });

  test('a new huddle can start after the previous ended; its thread works as huddle chat', async () => {
    const r = await cleo.post(`/api/conversations/${generalId}/huddle/join`);
    assert.equal(r.status, 200);
    const reply = await ben.post(`/api/conversations/${generalId}/messages`, { text: 'link from the huddle', threadRootId: r.body.huddle.messageId });
    assert.equal(reply.status, 200);
    const replies = (await ben.get(`/api/messages/${r.body.huddle.messageId}/replies`)).body;
    assert.ok(JSON.stringify(replies).includes('link from the huddle'));
    await cleo.post(`/api/conversations/${generalId}/huddle/leave`);
  });

  test('joining a huddle elsewhere leaves the current one', async () => {
    await ava.post(`/api/conversations/${generalId}/huddle/join`);
    await ben.post(`/api/conversations/${generalId}/huddle/join`);
    const r = await ava.post(`/api/conversations/${dmId}/huddle/join`);
    assert.equal(r.status, 200);
    const general = (await ben.get(`/api/conversations/${generalId}/huddle`)).body.huddle;
    assert.deepEqual(general.participants.map((p: any) => p.userId), [ben.user.id]);
    await ava.post(`/api/conversations/${dmId}/huddle/leave`);
    await ben.post(`/api/conversations/${generalId}/huddle/leave`);
  });
});

describe('huddle permissions', () => {
  test('requires auth', async () => {
    const r = await env.app.inject({ method: 'POST', url: `/api/conversations/${generalId}/huddle/join`, payload: {} });
    assert.equal(r.statusCode, 401);
  });

  test('outsiders cannot see or join', async () => {
    assert.equal((await outsider.post(`/api/conversations/${generalId}/huddle/join`)).status, 404);
    assert.equal((await outsider.get(`/api/conversations/${generalId}/huddle`)).status, 404);
    assert.equal((await outsider.post(`/api/conversations/${generalId}/huddle/leave`)).status, 404);
  });

  test('non-members of a private channel or DM cannot join or read', async () => {
    assert.equal((await cleo.post(`/api/conversations/${privateId}/huddle/join`)).status, 403);
    assert.equal((await cleo.get(`/api/conversations/${privateId}/huddle`)).status, 403);
    assert.equal((await cleo.post(`/api/conversations/${dmId}/huddle/join`)).status, 403);
  });

  test('private-channel huddles are invisible to non-members in the workspace list', async () => {
    const r = await ben.post(`/api/conversations/${privateId}/huddle/join`);
    assert.equal(r.status, 200);
    assert.equal((await cleo.get(`/api/w/${wid}/huddles`)).body.huddles.length, 0);
    assert.equal((await ava.get(`/api/w/${wid}/huddles`)).body.huddles.length, 1);
    assert.equal((await cleo.get(`/api/huddles/${r.body.huddle.id}`)).status, 403);
    assert.equal((await ava.get(`/api/huddles/${r.body.huddle.id}`)).status, 200);
    await ben.post(`/api/conversations/${privateId}/huddle/leave`);
  });

  test('public channel non-members can read but must join the channel to huddle', async () => {
    const ch = (await ava.post(`/api/w/${wid}/channels`, { name: 'open-room' })).body.conversation;
    assert.equal((await cleo.get(`/api/conversations/${ch.id}/huddle`)).status, 200);
    assert.equal((await cleo.post(`/api/conversations/${ch.id}/huddle/join`)).status, 403);
  });

  test('leaving the channel removes you from its huddle', async () => {
    const ch = (await ava.post(`/api/w/${wid}/channels`, { name: 'leavers' })).body.conversation;
    await ben.post(`/api/conversations/${ch.id}/join`);
    await ava.post(`/api/conversations/${ch.id}/huddle/join`);
    await ben.post(`/api/conversations/${ch.id}/huddle/join`);
    await ben.post(`/api/conversations/${ch.id}/leave`);
    const h = (await ava.get(`/api/conversations/${ch.id}/huddle`)).body.huddle;
    assert.deepEqual(h.participants.map((p: any) => p.userId), [ava.user.id]);
    await ava.post(`/api/conversations/${ch.id}/huddle/leave`);
  });

  test('huddle is full at the mesh limit', async () => {
    const ch = (await ava.post(`/api/w/${wid}/channels`, { name: 'packed' })).body.conversation;
    const ws = (await ava.get(`/api/w/${wid}`)).body.workspace;
    const people: TestClient[] = [];
    for (let i = 0; i < MAX_PARTICIPANTS + 1; i++) {
      const p = await signup(env.app, `Person ${i}`);
      await p.post(`/api/workspaces/join/${ws.inviteCode}`);
      await p.post(`/api/conversations/${ch.id}/join`);
      people.push(p);
    }
    for (let i = 0; i < MAX_PARTICIPANTS; i++) {
      assert.equal((await people[i].post(`/api/conversations/${ch.id}/huddle/join`)).status, 200);
    }
    const full = await people[MAX_PARTICIPANTS].post(`/api/conversations/${ch.id}/huddle/join`);
    assert.equal(full.status, 409);
    assert.equal(full.body.error.code, 'huddle_full');
    for (let i = 0; i < MAX_PARTICIPANTS; i++) await people[i].post(`/api/conversations/${ch.id}/huddle/leave`);
  });
});

test('formatDuration', () => {
  assert.equal(formatDuration(10_000), 'under a minute');
  assert.equal(formatDuration(12 * 60_000), '12 min');
  assert.equal(formatDuration(65 * 60_000), '1 h 5 min');
  assert.equal(formatDuration(120 * 60_000), '2 h');
});
