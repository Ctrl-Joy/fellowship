import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, signup } from './helpers';
import {
  listen, openSocket, workspaceFixture, privateChannel, dm, say, notifications, notificationsIn,
  type Fixture, type Sock,
} from './notifications-fixtures';
import { clockFor } from '../src/modules/presence/clock';
import { parseMentions, matchKeywords, inDailyWindow, levelAllows, effectiveLevel } from '../src/modules/notifications/rules';

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

describe('pure rules', () => {
  test('mentions, channel-wide and here markers are parsed', () => {
    const m = parseMentions('hi <@UABC> and <!channel> and <@UXYZ>');
    assert.deepEqual([...m.users].sort(), ['UABC', 'UXYZ']);
    assert.equal(m.channel, true);
    assert.equal(m.here, false);
    assert.equal(parseMentions('<!here> ping').here, true);
    assert.equal(parseMentions('<!everyone>').channel, true);
  });

  test('keywords match whole words only, case-insensitively', () => {
    assert.equal(matchKeywords('Deploy at five', ['deploy']), true);
    assert.equal(matchKeywords('redeploy tonight', ['deploy']), false);
    assert.equal(matchKeywords('the release notes are out', ['release notes']), true);
    assert.equal(matchKeywords('<@UDEPLOY> nothing here', ['deploy']), false, 'markup is not matched');
  });

  test('daily windows wrap past midnight', () => {
    assert.equal(inDailyWindow(23 * 60, '22:00', '08:00'), true);
    assert.equal(inDailyWindow(7 * 60 + 59, '22:00', '08:00'), true);
    assert.equal(inDailyWindow(8 * 60, '22:00', '08:00'), false);
    assert.equal(inDailyWindow(12 * 60, '09:00', '17:00'), true);
    assert.equal(inDailyWindow(18 * 60, '09:00', '17:00'), false);
  });

  test('conversation override beats the global level unless default', () => {
    assert.equal(effectiveLevel('mentions', 'default'), 'mentions');
    assert.equal(effectiveLevel('mentions', 'all'), 'all');
    assert.equal(effectiveLevel('all', 'nothing'), 'nothing');
    assert.equal(levelAllows('mentions', 'reaction'), false);
    assert.equal(levelAllows('all', 'reaction'), true);
  });
});

describe('direct messages and mentions', () => {
  test('a DM notifies the other person and never the sender', async () => {
    const f = await workspaceFixture(env.app);
    const cid = await dm(f, f.ava, [f.ben.user.id]);
    await say(f.ava, cid, 'hi ben');
    const bens = await notificationsIn(f.ben, f.wid, cid);
    assert.equal(bens.length, 1);
    assert.equal(bens[0].kind, 'dm');
    assert.equal(bens[0].text, 'hi ben');
    assert.equal(bens[0].actorId, f.ava.user.id);
    assert.equal(bens[0].readAt, null);
    assert.equal((await notificationsIn(f.ava, f.wid, cid)).length, 0);
  });

  test('a DM mentioning the recipient still produces exactly one notification', async () => {
    const f = await workspaceFixture(env.app);
    const cid = await dm(f, f.ava, [f.ben.user.id]);
    await say(f.ava, cid, `<@${f.ben.user.id}> ping`);
    assert.equal((await notificationsIn(f.ben, f.wid, cid)).length, 1);
  });

  test('an @mention notifies the mentioned member; a plain message does not under default prefs', async () => {
    const f = await workspaceFixture(env.app);
    await say(f.ava, f.general, 'just chatting');
    assert.equal((await notificationsIn(f.ben, f.wid, f.general)).length, 0);
    await say(f.ava, f.general, `hey <@${f.ben.user.id}>, see this`);
    const rows = await notificationsIn(f.ben, f.wid, f.general);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'mention');
    assert.equal(rows[0].conversationName, 'general');
    assert.equal((await notificationsIn(f.cleo, f.wid, f.general)).length, 0, 'not mentioned, no notification');
  });

  test('mentioning yourself never notifies you', async () => {
    const f = await workspaceFixture(env.app);
    await say(f.ava, f.general, `note to self <@${f.ava.user.id}>`);
    assert.equal((await notificationsIn(f.ava, f.wid, f.general)).length, 0);
  });

  test('<!channel> notifies every channel member except the author', async () => {
    const f = await workspaceFixture(env.app);
    await say(f.ava, f.general, 'everyone look <!channel>');
    for (const c of [f.ben, f.cleo, f.dan]) {
      const rows = await notificationsIn(c, f.wid, f.general);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].kind, 'channel_broadcast');
    }
    assert.equal((await notificationsIn(f.ava, f.wid, f.general)).length, 0);
  });
});

