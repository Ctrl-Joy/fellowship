import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, signup } from './helpers';
import { listen, openSocket, workspaceFixture, type Sock } from './notifications-fixtures';
import { clockFor } from '../src/modules/presence/clock';
import { presenceFor, ACTIVITY_WINDOW_MS } from '../src/modules/presence/service';

let env: Awaited<ReturnType<typeof makeTestApp>>;
let port: number;
const sockets: Sock[] = [];

before(async () => {
  env = await makeTestApp();
  port = await listen(env.app);
});

after(async () => { await env.cleanup(); });

afterEach(async () => {
  clockFor(env.app.ctx).reset();
  for (const s of sockets.splice(0)) await s.close();
});

const clock = () => clockFor(env.app.ctx);
const presence = () => presenceFor(env.app.ctx);

async function socketFor(c: { cookie: string }) {
  const s = await openSocket(port, c.cookie);
  sockets.push(s);
  return s;
}

const changedFor = (userId: string, state: 'active' | 'away') => (f: any) =>
  f.type === 'presence.changed' && f.payload.userId === userId && f.payload.presence === state;

describe('presence states', () => {
  test('members without an open socket are away', async () => {
    const f = await workspaceFixture(env.app);
    const r = await f.ava.get(`/api/w/${f.wid}/presence`);
    assert.equal(r.status, 200);
    assert.equal(r.body.presence[f.ben.user.id], 'away');
    assert.equal(r.body.presence[f.ava.user.id], 'away');
  });

  test('an open socket plus presence.active makes you active, and co-members hear about it', async () => {
    const f = await workspaceFixture(env.app);
    const benSock = await socketFor(f.ben);
    const cleoSock = await socketFor(f.cleo);
    const outsider = await signup(env.app, 'Outside Presence');
    const outsiderSock = await socketFor(outsider);

    benSock.send('presence.active');
    const frame = await cleoSock.waitFor(changedFor(f.ben.user.id, 'active'));
    assert.equal(frame.workspaceId, f.wid);
    assert.equal(frame.payload.manualAway, false);
    await benSock.waitFor(changedFor(f.ben.user.id, 'active'));

    const states = (await f.cleo.get(`/api/w/${f.wid}/presence`)).body.presence;
    assert.equal(states[f.ben.user.id], 'active');
    assert.equal(states[f.cleo.user.id], 'away');

    await outsiderSock.settle(120);
    assert.equal(outsiderSock.frames.filter((x) => x.type === 'presence.changed').length, 0,
      'people outside the workspace do not see presence');
  });

  test('repeated activity frames do not re-emit presence.changed', async () => {
    const f = await workspaceFixture(env.app);
    const benSock = await socketFor(f.ben);
    const cleoSock = await socketFor(f.cleo);
    benSock.send('presence.active');
    await cleoSock.waitFor(changedFor(f.ben.user.id, 'active'));
    benSock.send('presence.active');
    benSock.send('presence.active');
    await cleoSock.settle(150);
    assert.equal(cleoSock.frames.filter(changedFor(f.ben.user.id, 'active')).length, 1);
  });

  test('presence.away (client idle) flips to away immediately', async () => {
    const f = await workspaceFixture(env.app);
    const benSock = await socketFor(f.ben);
    const cleoSock = await socketFor(f.cleo);
    benSock.send('presence.active');
    await cleoSock.waitFor(changedFor(f.ben.user.id, 'active'));
    benSock.send('presence.away');
    await cleoSock.waitFor(changedFor(f.ben.user.id, 'away'));
    assert.equal((await f.cleo.get(`/api/w/${f.wid}/presence`)).body.presence[f.ben.user.id], 'away');
  });

  test('closing the last socket makes you away and tells co-members', async () => {
    const f = await workspaceFixture(env.app);
    const cleoSock = await socketFor(f.cleo);
    const benSock = await openSocket(port, f.ben.cookie);
    benSock.send('presence.active');
    await cleoSock.waitFor(changedFor(f.ben.user.id, 'active'));
    await benSock.close();
    await cleoSock.waitFor(changedFor(f.ben.user.id, 'away'));
  });

  test('activity expires after 10 minutes without new frames (scheduler tick)', async () => {
    const f = await workspaceFixture(env.app);
    const benSock = await socketFor(f.ben);
    const cleoSock = await socketFor(f.cleo);
    benSock.send('presence.active');
    await cleoSock.waitFor(changedFor(f.ben.user.id, 'active'));

    const base = Date.now();
    clock().set(() => base + ACTIVITY_WINDOW_MS - 60_000);
    presence().tick();
    assert.equal(presence().state(f.ben.user.id), 'active', 'still inside the window');

    clock().set(() => base + ACTIVITY_WINDOW_MS + 60_000);
    presence().tick();
    await cleoSock.waitFor(changedFor(f.ben.user.id, 'away'));
    assert.equal(presence().state(f.ben.user.id), 'away');
  });

  test('manual "appear away" overrides activity until it is turned off', async () => {
    const f = await workspaceFixture(env.app);
    const benSock = await socketFor(f.ben);
    const cleoSock = await socketFor(f.cleo);
    benSock.send('presence.active');
    await cleoSock.waitFor(changedFor(f.ben.user.id, 'active'));

    const on = await f.ben.patch('/api/presence/me', { manualAway: true });
    assert.equal(on.status, 200);
    assert.equal(on.body.presence, 'away');
    await cleoSock.waitFor(changedFor(f.ben.user.id, 'away'));

    benSock.send('presence.active');
    await benSock.settle(120);
    assert.equal(presence().state(f.ben.user.id), 'away', 'activity does not override the manual setting');

    const off = await f.ben.patch('/api/presence/me', { manualAway: false });
    assert.equal(off.body.presence, 'active');
    await cleoSock.waitFor(changedFor(f.ben.user.id, 'active'));
  });

  test('presence routes validate input and need workspace membership', async () => {
    const f = await workspaceFixture(env.app);
    assert.equal((await f.ben.patch('/api/presence/me', { manualAway: 'yes' })).status, 400);
    const stranger = await signup(env.app, 'Not A Member');
    assert.equal((await stranger.get(`/api/w/${f.wid}/presence`)).status, 404);
    const mine = await f.ben.get('/api/presence/me');
    assert.equal(mine.body.presence, 'away');
    assert.equal(mine.body.manualAway, false);
  });
});

