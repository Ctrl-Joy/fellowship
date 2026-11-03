import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import { makeTestApp, signup, type TestClient } from './helpers';

let env: Awaited<ReturnType<typeof makeTestApp>>;
let ava: TestClient, ben: TestClient, cleo: TestClient;
let wid: string;
let lounge: string;
let appId: string;
let botUserId: string;
let ephemerals: any[] = [];
let captureOff: () => void;

// Local stand-in for an external app's slash command endpoint.
let server: Server;
let baseUrl: string;
const received: { url: string; form: Record<string, string>; headers: IncomingMessage['headers'] }[] = [];
let mode: 'in_channel' | 'ephemeral' | 'slow' | 'error' | 'callback' = 'ephemeral';

async function readBody(req: IncomingMessage): Promise<string> {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data;
}

before(async () => {
  env = await makeTestApp();
  server = createServer(async (req, res) => {
    const raw = await readBody(req);
    const form = Object.fromEntries(new URLSearchParams(raw));
    received.push({ url: req.url ?? '', form, headers: req.headers });
    if (req.url?.startsWith('/slow')) {
      await new Promise((r) => setTimeout(r, 3500));
      res.end('late');
      return;
    }
    if (req.url?.startsWith('/error')) {
      res.statusCode = 500;
      res.end('boom');
      return;
    }
    if (req.url?.startsWith('/callback')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ text: 'Working on it…', response_type: 'ephemeral' }));
      // Follow-up through response_url, after the immediate answer.
      setTimeout(() => {
        // The in-process app is not listening, so deliver through inject().
        env.app.inject({
          method: 'POST',
          url: new URL(form.response_url).pathname,
          payload: { text: 'Done: 3 items', response_type: 'in_channel' },
        }).catch(() => undefined);
      }, 50);
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      text: `weather for ${form.text || 'nowhere'}`,
      response_type: mode === 'in_channel' ? 'in_channel' : 'ephemeral',
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  baseUrl = `http://127.0.0.1:${port}`;

  ava = await signup(env.app, 'Ava Admin', 'ava-cmd@example.test');
  ben = await signup(env.app, 'Ben Member');
  cleo = await signup(env.app, 'Cleo Guest');
  const ws = await ava.post('/api/workspaces', { name: 'Commands Test' });
  wid = ws.body.workspace.id;
  await ben.post(`/api/workspaces/join/${ws.body.workspace.inviteCode}`);
  await cleo.post(`/api/workspaces/join/${ws.body.workspace.inviteCode}`);
  const ch = await ben.post(`/api/w/${wid}/channels`, { name: 'lounge' });
  lounge = ch.body.conversation.id;
  await ava.post(`/api/conversations/${lounge}/join`);

  ephemerals = [];
  captureOff = env.app.ctx.bus.on('message.ephemeral', (e) => ephemerals.push(e));

  const created = await ava.post(`/api/w/${wid}/apps`, { name: 'Weather', iconEmoji: ':sunny:' });
  appId = created.body.app.id;
  botUserId = created.body.app.botUserId;
});

after(async () => {
  captureOff?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await env.cleanup();
});

const run = (who: TestClient, command: string, text = '') =>
  who.post(`/api/conversations/${lounge}/commands`, { command, text });

const recentMessages = async () => (await ava.get(`/api/conversations/${lounge}/messages?limit=100`)).body.messages;