describe('@here uses presence', () => {
  test('only members who are active right now are notified, and the socket gets the frame', async () => {
    const f = await workspaceFixture(env.app);
    const benSock = await openSocket(port, f.ben.cookie);
    sockets.push(benSock);
    const cleoSock = await openSocket(port, f.cleo.cookie); // connected but never active
    sockets.push(cleoSock);
    benSock.send('presence.active');
    await benSock.settle(80);

    await say(f.ava, f.general, 'standup now <!here>');

    const benRows = await notificationsIn(f.ben, f.wid, f.general);
    assert.equal(benRows.length, 1, 'active member is notified');
    assert.equal(benRows[0].kind, 'channel_broadcast');
    assert.equal((await notificationsIn(f.cleo, f.wid, f.general)).length, 0, 'away member is not');
    assert.equal((await notificationsIn(f.dan, f.wid, f.general)).length, 0, 'offline member is not');

    const frame = await benSock.waitFor((x) => x.type === 'notification.created');
    assert.equal(frame.payload.notification.kind, 'channel_broadcast');
    await cleoSock.settle(120);
    assert.equal(cleoSock.frames.filter((x) => x.type === 'notification.created').length, 0,
      'notification.created goes to the recipient only');
  });
});

describe('threads', () => {
  test('replies notify the root author and earlier repliers, not bystanders', async () => {
    const f = await workspaceFixture(env.app);
    const root = await say(f.ava, f.general, 'thoughts on the launch?');
    await say(f.ben, f.general, 'looks good', root.id);
    await say(f.cleo, f.general, 'agreed', root.id);

    const avaRows = (await notifications(f.ava, f.wid, 'threads')).notifications;
    assert.equal(avaRows.length, 2, 'root author gets both replies');
    assert.ok(avaRows.every((n) => n.kind === 'thread_reply' && n.messageId));

    const benRows = (await notifications(f.ben, f.wid, 'threads')).notifications;
    assert.equal(benRows.length, 1, 'earlier repliers follow the thread');
    assert.equal(benRows[0].actorId, f.cleo.user.id);
    assert.equal(benRows[0].threadRootId, root.id);

    assert.equal((await notificationsIn(f.cleo, f.wid, f.general)).length, 0, 'author of the last reply');
    assert.equal((await notificationsIn(f.dan, f.wid, f.general)).length, 0, 'never replied: not following');
  });

  test('a mention inside a thread reply is a mention, not a duplicate thread_reply', async () => {
    const f = await workspaceFixture(env.app);
    const root = await say(f.ava, f.general, 'question');
    await say(f.ben, f.general, 'answer', root.id);
    await say(f.cleo, f.general, `<@${f.ava.user.id}> can you confirm?`, root.id);
    const avaRows = (await notificationsIn(f.ava, f.wid, f.general));
    assert.equal(avaRows.length, 2, 'one for each reply, the mention reply counts once');
    assert.equal(avaRows.filter((n) => n.kind === 'mention').length, 1);
  });
});

