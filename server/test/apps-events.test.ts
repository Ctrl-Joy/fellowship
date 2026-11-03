import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { makeTestApp, signup } from './helpers';

// Fast retries for this file: 1 attempt, then 10 ms and 20 ms, 40 ms backoff.
process.env.FELLOWSHIP_APPS_BACKOFF_MS = '10';


type Req = { path: string; body: string; headers: IncomingMessage['headers']; json: any };

let env: Awaited<ReturnType<typeof makeTestApp>>;
let ava: Awaited<ReturnType<typeof signup>>, ben: Awaited<ReturnType<typeof signup>>;
let wid: string, lounge: string, hidden: string, inviteCode: string;
let appId: string, botUserId: string, signingSecret: string;
let server: Server;
let baseUrl: string;
const hits: Req[] = [];
/** Per-path response plan: how many failures before success, and what to answer. */
const plan = new Map<string, { failures: number; reply?: (req: Req) => any }>();

/** PUT through inject as the given client (the shared test client has no put helper). */
async function put(who: { cookie: string }, url: string, payload: unknown) {
  const r = await env.app.inject({ method: 'PUT', url, headers: { cookie: who.cookie }, payload: payload as any });
  return { status: r.statusCode, body: r.json() };
}

async function readBody(req: IncomingMessage): Promise<string> {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data;
}

function verify(secret: string, headers: IncomingMessage['headers'], body: string): boolean {
  const ts = String(headers['x-fellowship-request-timestamp']);
  const expected = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');
  return headers['x-fellowship-signature'] === expected;
}