describe('command discovery', () => {
  test('the list includes built-ins and registered app commands', async () => {
    const r = await ben.get(`/api/w/${wid}/commands`);
    assert.equal(r.status, 200);
    const names = r.body.commands.map((c: any) => c.command);
    for (const n of ['me', 'shrug', 'topic', 'invite', 'leave', 'remind', 'poll']) assert.ok(names.includes(n), n);
    assert.ok(r.body.commands.every((c: any) => typeof c.usage === 'string'));
  });

  test('built-in names cannot be registered as app commands; duplicates are refused', async () => {
    const reserved = await ava.post(`/api/w/${wid}/apps/${appId}/commands`, { command: '/poll', url: `${baseUrl}/x` });
    assert.equal(reserved.status, 409);
    const badUrl = await ava.post(`/api/w/${wid}/apps/${appId}/commands`, { command: 'weather', url: 'ftp://nope' });
    assert.equal(badUrl.status, 400);
    const ok = await ava.post(`/api/w/${wid}/apps/${appId}/commands`, { command: '/weather', url: `${baseUrl}/weather`, description: 'Forecast', usageHint: '/weather <city>' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.command.command, 'weather');
    const dup = await ava.post(`/api/w/${wid}/apps/${appId}/commands`, { command: 'weather', url: `${baseUrl}/weather` });
    assert.equal(dup.status, 409);
  });
});

describe('built-in commands', () => {
  test('/me posts an italic action as the user', async () => {
    const r = await run(ben, 'me', 'waves hello');
    assert.equal(r.status, 200);
    assert.equal(r.body.kind, 'builtin');
    const msgs = await recentMessages();
    const last = msgs[msgs.length - 1];
    assert.equal(last.userId, ben.user.id);
    assert.match(last.text, /^_Ben waves hello_$/);
  });

  test('/shrug appends the shrug', async () => {
    await run(ben, 'shrug', 'whatever');
    const last = (await recentMessages()).at(-1);
    assert.equal(last.text, 'whatever ¯\\_(ツ)_/¯');
  });

  test('/topic sets the channel topic for everyone', async () => {
    const r = await run(ben, 'topic', 'Ship it on Fridays');
    assert.equal(r.status, 200);
    const conv = await ava.get(`/api/conversations/${lounge}`);
    assert.equal(conv.body.conversation.topic, 'Ship it on Fridays');
  });

  test('usage errors come back as ephemeral messages to the invoker only', async () => {
    ephemerals = [];
    const r = await run(ben, 'topic', '');
    assert.equal(r.status, 200);
    assert.equal(ephemerals.length, 1);
    assert.deepEqual(ephemerals[0].audience, [ben.user.id]);
    assert.match(ephemerals[0].payload.message.text, /Usage: \/topic/);
    assert.equal(ephemerals[0].payload.message.subtype, 'ephemeral');
    // Ephemeral messages are never stored.
    const stored = env.app.ctx.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE text LIKE 'Usage: /topic%'").get() as any;
    assert.equal(stored.n, 0);
  });

  test('/invite adds people to the channel and reports anyone it could not find', async () => {
    const r = await run(ava, 'invite', '@Cleo Guest @nobody-here');
    assert.equal(r.status, 200);
    const members = await ava.get(`/api/conversations/${lounge}/members`);
    assert.ok(members.body.userIds.includes(cleo.user.id));
    const notice = ephemerals.at(-1).payload.message.text;
    assert.match(notice, /Invited Cleo Guest/);
    assert.match(notice, /Could not find/);
  });

  test('/leave removes the invoker from the channel', async () => {
    const r = await run(ben, 'leave');
    assert.equal(r.status, 200);
    const members = await ava.get(`/api/conversations/${lounge}/members`);
    assert.ok(!members.body.userIds.includes(ben.user.id));
    // Put Ben back for the rest of the suite.
    await ben.post(`/api/conversations/${lounge}/join`);
  });

  test('/remind me fires a DM from the Fellowship Bot when due, using a controllable clock', async () => {
    const before = Date.now();
    const r = await run(ben, 'remind', 'me to stretch in 2 hours');
    assert.equal(r.status, 200);
    const reminder = env.app.ctx.db.prepare('SELECT * FROM apps_reminders WHERE user_id = ?').get(ben.user.id) as any;
    assert.ok(reminder.due_at >= before + 2 * 3600_000 - 50 && reminder.due_at <= Date.now() + 2 * 3600_000 + 50);
    const early = env.app.appsRunReminders(reminder.due_at - 1);
    assert.equal(early, 0);
    const late = env.app.appsRunReminders(reminder.due_at + 60_000);
    assert.equal(late, 1);
    const sys = env.app.ctx.db.prepare("SELECT bot_user_id FROM apps WHERE workspace_id = ? AND is_system = 1").get(wid) as any;
    const dm = env.app.ctx.db.prepare(
      "SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.kind = 'dm' AND m.text = 'Reminder: to stretch'",
    ).get() as any;
    assert.ok(dm, 'reminder message should exist');
    assert.equal(dm.user_id, sys.bot_user_id);
    // Delivered once only.
    assert.equal(env.app.appsRunReminders(reminder.due_at + 120_000), 0);
  });

  test('/remind rejects a bad phrase with a usage hint', async () => {
    ephemerals = [];
    await run(ben, 'remind', 'stretch sometime');
    assert.match(ephemerals.at(-1).payload.message.text, /Usage: \/remind/);
  });

  test('/poll creates a poll and votes change the live counts', async () => {
    const r = await run(ben, 'poll', '"Lunch?" "Pizza" "Sushi"');
    assert.equal(r.status, 200);
    const poll = (await recentMessages()).find((m: any) => m.subtype === 'poll');
    assert.ok(poll);
    assert.equal(poll.text, 'Lunch?');
    assert.equal(poll.meta.poll.options.length, 2);
    assert.equal(poll.meta.poll.totalVotes, 0);

    const v1 = await ben.post(`/api/apps/polls/${poll.id}/vote`, { optionId: 'o1' });
    assert.equal(v1.status, 200);
    assert.deepEqual(v1.body.message.meta.poll.counts, { o1: 1 });
    assert.deepEqual(v1.body.message.meta.poll.voters.o1, [ben.user.id]);

    // Cleo was invited earlier, so she is a member and can vote.
    const v2 = await cleo.post(`/api/apps/polls/${poll.id}/vote`, { optionId: 'o2' });
    assert.deepEqual(v2.body.message.meta.poll.counts, { o1: 1, o2: 1 });

    // Changing a vote moves it.
    const v3 = await ben.post(`/api/apps/polls/${poll.id}/vote`, { optionId: 'o2' });
    assert.equal(v3.body.message.meta.poll.counts.o2, 2);
    assert.equal(v3.body.message.meta.poll.counts.o1 ?? 0, 0);
    assert.equal(v3.body.message.meta.poll.totalVotes, 2);

    // Other viewers see the same totals; their own vote differs.
    const asCleo = await cleo.get(`/api/messages/${poll.id}`);
    assert.ok(asCleo.body.message.meta.poll.voters.o2.includes(cleo.user.id));
    assert.ok(!(asCleo.body.message.meta.poll.voters.o1 ?? []).includes(cleo.user.id));
    const asAva = await ava.get(`/api/messages/${poll.id}`);
    assert.ok(!Object.values(asAva.body.message.meta.poll.voters).flat().includes(ava.user.id));

    const bad = await ben.post(`/api/apps/polls/${poll.id}/vote`, { optionId: 'o9' });
    assert.equal(bad.status, 400);
    const plain = (await recentMessages()).find((m: any) => !m.meta?.poll && m.text);
    const notPoll = await ben.post(`/api/apps/polls/${plain.id}/vote`, { optionId: 'o1' });
    assert.equal(notPoll.status, 400);
  });

  test('bad poll syntax gets a usage hint, and unknown commands are 404', async () => {
    ephemerals = [];
    await run(ben, 'poll', '"Only a question"');
    assert.match(ephemerals.at(-1).payload.message.text, /Usage: \/poll/);
    const unknown = await run(ben, 'nonexistent');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error.code, 'unknown_command');
  });

  test('commands need channel membership', async () => {
    const r = await env.app.inject({
      method: 'POST', url: `/api/conversations/${lounge}/commands`,
      headers: { cookie: `fs_session=` }, payload: { command: 'me', text: 'x' },
    });
    assert.equal(r.statusCode, 401);
  });
});

