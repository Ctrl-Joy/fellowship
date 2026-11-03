import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeTestApp, signup, type TestClient } from './helpers';

let env: Awaited<ReturnType<typeof makeTestApp>>;
let ava: TestClient, ben: TestClient, cleo: TestClient;
let wid: string;
let inviteCode: string;
let appId: string;
let botUserId: string;
let token: string;
let secret: string;

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const botCall = (method: 'GET' | 'POST', url: string, t: string, payload?: unknown) =>
  env.app.inject({ method, url, headers: bearer(t), payload: payload as any });

before(async () => {
  env = await makeTestApp();
  ava = await signup(env.app, 'Ava Owner', 'ava-apps@example.test');
  ben = await signup(env.app, 'Ben Member');
  cleo = await signup(env.app, 'Cleo Outsider');
  const ws = await ava.post('/api/workspaces', { name: 'Apps Test' });
  wid = ws.body.workspace.id;
  inviteCode = ws.body.workspace.inviteCode;
  await ben.post(`/api/workspaces/join/${inviteCode}`);
});

after(async () => { await env.cleanup(); });

describe('app management', () => {
  test('members cannot create apps; admins can', async () => {
    const denied = await ben.post(`/api/w/${wid}/apps`, { name: 'Sneaky' });
    assert.equal(denied.status, 403);
    const r = await ava.post(`/api/w/${wid}/apps`, { name: 'Deploy Bot', description: 'Ships things', iconEmoji: ':rocket:' });
    assert.equal(r.status, 200);
    appId = r.body.app.id;
    botUserId = r.body.app.botUserId;
    token = r.body.token.value;
    assert.match(token, /^fsbot_/);
    assert.deepEqual(r.body.token.scopes.sort(), ['channels:history', 'channels:join', 'channels:read', 'chat:write', 'reactions:write', 'users:read'].sort());
    assert.match(r.body.app.id, /^AP/);
    secret = r.body.app.signingSecret;
    assert.ok(secret.length >= 32);
  });

  test('the bot is an active workspace member flagged as a bot', async () => {
    const members = await ava.get(`/api/w/${wid}/members`);
    const bot = members.body.members.find((m: any) => m.id === botUserId);
    assert.ok(bot, 'bot should be listed as a member');
    assert.equal(bot.isBot, true);
    assert.equal(bot.deactivated, false);
    // Bots cannot log in with a password.
    const login = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: bot.email, password: 'anything-here' } });
    assert.equal(login.statusCode, 401);
  });

  test('only the token hash is stored, never the token', async () => {
    const rows = env.app.ctx.db.prepare('SELECT token_hash FROM apps_tokens WHERE app_id = ?').all(appId) as any[];
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].token_hash, token);
    assert.equal(rows[0].token_hash, createHash('sha256').update(token).digest('hex'));
  });

  test('the app list is visible to members without secrets; detail is admin-only', async () => {
    const list = await ben.get(`/api/w/${wid}/apps`);
    assert.equal(list.status, 200);
    const app = list.body.apps.find((a: any) => a.id === appId);
    assert.equal(app.name, 'Deploy Bot');
    assert.equal(app.signingSecret, undefined);
    assert.equal(app.token, undefined);
    const memberDetail = await ben.get(`/api/w/${wid}/apps/${appId}`);
    assert.equal(memberDetail.status, 403);
    const adminDetail = await ava.get(`/api/w/${wid}/apps/${appId}`);
    assert.equal(adminDetail.status, 200);
    assert.equal(adminDetail.body.app.signingSecret, secret);
  });

  test('a built-in Fellowship Bot exists and cannot be deleted', async () => {
    const list = await ava.get(`/api/w/${wid}/apps`);
    const sys = list.body.apps.find((a: any) => a.isSystem);
    assert.equal(sys?.name, 'Fellowship Bot');
    const del = await ava.del(`/api/w/${wid}/apps/${sys.id}`);
    assert.equal(del.status, 403);
  });

  test('PATCH renames the app and its bot user', async () => {
    const r = await ava.patch(`/api/w/${wid}/apps/${appId}`, { name: 'Release Bot' });
    assert.equal(r.status, 200);
    assert.equal(r.body.app.name, 'Release Bot');
    const members = await ava.get(`/api/w/${wid}/members`);
    assert.equal(members.body.members.find((m: any) => m.id === botUserId).displayName, 'Release Bot');
  });
});

