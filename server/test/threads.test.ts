import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, signup, type TestClient } from './helpers';

let env: Awaited<ReturnType<typeof makeTestApp>>;
let ava: TestClient, ben: TestClient, cleo: TestClient, outsider: TestClient;
let wid: string;
let cid: string;
let otherWid: string;

before(async () => {
  env = await makeTestApp();
  ava = await signup(env.app, 'Ava Thread');
  ben = await signup(env.app, 'Ben Thread');
  cleo = await signup(env.app, 'Cleo Thread');
  outsider = await signup(env.app, 'Out Thread');

  wid = (await ava.post('/api/workspaces', { name: 'Threads WS' })).body.workspace.id;
  const invite = (await ava.get(`/api/w/${wid}`)).body.workspace.inviteCode;
  await ben.post(`/api/workspaces/join/${invite}`);
  await cleo.post(`/api/workspaces/join/${invite}`);
  cid = (await ava.post(`/api/w/${wid}/channels`, { name: 'design' })).body.conversation.id;
  await ben.post(`/api/conversations/${cid}/join`);
  // cleo stays in the workspace but does not join #design.

  otherWid = (await outsider.post('/api/workspaces', { name: 'Elsewhere' })).body.workspace.id;
});

after(async () => { await env.cleanup(); });

async function post(client: TestClient, text: string, threadRootId?: string, alsoSendToChannel = false) {
  const r = await client.post(`/api/conversations/${cid}/messages`, { text, threadRootId, alsoSendToChannel });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.message;
}

async function threadState(client: TestClient, rootId: string) {
  return (await client.get(`/api/threads/${rootId}`)).body;
}

async function listThreads(client: TestClient) {
  return (await client.get(`/api/w/${wid}/threads`)).body;
}

describe('follow rules', () => {
  let root: any;

  test('root author and every replier follow automatically; others do not', async () => {
    root = await post(ava, 'Kickoff for the redesign?');
    assert.equal((await threadState(ava, root.id)).following, false, 'no replies yet, nothing followed');

    await post(ben, 'Yes, let us start Monday', root.id);
    const avaState = await threadState(ava, root.id);
    const benState = await threadState(ben, root.id);
    const cleoState = await threadState(cleo, root.id);
    assert.equal(avaState.following, true, 'root author follows after the first reply');
    assert.equal(benState.following, true, 'replier follows');
    assert.equal(cleoState.following, false, 'bystander does not follow');
    assert.equal(benState.unreadCount, 0, 'own reply is never unread');
    assert.equal(avaState.replies.length, 1);
    assert.equal(avaState.replyCount, 1);
  });

  test('explicit follow and unfollow toggle the viewer state only', async () => {
    await cleo.post(`/api/conversations/${cid}/join`);
    const f = await cleo.post(`/api/threads/${root.id}/follow`);
    assert.equal(f.status, 200);
    assert.equal(f.body.following, true);
    assert.equal((await threadState(cleo, root.id)).following, true);
    assert.equal((await threadState(ben, root.id)).following, true, 'others unaffected');

    const u = await cleo.del(`/api/threads/${root.id}/follow`);
    assert.equal(u.body.following, false);
    assert.equal((await threadState(cleo, root.id)).following, false);
  });

  test('an unfollowed root author is not re-followed by someone else replying', async () => {
    assert.equal((await ava.del(`/api/threads/${root.id}/follow`)).body.following, false);
    await post(ben, 'Still on for Monday', root.id);
    assert.equal((await threadState(ava, root.id)).following, false);
    // Replying yourself counts as participating again.
    await post(ava, 'Actually yes, I am in', root.id);
    assert.equal((await threadState(ava, root.id)).following, true);
  });

  test('follow/unfollow with a reply id targets its root', async () => {
    await ben.del(`/api/threads/${root.id}/follow`);
    const reply = await post(ava, 'side note', root.id);
    const f = await ben.post(`/api/threads/${reply.id}/follow`);
    assert.equal(f.status, 200);
    assert.equal(f.body.rootId, root.id);
    assert.equal(f.body.following, true);
    assert.equal((await threadState(ben, root.id)).following, true);
    await ben.del(`/api/threads/${reply.id}/follow`);
    assert.equal((await threadState(ben, root.id)).following, false);
  });

  test('a non-member of the channel cannot follow; outsiders cannot read', async () => {
    await cleo.post(`/api/conversations/${cid}/leave`);
    const denied = await cleo.post(`/api/threads/${root.id}/follow`);
    assert.equal(denied.status, 403);
    const hidden = await outsider.get(`/api/threads/${root.id}`);
    assert.equal(hidden.status, 404);
    const hiddenList = await outsider.get(`/api/w/${wid}/threads`);
    assert.equal(hiddenList.status, 404);
  });

  test('unauthenticated thread requests are rejected', async () => {
    const r = await env.app.inject({ method: 'GET', url: `/api/threads/${root.id}` });
    assert.equal(r.statusCode, 401);
  });
});

