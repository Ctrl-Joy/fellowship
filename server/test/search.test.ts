import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, signup, type TestClient } from './helpers';
import { upload } from './files-fixtures';
import { parseQuery } from '../src/modules/search';
import { buildApp } from '../src/app';

const DAY = 24 * 60 * 60 * 1000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const TODAY = isoDay(Date.now());
const YESTERDAY = isoDay(Date.now() - DAY);
const TOMORROW = isoDay(Date.now() + DAY);

let env: Awaited<ReturnType<typeof makeTestApp>>;
let ava: TestClient, ben: TestClient, cleo: TestClient, outsider: TestClient;
let wid: string;
let general: any, design: any, secret: any, dm: any;
let benHandle: string;
const m: Record<string, any> = {};

const search = (c: TestClient, q: string, type = 'messages', extra = '') =>
  c.get(`/api/w/${wid}/search?type=${type}&q=${encodeURIComponent(q)}${extra}`);
const ids = (r: any) => r.body.results.map((x: any) => x.message?.id ?? x.file?.id ?? x.conversation?.id ?? x.user?.id);

before(async () => {
  env = await makeTestApp();
  ava = await signup(env.app, 'Ava Search', 'ava-search@example.test');
  ben = await signup(env.app, 'Ben Search');
  cleo = await signup(env.app, 'Cleo Search');
  outsider = await signup(env.app, 'Out Search');
  benHandle = (ben.user.displayName || ben.user.fullName).replace(/\s+/g, '').toLowerCase();

  const ws = await ava.post('/api/workspaces', { name: 'Search Org' });
  wid = ws.body.workspace.id;
  const invite = ws.body.workspace.inviteCode;
  await ben.post(`/api/workspaces/join/${invite}`);
  await cleo.post(`/api/workspaces/join/${invite}`);

  const convs = await ava.get(`/api/w/${wid}/conversations`);
  general = convs.body.conversations.find((c: any) => c.name === 'general');
  await ben.post(`/api/conversations/${general.id}/join`);
  design = (await ava.post(`/api/w/${wid}/channels`, { name: 'design' })).body.conversation;
  await ben.post(`/api/conversations/${design.id}/join`);
  secret = (await ava.post(`/api/w/${wid}/channels`, { name: 'secret-plans', isPrivate: true })).body.conversation;
  dm = (await ava.post(`/api/w/${wid}/dms`, { userIds: [cleo.user.id] })).body.conversation;

  const post = async (c: TestClient, cid: string, text: string, extra: any = {}) => {
    const r = await c.post(`/api/conversations/${cid}/messages`, { text, ...extra });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.message;
  };
  m.general = await post(ben, general.id, 'The quarterly roadmap is ready for review');
  m.launch = await post(ava, design.id, 'Launch checklist for the roadmap see https://example.test/launch');
  m.mention = await post(ava, design.id, `Please review <@${ben.user.id}> this afternoon`);
  m.secret = await post(ava, secret.id, 'Secret roadmap merger codename falcon');
  m.dm = await post(ava, dm.id, 'Lunch at falcon cafe tomorrow?');
  m.thread = await post(ben, design.id, 'roadmap follow up in the thread', { threadRootId: m.launch.id });
  m.zebra = await post(ben, general.id, 'zebra draft notes');
  m.deleted = await post(ben, general.id, 'deleted roadmap draft');
  m.pinned = await post(ben, general.id, 'pinned roadmap note');
  await ben.post(`/api/messages/${m.pinned.id}/pin`);
  // Reaction written straight to the table (the reactions module owns the endpoint).
  env.app.ctx.db.prepare('INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)')
    .run(m.general.id, ava.user.id, ':+1:', Date.now());
  // Edit and delete go through the real routes so the bus keeps the index in sync.
  await ben.patch(`/api/messages/${m.zebra.id}`, { text: 'giraffe final notes' });
  await ben.del(`/api/messages/${m.deleted.id}`);
  for (let i = 0; i < 25; i++) await post(ava, general.id, `bulk term item ${i}`);
});

after(async () => { await env.cleanup(); });