describe('privacy', () => {
  test('nothing from a private channel reaches people who are not members', async () => {
    const f = await workspaceFixture(env.app);
    const secret = await privateChannel(f, 'secret-plans', [f.ben.user.id]);
    await say(f.ava, secret, `<@${f.cleo.user.id}> <!channel> deploy is secret`);
    await say(f.ava, secret, 'deploy again');
    assert.equal((await notificationsIn(f.cleo, f.wid, secret)).length, 0);
    assert.equal((await notifications(f.cleo, f.wid)).notifications.length, 0, 'not even in the activity feed');
    assert.equal((await notificationsIn(f.ben, f.wid, secret)).length, 1, 'the member is notified once');
  });

  test('a user who is not in the workspace sees no notifications at all', async () => {
    const f = await workspaceFixture(env.app);
    const stranger = await signup(env.app, 'Stranger');
    await say(f.ava, f.general, `<!channel> hello`);
    const r = await stranger.get(`/api/w/${f.wid}/notifications`);
    assert.equal(r.status, 404);
  });

  test('leaving a private channel hides its notifications from the feed', async () => {
    const f = await workspaceFixture(env.app);
    const secret = await privateChannel(f, 'leaving-soon', [f.ben.user.id]);
    await say(f.ava, secret, `<@${f.ben.user.id}> hi`);
    assert.equal((await notificationsIn(f.ben, f.wid, secret)).length, 1);
    const left = await f.ben.post(`/api/conversations/${secret}/leave`);
    assert.equal(left.status, 200);
    assert.equal((await notificationsIn(f.ben, f.wid, secret)).length, 0);
    assert.equal((await notifications(f.ben, f.wid)).unreadCount, 0);
  });
});

