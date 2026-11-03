import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, signup, type TestClient } from './helpers';

let env: Awaited<ReturnType<typeof makeTestApp>>;
let ava: TestClient, ben: TestClient, cleo: TestClient, outsider: TestClient;
let wid: string;
let inviteCode: string;
let generalId: string;

before(async () => {
  env = await makeTestApp();
  ava = await signup(env.app, 'Ava Test', 'ava@example.test');
  ben = await signup(env.app, 'Ben Test');
  cleo = await signup(env.app, 'Cleo Test');
  outsider = await signup(env.app, 'Out Sider');
});

after(async () => { await env.cleanup(); });

describe('auth', () => {
  test('me returns the signed-in user', async () => {
    const r = await ava.get('/api/auth/me');
    assert.equal(r.status, 200);
    assert.equal(r.body.user.email, 'ava@example.test');
    assert.equal(r.body.user.password_hash, undefined);
  });

  test('unauthenticated requests get 401 with error shape', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/api/auth/me' });
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().error.code, 'unauthorized');
  });

  test('duplicate email is rejected', async () => {
    const r = await env.app.inject({
      method: 'POST', url: '/api/auth/signup',
      payload: { email: 'AVA@example.test', password: 'password123', fullName: 'Dup' },
    });
    assert.equal(r.statusCode, 409);
  });

  test('login with right and wrong password; logout clears session', async () => {
    const bad = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ava@example.test', password: 'nope-nope' } });
    assert.equal(bad.statusCode, 401);
    const ok = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ava@example.test', password: 'password123' } });
    assert.equal(ok.statusCode, 200);
    const cookie = String(ok.headers['set-cookie']).split(';')[0];
    assert.match(cookie, /^fs_session=/);
    await env.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    const after = await env.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(after.statusCode, 401);
  });

  test('profile PATCH updates fields', async () => {
    const r = await ava.patch('/api/users/me', { title: 'Lead', displayName: 'avat', timezone: 'Europe/London' });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.title, 'Lead');
    assert.equal(r.body.user.displayName, 'avat');
  });
});