describe('visibility: non-members never see private channels or DMs', () => {
  test('a workspace member does not find private-channel text', async () => {
    const r = await search(ben, 'falcon');
    assert.equal(r.status, 200);
    assert.deepEqual(ids(r), []);
    const secretOnly = await search(ben, 'merger');
    assert.deepEqual(ids(secretOnly), []);
  });

  test('a DM participant finds the DM but not the private channel', async () => {
    const r = await search(cleo, 'falcon');
    assert.deepEqual(ids(r), [m.dm.id]);
  });

  test('a channel member finds the private channel and the DM they are in', async () => {
    const r = await search(ava, 'falcon');
    assert.deepEqual(ids(r).sort(), [m.dm.id, m.secret.id].sort());
  });

  test('in:#private-channel is empty for a non-member, even with the exact name', async () => {
    assert.deepEqual(ids(await search(ben, 'falcon in:#secret-plans')), []);
    assert.deepEqual(ids(await search(ben, 'in:#secret-plans')), []);
    assert.deepEqual(ids(await search(ava, 'in:#secret-plans falcon')), [m.secret.id]);
  });

  test('channel and people searches do not reveal private channels to outsiders of them', async () => {
    const ch = await search(ben, 'secret', 'channels');
    assert.deepEqual(ch.body.results, []);
    const chAva = await search(ava, 'secret', 'channels');
    assert.equal(chAva.body.results[0].conversation.name, 'secret-plans');
    assert.equal(chAva.body.results[0].conversation.isPrivate, true);
  });

  test('files in a private channel or DM are invisible to non-members', async () => {
    const plan = (await upload(env.app, ava.cookie, wid, secret.id, [{ filename: 'falcon-plan.txt', type: 'text/plain', data: Buffer.from('p') }])).body.files[0];
    await ava.post(`/api/conversations/${secret.id}/messages`, { text: 'plan attached', fileIds: [plan.id] });
    const lunch = (await upload(env.app, ava.cookie, wid, dm.id, [{ filename: 'lunch-menu.txt', type: 'text/plain', data: Buffer.from('m') }])).body.files[0];
    await ava.post(`/api/conversations/${dm.id}/messages`, { text: 'menu', fileIds: [lunch.id] });
    assert.deepEqual(ids(await search(ben, 'falcon', 'files')), []);
    assert.deepEqual(ids(await search(ben, 'lunch', 'files')), []);
    assert.deepEqual(ids(await search(cleo, 'lunch', 'files')), [lunch.id]);
    assert.deepEqual(ids(await search(ava, 'falcon', 'files')), [plan.id]);
  });

  test('an outsider (not in the workspace) gets 404 for every search type', async () => {
    for (const type of ['messages', 'files', 'channels', 'people']) {
      const r = await search(outsider, 'roadmap', type);
      assert.equal(r.status, 404, type);
    }
  });

  test('anonymous search is 401', async () => {
    const r = await env.app.inject({ method: 'GET', url: `/api/w/${wid}/search?q=roadmap` });
    assert.equal(r.statusCode, 401);
  });
});