describe('per-user and per-conversation preferences', () => {
  test('muting a conversation silences mentions and DMs in it', async () => {
    const f = await workspaceFixture(env.app);
    const r = await f.ben.patch(`/api/conversations/${f.general}`, { muted: true });
    assert.equal(r.status, 200);
    await say(f.ava, f.general, `<@${f.ben.user.id}> urgent`);
    assert.equal((await notificationsIn(f.ben, f.wid, f.general)).length, 0);
    await f.ben.patch(`/api/conversations/${f.general}`, { muted: false });
    await say(f.ava, f.general, `<@${f.ben.user.id}> again`);
    assert.equal((await notificationsIn(f.ben, f.wid, f.general)).length, 1);
  });

  test('conversation notify_pref "nothing" silences a DM the global level would allow', async () => {
    const f = await workspaceFixture(env.app);
    const cid = await dm(f, f.ava, [f.ben.user.id]);
    const r = await f.ben.patch(`/api/conversations/${cid}`, { notifyPref: 'nothing' });
    assert.equal(r.status, 200);
    await say(f.ava, cid, 'still there?');
    assert.equal((await notificationsIn(f.ben, f.wid, cid)).length, 0);
  });

  test('conversation notify_pref "all" notifies every message in that channel only', async () => {
    const f = await workspaceFixture(env.app);
    await f.ben.patch(`/api/conversations/${f.random}`, { notifyPref: 'all' });
    await say(f.ava, f.random, 'no mention here');
    const rows = await notificationsIn(f.ben, f.wid, f.random);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'channel_broadcast');
    await say(f.ava, f.general, 'no mention here either');
    assert.equal((await notificationsIn(f.ben, f.wid, f.general)).length, 0, 'general keeps the default');
  });

  test('global level "all" includes reactions, "mentions" does not, "nothing" silences everything', async () => {
    const f = await workspaceFixture(env.app);
    const msg = await say(f.ben, f.general, 'shipped it');
    const react = (emoji: string) => env.app.ctx.bus.emit({
      type: 'reaction.added', workspaceId: f.wid, conversationId: f.general, actorId: f.cleo.user.id,
      payload: { messageId: msg.id, emoji, userId: f.cleo.user.id },
    });
    react(':tada:');
    assert.equal((await notifications(f.ben, f.wid, 'reactions')).notifications.length, 0, 'mentions level: no reactions');

    const put = await f.ben.patch(`/api/w/${f.wid}/notifications/prefs`, { level: 'all' });
    assert.equal(put.body.prefs.level, 'all');
    react(':raised_hands:');
    const reactions = (await notifications(f.ben, f.wid, 'reactions')).notifications;
    assert.equal(reactions.length, 1);
    assert.equal(reactions[0].kind, 'reaction');
    assert.equal(reactions[0].emoji, ':raised_hands:');
    assert.equal(reactions[0].actorId, f.cleo.user.id);

    await f.ben.patch(`/api/w/${f.wid}/notifications/prefs`, { level: 'nothing' });
    const dmCid = await dm(f, f.ava, [f.ben.user.id]);
    await say(f.ava, dmCid, 'hello?');
    assert.equal((await notificationsIn(f.ben, f.wid, dmCid)).length, 0);
  });

  test('a reaction on your own message by yourself is never a notification', async () => {
    const f = await workspaceFixture(env.app);
    await f.ben.patch(`/api/w/${f.wid}/notifications/prefs`, { level: 'all' });
    const msg = await say(f.ben, f.general, 'mine');
    env.app.ctx.bus.emit({
      type: 'reaction.added', workspaceId: f.wid, conversationId: f.general, actorId: f.ben.user.id,
      payload: { messageId: msg.id, emoji: ':+1:', userId: f.ben.user.id },
    });
    assert.equal((await notifications(f.ben, f.wid, 'reactions')).notifications.length, 0);
  });

  test('keywords notify on whole-word matches, case-insensitively, and can be cleared', async () => {
    const f = await workspaceFixture(env.app);
    const put = await f.ben.patch(`/api/w/${f.wid}/notifications/prefs`, { keywords: ['Deploy', 'deploy', 'release notes'] });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.prefs.keywords, ['Deploy', 'release notes'], 'duplicates removed case-insensitively');

    await say(f.ava, f.general, 'DEPLOY window is 5pm');
    await say(f.ava, f.general, 'the redeploy is tomorrow');
    await say(f.ava, f.general, 'release notes are in the wiki');
    const rows = await notificationsIn(f.ben, f.wid, f.general);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((n) => n.kind === 'keyword'));

    await f.ben.patch(`/api/w/${f.wid}/notifications/prefs`, { keywords: [] });
    await say(f.ava, f.general, 'deploy again');
    assert.equal((await notificationsIn(f.ben, f.wid, f.general)).length, 2);
  });

  test('a message matching a mention and a keyword produces only the mention', async () => {
    const f = await workspaceFixture(env.app);
    await f.ben.patch(`/api/w/${f.wid}/notifications/prefs`, { keywords: ['standup'] });
    await say(f.ava, f.general, `<@${f.ben.user.id}> standup moved to 10`);
    const rows = await notificationsIn(f.ben, f.wid, f.general);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'mention');
  });

  test('invalid preferences are rejected with 400', async () => {
    const f = await workspaceFixture(env.app);
    const tooMany = Array.from({ length: 21 }, (_, i) => `k${i}`);
    assert.equal((await f.ben.patch(`/api/w/${f.wid}/notifications/prefs`, { keywords: tooMany })).status, 400);
    assert.equal((await f.ben.patch(`/api/w/${f.wid}/notifications/prefs`, { dnd: { start: '25:00' } })).status, 400);
    assert.equal((await f.ben.patch(`/api/w/${f.wid}/notifications/prefs`, { level: 'loud' })).status, 400);
    assert.equal((await f.ben.get(`/api/w/${f.wid}/notifications?filter=bogus`)).status, 400);
    const prefs = (await f.ben.get(`/api/w/${f.wid}/notifications/prefs`)).body.prefs;
    assert.equal(prefs.level, 'mentions');
    assert.deepEqual(prefs.dnd, { enabled: false, start: '22:00', end: '08:00' });
  });
});