describe('unread counts and the threads list', () => {
  test('unread counts only other people replies after the read cursor', async () => {
    const root = await post(ben, 'Design review notes');
    await post(ava, 'First look', root.id); // ava follows via reply, cursor = her reply time
    await new Promise((r) => setTimeout(r, 5));
    await post(ben, 'Reply one', root.id);
    await post(ben, 'Reply two', root.id);
    const avaState = await threadState(ava, root.id);
    assert.equal(avaState.unreadCount, 2);

    const read = await ava.post(`/api/threads/${root.id}/read`);
    assert.equal(read.body.unreadCount, 0);
    assert.equal(read.body.following, true);

    await post(ben, 'Reply three', root.id);
    assert.equal((await threadState(ava, root.id)).unreadCount, 1);
    // Ben's own replies are not unread for him.
    assert.equal((await threadState(ben, root.id)).unreadCount, 0);
  });

  test('deleting a reply removes it from unread counts', async () => {
    const root = await post(ava, 'Delete test root');
    await post(ben, 'to be deleted', root.id);
    assert.equal((await threadState(ava, root.id)).unreadCount, 1);
    const reply = (await threadState(ben, root.id)).replies[0];
    const del = await ben.del(`/api/messages/${reply.id}`);
    assert.equal(del.status, 200);
    assert.equal((await threadState(ava, root.id)).unreadCount, 0);
  });

  test('read on a thread you do not follow is a no-op', async () => {
    const root = await post(ava, 'Nobody follows this');
    const r = await cleo.post(`/api/threads/${root.id}/read`);
    assert.equal(r.status, 200);
    assert.equal(r.body.following, false);
    assert.equal(r.body.unreadCount, 0);
    assert.equal((await threadState(cleo, root.id)).following, false);
  });

  test('list returns followed threads, newest activity first, with last two replies and unread counts', async () => {
    const older = await post(ava, 'Older thread root');
    await post(ben, 'older reply A', older.id);
    const newer = await post(ava, 'Newer thread root');
    await post(ben, 'newer reply A', newer.id);
    await post(ben, 'newer reply B', newer.id);
    await post(ben, 'newer reply C', newer.id);

    const list = await listThreads(ava);
    const ids = list.threads.map((t: any) => t.root.id);
    assert.ok(ids.indexOf(newer.id) < ids.indexOf(older.id), 'newest activity first');

    const newerItem = list.threads.find((t: any) => t.root.id === newer.id);
    assert.equal(newerItem.root.text, 'Newer thread root');
    assert.equal(newerItem.replies.length, 2, 'only the last two replies');
    assert.deepEqual(newerItem.replies.map((r: any) => r.text), ['newer reply B', 'newer reply C']);
    assert.equal(newerItem.unreadCount, 3);
    assert.equal(newerItem.conversation.id, cid);
    assert.equal(newerItem.conversation.name, 'design');
    assert.ok(list.unreadThreadCount >= 2);
  });

  test('list excludes threads the viewer does not follow', async () => {
    assert.equal((await listThreads(cleo)).threads.length, 0, 'cleo follows nothing yet');
    const root = await post(ben, 'Only ben replies here');
    await post(ben, 'self reply', root.id);
    const benList = await listThreads(ben);
    assert.ok(benList.threads.some((t: any) => t.root.id === root.id));
    const cleoList = await listThreads(cleo);
    assert.ok(!cleoList.threads.some((t: any) => t.root.id === root.id));
  });

  test('a thread disappears from the list after leaving the channel', async () => {
    const root = await post(ava, 'Leaving soon root');
    await post(ben, 'reply before leaving', root.id);
    assert.ok((await listThreads(ben)).threads.some((t: any) => t.root.id === root.id));
    await ben.post(`/api/conversations/${cid}/leave`);
    assert.ok(!(await listThreads(ben)).threads.some((t: any) => t.root.id === root.id));
    await ben.post(`/api/conversations/${cid}/join`);
  });

  test('"also send to channel" replies still count toward the thread', async () => {
    const root = await post(ava, 'Broadcast root');
    await post(ben, 'visible in channel too', root.id, true);
    const st = await threadState(ava, root.id);
    assert.equal(st.unreadCount, 1);
    assert.equal(st.replyCount, 1);
  });
});