describe('bot token auth and scopes', () => {
  test('missing or unknown bearer tokens get 401', async () => {
    const none = await env.app.inject({ method: 'GET', url: '/api/bot/auth.test' });
    assert.equal(none.statusCode, 401);
    const bad = await botCall('GET', '/api/bot/auth.test', 'fsbot_not-a-real-token');
    assert.equal(bad.statusCode, 401);
    const ok = await botCall('GET', '/api/bot/auth.test', token);
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().botUserId, botUserId);
    assert.equal(ok.json().workspaceId, wid);
  });

  test('a token without the scope is refused with missing_scope', async () => {
    const r = await ava.post(`/api/w/${wid}/apps/${appId}/token`, { scopes: ['channels:read'] });
    assert.equal(r.status, 200);
    const limited = r.body.token.value;
    const res = await botCall('POST', '/api/bot/chat.post', limited, { channel: 'general', text: 'hi' });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'missing_scope');
    const list = await botCall('GET', '/api/bot/conversations.list', limited);
    assert.equal(list.statusCode, 200);
    // Rotation revokes the previous token immediately.
    const old = await botCall('GET', '/api/bot/auth.test', token);
    assert.equal(old.statusCode, 401);
    token = limited;
  });

  test('restore a full-scope token for the rest of the suite', async () => {
    const r = await ava.post(`/api/w/${wid}/apps/${appId}/token`, {});
    token = r.body.token.value;
    const ok = await botCall('GET', '/api/bot/auth.test', token);
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().scopes.includes('chat:write'), true);
  });

  test('a non-admin cannot rotate the token', async () => {
    const r = await ben.post(`/api/w/${wid}/apps/${appId}/token`, {});
    assert.equal(r.status, 403);
  });
});

describe('bot posting', () => {
  let lounge: string;
  let secretChannel: string;

  before(async () => {
    const l = await ben.post(`/api/w/${wid}/channels`, { name: 'lounge' });
    lounge = l.body.conversation.id;
    const p = await ben.post(`/api/w/${wid}/channels`, { name: 'private-stuff', isPrivate: true });
    secretChannel = p.body.conversation.id;
  });

  test('posting needs membership: not_in_channel until the bot joins', async () => {
    const r = await botCall('POST', '/api/bot/chat.post', token, { channel: '#lounge', text: 'hello' });
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().error.code, 'not_in_channel');
    const join = await botCall('POST', '/api/bot/conversations.join', token, { channel: 'lounge' });
    assert.equal(join.statusCode, 200);
    assert.equal(join.json().channel.isMember, true);
    const ok = await botCall('POST', '/api/bot/chat.post', token, { channel: lounge, text: 'hello from the bot' });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().message.userId, botUserId);
    assert.equal(ok.json().message.meta.app.name, 'Release Bot');
  });

  test('private channels cannot be joined by bots and the bot cannot post there', async () => {
    const join = await botCall('POST', '/api/bot/conversations.join', token, { channel: 'private-stuff' });
    assert.equal(join.statusCode, 403);
    assert.equal(join.json().error.code, 'private_channel');
    const post = await botCall('POST', '/api/bot/chat.post', token, { channel: secretChannel, text: 'nope' });
    assert.equal(post.statusCode, 403);
  });

  test('unknown channels and empty bodies are rejected', async () => {
    const missing = await botCall('POST', '/api/bot/chat.post', token, { channel: 'no-such-channel', text: 'x' });
    assert.equal(missing.statusCode, 404);
    const empty = await botCall('POST', '/api/bot/chat.post', token, { channel: lounge, text: '   ' });
    assert.equal(empty.statusCode, 400);
  });

  test('chat.post with action blocks stores the buttons on the message', async () => {
    const r = await botCall('POST', '/api/bot/chat.post', token, {
      channel: lounge,
      text: 'Approve the release?',
      blocks: [
        { type: 'section', text: 'Build 42 is ready.' },
        { type: 'actions', elements: [
          { type: 'button', actionId: 'approve', text: 'Approve', style: 'primary', value: '42' },
          { type: 'button', actionId: 'reject', text: 'Reject', style: 'danger' },
        ] },
      ],
    });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json().message.meta.actions.map((a: any) => a.actionId), ['approve', 'reject']);
  });

  test('history returns the bot posts and conversations.list includes the channel', async () => {
    const h = await botCall('GET', `/api/bot/conversations.history?channel=${lounge}&limit=10`, token);
    assert.equal(h.statusCode, 200);
    assert.ok(h.json().messages.some((m: any) => m.text === 'hello from the bot'));
    const list = await botCall('GET', '/api/bot/conversations.list', token);
    assert.ok(list.json().channels.some((c: any) => c.id === lounge));
  });

  test('chat.update changes only the bot’s own messages', async () => {
    const posted = await botCall('POST', '/api/bot/chat.post', token, { channel: lounge, text: 'draft' });
    const ts = posted.json().ts;
    const upd = await botCall('POST', '/api/bot/chat.update', token, { channel: lounge, ts, text: 'final' });
    assert.equal(upd.statusCode, 200);
    assert.equal(upd.json().message.text, 'final');
    assert.ok(upd.json().message.editedAt);
    const humanMsg = await ben.post(`/api/conversations/${lounge}/messages`, { text: 'human words' });
    const forbidden = await botCall('POST', '/api/bot/chat.update', token, { channel: lounge, ts: humanMsg.body.message.id, text: 'hacked' });
    assert.equal(forbidden.statusCode, 403);
  });

  test('chat.delete removes the bot’s own message from history', async () => {
    const posted = await botCall('POST', '/api/bot/chat.post', token, { channel: lounge, text: 'to be deleted' });
    const ts = posted.json().ts;
    const del = await botCall('POST', '/api/bot/chat.delete', token, { channel: lounge, ts });
    assert.equal(del.statusCode, 200);
    const h = await botCall('GET', `/api/bot/conversations.history?channel=${lounge}&limit=50`, token);
    assert.ok(!h.json().messages.some((m: any) => m.id === ts));
  });

  test('users.info returns workspace members only', async () => {
    const info = await botCall('GET', `/api/bot/users.info?user=${ben.user.id}`, token);
    assert.equal(info.statusCode, 200);
    assert.equal(info.json().user.fullName, 'Ben Member');
    const outsider = await botCall('GET', `/api/bot/users.info?user=${cleo.user.id}`, token);
    assert.equal(outsider.statusCode, 404);
  });
});