describe('custom status', () => {
  test('a status with a future expiry is shown and kept by the scheduler', async () => {
    const f = await workspaceFixture(env.app);
    const expires = Date.now() + 60 * 60_000;
    const r = await f.ben.patch('/api/users/me', { statusEmoji: '🚌', statusText: 'Commuting', statusExpires: expires });
    assert.equal(r.body.user.statusText, 'Commuting');
    presence().tick();
    const seen = (await f.cleo.get(`/api/users/${f.ben.user.id}`)).body.user;
    assert.equal(seen.statusText, 'Commuting');
    assert.equal(seen.statusExpires, expires);
  });

  test('an expired status is hidden at once and cleared by the tick, with user.updated sent to co-members', async () => {
    const f = await workspaceFixture(env.app);
    const cleoSock = await socketFor(f.cleo);
    await f.ben.patch('/api/users/me', { statusEmoji: '🌴', statusText: 'Vacationing', statusExpires: Date.now() - 1000 });

    const hidden = (await f.cleo.get(`/api/users/${f.ben.user.id}`)).body.user;
    assert.equal(hidden.statusText, '', 'expired status is never shown');
    assert.equal(hidden.statusEmoji, '');

    presence().tick();
    const frame = await cleoSock.waitFor((x) => x.type === 'user.updated' && x.payload.user.id === f.ben.user.id);
    assert.equal(frame.payload.user.statusText, '');
    const row = env.app.ctx.db.prepare('SELECT status_text, status_expires FROM users WHERE id = ?').get(f.ben.user.id) as any;
    assert.equal(row.status_text, '');
    assert.equal(row.status_expires, null);
  });

  test('"never" (no expiry) statuses survive the tick', async () => {
    const f = await workspaceFixture(env.app);
    await f.ben.patch('/api/users/me', { statusEmoji: '🏠', statusText: 'Working remotely', statusExpires: null });
    clock().set(() => Date.now() + 365 * 24 * 60 * 60_000);
    presence().tick();
    const row = env.app.ctx.db.prepare('SELECT status_text FROM users WHERE id = ?').get(f.ben.user.id) as any;
    assert.equal(row.status_text, 'Working remotely');
  });
});

describe('profile fields', () => {
  test('core profile fields round-trip through PATCH users/me', async () => {
    const f = await workspaceFixture(env.app);
    const r = await f.ben.patch('/api/users/me', {
      fullName: 'Benedict Test', displayName: 'Ben', title: 'Staff engineer', pronouns: 'he/him',
      phone: '+1 555 0100', timezone: 'Europe/Paris',
    });
    assert.equal(r.status, 200);
    const seen = (await f.cleo.get(`/api/users/${f.ben.user.id}`)).body.user;
    assert.equal(seen.title, 'Staff engineer');
    assert.equal(seen.pronouns, 'he/him');
    assert.equal(seen.timezone, 'Europe/Paris');
    assert.equal(seen.displayName, 'Ben');
  });
});

describe('avatars', () => {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

  function multipart(filename: string, type: string, bytes: Buffer) {
    const boundary = `----fsTest${Math.random().toString(16).slice(2)}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return { body, contentType: `multipart/form-data; boundary=${boundary}` };
  }

  test('upload, fetch, reject bad types, and remove', async () => {
    const f = await workspaceFixture(env.app);
    const { body, contentType } = multipart('me.png', 'image/png', PNG);
    const up = await env.app.inject({
      method: 'POST', url: '/api/users/me/avatar', payload: body,
      headers: { cookie: f.ben.cookie, 'content-type': contentType },
    });
    assert.equal(up.statusCode, 200, up.body);
    const url: string = up.json().user.avatarUrl;
    assert.match(url, new RegExp(`^/api/avatars/${f.ben.user.id}\\?v=`));

    const img = await f.cleo.get(url);
    assert.equal(img.status, 200);

    const bad = multipart('notes.txt', 'text/plain', Buffer.from('nope'));
    const rejected = await env.app.inject({
      method: 'POST', url: '/api/users/me/avatar', payload: bad.body,
      headers: { cookie: f.ben.cookie, 'content-type': bad.contentType },
    });
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.json().error.code, 'unsupported_type');

    const del = await f.ben.del('/api/users/me/avatar');
    assert.equal(del.status, 200);
    assert.equal(del.body.user.avatarUrl, null);
    assert.equal((await f.cleo.get(`/api/avatars/${f.ben.user.id}`)).status, 404);
  });

  test('avatars are only visible to people who share a workspace', async () => {
    const f = await workspaceFixture(env.app);
    const { body, contentType } = multipart('me.png', 'image/png', PNG);
    await env.app.inject({ method: 'POST', url: '/api/users/me/avatar', payload: body, headers: { cookie: f.ben.cookie, 'content-type': contentType } });
    const stranger = await signup(env.app, 'Avatar Stranger');
    assert.equal((await stranger.get(`/api/avatars/${f.ben.user.id}`)).status, 404);
  });
});