describe('do not disturb', () => {
  test('a manual snooze flags new notifications as silenced, clearing it restores them', async () => {
    const f = await workspaceFixture(env.app);
    const snooze = await f.ben.post(`/api/w/${f.wid}/notifications/snooze`, { minutes: 30 });
    assert.equal(snooze.body.silencedNow, true);
    assert.ok(snooze.body.prefs.snoozeUntil > Date.now());
    await say(f.ava, f.general, `<@${f.ben.user.id}> while I was away`);
    const during = await notificationsIn(f.ben, f.wid, f.general);
    assert.equal(during.length, 1, 'still listed in the activity feed');
    assert.equal(during[0].silenced, true);

    const clear = await f.ben.post(`/api/w/${f.wid}/notifications/snooze`, { minutes: 0 });
    assert.equal(clear.body.silencedNow, false);
    await say(f.ava, f.general, `<@${f.ben.user.id}> back now`);
    const after = (await notificationsIn(f.ben, f.wid, f.general)).find((n) => n.text.endsWith('back now'));
    assert.equal(after.silenced, false);
  });

  test('the daily schedule is evaluated in the user timezone (overnight window)', async () => {
    const f = await workspaceFixture(env.app);
    await f.ben.patch('/api/users/me', { timezone: 'America/New_York' });
    await f.ben.patch(`/api/w/${f.wid}/notifications/prefs`, { dnd: { enabled: true, start: '22:00', end: '08:00' } });

    // 04:00 UTC in January is 23:00 in New York: inside the window.
    clock().set(() => Date.UTC(2026, 0, 5, 4, 0));
    await say(f.ava, f.general, `<@${f.ben.user.id}> late night`);
    // 15:00 UTC is 10:00 in New York: outside the window.
    clock().set(() => Date.UTC(2026, 0, 5, 15, 0));
    await say(f.ava, f.general, `<@${f.ben.user.id}> mid morning`);

    const rows = await notificationsIn(f.ben, f.wid, f.general);
    assert.equal(rows.find((n) => n.text.endsWith('late night')).silenced, true);
    assert.equal(rows.find((n) => n.text.endsWith('mid morning')).silenced, false);
  });
});