describe('message search', () => {
  test('free text finds public messages, thread replies and mention-resolved names', async () => {
    const r = await search(ben, 'roadmap');
    const got = ids(r);
    assert.ok(got.includes(m.general.id));
    assert.ok(got.includes(m.launch.id));
    assert.ok(got.includes(m.thread.id), 'thread replies are searchable');
    assert.ok(!got.includes(m.secret.id));
    const byName = await search(ava, 'ben');
    assert.ok(ids(byName).includes(m.mention.id), 'mention text shows the person name, not the raw id');
    const hitMention = byName.body.results.find((x: any) => x.message.id === m.mention.id);
    assert.ok(hitMention.snippet.replace(/[\u0002\u0003]/g, '').includes(`@${ben.user.displayName}`), 'snippet shows the resolved name');
    assert.ok(!hitMention.snippet.includes('<@'));
  });

  test('results carry a highlighted snippet and the conversation', async () => {
    const r = await search(ben, 'roadmap');
    const hit = r.body.results.find((x: any) => x.message.id === m.general.id);
    assert.match(hit.snippet, /\u0002roadmap\u0003/);
    assert.equal(hit.conversation.id, general.id);
    assert.equal(hit.conversation.name, 'general');
    assert.equal(hit.type, 'message');
    assert.ok(hit.message.text.includes('roadmap'));
  });

  test('matching is prefix based and phrases are exact', async () => {
    assert.ok(ids(await search(ben, 'roadm')).includes(m.general.id));
    assert.ok(ids(await search(ben, '"quarterly roadmap"')).includes(m.general.id));
    assert.deepEqual(ids(await search(ben, '"roadmap quarterly"')), []);
  });

  test('multiple words must all match', async () => {
    assert.deepEqual(ids(await search(ben, 'launch roadmap')), [m.launch.id]);
    assert.deepEqual(ids(await search(ben, 'launch unicorn')), []);
  });

  test('punctuation and quotes in the query cannot break the FTS syntax', async () => {
    const r = await search(ben, 'roadmap" OR "x *');
    assert.equal(r.status, 200);
    const weird = await search(ben, '-- ( ) :');
    assert.equal(weird.status, 200);
    assert.deepEqual(ids(weird), []);
  });

  test('in:#channel limits to a channel (with or without #)', async () => {
    assert.deepEqual(ids(await search(ava, 'roadmap in:#design')).sort(), [m.launch.id, m.thread.id].sort());
    assert.deepEqual(ids(await search(ava, 'roadmap in:design')).sort(), [m.launch.id, m.thread.id].sort());
  });

  test('from:@name limits to one author', async () => {
    const r = await search(ava, `roadmap from:@${benHandle}`);
    assert.ok(ids(r).every((id: string) => [m.general.id, m.thread.id, m.deleted.id, m.pinned.id].includes(id) || id === m.thread.id));
    assert.ok(ids(r).includes(m.general.id));
    assert.ok(!ids(r).includes(m.launch.id), 'Ava wrote the launch message');
  });

  test('has:link finds messages with a URL', async () => {
    assert.deepEqual(ids(await search(ava, 'has:link')), [m.launch.id]);
  });

  test('has:pin finds pinned messages', async () => {
    assert.deepEqual(ids(await search(ben, 'has:pin')), [m.pinned.id]);
  });

  test('has:reaction finds reacted messages', async () => {
    assert.deepEqual(ids(await search(ben, 'has:reaction')), [m.general.id]);
  });

  test('has:file finds messages with a live attachment', async () => {
    const f = (await upload(env.app, ben.cookie, wid, general.id, [{ filename: 'roadmap-2026.pdf', type: 'application/pdf', data: Buffer.from('%PDF') }])).body.files[0];
    const post = await ben.post(`/api/conversations/${general.id}/messages`, { text: 'deck attached', fileIds: [f.id] });
    assert.deepEqual(ids(await search(ava, 'has:file in:#general')), [post.body.message.id]);
    await ben.del(`/api/files/${f.id}`);
    assert.deepEqual(ids(await search(ava, 'has:file in:#general')), []);
  });

  test('is:thread finds thread roots and replies, not plain messages', async () => {
    const got = ids(await search(ben, 'is:thread'));
    assert.ok(got.includes(m.thread.id));
    assert.ok(got.includes(m.launch.id));
    assert.ok(!got.includes(m.general.id));
  });

  test('date modifiers: on:, before:, after: (UTC days)', async () => {
    assert.ok(ids(await search(ben, `roadmap on:${TODAY}`)).includes(m.general.id));
    assert.deepEqual(ids(await search(ben, `roadmap on:${YESTERDAY}`)), []);
    assert.ok(ids(await search(ben, `roadmap after:${YESTERDAY}`)).includes(m.general.id));
    assert.deepEqual(ids(await search(ben, `roadmap after:${TODAY}`)), []);
    assert.deepEqual(ids(await search(ben, `roadmap before:${TODAY}`)), []);
    assert.ok(ids(await search(ben, `roadmap before:${TOMORROW}`)).includes(m.general.id));
  });

  test('deleted messages are not found; edited text replaces old text', async () => {
    assert.deepEqual(ids(await search(ben, 'draft')), []);
    assert.deepEqual(ids(await search(ben, 'zebra')), []);
    assert.ok(ids(await search(ben, 'giraffe')).includes(m.zebra.id));
  });

  test('paging with cursor returns the rest and a null nextCursor at the end', async () => {
    const first = await search(ava, 'bulk', 'messages', '&limit=20');
    assert.equal(first.body.results.length, 20);
    assert.equal(first.body.nextCursor, '20');
    const second = await search(ava, 'bulk', 'messages', '&limit=20&cursor=20');
    assert.equal(second.body.results.length, 5);
    assert.equal(second.body.nextCursor, null);
    const all = new Set([...ids(first), ...ids(second)]);
    assert.equal(all.size, 25);
  });

  test('a bad cursor or unknown type is 400; a bad modifier value is 400', async () => {
    assert.equal((await search(ava, 'x', 'messages', '&cursor=abc')).status, 400);
    assert.equal((await search(ava, 'x', 'nope')).status, 400);
    assert.equal((await search(ava, 'has:cats')).status, 400);
    assert.equal((await search(ava, 'on:2026-02-30')).status, 400);
    assert.equal((await search(ava, 'before:yesterday')).status, 400);
    assert.equal((await search(ava, 'is:starred')).status, 400);
  });

  test('empty query returns no results', async () => {
    const r = await search(ava, '   ');
    assert.deepEqual(r.body.results, []);
  });
});

