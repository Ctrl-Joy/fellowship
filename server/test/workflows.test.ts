import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app';
import { makeTestApp, signup, clientFor, type TestClient } from './helpers';
import { getEngine, type Engine } from '../src/modules/workflows/engine';

let env: Awaited<ReturnType<typeof makeTestApp>>;
let engine: Engine;
let ava: TestClient, ben: TestClient, cleo: TestClient, outsider: TestClient;
let wid: string;
let general: string;   // public channel everyone is in
let ops: string;       // public channel, ava + ben
let secret: string;    // private channel, ava only
let now = Date.parse('2026-11-03T08:00:00Z');
let events: any[] = [];
let httpServer: Server;
let httpBase: string;
const httpLog: { method: string; url: string; headers: any; body: string }[] = [];

before(async () => {
  env = await makeTestApp();
  engine = getEngine(env.app.ctx);
  engine.setClock(() => now);
  env.app.ctx.bus.on('*', (e) => events.push(e));
  ava = await signup(env.app, 'Ava Flow');
  ben = await signup(env.app, 'Ben Flow');
  cleo = await signup(env.app, 'Cleo Flow');
  outsider = await signup(env.app, 'Otto Outside');
  wid = (await ava.post('/api/workspaces', { name: 'Flow WS' })).body.workspace.id;
  const invite = (await ava.get(`/api/w/${wid}`)).body.workspace.inviteCode;
  await ben.post(`/api/workspaces/join/${invite}`);
  await cleo.post(`/api/workspaces/join/${invite}`);
  await outsider.post('/api/workspaces', { name: 'Elsewhere' });
  general = (await ava.post(`/api/w/${wid}/channels`, { name: 'all-hands' })).body.conversation.id;
  await ben.post(`/api/conversations/${general}/join`);
  await cleo.post(`/api/conversations/${general}/join`);
  ops = (await ava.post(`/api/w/${wid}/channels`, { name: 'ops' })).body.conversation.id;
  await ben.post(`/api/conversations/${ops}/join`);
  secret = (await ava.post(`/api/w/${wid}/channels`, { name: 'secret', isPrivate: true })).body.conversation.id;

  httpServer = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      httpLog.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      if (req.url === '/slow') return; // never answers
      if (req.url === '/text') { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('boom'); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ greeting: 'hello', echo: body ? JSON.parse(body) : null, items: [{ name: 'alpha' }] }));
    });
  });
  await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', () => r()));
  httpBase = `http://127.0.0.1:${(httpServer.address() as any).port}`;
});

after(async () => {
  httpServer.closeAllConnections?.();
  await new Promise<void>((r) => httpServer.close(() => r()));
  await env.cleanup();
});

// ---------------------------------------------------------------- helpers

async function create(client: TestClient, trigger: any, steps: any[], name = 'Flow') {
  const r = await client.post(`/api/w/${wid}/workflows`, { name, trigger, steps });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.workflow;
}