describe('activity feed', () => {
  test('tabs filter by kind, unread-only works and read-all clears the count', async () => {
    const f = await workspaceFixture(env.app);
    const root = await say(f.ava, f.general, 'a root');
    await say(f.ava, f.general, `<@${f.ben.user.id}> mention`);
    await say(f.cleo, f.general, 'reply', root.id);
    const cid = await dm(f, f.ava, [f.ben.user.id]);
    await say(f.ava, cid, 'dm to ben');

    const all = await notifications(f.ben, f.wid, 'all');
    const kinds = all.notifications.map((n) => n.kind).sort();
    assert.deepEqual(kinds, ['dm', 'mention']);
    assert.equal(all.unreadCount, 2);
    assert.equal((await notifications(f.ben, f.wid, 'mentions')).notifications.length, 2);
    assert.equal((await notifications(f.ben, f.wid, 'threads')).notifications.length, 0);
    assert.equal((await notifications(f.ben, f.wid, 'reactions')).notifications.length, 0);

    const avaThreads = await notifications(f.ava, f.wid, 'threads');
    assert.equal(avaThreads.notifications.length, 1);
    assert.equal(avaThreads.notifications[0].actorId, f.cleo.user.id);

    const one = all.notifications[0];
    const marked = await f.ben.post(`/api/w/${f.wid}/notifications/${one.id}/read`);
    assert.equal(marked.body.unreadCount, 1);
    assert.equal((await notifications(f.ben, f.wid, 'all', '&unread=1')).notifications.length, 1);

    const cleared = await f.ben.post(`/api/w/${f.wid}/notifications/read-all`);
    assert.equal(cleared.body.unreadCount, 0);
    assert.equal((await notifications(f.ben, f.wid, 'all', '&unread=1')).notifications.length, 0);
  });

  test('paging: before= returns older items and hasMore is set', async () => {
    const f = await workspaceFixture(env.app);
    for (let i = 0; i < 3; i++) await say(f.ava, f.general, `<@${f.ben.user.id}> n${i}`);
    const page1 = await f.ben.get(`/api/w/${f.wid}/notifications?limit=2`);
    assert.equal(page1.body.notifications.length, 2);
    assert.equal(page1.body.hasMore, true);
    const page2 = await f.ben.get(`/api/w/${f.wid}/notifications?limit=2&before=${page1.body.nextCursor}`);
    assert.equal(page2.body.notifications.length, 1);
    assert.equal(page2.body.hasMore, false);
    const ids = [...page1.body.notifications, ...page2.body.notifications].map((n) => n.id);
    assert.equal(new Set(ids).size, 3);
  });

  test('marking one notification read is limited to its owner', async () => {
    const f = await workspaceFixture(env.app);
    await say(f.ava, f.general, `<@${f.ben.user.id}> hi`);
    const [row] = await notificationsIn(f.ben, f.wid, f.general);
    const intruder = await f.cleo.post(`/api/w/${f.wid}/notifications/${row.id}/read`);
    assert.equal(intruder.status, 404);
    assert.equal((await notifications(f.ben, f.wid)).unreadCount, 1);
  });

  test('opening a conversation marks notifications from before the read cursor as read', async () => {
    const f = await workspaceFixture(env.app);
    await say(f.ava, f.general, `<@${f.ben.user.id}> one`);
    await say(f.ava, f.general, `<@${f.ben.user.id}> two`);
    assert.equal((await notifications(f.ben, f.wid)).unreadCount, 2);
    const r = await f.ben.post(`/api/conversations/${f.general}/read`, { ts: Date.now() + 1000 });
    assert.equal(r.status, 200);
    assert.equal((await notifications(f.ben, f.wid)).unreadCount, 0);
  });

  test('deleting a message removes its text from the feed', async () => {
    const f = await workspaceFixture(env.app);
    const msg = await say(f.ava, f.general, `<@${f.ben.user.id}> secret text`);
    assert.ok((await notificationsIn(f.ben, f.wid, f.general))[0].text.endsWith('secret text'));
    const del = await f.ava.del(`/api/messages/${msg.id}`);
    assert.equal(del.status, 200);
    assert.equal((await notificationsIn(f.ben, f.wid, f.general))[0].text, null);
  });

  test('the viewer gets notification.created over WebSocket and nobody else', async () => {
    const f = await workspaceFixture(env.app);
    const benSock = await openSocket(port, f.ben.cookie);
    const cleoSock = await openSocket(port, f.cleo.cookie);
    sockets.push(benSock, cleoSock);
    const cid = await dm(f, f.ava, [f.ben.user.id]);
    await say(f.ava, cid, 'realtime hi');
    const frame = await benSock.waitFor((x) => x.type === 'notification.created');
    assert.equal(frame.payload.notification.kind, 'dm');
    assert.equal(frame.payload.notification.text, 'realtime hi');
    await cleoSock.settle(120);
    assert.equal(cleoSock.frames.filter((x) => x.type === 'notification.created').length, 0);
  });
});

describe('preference endpoints', () => {
  test('prefs round-trip including keywords and DND schedule', async () => {
    const f = await workspaceFixture(env.app);
    const put = await f.ben.patch(`/api/w/${f.wid}/notifications/prefs`, {
      level: 'all', keywords: ['alpha'], dnd: { enabled: true, start: '21:30', end: '07:15' },
    });
    assert.equal(put.status, 200);
    const got = (await f.ben.get(`/api/w/${f.wid}/notifications/prefs`)).body.prefs;
    assert.equal(got.level, 'all');
    assert.deepEqual(got.keywords, ['alpha']);
    assert.deepEqual(got.dnd, { enabled: true, start: '21:30', end: '07:15' });
    // Other workspaces and other users keep their own defaults.
    const cleoPrefs = (await f.cleo.get(`/api/w/${f.wid}/notifications/prefs`)).body.prefs;
    assert.equal(cleoPrefs.level, 'mentions');
  });

  test('conversation prefs use the core conversation endpoint', async () => {
    const f = await workspaceFixture(env.app);
    const r = await f.ben.patch(`/api/conversations/${f.general}`, { notifyPref: 'mentions', muted: false });
    assert.equal(r.body.conversation.notifyPref, 'mentions');
    assert.equal(r.body.conversation.muted, false);
  });
});