describe('incoming webhooks', () => {
  let hookPath: string;
  let lounge: string;

  before(async () => {
    const list = await ava.get(`/api/w/${wid}/channels/browse`);
    lounge = list.body.channels.find((c: any) => c.name === 'lounge').id;
  });

  test('only admins can create a webhook; it adds the bot to the channel', async () => {
    const denied = await ben.post(`/api/w/${wid}/apps/${appId}/webhooks`, { conversationId: lounge });
    assert.equal(denied.status, 403);
    const r = await ava.post(`/api/w/${wid}/apps/${appId}/webhooks`, { conversationId: lounge });
    assert.equal(r.status, 200);
    hookPath = r.body.webhook.path;
    assert.match(hookPath, /^\/api\/hooks\/incoming\/[A-Za-z0-9_-]{20,}$/);
    assert.ok(env.app.ctx.access.isConversationMember(lounge, botUserId));
  });

  test('a POST becomes a message posted as the bot, with an override name', async () => {
    const r = await env.app.inject({ method: 'POST', url: hookPath, payload: { text: 'deploy finished', username: 'CI', icon_emoji: ':ship:' } });
    assert.equal(r.statusCode, 200);
    const msg = r.json().message;
    assert.equal(msg.userId, botUserId);
    assert.equal(msg.text, 'deploy finished');
    assert.deepEqual(msg.meta.override, { username: 'CI', iconEmoji: ':ship:' });
    const history = await ava.get(`/api/conversations/${lounge}/messages`);
    assert.ok(history.body.messages.some((m: any) => m.text === 'deploy finished'));
  });

  test('unknown secrets are 404 and empty bodies are 400', async () => {
    const unknown = await env.app.inject({ method: 'POST', url: '/api/hooks/incoming/nope-nope-nope-nope-nope', payload: { text: 'x' } });
    assert.equal(unknown.statusCode, 404);
    const empty = await env.app.inject({ method: 'POST', url: hookPath, payload: {} });
    assert.equal(empty.statusCode, 400);
  });

  test('rate limit: a burst of 10, then 429 with Retry-After', async () => {
    const url = hookPath;
    const results: number[] = [];
    let retryAfter: string | undefined;
    for (let i = 0; i < 12; i++) {
      const r = await env.app.inject({ method: 'POST', url, payload: { text: `burst ${i}` } });
      results.push(r.statusCode);
      if (r.statusCode === 429) retryAfter = r.headers['retry-after'] as string;
    }
    const allowed = results.filter((c) => c === 200).length;
    const limited = results.filter((c) => c === 429).length;
    assert.ok(allowed >= 8 && allowed <= 10, `allowed ${allowed}`);
    assert.ok(limited >= 1);
    assert.ok(Number(retryAfter) >= 1);
    // After the bucket refills (1 token per second) the webhook works again.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const again = await env.app.inject({ method: 'POST', url, payload: { text: 'after wait' } });
    assert.equal(again.statusCode, 200);
  });

  test('deleting a webhook makes its URL dead', async () => {
    const list = await ava.get(`/api/w/${wid}/apps/${appId}`);
    const hook = list.body.app.webhooks.find((h: any) => h.path === hookPath);
    const del = await ava.del(`/api/w/${wid}/apps/${appId}/webhooks/${hook.id}`);
    assert.equal(del.status, 200);
    const r = await env.app.inject({ method: 'POST', url: hookPath, payload: { text: 'gone' } });
    assert.equal(r.statusCode, 404);
  });
});

describe('access to the bot API for non-members', () => {
  test('a user outside the workspace cannot see app data', async () => {
    const r = await cleo.get(`/api/w/${wid}/apps`);
    assert.equal(r.status, 404);
  });
});