describe('custom app commands', () => {
  test('in_channel replies are posted by the app bot', async () => {
    mode = 'in_channel';
    received.length = 0;
    const r = await run(ben, 'weather', 'Oslo');
    assert.equal(r.status, 200);
    assert.equal(r.body.kind, 'app');
    assert.equal(r.body.responseType, 'in_channel');
    const msg = (await recentMessages()).at(-1);
    assert.equal(msg.userId, botUserId);
    assert.equal(msg.text, 'weather for Oslo');
    assert.equal(msg.meta.app.name, 'Weather');
    assert.equal(msg.meta.command, '/weather');
  });

  test('the app receives form data with the invocation details and a signature header', async () => {
    const call = received.at(-1)!;
    assert.equal(call.form.command, '/weather');
    assert.equal(call.form.text, 'Oslo');
    assert.equal(call.form.user_id, ben.user.id);
    assert.equal(call.form.channel_id, lounge);
    assert.match(call.form.response_url, /\/api\/hooks\/response\//);
    assert.match(String(call.headers['x-fellowship-signature']), /^v0=[0-9a-f]{64}$/);
    assert.match(String(call.headers['content-type']), /x-www-form-urlencoded/);
  });

  test('ephemeral replies go to the invoker only and are not stored', async () => {
    mode = 'ephemeral';
    ephemerals = [];
    const before = (await recentMessages()).length;
    const r = await run(cleo, 'weather', 'Rome');
    assert.equal(r.body.responseType, 'ephemeral');
    assert.equal(ephemerals.length, 1);
    assert.deepEqual(ephemerals[0].audience, [cleo.user.id]);
    assert.equal(ephemerals[0].payload.message.text, 'weather for Rome');
    assert.equal((await recentMessages()).length, before);
  });

  test('a slow app is abandoned after 3 seconds with an ephemeral error', async () => {
    await ava.post(`/api/w/${wid}/apps/${appId}/commands`, { command: 'slowcmd', url: `${baseUrl}/slow` });
    ephemerals = [];
    const started = Date.now();
    const r = await run(ben, 'slowcmd', 'x');
    const elapsed = Date.now() - started;
    assert.equal(r.status, 200);
    assert.ok(elapsed >= 2900 && elapsed < 4500, `elapsed ${elapsed}`);
    assert.match(ephemerals.at(-1).payload.message.text, /did not respond/);
  });

  test('an app error response becomes an ephemeral error', async () => {
    await ava.post(`/api/w/${wid}/apps/${appId}/commands`, { command: 'errcmd', url: `${baseUrl}/error` });
    ephemerals = [];
    await run(ben, 'errcmd');
    assert.match(ephemerals.at(-1).payload.message.text, /HTTP 500/);
  });

  test('response_url lets the app post a follow-up later', async () => {
    await ava.post(`/api/w/${wid}/apps/${appId}/commands`, { command: 'jobs', url: `${baseUrl}/callback` });
    ephemerals = [];
    const r = await run(ben, 'jobs');
    assert.equal(r.body.responseType, 'ephemeral');
    assert.equal(ephemerals.at(-1).payload.message.text, 'Working on it…');
    // The follow-up arrives asynchronously through response_url.
    let found: any = null;
    for (let i = 0; i < 40 && !found; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      found = (await recentMessages()).find((m: any) => m.text === 'Done: 3 items');
    }
    assert.ok(found, 'follow-up message should be posted');
    assert.equal(found.userId, botUserId);
  });

  test('deleting a command removes it from autocomplete', async () => {
    const list = await ava.get(`/api/w/${wid}/apps/${appId}`);
    const cmd = list.body.app.commands.find((c: any) => c.command === 'errcmd');
    const del = await ava.del(`/api/w/${wid}/apps/${appId}/commands/${cmd.id}`);
    assert.equal(del.status, 200);
    const names = (await ben.get(`/api/w/${wid}/commands`)).body.commands.map((c: any) => c.command);
    assert.ok(!names.includes('errcmd'));
  });
});