async function publish(client: TestClient, id: string) {
  const r = await client.post(`/api/workflows/${id}/publish`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.workflow;
}

async function mk(trigger: any, steps: any[], name = 'Flow') {
  const wf = await create(ava, trigger, steps, name);
  return publish(ava, wf.id);
}

async function runManual(client: TestClient, id: string, body: any = {}) {
  const r = await client.post(`/api/workflows/${id}/run`, body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await engine.idle();
  return run(r.body.run.id);
}

async function run(id: string) {
  return (await ava.get(`/api/workflow-runs/${id}`)).body.run;
}

async function runsOf(id: string) {
  return (await ava.get(`/api/workflows/${id}/runs`)).body.runs;
}

async function lastRun(id: string) {
  const runs = await runsOf(id);
  return runs.length ? run(runs[0].id) : null;
}

async function messagesIn(client: TestClient, cid: string) {
  const r = await client.get(`/api/conversations/${cid}/messages?limit=100`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.messages as any[];
}

async function lastMessage(client: TestClient, cid: string) {
  const ms = await messagesIn(client, cid);
  return ms[ms.length - 1];
}

async function say(client: TestClient, cid: string, text: string) {
  const r = await client.post(`/api/conversations/${cid}/messages`, { text });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await engine.idle();
  return r.body.message;
}

async function tick(ms = 0) {
  now += ms;
  engine.tick();
  await engine.idle();
}

const msg = (text: string, target: any = { kind: 'trigger_channel' }, id = 'm1') => ({ id, type: 'send_message', config: { target, text } });

// ---------------------------------------------------------------- CRUD + permissions

describe('workflow CRUD and permissions', () => {
  let wf: any;

  test('create, list mine / workspace, drafts are private to owner and admins', async () => {
    wf = await create(ben, { type: 'manual' }, [msg('hi')], 'Ben draft');
    assert.equal(wf.status, 'draft');
    assert.equal(wf.version, 1);
    assert.ok(wf.webhookPath.startsWith('/api/hooks/workflows/'));
    const mine = (await ben.get(`/api/w/${wid}/workflows?scope=mine`)).body.workflows;
    assert.ok(mine.some((w: any) => w.id === wf.id));
    assert.equal((await cleo.get(`/api/workflows/${wf.id}`)).status, 404, 'other members cannot see drafts');
    assert.ok(!(await cleo.get(`/api/w/${wid}/workflows?scope=workspace`)).body.workflows.some((w: any) => w.id === wf.id));
    assert.equal((await ava.get(`/api/workflows/${wf.id}`)).status, 200, 'workspace owner can see drafts');
    assert.equal((await outsider.get(`/api/w/${wid}/workflows`)).status, 404);
  });

  test('only owner/admin can edit; edits bump version only when the definition changes', async () => {
    assert.equal((await cleo.patch(`/api/workflows/${wf.id}`, { name: 'x' })).status, 404);
    const r1 = await ben.patch(`/api/workflows/${wf.id}`, { name: 'Renamed' });
    assert.equal(r1.body.workflow.version, 1);
    const r2 = await ben.patch(`/api/workflows/${wf.id}`, { steps: [msg('changed')] });
    assert.equal(r2.body.workflow.version, 2);
    assert.equal((await ben.patch(`/api/workflows/${wf.id}`, { steps: [msg('a'), msg('b')] })).status, 400, 'duplicate step ids rejected');
    assert.equal((await ben.patch(`/api/workflows/${wf.id}`, { steps: [{ id: 'x', type: 'teleport', config: {} }] })).status, 400);
  });

  test('publish validates and returns issues; published workflows are visible but not editable by others', async () => {
    const bad = await create(ben, { type: 'reaction' }, [{ id: 's', type: 'send_message', config: { target: { kind: 'channel', channelId: '' }, text: '' } }]);
    const r = await ben.post(`/api/workflows/${bad.id}/publish`);
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'invalid_workflow');
    assert.ok(r.body.error.issues.length >= 3, JSON.stringify(r.body.error.issues));
    assert.ok(r.body.error.issues.some((i: any) => i.stepId === 's'));

    await ben.patch(`/api/workflows/${wf.id}`, { trigger: { type: 'manual', channelIds: [] } });
    const pub = await publish(ben, wf.id);
    assert.equal(pub.status, 'published');
    assert.equal(pub.publishedVersion, pub.version);
    const seen = (await cleo.get(`/api/workflows/${wf.id}`)).body.workflow;
    assert.equal(seen.canEdit, false);
    assert.equal(seen.steps, undefined, 'non-editors do not get the definition');
    assert.equal(seen.webhookPath, undefined);
    assert.equal((await cleo.post(`/api/workflows/${wf.id}/unpublish`)).status, 403);
    assert.equal((await cleo.del(`/api/workflows/${wf.id}`)).status, 403);
    assert.equal((await cleo.get(`/api/workflows/${wf.id}/runs`)).status, 403);
    assert.equal((await ben.post(`/api/workflows/${wf.id}/unpublish`)).body.workflow.status, 'draft');
    assert.equal((await ben.del(`/api/workflows/${wf.id}`)).status, 200);
    assert.equal((await ben.get(`/api/workflows/${wf.id}`)).status, 404);
  });

  test('templates create complete-looking drafts', async () => {
    const t = (await ava.get(`/api/w/${wid}/workflow-templates`)).body.templates;
    assert.equal(t.length, 4);
    for (const tpl of t) {
      const r = await ava.post(`/api/w/${wid}/workflows`, { templateId: tpl.id });
      assert.equal(r.status, 200);
      assert.equal(r.body.workflow.name, tpl.name);
      assert.ok(r.body.workflow.steps.length > 0);
      await ava.del(`/api/workflows/${r.body.workflow.id}`);
    }
    assert.equal((await ava.post(`/api/w/${wid}/workflows`, { templateId: 'nope' })).status, 400);
  });
});

// ---------------------------------------------------------------- manual trigger + message step

describe('manual trigger', () => {
  test('runs from a conversation, renders variables as mentions, logs steps, emits run updates', async () => {
    const wf = await mk({ type: 'manual', channelIds: [ops] }, [
      { id: 'hello', type: 'send_message', config: { target: { kind: 'trigger_channel' }, text: 'Hi {{trigger.user}}, this is {{trigger.channel}} at {{now}}' } },
      { id: 'dm', type: 'send_message', config: { target: { kind: 'trigger_user' }, text: 'Posted {{steps.hello.messageId}}' } },
    ], 'Greeter');
    const shortcuts = (await ben.get(`/api/w/${wid}/workflow-shortcuts?conversationId=${ops}`)).body.shortcuts;
    assert.ok(shortcuts.some((s: any) => s.id === wf.id));
    const elsewhere = (await ben.get(`/api/w/${wid}/workflow-shortcuts?conversationId=${general}`)).body.shortcuts;
    assert.ok(!elsewhere.some((s: any) => s.id === wf.id), 'restricted to its channels');
    assert.equal((await ben.post(`/api/workflows/${wf.id}/run`, { conversationId: general })).status, 403);

    events = [];
    const r = await runManual(ben, wf.id, { conversationId: ops });
    assert.equal(r.status, 'succeeded', r.error);
    assert.deepEqual(r.steps.map((s: any) => [s.stepId, s.status]), [['hello', 'succeeded'], ['dm', 'succeeded']]);
    assert.ok(r.steps[0].startedAt && r.steps[0].finishedAt);
    const m = await lastMessage(ben, ops);
    assert.equal(m.text, `Hi <@${ben.user.id}>, this is <#${ops}> at ${new Date(now).toISOString()}`);
    assert.equal(m.meta.workflow.id, wf.id);
    const bot = (await ava.get(`/api/w/${wid}/members`)).body.members.find((x: any) => x.id === m.userId);
    assert.equal(bot.isBot, true, 'posted by the workflow bot');
    const dm = await lastMessage(ben, r.context.steps.dm.channel);
    assert.equal(dm.text, `Posted ${m.id}`);
    const updates = events.filter((e) => e.type === 'workflow.run_updated');
    assert.ok(updates.length >= 2);
    assert.ok(updates.every((e) => e.audience.includes(ben.user.id) && e.audience.includes(ava.user.id)));
    assert.equal(updates.at(-1).payload.run.status, 'succeeded');
  });

  test('unpublished or automatic workflows cannot be run by hand; outsiders cannot run', async () => {
    const draft = await create(ava, { type: 'manual' }, [msg('x', { kind: 'channel', channelId: ops })]);
    assert.equal((await ben.post(`/api/workflows/${draft.id}/run`, {})).status, 404);
    assert.equal((await ava.post(`/api/workflows/${draft.id}/run`, {})).status, 400);
    const auto = await mk({ type: 'webhook' }, [msg('x', { kind: 'channel', channelId: ops })]);
    assert.equal((await ben.post(`/api/workflows/${auto.id}/run`, {})).status, 400);
    assert.equal((await outsider.post(`/api/workflows/${auto.id}/run`, {})).status, 404);
  });

  test('test runs use the draft definition and validate first', async () => {
    const draft = await create(ava, { type: 'webhook' }, [msg('Order {{trigger.webhook.order}}', { kind: 'channel', channelId: ops }, 'w')]);
    const r = await ava.post(`/api/workflows/${draft.id}/run`, { test: true, sample: { webhook: { order: 'A-1' } } });
    assert.equal(r.status, 200);
    await engine.idle();
    assert.equal((await run(r.body.run.id)).isTest, true);
    assert.equal((await lastMessage(ava, ops)).text, 'Order A-1');
    assert.equal((await ben.post(`/api/workflows/${draft.id}/run`, { test: true })).status, 404, 'only editors test');
    const bad = await create(ava, { type: 'manual' }, [msg('')]);
    assert.equal((await ava.post(`/api/workflows/${bad.id}/run`, { test: true })).status, 400);
  });

  test('a channel the owner cannot access fails the run with the step error', async () => {
    const wf = await create(ben, { type: 'manual' }, [msg('psst', { kind: 'channel', channelId: secret }, 'leak')]);
    // validation passes (channel exists) but ben is not in the private channel
    await publish(ben, wf.id);
    const r = await runManual(ben, wf.id);
    assert.equal(r.status, 'failed');
    assert.match(r.error, /leak.*cannot access/);
    assert.equal(r.steps[0].status, 'failed');
    assert.ok(!(await messagesIn(ava, secret)).some((m) => m.text === 'psst'));
  });
});

// ---------------------------------------------------------------- event triggers

describe('event triggers', () => {
  test('message trigger: contains and regex, ignores other channels', async () => {
    const a = await mk({ type: 'message', channelId: ops, match: 'contains', pattern: 'deploy' },
      [msg('Deploy noticed: "{{trigger.message.text}}" by {{trigger.user}}')], 'Deploy watcher');
    const b = await mk({ type: 'message', channelId: ops, match: 'regex', pattern: '^ticket-\\d+$' },
      [msg('Ticket {{trigger.message.text}}', { kind: 'trigger_channel' }, 'tk')], 'Ticket watcher');
    await say(ben, ops, 'starting the DEPLOY now');
    assert.equal((await lastMessage(ben, ops)).text, `Deploy noticed: "starting the DEPLOY now" by <@${ben.user.id}>`);
    await say(ben, ops, 'ticket-42');
    assert.equal((await lastMessage(ben, ops)).text, 'Ticket ticket-42');
    await say(ben, ops, 'ticket-42 please');
    assert.equal((await runsOf(b.id)).length, 1);
    await say(ben, general, 'deploy elsewhere');
    assert.equal((await runsOf(a.id)).length, 1);
    await ava.post(`/api/workflows/${a.id}/unpublish`);
    await ava.post(`/api/workflows/${b.id}/unpublish`);
  });

  test('loop guard: a workflow\'s own messages never retrigger it; chains are depth-capped', async () => {
    const self = await mk({ type: 'message', channelId: general, match: 'contains', pattern: 'echo' }, [msg('echo echo')], 'Echo');
    await say(ava, general, 'echo');
    assert.equal((await runsOf(self.id)).length, 1, 'own message ignored');
    await ava.post(`/api/workflows/${self.id}/unpublish`);

    const ping = await mk({ type: 'message', channelId: general, match: 'contains', pattern: 'ping' }, [msg('pong')], 'Ping');
    const pong = await mk({ type: 'message', channelId: general, match: 'contains', pattern: 'pong' }, [msg('ping')], 'Pong');
    await say(ava, general, 'ping');
    const total = (await runsOf(ping.id)).length + (await runsOf(pong.id)).length;
    assert.ok(total >= 2 && total <= 4, `chain stopped (got ${total} runs)`);
    await ava.post(`/api/workflows/${ping.id}/unpublish`);
    await ava.post(`/api/workflows/${pong.id}/unpublish`);
  });

  test('member joined trigger welcomes the new member by DM and in channel', async () => {
    const welcome = await mk({ type: 'member_joined', channelId: ops }, [
      { id: 'pub', type: 'send_message', config: { target: { kind: 'trigger_channel' }, text: 'Welcome {{trigger.user}}!' } },
      { id: 'dm', type: 'send_message', config: { target: { kind: 'trigger_user' }, text: 'Glad you joined {{trigger.channel}}' } },
    ], 'Welcome');
    await cleo.post(`/api/conversations/${ops}/join`);
    await engine.idle();
    const r = await lastRun(welcome.id);
    assert.equal(r.status, 'succeeded', r.error);
    assert.equal((await lastMessage(cleo, ops)).text, `Welcome <@${cleo.user.id}>!`);
    assert.equal((await lastMessage(cleo, r.context.steps.dm.channel)).text, `Glad you joined <#${ops}>`);
    await ava.post(`/api/workflows/${welcome.id}/unpublish`);
  });

  test('reaction trigger (SPEC event shape) + add reaction step', async () => {
    const target = await say(ben, general, 'Please triage this');
    const wf = await mk({ type: 'reaction', channelId: general, emoji: '🚨' }, [
      { id: 'note', type: 'send_message', config: { target: { kind: 'trigger_channel' }, text: '{{trigger.user}} flagged: {{trigger.message.text}} ({{trigger.emoji}})' } },
      { id: 'ack', type: 'add_reaction', config: { messageId: '{{trigger.message.id}}', emoji: '👀' } },
    ], 'Flagger');
    // emit the event the reactions module emits
    env.app.ctx.bus.emit({ type: 'reaction.added', workspaceId: wid, conversationId: general, actorId: cleo.user.id,
      payload: { messageId: target.id, conversationId: general, emoji: '👍', userId: cleo.user.id } });
    await engine.idle();
    assert.equal((await runsOf(wf.id)).length, 0, 'other emoji ignored');
    env.app.ctx.bus.emit({ type: 'reaction.added', workspaceId: wid, conversationId: general, actorId: cleo.user.id,
      payload: { messageId: target.id, conversationId: general, emoji: '🚨', userId: cleo.user.id } });
    await engine.idle();
    const r = await lastRun(wf.id);
    assert.equal(r.steps[0].status, 'succeeded');
    assert.ok((await messagesIn(ben, general)).some((m) => m.text === `<@${cleo.user.id}> flagged: Please triage this (🚨)`));
    const reactionsAvailable = (await ben.post(`/api/messages/${target.id}/reactions`, { emoji: '✅' })).status !== 404;
    if (reactionsAvailable) {
      assert.equal(r.status, 'succeeded', r.error);
      const reacted = (await messagesIn(ben, general)).find((m) => m.id === target.id);
      assert.ok(reacted.reactions.some((x: any) => x.emoji === '👀'), JSON.stringify(reacted.reactions));
      // the bot's own reaction did not retrigger anything
      assert.equal((await runsOf(wf.id)).length, 1);
    } else {
      assert.equal(r.status, 'failed');
      assert.match(r.error, /Reactions are not available/);
    }
    await ava.post(`/api/workflows/${wf.id}/unpublish`);
  });

  test('webhook trigger: variables from JSON body; unknown / unpublished / bad body rejected', async () => {
    const wf = await mk({ type: 'webhook' }, [
      { id: 'w', type: 'send_message', config: { target: { kind: 'channel', channelId: ops }, text: 'Build {{trigger.webhook.build.id}} is {{trigger.webhook.status}}' } },
    ], 'CI hook');
    const hook = (url: string, payload: any) => env.app.inject({ method: 'POST', url, payload });
    const res = await hook(wf.webhookPath, { status: 'green', build: { id: 77 } });
    assert.equal(res.statusCode, 200, res.body);
    await engine.idle();
    assert.equal((await lastMessage(ava, ops)).text, 'Build 77 is green');
    assert.equal((await run(res.json().runId)).triggerUserId, null);
    assert.equal((await hook('/api/hooks/workflows/not-a-secret', {})).statusCode, 404);
    assert.equal((await env.app.inject({ method: 'POST', url: wf.webhookPath, payload: '[1,2]', headers: { 'content-type': 'application/json' } })).statusCode, 400);
    const rotated = (await ava.post(`/api/workflows/${wf.id}/webhook-secret`)).body.workflow;
    assert.notEqual(rotated.webhookPath, wf.webhookPath);
    assert.equal((await hook(wf.webhookPath, {})).statusCode, 404, 'old secret dead');
    await ava.post(`/api/workflows/${wf.id}/unpublish`);
    assert.equal((await hook(rotated.webhookPath, {})).statusCode, 404, 'unpublished');
  });
});

// ---------------------------------------------------------------- schedule trigger

describe('schedule trigger (controllable clock)', () => {
  test('once, daily, weekly and cron fire exactly when due', async () => {
    now = Date.parse('2026-11-03T08:58:30Z'); // Tuesday
    const once = await mk({ type: 'schedule', schedule: { kind: 'once', at: Date.parse('2026-11-03T09:00:00Z') } }, [msg('once', { kind: 'channel', channelId: ops }, 'o')], 'Once');
    const daily = await mk({ type: 'schedule', schedule: { kind: 'daily', time: '09:00' } }, [msg('daily {{trigger.firedAt}}', { kind: 'channel', channelId: ops }, 'd')], 'Daily');
    const weekly = await mk({ type: 'schedule', schedule: { kind: 'weekly', days: [1], time: '09:00' } }, [msg('monday', { kind: 'channel', channelId: ops }, 'w')], 'Weekly');
    const cron = await mk({ type: 'schedule', schedule: { kind: 'cron', expr: '*/30 9 * * 2' } }, [msg('cron', { kind: 'channel', channelId: ops }, 'c')], 'Cron');
    const local = await mk({ type: 'schedule', schedule: { kind: 'daily', time: '10:00' }, tzOffset: 60 }, [msg('local', { kind: 'channel', channelId: ops }, 'l')], 'Local');
    assert.ok((await ava.get(`/api/workflows/${daily.id}`)).body.workflow.nextRunAt === Date.parse('2026-11-03T09:00:00Z'));

    await tick();
    for (const w of [once, daily, weekly, cron, local]) assert.equal((await runsOf(w.id)).length, 0, `${w.name} not yet`);
    await tick(60_000); // 08:59:30
    await tick(30_000); // 09:00:00
    assert.equal((await runsOf(once.id)).length, 1);
    assert.equal((await runsOf(daily.id)).length, 1);
    assert.equal((await runsOf(weekly.id)).length, 0, 'not Monday');
    assert.equal((await runsOf(cron.id)).length, 1);
    assert.equal((await runsOf(local.id)).length, 1, '10:00 at UTC+1');
    await tick(1000);
    await tick(20_000);
    assert.equal((await runsOf(daily.id)).length, 1, 'fires once per matching minute');
    await tick(30 * 60_000); // 09:30:21
    assert.equal((await runsOf(cron.id)).length, 2);
    assert.equal((await runsOf(once.id)).length, 1, 'once never repeats');
    await tick(24 * 3600_000); // next day 09:30
    assert.equal((await runsOf(daily.id)).length, 2, 'catches up a missed minute within the hour');
    const d = await lastRun(daily.id);
    assert.equal(d.status, 'succeeded');
    for (const w of [once, daily, weekly, cron, local]) await ava.post(`/api/workflows/${w.id}/unpublish`);
  });
});

// ---------------------------------------------------------------- step types

describe('steps', () => {
  test('create channel, invite, update topic, set variable, branch with nested lists, end', async () => {
    const wf = await mk({ type: 'manual' }, [
      { id: 'room', type: 'create_channel', config: { name: 'War Room {{trigger.user}}', topic: 'Opened by {{trigger.user}}' } },
      { id: 'inv', type: 'invite_to_channel', config: { channelId: '{{steps.room.channel}}', userIds: ['{{trigger.user}}', cleo.user.id] } },
      { id: 'topic', type: 'update_topic', config: { channelId: '{{steps.room.channel}}', topic: 'Invited {{steps.inv.invited}}' } },
      { id: 'sv', type: 'set_variable', config: { name: 'level', value: '7' } },
      { id: 'br', type: 'branch', config: { match: 'all', groups: [{ match: 'all', conditions: [{ left: '{{vars.level}}', op: 'gt', right: '5' }] }] },
        then: [
          { id: 'hi', type: 'send_message', config: { target: { kind: 'channel', channelId: '{{steps.room.channel}}' }, text: 'high {{vars.level}}' } },
          { id: 'inner', type: 'branch', config: { match: 'any', groups: [{ match: 'all', conditions: [{ left: '{{vars.level}}', op: 'equals', right: '9' }] }] },
            then: [{ id: 'nine', type: 'send_message', config: { target: { kind: 'trigger_channel' }, text: 'nine' } }],
            else: [{ id: 'stop', type: 'end', config: {} }] },
        ],
        else: [{ id: 'lo', type: 'send_message', config: { target: { kind: 'trigger_channel' }, text: 'low' } }] },
      { id: 'after', type: 'send_message', config: { target: { kind: 'trigger_channel' }, text: 'never reached' } },
    ], 'Builder');
    const r = await runManual(ben, wf.id, { conversationId: ops });
    assert.equal(r.status, 'succeeded', r.error);
    assert.deepEqual(r.steps.map((s: any) => s.stepId), ['room', 'inv', 'topic', 'sv', 'br', 'hi', 'inner', 'stop']);
    const room = r.context.steps.room.channel;
    const conv = (await ben.get(`/api/conversations/${room}`)).body.conversation;
    assert.equal(conv.name, `war-room-${ben.user.id.toLowerCase()}`);
    assert.equal(conv.topic, 'Invited 2');
    assert.ok(conv.isMember, 'trigger user invited');
    assert.equal((await lastMessage(cleo, room)).text, 'high 7');
    assert.equal(r.context.vars.level, '7');
    assert.equal(r.context.steps.br.result, true);
    assert.ok(!(await messagesIn(ben, ops)).some((m) => m.text === 'never reached'));
  });

  test('delay (duration and until) parks the run and the scheduler resumes it', async () => {
    const wf = await mk({ type: 'manual' }, [
      { id: 'wait', type: 'delay', config: { mode: 'duration', amount: 2, unit: 'hours' } },
      { id: 'later', type: 'send_message', config: { target: { kind: 'trigger_channel' }, text: 'two hours later' } },
      { id: 'until', type: 'delay', config: { mode: 'until', at: '2030-01-01T00:00:00Z' } },
      { id: 'done', type: 'send_message', config: { target: { kind: 'trigger_channel' }, text: 'happy 2030' } },
    ], 'Waiter');
    let r = await runManual(ava, wf.id, { conversationId: ops });
    assert.equal(r.status, 'waiting');
    assert.equal(r.waitingStepId, 'wait');
    assert.equal(r.wakeAt, now + 2 * 3600_000);
    await tick(3600_000);
    assert.equal((await run(r.id)).status, 'waiting');
    await tick(3600_000);
    r = await run(r.id);
    assert.equal(r.status, 'waiting');
    assert.equal(r.waitingStepId, 'until');
    assert.equal((await lastMessage(ava, ops)).text, 'two hours later');
    now = Date.parse('2030-01-01T00:00:00Z');
    await tick();
    r = await run(r.id);
    assert.equal(r.status, 'succeeded');
    assert.equal(r.steps.find((s: any) => s.stepId === 'wait').status, 'succeeded');
    assert.equal((await lastMessage(ava, ops)).text, 'happy 2030');
    now = Date.parse('2026-11-04T08:00:00Z');
  });

  test('HTTP request against a local server: variables in url/headers/body, JSON exposed', async () => {
    httpLog.length = 0;
    const wf = await mk({ type: 'webhook' }, [
      { id: 'get', type: 'http_request', config: { method: 'GET', url: `${httpBase}/info?q={{trigger.webhook.q}}`, headers: [{ key: 'X-Token', value: 'tok-{{trigger.webhook.q}}' }] } },
      { id: 'send', type: 'http_request', config: { method: 'POST', url: `${httpBase}/hook`, body: '{"name":"{{steps.get.json.items.0.name}}"}' } },
      { id: 'say', type: 'send_message', config: { target: { kind: 'channel', channelId: ops }, text: '{{steps.get.json.greeting}} / {{steps.send.json.echo.name}} / {{steps.send.status}}' } },
    ], 'HTTP');
    const res = await env.app.inject({ method: 'POST', url: wf.webhookPath, payload: { q: 'abc' } });
    await engine.idle();
    const r = await run(res.json().runId);
    assert.equal(r.status, 'succeeded', r.error);
    assert.equal(httpLog[0].url, '/info?q=abc');
    assert.equal(httpLog[0].headers['x-token'], 'tok-abc');
    assert.equal(httpLog[1].method, 'POST');
    assert.equal(httpLog[1].headers['content-type'], 'application/json');
    assert.equal((await lastMessage(ava, ops)).text, 'hello / alpha / 200');
    assert.equal(r.steps[0].input.headers[0].value, '••••', 'secret-looking headers masked in the log');
  });

  test('HTTP failures: non-http URLs blocked, private hosts blocked, timeout, failOnError', async () => {
    const check = async (cfg: any, re: RegExp) => {
      const draft = await create(ava, { type: 'manual' }, [{ id: 'h', type: 'http_request', config: { method: 'GET', ...cfg } }]);
      const r = await ava.post(`/api/workflows/${draft.id}/run`, { test: true });
      if (r.status === 400) { assert.match(r.body.error.message, re); return; }
      await engine.idle();
      const done = await run(r.body.run.id);
      assert.equal(done.status, 'failed');
      assert.match(done.error, re);
    };
    await check({ url: 'file:///etc/passwd' }, /Only http/);
    await check({ url: '{{trigger.channel}}' }, /Invalid URL|Only http/);
    engine.setAllowPrivateHttp(false);
    await check({ url: `${httpBase}/info` }, /private network/);
    await check({ url: 'http://localhost:1/' }, /private network/);
    engine.setAllowPrivateHttp(true);
    engine.setHttpTimeout(300);
    await check({ url: `${httpBase}/slow` }, /timed out/);
    engine.setHttpTimeout(10_000);
    await check({ url: `${httpBase}/text`, failOnError: true }, /answered 500/);
  });

  test('step cap stops runaway runs', async () => {
    const wf = await mk({ type: 'manual' }, [
      { id: 'w', type: 'delay', config: { mode: 'duration', amount: 1, unit: 'minutes' } },
      msg('x'),
    ], 'Capped');
    const r = await runManual(ava, wf.id, { conversationId: ops });
    env.app.ctx.db.prepare('UPDATE workflow_runs SET steps_count = 200 WHERE id = ?').run(r.id);
    await tick(61_000);
    const done = await run(r.id);
    assert.equal(done.status, 'failed');
    assert.match(done.error, /loop guard/);
  });
});

// ---------------------------------------------------------------- forms & approvals

describe('forms', () => {
  let wf: any;
  let formMsg: any;
  let runId: string;

  test('form is posted as an interactive message and the run waits', async () => {
    wf = await mk({ type: 'manual' }, [
      { id: 'f', type: 'send_form', config: {
        target: { kind: 'channel', channelId: ops }, title: 'Lunch order', intro: 'Hungry, {{trigger.user}}?', postResponsesTo: 'same',
        fields: [
          { id: 'dish', label: 'Dish', type: 'select', required: true, options: ['Soup', 'Salad'] },
          { id: 'extras', label: 'Extras', type: 'multi_select', options: ['Bread', 'Cheese'] },
          { id: 'qty', label: 'How many', type: 'number', required: true },
          { id: 'when', label: 'Day', type: 'date' },
          { id: 'buddy', label: 'Lunch buddy', type: 'user' },
          { id: 'note', label: 'Note', type: 'long_text' },
        ] } },
      { id: 'thanks', type: 'send_message', config: { target: { kind: 'channel', channelId: ops }, text: '{{steps.f.submittedBy}} wants {{steps.f.qty}}× {{steps.f.dish}} with {{steps.f.extras}} and {{steps.f.buddy}}' } },
    ], 'Lunch');
    const r = await runManual(ava, wf.id, { conversationId: ops });
    runId = r.id;
    assert.equal(r.status, 'waiting');
    assert.equal(r.waitingStepId, 'f');
    formMsg = await lastMessage(ben, ops);
    assert.equal(formMsg.subtype, 'workflow_form');
    assert.equal(formMsg.meta.kind, 'form');
    assert.equal(formMsg.meta.fields.length, 6);
    assert.match(formMsg.text, /Lunch order/);
    assert.match(formMsg.text, new RegExp(`<@${ava.user.id}>`));
  });

  test('permission and value validation', async () => {
    const url = `/api/workflow-messages/${formMsg.id}/form`;
    assert.equal((await outsider.post(url, { values: { dish: 'Soup', qty: 1 } })).status, 404, 'other workspace');
    assert.equal((await ben.post(url, { values: { qty: 1 } })).status, 400, 'required');
    assert.equal((await ben.post(url, { values: { dish: 'Pizza', qty: 1 } })).status, 400, 'not an option');
    assert.equal((await ben.post(url, { values: { dish: 'Soup', qty: 'many' } })).status, 400, 'number');
    assert.equal((await ben.post(url, { values: { dish: 'Soup', qty: 1, extras: ['Gold'] } })).status, 400, 'multi');
    assert.equal((await ben.post(url, { values: { dish: 'Soup', qty: 1, when: 'tomorrow' } })).status, 400, 'date');
    assert.equal((await ben.post(url, { values: { dish: 'Soup', qty: 1, buddy: outsider.user.id } })).status, 400, 'user must be in workspace');
    assert.equal((await ben.post(`/api/workflow-messages/${(await say(ben, ops, 'plain')).id}/form`, { values: {} })).status, 404, 'not a form');
  });

  test('submission resumes the run with variables, posts responses in thread, once per user', async () => {
    const url = `/api/workflow-messages/${formMsg.id}/form`;
    const ok = await ben.post(url, { values: { dish: 'Soup', qty: '2', extras: ['Bread', 'Cheese'], when: '2026-11-05', buddy: cleo.user.id, note: 'hot' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    await engine.idle();
    const r = await run(runId);
    assert.equal(r.status, 'succeeded', r.error);
    assert.equal(r.context.steps.f.dish, 'Soup');
    assert.equal(r.context.steps.f.qty, 2);
    assert.equal(r.context.steps.f.submittedBy, ben.user.id);
    const ms = await messagesIn(ben, ops);
    assert.ok(ms.some((m) => m.text === `<@${ben.user.id}> wants 2× Soup with Bread, Cheese and <@${cleo.user.id}>`), ms.map((m) => m.text).join('\n'));
    const thread = (await ben.get(`/api/conversations/${ops}/messages?limit=5`)).body.messages.find((m: any) => m.id === formMsg.id);
    assert.equal(thread.replyCount, 1, 'responses posted in the form thread');
    assert.equal(thread.meta.responseCount, 1);
    assert.deepEqual(thread.meta.respondedUserIds, [ben.user.id]);
    const again = await ben.post(url, { values: { dish: 'Salad', qty: 1 } });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'already_submitted');
    // another member may still respond; stored but the run already moved on
    assert.equal((await cleo.post(url, { values: { dish: 'Salad', qty: 1 } })).status, 200);
    const mine = (await cleo.get(url)).body.responses;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].values.dish, 'Salad');
  });

  test('forms in private places: non-members cannot submit; allowMultiple permits repeats', async () => {
    const pf = await mk({ type: 'manual' }, [
      { id: 'f', type: 'send_form', config: { target: { kind: 'channel', channelId: secret }, title: 'Secret poll', allowMultiple: true, fields: [{ id: 'a', label: 'A', type: 'short_text', required: true }] } },
    ], 'Private form');
    const r = await runManual(ava, pf.id);
    const m = await lastMessage(ava, secret);
    assert.equal((await ben.post(`/api/workflow-messages/${m.id}/form`, { values: { a: 'x' } })).status, 403);
    assert.equal((await ava.post(`/api/workflow-messages/${m.id}/form`, { values: { a: 'x' } })).status, 200);
    assert.equal((await ava.post(`/api/workflow-messages/${m.id}/form`, { values: { a: 'y' } })).status, 200);
    await engine.idle();
    assert.equal((await run(r.id)).status, 'succeeded');
  });

  test('cancelling a waiting run closes its form', async () => {
    const cf = await mk({ type: 'manual' }, [
      { id: 'f', type: 'send_form', config: { target: { kind: 'trigger_user' }, title: 'Never', fields: [{ id: 'a', label: 'A', type: 'short_text' }] } },
    ], 'Cancelled');
    const r = await runManual(ben, cf.id);
    assert.equal(r.status, 'waiting');
    const dmId = r.context.steps.f.channel;
    const m = await lastMessage(ben, dmId);
    assert.equal((await ben.post(`/api/workflow-runs/${r.id}/cancel`)).status, 403, 'run history is for editors');
    const c = await ava.post(`/api/workflow-runs/${r.id}/cancel`);
    assert.equal(c.body.run.status, 'cancelled');
    const after = (await messagesIn(ben, dmId)).find((x) => x.id === m.id);
    assert.equal(after.meta.closed, true);
    assert.equal((await ben.post(`/api/workflow-messages/${m.id}/form`, { values: { a: 'x' } })).status, 409);
    assert.equal((await ava.post(`/api/workflow-runs/${r.id}/cancel`)).status, 409);
  });
});

describe('approvals', () => {
  let wf: any;

  async function startRequest(requester: TestClient, approver: TestClient) {
    const r = await runManual(requester, wf.id);
    const formDm = r.context.steps.req.channel;
    const form = await lastMessage(requester, formDm);
    const s = await requester.post(`/api/workflow-messages/${form.id}/form`, { values: { days: 3, manager: approver.user.id } });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    await engine.idle();
    const waiting = await run(r.id);
    assert.equal(waiting.status, 'waiting');
    assert.equal(waiting.waitingStepId, 'ap');
    return { run: waiting, apMsgId: waiting.context.steps.ap.messageId as string };
  }

  before(async () => {
    wf = await mk({ type: 'manual' }, [
      { id: 'req', type: 'send_form', config: { target: { kind: 'trigger_user' }, title: 'Time off', fields: [
        { id: 'days', label: 'Days', type: 'number', required: true },
        { id: 'manager', label: 'Approver', type: 'user', required: true },
      ] } },
      { id: 'ap', type: 'request_approval', config: { approver: { kind: 'variable', value: '{{steps.req.manager}}' }, text: '{{trigger.user}} wants {{steps.req.days}} days off' },
        then: [{ id: 'yes', type: 'send_message', config: { target: { kind: 'trigger_user' }, text: 'Approved by {{steps.ap.decidedBy}}' } }],
        else: [{ id: 'no', type: 'send_message', config: { target: { kind: 'trigger_user' }, text: 'Denied: {{steps.ap.note}}' } }] },
      { id: 'fin', type: 'send_message', config: { target: { kind: 'trigger_user' }, text: 'Outcome {{steps.ap.outcome}}' } },
    ], 'Time off');
  });

  test('only the designated approver can decide; approve takes the "then" branch and records who/when', async () => {
    const { run: r, apMsgId } = await startRequest(ben, cleo);
    const row = env.app.ctx.messages.get(apMsgId, cleo.user.id)!;
    assert.equal(row.subtype, 'workflow_approval');
    assert.equal(row.meta.approverId, cleo.user.id);
    assert.equal(row.text.includes(`<@${ben.user.id}> wants 3 days off`), true, row.text);
    const url = `/api/workflow-messages/${apMsgId}/approval`;
    assert.equal((await ben.post(url, { decision: 'approve' })).status, 403, 'requester cannot act in the approver DM');
    assert.equal((await ava.post(url, { decision: 'approve' })).status, 403, 'workspace owner is not the approver');
    assert.equal((await cleo.post(url, { decision: 'maybe' })).status, 400);
    now += 5000;
    const ok = await cleo.post(url, { decision: 'approve' });
    assert.equal(ok.status, 200);
    await engine.idle();
    const done = await run(r.id);
    assert.equal(done.status, 'succeeded', done.error);
    assert.deepEqual(done.steps.map((s: any) => s.stepId), ['req', 'ap', 'yes', 'fin']);
    assert.equal(done.context.steps.ap.outcome, 'approved');
    assert.equal(done.context.steps.ap.decidedBy, cleo.user.id);
    assert.equal(done.context.steps.ap.decidedAt, new Date(now).toISOString());
    const dm = done.context.steps.req.channel;
    const texts = (await messagesIn(ben, dm)).map((m) => m.text);
    assert.ok(texts.includes(`Approved by <@${cleo.user.id}>`));
    assert.ok(texts.includes('Outcome approved'));
    const resolved = env.app.ctx.messages.get(apMsgId, cleo.user.id)!;
    assert.equal(resolved.meta.status, 'approved');
    assert.equal(resolved.meta.decidedBy, cleo.user.id);
    const twice = await cleo.post(url, { decision: 'deny' });
    assert.equal(twice.status, 409);
    const ap = env.app.ctx.db.prepare('SELECT * FROM workflow_approvals WHERE message_id = ?').get(apMsgId) as any;
    assert.equal(ap.status, 'approved');
    assert.equal(ap.decided_by, cleo.user.id);
  });

  test('deny takes the "else" branch with the note', async () => {
    const { run: r, apMsgId } = await startRequest(cleo, ben);
    events = [];
    const res = await ben.post(`/api/workflow-messages/${apMsgId}/approval`, { decision: 'deny', note: 'busy week' });
    assert.equal(res.status, 200);
    assert.ok(events.some((e) => e.type === 'message.updated' && e.payload.message.id === apMsgId && e.payload.message.meta.status === 'denied'), 'live update');
    await engine.idle();
    const done = await run(r.id);
    assert.deepEqual(done.steps.map((s: any) => s.stepId), ['req', 'ap', 'no', 'fin']);
    const texts = (await messagesIn(cleo, done.context.steps.req.channel)).map((m) => m.text);
    assert.ok(texts.includes('Denied: busy week'));
    assert.ok(texts.includes('Outcome denied'));
  });

  test('a non-member of the approval channel gets 403 even if they know the id', async () => {
    const chWf = await mk({ type: 'manual' }, [
      { id: 'ap', type: 'request_approval', config: { approver: { kind: 'user', userId: ava.user.id }, channelId: ops, text: 'Ship it?' } },
    ], 'Channel approval');
    const r = await runManual(ben, chWf.id);
    const apId = r.context.steps.ap.messageId;
    assert.equal((await ben.post(`/api/workflow-messages/${apId}/approval`, { decision: 'approve' })).status, 403, 'member but not approver');
    assert.equal((await outsider.post(`/api/workflow-messages/${apId}/approval`, { decision: 'approve' })).status, 404);
    assert.equal((await ava.post(`/api/workflow-messages/${apId}/approval`, { decision: 'approve' })).status, 200);
    await engine.idle();
    assert.equal((await run(r.id)).status, 'succeeded');
  });
});

// ---------------------------------------------------------------- versioning + restart

describe('durability', () => {
  test('editing and republishing does not change in-flight runs (version snapshot)', async () => {
    const wf = await mk({ type: 'manual' }, [
      { id: 'w', type: 'delay', config: { mode: 'duration', amount: 5, unit: 'minutes' } },
      { id: 'v', type: 'send_message', config: { target: { kind: 'trigger_channel' }, text: 'version one' } },
    ], 'Versioned');
    const r = await runManual(ava, wf.id, { conversationId: ops });
    await ava.patch(`/api/workflows/${wf.id}`, { steps: [{ id: 'v', type: 'send_message', config: { target: { kind: 'trigger_channel' }, text: 'version two' } }] });
    const re = await publish(ava, wf.id);
    assert.equal(re.publishedVersion, 2);
    await tick(5 * 60_000);
    const done = await run(r.id);
    assert.equal(done.status, 'succeeded');
    assert.equal(done.version, 1);
    assert.equal((await lastMessage(ava, ops)).text, 'version one');
    const r2 = await runManual(ava, wf.id, { conversationId: ops });
    assert.equal(r2.version, 2);
    assert.equal((await lastMessage(ava, ops)).text, 'version two');
  });

  test('runs survive a restart: waiting runs resume on tick, interrupted runs resume on boot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fellowship-wf-restart-'));
    const dbPath = join(dir, 'restart.db');
    let app = await buildApp({ dbPath, isTest: true });
    let eng = getEngine(app.ctx);
    let t = Date.parse('2026-11-03T12:00:00Z');
    eng.setClock(() => t);
    let rae = await signup(app, 'Rae Start', 'restart@example.test');
    const cookie = rae.cookie;
    const w = (await rae.post('/api/workspaces', { name: 'Restart WS' })).body.workspace.id;
    const ch = (await rae.post(`/api/w/${w}/channels`, { name: 'durable' })).body.conversation.id;
    const wf = (await rae.post(`/api/w/${w}/workflows`, { name: 'Durable', trigger: { type: 'manual' }, steps: [
      { id: 'a', type: 'send_message', config: { target: { kind: 'trigger_channel' }, text: 'before' } },
      { id: 'd', type: 'delay', config: { mode: 'duration', amount: 1, unit: 'days' } },
      { id: 'b', type: 'send_message', config: { target: { kind: 'trigger_channel' }, text: 'after {{steps.a.messageId}}' } },
    ] })).body.workflow;
    assert.equal((await rae.post(`/api/workflows/${wf.id}/publish`)).status, 200);
    const started = (await rae.post(`/api/workflows/${wf.id}/run`, { conversationId: ch })).body.run;
    await eng.idle();
    // a second run that "crashed" mid-step: status running, cursor at step b
    const wf2 = (await rae.post(`/api/w/${w}/workflows`, { name: 'Crashy', trigger: { type: 'manual' }, steps: [
      { id: 'x', type: 'send_message', config: { target: { kind: 'trigger_channel' }, text: 'resumed after crash' } },
    ] })).body.workflow;
    await rae.post(`/api/workflows/${wf2.id}/publish`);
    app.ctx.db.prepare(
      `INSERT INTO workflow_runs (id, workflow_id, workspace_id, version, status, trigger_user_id, context_json, current_step, started_at)
       VALUES ('WRcrash', ?, ?, 1, 'running', ?, ?, '[{"i":0}]', ?)`,
    ).run(wf2.id, w, rae.user.id, JSON.stringify({ trigger: { user: rae.user.id, channel: ch }, steps: {}, vars: {} }), t);
    app.ctx.db.prepare("INSERT INTO workflow_run_steps (run_id, step_id, step_type, status, started_at) VALUES ('WRcrash', 'x', 'send_message', 'running', ?)").run(t);
    await app.close();

    app = await buildApp({ dbPath, isTest: true });
    eng = getEngine(app.ctx);
    eng.setClock(() => t);
    rae = clientFor(app, cookie, rae.user);
    await eng.idle();
    const crash = (await rae.get('/api/workflow-runs/WRcrash')).body.run;
    assert.equal(crash.status, 'succeeded', crash.error);
    assert.deepEqual(crash.steps.map((s: any) => s.status), ['interrupted', 'succeeded']);

    let r = (await rae.get(`/api/workflow-runs/${started.id}`)).body.run;
    assert.equal(r.status, 'waiting');
    t += 86_400_000;
    eng.tick();
    await eng.idle();
    r = (await rae.get(`/api/workflow-runs/${started.id}`)).body.run;
    assert.equal(r.status, 'succeeded', r.error);
    const texts = (await rae.get(`/api/conversations/${ch}/messages`)).body.messages.map((m: any) => m.text);
    assert.ok(texts.includes(`after ${r.context.steps.a.messageId}`), texts.join('|'));
    assert.ok(texts.includes('resumed after crash'));
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
