import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { makeTestApp, signup, type TestClient } from './helpers';

let env: Awaited<ReturnType<typeof makeTestApp>>;
let ava: TestClient, ben: TestClient, cleo: TestClient;
let wid: string, lounge: string, hookPath: string, appId: string;
let port: number;

type Socket = { ws: WebSocket; frames: any[] };
const sockets: Socket[] = [];

function connect(client: TestClient): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: client.cookie } });
    const s: Socket = { ws, frames: [] };
    ws.on('message', (raw) => s.frames.push(JSON.parse(String(raw))));
    ws.on('open', () => { sockets.push(s); resolve(s); });
    ws.on('error', reject);
  });
}

/** Wait until a frame matching the predicate arrives on the socket (or time out). */
async function frame(s: Socket, pred: (f: any) => boolean, ms = 1500): Promise<any | null> {
  const started = Date.now();
  for (;;) {
    const hit = s.frames.find(pred);
    if (hit) return hit;
    if (Date.now() - started > ms) return null;
    await new Promise((r) => setTimeout(r, 15));
  }
}

async function quietFor(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

before(async () => {
  env = await makeTestApp();
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  port = (env.app.server.address() as any).port;

  ava = await signup(env.app, 'Ava Owner', 'ava-rt@example.test');
  ben = await signup(env.app, 'Ben Member');
  cleo = await signup(env.app, 'Cleo Outsider');
  const ws = await ava.post('/api/workspaces', { name: 'Realtime Test' });
  wid = ws.body.workspace.id;
  const invite = ws.body.workspace.inviteCode;
  await ben.post(`/api/workspaces/join/${invite}`);
  await cleo.post(`/api/workspaces/join/${invite}`);
  lounge = (await ben.post(`/api/w/${wid}/channels`, { name: 'lounge' })).body.conversation.id;
  await ava.post(`/api/conversations/${lounge}/join`);
  // Cleo is in the workspace but deliberately NOT in #lounge.

  const created = await ava.post(`/api/w/${wid}/apps`, { name: 'Notifier' });
  appId = created.body.app.id;
  const hook = await ava.post(`/api/w/${wid}/apps/${appId}/webhooks`, { conversationId: lounge });
  hookPath = hook.body.webhook.path;
});

after(async () => {
  // Let every socket finish closing before the database goes away.
  await Promise.all(sockets.map((s) => new Promise<void>((resolve) => {
    if (s.ws.readyState === WebSocket.CLOSED) return resolve();
    s.ws.once('close', () => resolve());
    s.ws.close();
  })));
  await env.cleanup();
});

describe('realtime delivery for apps', () => {
  let sAva: Socket, sBen: Socket, sCleo: Socket;

  before(async () => {
    sAva = await connect(ava);
    sBen = await connect(ben);
    sCleo = await connect(cleo);
    await frame(sBen, (f) => f.type === 'hello');
  });

  test('a webhook post reaches every member of the channel in realtime', async () => {
    const r = await env.app.inject({ method: 'POST', url: hookPath, payload: { text: 'realtime hello' } });
    assert.equal(r.statusCode, 200);
    const msgId = r.json().message.id;
    const forBen = await frame(sBen, (f) => f.type === 'message.created' && f.payload.message.id === msgId);
    const forAva = await frame(sAva, (f) => f.type === 'message.created' && f.payload.message.id === msgId);
    assert.ok(forBen, 'ben should receive message.created');
    assert.ok(forAva, 'ava should receive message.created');
    assert.equal(forBen.payload.message.text, 'realtime hello');
    assert.equal(forBen.payload.message.meta.app.name, 'Notifier');
    assert.equal(forBen.conversationId, lounge);
  });

  test('a non-member does not receive channel messages', async () => {
    const r = await env.app.inject({ method: 'POST', url: hookPath, payload: { text: 'members only' } });
    const msgId = r.json().message.id;
    await quietFor(200);
    assert.equal(sCleo.frames.find((f) => f.type === 'message.created' && f.payload?.message?.id === msgId), undefined);
  });

  test('an ephemeral command reply is delivered only to the invoker', async () => {
    // A built-in usage error is ephemeral and addressed to the person who typed the command.
    const r = await ben.post(`/api/conversations/${lounge}/commands`, { command: 'topic', text: '' });
    assert.equal(r.status, 200);
    const forBen = await frame(sBen, (f) => f.type === 'message.ephemeral' && /Usage: \/topic/.test(f.payload.message.text));
    assert.ok(forBen, 'the invoker should receive the ephemeral message');
    await quietFor(150);
    assert.equal(sAva.frames.find((f) => f.type === 'message.ephemeral' && /Usage: \/topic/.test(f.payload.message.text)), undefined);
    assert.equal(sCleo.frames.find((f) => f.type === 'message.ephemeral'), undefined);
  });

  test('poll votes push fresh counts to everyone in the channel', async () => {
    await ben.post(`/api/conversations/${lounge}/commands`, { command: 'poll', text: '"Standup time?" "9am" "10am"' });
    const pollMsg = await frame(sAva, (f) => f.type === 'message.created' && f.payload.message.subtype === 'poll');
    assert.ok(pollMsg, 'poll should be broadcast');
    const pollId = pollMsg.payload.message.id;

    const vote = await ben.post(`/api/apps/polls/${pollId}/vote`, { optionId: 'o1' });
    assert.equal(vote.status, 200);
    const updated = await frame(sAva, (f) => f.type === 'message.updated'
      && f.payload.message.id === pollId && f.payload.message.meta?.poll?.counts?.o1 === 1);
    assert.ok(updated, 'ava should see the live count');
    assert.equal(updated.payload.message.meta.poll.totalVotes, 1);
    // Voter lists travel with the broadcast so every client can show its own vote.
    assert.deepEqual(updated.payload.message.meta.poll.voters.o1, [ben.user.id]);

    await ava.post(`/api/apps/polls/${pollId}/vote`, { optionId: 'o2' });
    const after = await frame(sBen, (f) => f.type === 'message.updated'
      && f.payload.message.id === pollId && f.payload.message.meta?.poll?.totalVotes === 2);
    assert.ok(after, 'ben should see the second vote');
    assert.equal(after.payload.message.meta.poll.counts.o2, 1);
  });

});