before(async () => {
  env = await makeTestApp();
  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const body = await readBody(req);
    let json: any = null;
    try { json = JSON.parse(body); } catch { json = null; }
    const entry: Req = { path: req.url ?? '', body, headers: req.headers, json };
    hits.push(entry);
    const p = plan.get(entry.path);
    if (p && p.failures > 0) {
      p.failures--;
      res.statusCode = 500;
      res.end('nope');
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(p?.reply ? p.reply(entry) : { ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;

  ava = await signup(env.app, 'Ava Owner', 'ava-events@example.test');
  ben = await signup(env.app, 'Ben Member');
  const ws = await ava.post('/api/workspaces', { name: 'Events Test' });
  wid = ws.body.workspace.id;
  inviteCode = ws.body.workspace.inviteCode;
  await ben.post(`/api/workspaces/join/${inviteCode}`);
  lounge = (await ben.post(`/api/w/${wid}/channels`, { name: 'lounge' })).body.conversation.id;
  hidden = (await ben.post(`/api/w/${wid}/channels`, { name: 'hidden' })).body.conversation.id;
  await ava.post(`/api/conversations/${lounge}/join`);

  const created = await ava.post(`/api/w/${wid}/apps`, { name: 'Watcher' });
  appId = created.body.app.id;
  botUserId = created.body.app.botUserId;
  signingSecret = created.body.app.signingSecret;
  await ava.post(`/api/w/${wid}/apps/${appId}/webhooks`, { conversationId: lounge });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await env.cleanup();
});

/** Poll until a condition is true or give up after ~3 seconds. */
async function eventually<T>(fn: () => T | undefined | null | false): Promise<T> {
  for (let i = 0; i < 150; i++) {
    const v = fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('condition not met in time');
}

describe('event subscriptions', () => {
  test('only admins can configure the events URL and types', async () => {
    const denied = await put(ben, `/api/w/${wid}/apps/${appId}/events`, { url: `${baseUrl}/events`, eventTypes: ['message.created'] });
    assert.equal(denied.status, 403);
    const bad = await put(ava, `/api/w/${wid}/apps/${appId}/events`, { url: 'javascript:alert(1)', eventTypes: [] });
    assert.equal(bad.status, 400);
    const bogusType = await put(ava, `/api/w/${wid}/apps/${appId}/events`, { url: `${baseUrl}/events`, eventTypes: ['thread.exploded'] });
    assert.equal(bogusType.status, 400);
    const ok = await put(ava, `/api/w/${wid}/apps/${appId}/events`, {
      url: `${baseUrl}/events`, eventTypes: ['message.created', 'member.joined'],
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.events.eventTypes, ['message.created', 'member.joined']);
  });

  test('a delivered event is signed with the app secret and carries the message', async () => {
    plan.set('/events', { failures: 0 });
    hits.length = 0;
    const r = await ben.post(`/api/conversations/${lounge}/messages`, { text: 'ship it' });
    assert.equal(r.status, 200);
    const hit = await eventually(() => hits.find((h) => h.json?.event?.type === 'message.created' && h.json.event.message?.text === 'ship it'));
    assert.equal(hit.json.type, 'event_callback');
    assert.equal(hit.json.api_app_id, appId);
    assert.equal(hit.json.event.channel, lounge);
    assert.equal(hit.json.event.user, ben.user.id);
    assert.ok(verify(signingSecret, hit.headers, hit.body), 'signature should verify with the app secret');
    assert.equal(verify('the-wrong-secret', hit.headers, hit.body), false);
  });

  test('the app does not get events for conversations it is not in', async () => {
    hits.length = 0;
    await ben.post(`/api/conversations/${hidden}/messages`, { text: 'private-ish chatter' });
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(!hits.some((h) => h.json?.event?.message?.text === 'private-ish chatter'));
  });

  test('the bot does not receive echoes of its own posts', async () => {
    hits.length = 0;
    await env.app.inject({
      method: 'POST', url: (await ava.get(`/api/w/${wid}/apps/${appId}`)).body.app.webhooks[0].path,
      payload: { text: 'bot says hi' },
    });
    await eventually(() => hits.find((h) => h.json?.event?.message?.text === 'bot says hi') ?? null).catch(() => null);
    // Delivered to the app? The bot is the author, so it must be skipped.
    assert.ok(!hits.some((h) => h.json?.event?.message?.text === 'bot says hi'));
  });

  test('member.joined events are delivered too', async () => {
    hits.length = 0;
    const cleo = await signup(env.app, 'Cleo Late');
    await cleo.post(`/api/workspaces/join/${inviteCode}`);
    const join = await cleo.post(`/api/conversations/${lounge}/join`);
    assert.equal(join.status, 200);
    const deliveredJoin = await eventually(() => hits.find((h) => h.json?.event?.type === 'member.joined' && h.json.event.userId === cleo.user.id) ?? null);
    assert.ok(deliveredJoin);
  });

  test('failed deliveries retry with backoff and succeed on a later attempt', async () => {
    plan.set('/flaky', { failures: 2 });
    await put(ava, `/api/w/${wid}/apps/${appId}/events`, { url: `${baseUrl}/flaky`, eventTypes: ['message.created'] });
    hits.length = 0;
    await ben.post(`/api/conversations/${lounge}/messages`, { text: 'retry me' });
    const row = await eventually(() => {
      const r = env.app.ctx.db.prepare(
        "SELECT * FROM apps_event_deliveries WHERE app_id = ? AND body LIKE '%retry me%'",
      ).get(appId) as any;
      return r && r.status === 'delivered' ? r : null;
    });
    assert.equal(row.attempts, 3);
    assert.equal(hits.filter((h) => h.path === '/flaky').length, 3);
  });

  test('after 4 failed attempts the delivery is marked failed and the log shows why', async () => {
    plan.set('/dead', { failures: 99 });
    await put(ava, `/api/w/${wid}/apps/${appId}/events`, { url: `${baseUrl}/dead`, eventTypes: ['message.created'] });
    await ben.post(`/api/conversations/${lounge}/messages`, { text: 'never arrives' });
    const row = await eventually(() => {
      const r = env.app.ctx.db.prepare(
        "SELECT * FROM apps_event_deliveries WHERE app_id = ? AND body LIKE '%never arrives%'",
      ).get(appId) as any;
      return r && r.status === 'failed' ? r : null;
    });
    assert.equal(row.attempts, 4);
    assert.equal(row.last_status, 500);
    assert.match(row.last_error, /HTTP 500/);
    const detail = await ava.get(`/api/w/${wid}/apps/${appId}`);
    assert.ok(detail.body.app.events.deliveries.some((d: any) => d.status === 'failed'));
  });

  test('the admin can send a test event and see it in the log', async () => {
    plan.set('/test-ok', { failures: 0 });
    await put(ava, `/api/w/${wid}/apps/${appId}/events`, { url: `${baseUrl}/test-ok`, eventTypes: ['message.created'] });
    const noUrl = await ben.post(`/api/w/${wid}/apps/${appId}/events/test`, {});
    assert.equal(noUrl.status, 403);
    const ok = await ava.post(`/api/w/${wid}/apps/${appId}/events/test`, {});
    assert.equal(ok.status, 200);
    const hit = await eventually(() => hits.find((h) => h.json?.event?.type === 'app.test') ?? null);
    assert.ok(verify(signingSecret, hit.headers, hit.body));
  });
});

describe('interactive buttons', () => {
  let msgId: string;
  let clicks: Req[] = [];

  before(async () => {
    plan.set('/interact', {
      failures: 0,
      reply: (req) => {
        clicks.push(req);
        const action = req.json.actions[0];
        if (action.actionId === 'approve') return { replace_original: true, text: `Approved by ${req.json.user.name}` };
        if (action.actionId === 'nudge') return { ephemeral_text: 'Only you can see this note' };
        return {};
      },
    });
    await put(ava, `/api/w/${wid}/apps/${appId}/interactivity`, { url: `${baseUrl}/interact` });
    const r = await env.app.inject({
      method: 'POST',
      url: (await ava.get(`/api/w/${wid}/apps/${appId}`)).body.app.webhooks[0].path,
      payload: {
        text: 'Release 42 is ready',
        blocks: [{ type: 'actions', elements: [
          { type: 'button', actionId: 'approve', text: 'Approve', style: 'primary', value: 'r42' },
          { type: 'button', actionId: 'nudge', text: 'Nudge' },
        ] }],
      },
    });
    msgId = r.json().message.id;
  });

  test('clicking a button calls the interactivity URL with the signed payload', async () => {
    clicks = [];
    const r = await ben.post(`/api/messages/${msgId}/actions`, { actionId: 'approve', value: 'r42' });
    assert.equal(r.status, 200);
    assert.equal(clicks.length, 1);
    const c = clicks[0];
    assert.equal(c.json.type, 'block_actions');
    assert.equal(c.json.user.id, ben.user.id);
    assert.equal(c.json.message.id, msgId);
    assert.equal(c.json.actions[0].actionId, 'approve');
    assert.equal(c.json.actions[0].value, 'r42');
    assert.ok(verify(signingSecret, c.headers, c.body));
  });

  test('replace_original updates the app message for everyone (live edit)', async () => {
    const m = await ava.get(`/api/messages/${msgId}`);
    assert.equal(m.body.message.text, 'Approved by Ben');
    assert.ok(m.body.message.editedAt);
  });

  test('an ephemeral_text answer goes only to the clicker', async () => {
    const captured: any[] = [];
    const off = env.app.ctx.bus.on('message.ephemeral', (e) => captured.push(e));
    await ava.post(`/api/messages/${msgId}/actions`, { actionId: 'nudge' });
    off();
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].audience, [ava.user.id]);
    assert.equal(captured[0].payload.message.text, 'Only you can see this note');
  });

  test('unknown actions are rejected before reaching the app', async () => {
    clicks = [];
    const r = await ben.post(`/api/messages/${msgId}/actions`, { actionId: 'delete-everything' });
    assert.equal(r.status, 400);
    assert.equal(clicks.length, 0);
  });

  test('apps without an interactivity URL cannot answer clicks', async () => {
    const other = await ava.post(`/api/w/${wid}/apps`, { name: 'Quiet' });
    const hook = await ava.post(`/api/w/${wid}/apps/${other.body.app.id}/webhooks`, { conversationId: lounge });
    assert.equal(hook.status, 200);
    const posted = await env.app.inject({
      method: 'POST', url: hook.body.webhook.path,
      payload: { text: 'quiet', blocks: [{ type: 'actions', elements: [{ type: 'button', actionId: 'x', text: 'X' }] }] },
    });
    const r = await ben.post(`/api/messages/${posted.json().message.id}/actions`, { actionId: 'x' });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'no_interactivity_url');
  });
});