describe('workspaces', () => {
  test('create workspace makes creator owner with #general and #random', async () => {
    const r = await ava.post('/api/workspaces', { name: 'Test Org' });
    assert.equal(r.status, 200);
    wid = r.body.workspace.id;
    inviteCode = r.body.workspace.inviteCode;
    assert.equal(r.body.workspace.role, 'owner');
    assert.match(wid, /^W/);
    const convs = await ava.get(`/api/w/${wid}/conversations`);
    const names = convs.body.conversations.map((c: any) => c.name).sort();
    assert.deepEqual(names, ['general', 'random']);
    generalId = convs.body.conversations.find((c: any) => c.name === 'general').id;
  });

  test('join by invite code adds member and default channels', async () => {
    const r = await ben.post(`/api/workspaces/join/${inviteCode}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.workspace.role, 'member');
    await cleo.post(`/api/workspaces/join/${inviteCode}`);
    const members = await ava.get(`/api/w/${wid}/members`);
    assert.equal(members.body.members.length, 3);
    const convs = await ben.get(`/api/w/${wid}/conversations`);
    assert.ok(convs.body.conversations.some((c: any) => c.id === generalId));
  });

  test('bad invite code is 404, outsider cannot see workspace', async () => {
    assert.equal((await outsider.post('/api/workspaces/join/nope')).status, 404);
    assert.equal((await outsider.get(`/api/w/${wid}/members`)).status, 404);
    assert.equal((await outsider.get(`/api/w/${wid}/conversations`)).status, 404);
  });

  test('workspace list', async () => {
    const r = await ben.get('/api/workspaces');
    assert.equal(r.body.workspaces.length, 1);
    assert.equal(r.body.workspaces[0].id, wid);
  });
});

describe('channels', () => {
  let cid: string;
  let privateId: string;

  test('create public channel normalizes the name and rejects duplicates', async () => {
    const r = await ava.post(`/api/w/${wid}/channels`, { name: 'Product Team' });
    assert.equal(r.status, 200);
    assert.equal(r.body.conversation.name, 'product-team');
    cid = r.body.conversation.id;
    const dup = await ben.post(`/api/w/${wid}/channels`, { name: 'product-team' });
    assert.equal(dup.status, 409);
    const bad = await ben.post(`/api/w/${wid}/channels`, { name: '!!!' });
    assert.equal(bad.status, 400);
  });

  test('browse, join, leave', async () => {
    const browse = await ben.get(`/api/w/${wid}/channels/browse`);
    const ch = browse.body.channels.find((c: any) => c.id === cid);
    assert.ok(ch);
    assert.equal(ch.isMember, false);
    assert.equal((await ben.post(`/api/conversations/${cid}/join`)).body.conversation.isMember, true);
    assert.equal((await ben.post(`/api/conversations/${cid}/leave`)).status, 200);
    const again = await ben.get(`/api/conversations/${cid}`);
    assert.equal(again.body.conversation.isMember, false);
  });

  test('cannot leave #general', async () => {
    assert.equal((await ben.post(`/api/conversations/${generalId}/leave`)).status, 403);
  });

  test('rename, topic, description by members', async () => {
    const r = await ava.patch(`/api/conversations/${cid}`, { name: 'product', topic: 'Roadmap', description: 'All things product' });
    assert.equal(r.status, 200);
    assert.equal(r.body.conversation.name, 'product');
    assert.equal(r.body.conversation.topic, 'Roadmap');
    assert.equal((await ben.patch(`/api/conversations/${cid}`, { topic: 'x' })).status, 403);
  });

  test('private channels are hidden from non-members', async () => {
    const r = await ava.post(`/api/w/${wid}/channels`, { name: 'secret', isPrivate: true });
    privateId = r.body.conversation.id;
    await ava.post(`/api/conversations/${privateId}/messages`, { text: 'classified', clientMsgId: 'p1' });
    const browse = await ben.get(`/api/w/${wid}/channels/browse`);
    assert.ok(!browse.body.channels.some((c: any) => c.id === privateId));
    assert.equal((await ben.get(`/api/conversations/${privateId}/messages`)).status, 403);
    assert.equal((await ben.get(`/api/conversations/${privateId}`)).status, 403);
    assert.equal((await ben.post(`/api/conversations/${privateId}/join`)).status, 403);
    assert.equal((await ben.post(`/api/conversations/${privateId}/messages`, { text: 'hi' })).status, 403);
    assert.equal((await outsider.get(`/api/conversations/${privateId}/messages`)).status, 404);
  });

  test('member add lets them read the private channel', async () => {
    const r = await ava.post(`/api/conversations/${privateId}/members`, { userIds: [ben.user.id] });
    assert.deepEqual(r.body.added, [ben.user.id]);
    const msgs = await ben.get(`/api/conversations/${privateId}/messages`);
    assert.equal(msgs.status, 200);
    assert.equal(msgs.body.messages[0].text, 'classified');
    assert.equal((await ava.post(`/api/conversations/${privateId}/members`, { userIds: [outsider.user.id] })).status, 400);
  });

  test('archive blocks posting; general cannot be archived', async () => {
    assert.equal((await ava.post(`/api/conversations/${generalId}/archive`)).status, 403);
    const r = await ava.post(`/api/conversations/${cid}/archive`);
    assert.equal(r.body.conversation.isArchived, true);
    assert.equal((await ava.post(`/api/conversations/${cid}/messages`, { text: 'hello?' })).status, 403);
    const un = await ava.post(`/api/conversations/${cid}/archive`, { archived: false });
    assert.equal(un.body.conversation.isArchived, false);
  });
});

describe('direct messages', () => {
  test('dm is deduplicated by member set', async () => {
    const a = await ava.post(`/api/w/${wid}/dms`, { userIds: [ben.user.id] });
    const b = await ben.post(`/api/w/${wid}/dms`, { userIds: [ava.user.id] });
    assert.equal(a.body.conversation.kind, 'dm');
    assert.equal(a.body.conversation.id, b.body.conversation.id);
    assert.deepEqual([...a.body.conversation.memberIds].sort(), [ava.user.id, ben.user.id].sort());
  });

  test('group dm and self dm', async () => {
    const g = await ava.post(`/api/w/${wid}/dms`, { userIds: [ben.user.id, cleo.user.id] });
    assert.equal(g.body.conversation.kind, 'group_dm');
    const g2 = await cleo.post(`/api/w/${wid}/dms`, { userIds: [ben.user.id, ava.user.id, cleo.user.id] });
    assert.equal(g.body.conversation.id, g2.body.conversation.id);
    const self = await ava.post(`/api/w/${wid}/dms`, { userIds: [] });
    assert.equal(self.body.conversation.kind, 'self');
    assert.equal((await ava.post(`/api/w/${wid}/dms`, { userIds: [outsider.user.id] })).status, 400);
  });

  test('non-participants cannot read a dm', async () => {
    const a = await ava.post(`/api/w/${wid}/dms`, { userIds: [ben.user.id] });
    assert.equal((await cleo.get(`/api/conversations/${a.body.conversation.id}/messages`)).status, 403);
  });
});

describe('messages', () => {
  let rootId: string;

  test('post with clientMsgId is idempotent', async () => {
    const a = await ava.post(`/api/conversations/${generalId}/messages`, { text: 'Hello *team*', clientMsgId: 'abc-1' });
    assert.equal(a.status, 200);
    const m = a.body.message;
    assert.match(m.id, /^M/);
    for (const key of ['id', 'conversationId', 'userId', 'text', 'threadRootId', 'replyCount', 'lastReplyAt', 'replyUserIds',
      'editedAt', 'deletedAt', 'createdAt', 'clientMsgId', 'subtype', 'meta', 'reactions', 'files', 'pinned', 'saved']) {
      assert.ok(key in m, `message has ${key}`);
    }
    const b = await ava.post(`/api/conversations/${generalId}/messages`, { text: 'Hello *team*', clientMsgId: 'abc-1' });
    assert.equal(b.body.message.id, m.id);
    assert.equal(b.body.deduped, true);
    rootId = m.id;
  });

  test('empty message rejected; non-member cannot post', async () => {
    assert.equal((await ava.post(`/api/conversations/${generalId}/messages`, { text: '   ' })).status, 400);
    assert.equal((await outsider.post(`/api/conversations/${generalId}/messages`, { text: 'hi' })).status, 404);
  });

  test('pagination returns ascending pages with hasMore', async () => {
    const ch = await ava.post(`/api/w/${wid}/channels`, { name: 'pager' });
    const id = ch.body.conversation.id;
    for (let i = 0; i < 7; i++) await ava.post(`/api/conversations/${id}/messages`, { text: `m${i}` });
    const p1 = await ava.get(`/api/conversations/${id}/messages?limit=3`);
    assert.deepEqual(p1.body.messages.map((m: any) => m.text), ['m4', 'm5', 'm6']);
    assert.equal(p1.body.hasMore, true);
    const p2 = await ava.get(`/api/conversations/${id}/messages?limit=3&before=${p1.body.messages[0].id}`);
    assert.deepEqual(p2.body.messages.map((m: any) => m.text), ['m1', 'm2', 'm3']);
    const p3 = await ava.get(`/api/conversations/${id}/messages?limit=3&before=${p2.body.messages[0].id}`);
    assert.deepEqual(p3.body.messages.map((m: any) => m.text), ['m0']);
    assert.equal(p3.body.hasMore, false);
  });

  test('threads: replies update root counts and stay out of the channel list', async () => {
    const r1 = await ben.post(`/api/conversations/${generalId}/messages`, { text: 'reply one', threadRootId: rootId });
    assert.equal(r1.body.message.threadRootId, rootId);
    await cleo.post(`/api/conversations/${generalId}/messages`, { text: 'reply two', threadRootId: r1.body.message.id });
    const thread = await ava.get(`/api/messages/${rootId}/replies`);
    assert.equal(thread.body.root.replyCount, 2);
    assert.ok(thread.body.root.lastReplyAt);
    assert.deepEqual(new Set(thread.body.root.replyUserIds), new Set([ben.user.id, cleo.user.id]));
    assert.deepEqual(thread.body.replies.map((m: any) => m.text), ['reply one', 'reply two']);
    const list = await ava.get(`/api/conversations/${generalId}/messages`);
    assert.ok(!list.body.messages.some((m: any) => m.text.startsWith('reply')));
  });

  test('alsoSendToChannel shows the reply in the channel', async () => {
    const r = await ben.post(`/api/conversations/${generalId}/messages`, { text: 'broadcast reply', threadRootId: rootId, alsoSendToChannel: true });
    assert.equal(r.body.message.subtype, 'thread_broadcast');
    const list = await ava.get(`/api/conversations/${generalId}/messages`);
    assert.ok(list.body.messages.some((m: any) => m.text === 'broadcast reply'));
  });

  test('edit only by author; marks edited', async () => {
    assert.equal((await ben.patch(`/api/messages/${rootId}`, { text: 'hacked' })).status, 403);
    const r = await ava.patch(`/api/messages/${rootId}`, { text: 'Hello *everyone*' });
    assert.equal(r.status, 200);
    assert.equal(r.body.message.text, 'Hello *everyone*');
    assert.ok(r.body.message.editedAt);
  });

  test('delete is soft; a root with replies stays as a placeholder', async () => {
    assert.equal((await cleo.del(`/api/messages/${rootId}`)).status, 403);
    const r = await ava.del(`/api/messages/${rootId}`);
    assert.equal(r.status, 200);
    assert.ok(r.body.message.deletedAt);
    assert.equal(r.body.message.text, '');
    const list = await ava.get(`/api/conversations/${generalId}/messages`);
    const placeholder = list.body.messages.find((m: any) => m.id === rootId);
    assert.ok(placeholder && placeholder.deletedAt);

    const lone = await cleo.post(`/api/conversations/${generalId}/messages`, { text: 'oops' });
    await cleo.del(`/api/messages/${lone.body.message.id}`);
    const list2 = await ava.get(`/api/conversations/${generalId}/messages`);
    assert.ok(!list2.body.messages.some((m: any) => m.id === lone.body.message.id));
  });

  test('pins and saved items', async () => {
    const m = (await ben.post(`/api/conversations/${generalId}/messages`, { text: 'pin me' })).body.message;
    const p = await ava.post(`/api/messages/${m.id}/pin`);
    assert.equal(p.body.message.pinned, true);
    const pins = await cleo.get(`/api/conversations/${generalId}/pins`);
    assert.deepEqual(pins.body.messages.map((x: any) => x.id), [m.id]);
    await ava.del(`/api/messages/${m.id}/pin`);
    assert.equal((await cleo.get(`/api/conversations/${generalId}/pins`)).body.messages.length, 0);

    const s = await cleo.post(`/api/messages/${m.id}/save`);
    assert.equal(s.body.message.saved, true);
    const saved = await cleo.get(`/api/w/${wid}/saved`);
    assert.equal(saved.body.items[0].message.id, m.id);
    const forBen = await ben.get(`/api/messages/${m.id}`);
    assert.equal(forBen.body.message.saved, false);
    await cleo.del(`/api/messages/${m.id}/save`);
    assert.equal((await cleo.get(`/api/w/${wid}/saved`)).body.items.length, 0);
  });
});

describe('read state', () => {
  test('unread and mention counts, cleared by read cursor', async () => {
    const ch = await ava.post(`/api/w/${wid}/channels`, { name: 'counts', memberIds: [ben.user.id] });
    const id = ch.body.conversation.id;
    await ava.post(`/api/conversations/${id}/messages`, { text: 'one' });
    await ava.post(`/api/conversations/${id}/messages`, { text: `hey <@${ben.user.id}>` });
    const last = await ava.post(`/api/conversations/${id}/messages`, { text: '<!here> standup' });
    // thread replies don't count toward channel unread
    await ava.post(`/api/conversations/${id}/messages`, { text: 'in thread', threadRootId: last.body.message.id });

    const list = await ben.get(`/api/w/${wid}/conversations`);
    const c = list.body.conversations.find((x: any) => x.id === id);
    assert.equal(c.unreadCount, 3);
    assert.equal(c.mentionCount, 2);

    const mine = (await ava.get(`/api/w/${wid}/conversations`)).body.conversations.find((x: any) => x.id === id);
    assert.equal(mine.unreadCount, 0);

    const r = await ben.post(`/api/conversations/${id}/read`, { ts: last.body.message.createdAt });
    assert.equal(r.body.conversation.unreadCount, 0);
    assert.equal(r.body.conversation.mentionCount, 0);
  });

  test('every unread dm message counts as a mention', async () => {
    const dm = (await cleo.post(`/api/w/${wid}/dms`, { userIds: [ben.user.id] })).body.conversation;
    await cleo.post(`/api/conversations/${dm.id}/messages`, { text: 'ping' });
    await cleo.post(`/api/conversations/${dm.id}/messages`, { text: 'pong' });
    const c = (await ben.get(`/api/w/${wid}/conversations`)).body.conversations.find((x: any) => x.id === dm.id);
    assert.equal(c.unreadCount, 2);
    assert.equal(c.mentionCount, 2);
  });
});

describe('bus events', () => {
  test('message writes emit events', async () => {
    const seen: string[] = [];
    const off = env.app.ctx.bus.on('*', (e) => seen.push(e.type));
    const m = (await ava.post(`/api/conversations/${generalId}/messages`, { text: 'evt' })).body.message;
    await ava.patch(`/api/messages/${m.id}`, { text: 'evt2' });
    await ava.del(`/api/messages/${m.id}`);
    off();
    assert.deepEqual(seen, ['message.created', 'message.updated', 'message.deleted']);
  });

  test('enrichers fill fields and ctx.messages.post works for system posts', async () => {
    env.app.ctx.messages.addEnricher((msgs) => { for (const m of msgs) m.reactions = [{ emoji: 'x', userIds: [] }]; });
    const m = env.app.ctx.messages.post({ conversationId: generalId, userId: ava.user.id, text: 'from service' });
    assert.equal(m.reactions[0].emoji, 'x');
  });
});