describe('query parser', () => {
  test('parses every modifier and keeps phrases and free words', () => {
    const p = parseQuery('in:#General from:@Ben has:link has:file is:thread after:2026-01-01 "exact phrase" word');
    assert.equal(p.inChannel, 'general');
    assert.equal(p.from, 'ben');
    assert.deepEqual(p.has, ['link', 'file']);
    assert.equal(p.isThread, true);
    assert.equal(p.after, Date.parse('2026-01-02T00:00:00Z'), 'after: excludes that day');
    assert.deepEqual(p.terms, [{ text: 'exact phrase', phrase: true }, { text: 'word', phrase: false }]);
  });

  test('on: covers exactly one UTC day; before: stops at the start of that day', () => {
    const start = Date.parse('2026-03-05T00:00:00Z');
    const on = parseQuery('on:2026-03-05');
    assert.equal(on.after, start);
    assert.equal(on.before, start + DAY);
    assert.equal(parseQuery('before:2026-03-05').before, start);
  });

  test('an unknown word:value token is plain text', () => {
    assert.deepEqual(parseQuery('foo:bar').terms, [{ text: 'foo:bar', phrase: false }]);
  });
});

describe('channels and people', () => {
  test('channels: public visible to all members, private only to members', async () => {
    const r = await search(ben, 'design', 'channels');
    assert.equal(r.body.results[0].conversation.name, 'design');
    assert.equal(r.body.results[0].conversation.isMember, true);
    const outsiderInWs = await search(cleo, 'design', 'channels');
    assert.equal(outsiderInWs.body.results[0].conversation.name, 'design');
    assert.equal(outsiderInWs.body.results[0].conversation.isMember, false);
  });

  test('people: workspace members match by name; outsiders get 404', async () => {
    const r = await search(ava, 'cleo', 'people');
    assert.equal(r.body.results.length, 1);
    assert.equal(r.body.results[0].user.id, cleo.user.id);
    assert.equal(r.body.results[0].user.email, undefined, 'email is not exposed in search');
    assert.equal((await search(outsider, 'cleo', 'people')).status, 404);
  });
});

describe('file names', () => {
  test('uploaded and attached file names are searchable; pending uploads are not', async () => {
    const pending = (await upload(env.app, ben.cookie, wid, general.id, [{ filename: 'pending-roadmap.txt', type: 'text/plain', data: Buffer.from('x') }])).body.files[0];
    assert.deepEqual(ids(await search(ben, 'pending', 'files')), []);
    const f = (await upload(env.app, ben.cookie, wid, general.id, [{ filename: 'budget-q3.xlsx', type: 'application/octet-stream', data: Buffer.from('x') }])).body.files[0];
    await ben.post(`/api/conversations/${general.id}/messages`, { text: 'budget', fileIds: [f.id] });
    assert.deepEqual(ids(await search(ava, 'budget', 'files')), [f.id]);
    assert.deepEqual(ids(await search(ava, 'q3', 'files')), [f.id]);
    assert.ok(pending.id);
  });

  test('a deleted file leaves the results', async () => {
    const f = (await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'vanishing-doc.txt', type: 'text/plain', data: Buffer.from('x') }])).body.files[0];
    await ava.post(`/api/conversations/${general.id}/messages`, { text: 'doc', fileIds: [f.id] });
    assert.deepEqual(ids(await search(ava, 'vanishing', 'files')), [f.id]);
    await ava.del(`/api/files/${f.id}`);
    assert.deepEqual(ids(await search(ava, 'vanishing', 'files')), []);
  });

  test('file search applies in: and from: too', async () => {
    const f = (await upload(env.app, ben.cookie, wid, design.id, [{ filename: 'mockup-final.png', type: 'image/png', data: Buffer.from('x') }])).body.files[0];
    await ben.post(`/api/conversations/${design.id}/messages`, { text: 'mockup', fileIds: [f.id] });
    assert.deepEqual(ids(await search(ava, `mockup in:#design from:@${benHandle}`, 'files')), [f.id]);
    assert.deepEqual(ids(await search(ava, 'mockup in:#general', 'files')), []);
  });
});

describe('index maintenance', () => {
  test('messages written before the server started are indexed by the startup backfill', async () => {
    const db = env.app.ctx.db;
    const id = 'MBACKFILLTEST0001';
    db.prepare('INSERT INTO messages (id, conversation_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, general.id, ava.user.id, 'legacy backfillmarker text', Date.now());
    const app2 = await buildApp({ dbPath: env.app.ctx.config.dbPath, isTest: true });
    try {
      const r = await app2.inject({
        method: 'GET', url: `/api/w/${wid}/search?q=backfillmarker`, headers: { cookie: ava.cookie },
      });
      assert.equal(r.statusCode, 200);
      assert.deepEqual(r.json().results.map((x: any) => x.message.id), [id]);
    } finally {
      await app2.close();
    }
  });
});
