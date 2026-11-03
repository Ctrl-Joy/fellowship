import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { makeTestApp, signup, type TestClient } from './helpers';
import { upload, pngBytes } from './files-fixtures';

let env: Awaited<ReturnType<typeof makeTestApp>>;
let ava: TestClient, ben: TestClient, cleo: TestClient, outsider: TestClient;
let wid: string;
let general: any, secret: any, dm: any;

before(async () => {
  env = await makeTestApp();
  ava = await signup(env.app, 'Ava Files', 'ava-files@example.test');
  ben = await signup(env.app, 'Ben Files');
  cleo = await signup(env.app, 'Cleo Files');
  outsider = await signup(env.app, 'Out Files');
  const ws = await ava.post('/api/workspaces', { name: 'Files Org' });
  wid = ws.body.workspace.id;
  const invite = ws.body.workspace.inviteCode;
  await ben.post(`/api/workspaces/join/${invite}`);
  await cleo.post(`/api/workspaces/join/${invite}`);
  const convs = await ava.get(`/api/w/${wid}/conversations`);
  general = convs.body.conversations.find((c: any) => c.name === 'general');
  await ben.post(`/api/conversations/${general.id}/join`);
  const priv = await ava.post(`/api/w/${wid}/channels`, { name: 'vault', isPrivate: true });
  secret = priv.body.conversation;
  const d = await ava.post(`/api/w/${wid}/dms`, { userIds: [cleo.user.id] });
  dm = d.body.conversation;
});

after(async () => { await env.cleanup(); });

const txt = (s: string) => Buffer.from(s, 'utf8');

describe('upload', () => {
  test('a member uploads to a conversation and gets FileInfo back', async () => {
    const r = await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'notes.txt', type: 'text/plain', data: txt('hello world') }]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const f = r.body.files[0];
    assert.match(f.id, /^F/);
    assert.equal(f.name, 'notes.txt');
    assert.equal(f.mimeType, 'text/plain');
    assert.equal(f.size, 11);
    assert.equal(f.url, `/files/${f.id}/notes.txt`);
    assert.equal(f.thumbUrl, null);
    assert.equal(f.kind, 'file');
    assert.equal(f.conversationId, general.id);
  });

  test('several files in one request are all stored', async () => {
    const r = await upload(env.app, ava.cookie, wid, general.id, [
      { filename: 'a.txt', type: 'text/plain', data: txt('a') },
      { filename: 'b.txt', type: 'text/plain', data: txt('bb') },
    ]);
    assert.equal(r.status, 200);
    assert.equal(r.body.files.length, 2);
    assert.deepEqual(r.body.files.map((f: any) => f.size), [1, 2]);
  });

  test('uploads are stored under uploadsDir, not in the repository', async () => {
    const dir = env.app.ctx.config.uploadsDir;
    assert.ok(dir.includes('fellowship-test-'), `uploads dir ${dir} should be the temp dir`);
    assert.ok(readdirSync(dir).length >= 3);
  });

  test('the declared type is replaced by the sniffed image type', async () => {
    const r = await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'pic.txt', type: 'text/plain', data: pngBytes(640, 480) }]);
    assert.equal(r.status, 200);
    assert.equal(r.body.files[0].mimeType, 'image/png');
    assert.equal(r.body.files[0].kind, 'image');
    assert.equal(r.body.files[0].width, 640);
    assert.equal(r.body.files[0].height, 480);
    assert.equal(r.body.files[0].thumbUrl, r.body.files[0].url);
  });

  test('file names are reduced to a base name without path or control characters', async () => {
    const r = await upload(env.app, ava.cookie, wid, general.id, [{ filename: '../../etc/evil name.txt', type: 'text/plain', data: txt('x') }]);
    assert.equal(r.status, 200);
    assert.equal(r.body.files[0].name, 'evil name.txt');
    const { cleanName } = await import('../src/modules/files/info');
    assert.equal(cleanName('C:\\Users\\x\\bad"name\u0001.pdf'), 'bad_name_.pdf');
    assert.equal(cleanName('   '), 'file');
  });

  test('an empty file is rejected', async () => {
    const r = await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'empty.txt', type: 'text/plain', data: Buffer.alloc(0) }]);
    assert.equal(r.status, 400);
  });

  test('conversationId must come before the file parts', async () => {
    const { multipart } = await import('./files-fixtures');
    const { body, contentType } = multipart({}, [{ filename: 'x.txt', type: 'text/plain', data: txt('x') }]);
    const res = await env.app.inject({
      method: 'POST', url: `/api/w/${wid}/files`, headers: { cookie: ava.cookie, 'content-type': contentType }, payload: body,
    });
    assert.equal(res.statusCode, 400);
  });

  test('per-file size limit is enforced (configurable, here 1 MB) and nothing is kept', async () => {
    const prev = process.env.FELLOWSHIP_MAX_FILE_MB;
    process.env.FELLOWSHIP_MAX_FILE_MB = '1';
    try {
      const before = readdirSync(env.app.ctx.config.uploadsDir).length;
      const r = await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'big.bin', type: 'application/octet-stream', data: Buffer.alloc(1024 * 1024 + 10, 1) }]);
      assert.equal(r.status, 413);
      assert.equal(r.body.error.code, 'file_too_large');
      assert.equal(readdirSync(env.app.ctx.config.uploadsDir).length, before);
      const ok = await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'ok.bin', type: 'application/octet-stream', data: Buffer.alloc(1024 * 1024, 1) }]);
      assert.equal(ok.status, 200);
    } finally {
      if (prev === undefined) delete process.env.FELLOWSHIP_MAX_FILE_MB; else process.env.FELLOWSHIP_MAX_FILE_MB = prev;
    }
  });

  test('limits endpoint reports the 25 MB default', async () => {
    const r = await ava.get(`/api/w/${wid}/files/limits`);
    assert.equal(r.status, 200);
    assert.equal(r.body.maxFileBytes, 25 * 1024 * 1024);
  });

  test('upload needs workspace membership: outsider gets 404', async () => {
    const r = await upload(env.app, outsider.cookie, wid, general.id, [{ filename: 'x.txt', type: 'text/plain', data: txt('x') }]);
    assert.equal(r.status, 404);
  });

  test('upload to a private channel you are not in is forbidden', async () => {
    const r = await upload(env.app, ben.cookie, wid, secret.id, [{ filename: 'x.txt', type: 'text/plain', data: txt('x') }]);
    assert.equal(r.status, 403);
  });

  test('upload to someone else\'s DM is forbidden', async () => {
    const r = await upload(env.app, ben.cookie, wid, dm.id, [{ filename: 'x.txt', type: 'text/plain', data: txt('x') }]);
    assert.ok(r.status === 403 || r.status === 404, `got ${r.status}`);
  });

  test('uploading emits file.uploaded on the bus', async () => {
    const seen: any[] = [];
    const off = env.app.ctx.bus.on('file.uploaded', (e) => seen.push(e));
    const r = await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'evt.txt', type: 'text/plain', data: txt('e') }]);
    off();
    assert.equal(r.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].conversationId, general.id);
    assert.equal(seen[0].payload.file.id, r.body.files[0].id);
  });
});

describe('download and preview', () => {
  let png: any, text: any, svg: any, pdf: any, video: any;
  before(async () => {
    png = (await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'photo.png', type: 'image/png', data: pngBytes(10, 20) }])).body.files[0];
    text = (await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'readme.txt', type: 'text/plain', data: txt('line one\nline two') }])).body.files[0];
    svg = (await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'logo.svg', type: 'image/svg+xml', data: txt('<svg onload="alert(1)"></svg>') }])).body.files[0];
    pdf = (await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'doc.pdf', type: 'application/pdf', data: txt('%PDF-1.4 test') }])).body.files[0];
    video = (await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'clip.mp4', type: 'video/mp4', data: Buffer.from('0123456789abcdef') }])).body.files[0];
  });

  test('an image is served inline with its content type and the bytes', async () => {
    const res = await env.app.inject({ method: 'GET', url: png.url, headers: { cookie: ben.cookie } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.match(String(res.headers['content-disposition']), /^inline/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(res.rawPayload, pngBytes(10, 20));
  });

  test('a text file is an attachment download', async () => {
    const res = await env.app.inject({ method: 'GET', url: text.url, headers: { cookie: ben.cookie } });
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-type']), /^text\/plain/);
    assert.match(String(res.headers['content-disposition']), /^attachment/);
    assert.equal(res.body, 'line one\nline two');
  });

  test('SVG is never shown inline (it can run script)', async () => {
    const res = await env.app.inject({ method: 'GET', url: svg.url, headers: { cookie: ava.cookie } });
    assert.match(String(res.headers['content-disposition']), /^attachment/);
    assert.match(String(res.headers['content-security-policy']), /sandbox/);
  });

  test('PDF and video are inline', async () => {
    const p = await env.app.inject({ method: 'GET', url: pdf.url, headers: { cookie: ava.cookie } });
    assert.equal(p.headers['content-type'], 'application/pdf');
    assert.match(String(p.headers['content-disposition']), /^inline/);
    const v = await env.app.inject({ method: 'GET', url: video.url, headers: { cookie: ava.cookie } });
    assert.equal(v.headers['content-type'], 'video/mp4');
    assert.match(String(v.headers['content-disposition']), /^inline/);
  });

  test('Range requests return a partial body (for video seeking)', async () => {
    const res = await env.app.inject({ method: 'GET', url: video.url, headers: { cookie: ava.cookie, range: 'bytes=4-7' } });
    assert.equal(res.statusCode, 206);
    assert.equal(res.headers['content-range'], 'bytes 4-7/16');
    assert.equal(res.body, '4567');
    const tail = await env.app.inject({ method: 'GET', url: video.url, headers: { cookie: ava.cookie, range: 'bytes=-3' } });
    assert.equal(tail.body, 'def');
    const bad = await env.app.inject({ method: 'GET', url: video.url, headers: { cookie: ava.cookie, range: 'bytes=99-120' } });
    assert.equal(bad.statusCode, 416);
  });

  test('a non-member of a private channel cannot download its files (403)', async () => {
    const f = (await upload(env.app, ava.cookie, wid, secret.id, [{ filename: 'plan.txt', type: 'text/plain', data: txt('secret') }])).body.files[0];
    const res = await env.app.inject({ method: 'GET', url: f.url, headers: { cookie: ben.cookie } });
    assert.equal(res.statusCode, 403);
    const own = await env.app.inject({ method: 'GET', url: f.url, headers: { cookie: ava.cookie } });
    assert.equal(own.statusCode, 200);
  });

  test('a DM file is not downloadable by a workspace member outside the DM', async () => {
    const f = (await upload(env.app, ava.cookie, wid, dm.id, [{ filename: 'dm.txt', type: 'text/plain', data: txt('private dm') }])).body.files[0];
    const res = await env.app.inject({ method: 'GET', url: f.url, headers: { cookie: ben.cookie } });
    assert.ok(res.statusCode === 403 || res.statusCode === 404, `got ${res.statusCode}`);
    const ok = await env.app.inject({ method: 'GET', url: f.url, headers: { cookie: cleo.cookie } });
    assert.equal(ok.statusCode, 200);
  });

  test('outsiders and anonymous requests cannot download', async () => {
    const out = await env.app.inject({ method: 'GET', url: text.url, headers: { cookie: outsider.cookie } });
    assert.equal(out.statusCode, 404);
    const anon = await env.app.inject({ method: 'GET', url: text.url });
    assert.equal(anon.statusCode, 401);
  });

  test('unknown file id is 404', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/files/FNOPE/x.txt', headers: { cookie: ava.cookie } });
    assert.equal(res.statusCode, 404);
  });
});

describe('attaching to messages', () => {
  test('posting with fileIds attaches the files and the enricher fills message.files', async () => {
    const f = (await upload(env.app, ben.cookie, wid, general.id, [{ filename: 'report.pdf', type: 'application/pdf', data: txt('%PDF-1.4') }])).body.files[0];
    const post = await ben.post(`/api/conversations/${general.id}/messages`, { text: 'here is the report', fileIds: [f.id] });
    assert.equal(post.status, 200, JSON.stringify(post.body));
    assert.equal(post.body.message.files.length, 1);
    assert.equal(post.body.message.files[0].id, f.id);
    assert.equal(post.body.message.files[0].kind, 'pdf');
    const list = await ava.get(`/api/conversations/${general.id}/messages`);
    const listed = list.body.messages.find((m: any) => m.id === post.body.message.id);
    assert.equal(listed.files[0].id, f.id);
  });

  test('a file can be sent with no text', async () => {
    const f = (await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'only.txt', type: 'text/plain', data: txt('x') }])).body.files[0];
    const post = await ava.post(`/api/conversations/${general.id}/messages`, { text: '', fileIds: [f.id] });
    assert.equal(post.status, 200);
    assert.equal(post.body.message.files.length, 1);
  });

  test('you cannot attach someone else\'s file', async () => {
    const theirs = (await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'theirs.txt', type: 'text/plain', data: txt('t') }])).body.files[0];
    const r = await ben.post(`/api/conversations/${general.id}/messages`, { text: 'steal', fileIds: [theirs.id] });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'bad_attachment');
    const before = await ava.get(`/api/conversations/${general.id}/messages`);
    assert.ok(!before.body.messages.some((m: any) => m.text === 'steal'), 'rejected post must not persist');
  });

  test('a file cannot be attached to a message in another conversation', async () => {
    const f = (await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'wrong.txt', type: 'text/plain', data: txt('w') }])).body.files[0];
    const r = await ava.post(`/api/conversations/${secret.id}/messages`, { text: 'moved', fileIds: [f.id] });
    assert.equal(r.status, 400);
  });

  test('a file attaches only once', async () => {
    const f = (await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'once.txt', type: 'text/plain', data: txt('o') }])).body.files[0];
    assert.equal((await ava.post(`/api/conversations/${general.id}/messages`, { text: 'one', fileIds: [f.id] })).status, 200);
    const again = await ava.post(`/api/conversations/${general.id}/messages`, { text: 'two', fileIds: [f.id] });
    assert.equal(again.status, 400);
  });

  test('a deleted file cannot be attached', async () => {
    const f = (await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'gone.txt', type: 'text/plain', data: txt('g') }])).body.files[0];
    assert.equal((await ava.del(`/api/files/${f.id}`)).status, 200);
    const r = await ava.post(`/api/conversations/${general.id}/messages`, { text: 'ghost', fileIds: [f.id] });
    assert.equal(r.status, 400);
  });

  test('a failed attach rolls back the whole message', async () => {
    const mine = (await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'rb.txt', type: 'text/plain', data: txt('r') }])).body.files[0];
    const r = await ava.post(`/api/conversations/${general.id}/messages`, { text: 'rollback me', fileIds: [mine.id, 'FNOPE'] });
    assert.equal(r.status, 400);
    const list = await ava.get(`/api/conversations/${general.id}/messages`);
    assert.ok(!list.body.messages.some((m: any) => m.text === 'rollback me'));
    const again = await ava.post(`/api/conversations/${general.id}/messages`, { text: 'after rollback', fileIds: [mine.id] });
    assert.equal(again.status, 200, 'file must still be free to attach after the rollback');
  });

  test('unattached (pending) uploads are not listed in the conversation Files tab', async () => {
    const pending = (await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'pending.txt', type: 'text/plain', data: txt('p') }])).body.files[0];
    const list = await ava.get(`/api/conversations/${general.id}/files`);
    assert.equal(list.status, 200);
    assert.ok(!list.body.files.some((f: any) => f.id === pending.id));
  });

  test('the conversation Files tab lists attached files newest first, with paging', async () => {
    const tab = await ava.get(`/api/conversations/${general.id}/files?limit=2`);
    assert.equal(tab.status, 200);
    assert.equal(tab.body.files.length, 2);
    assert.equal(tab.body.hasMore, true);
    assert.ok(tab.body.files[0].createdAt >= tab.body.files[1].createdAt);
    const next = await ava.get(`/api/conversations/${general.id}/files?limit=200&before=${tab.body.nextBefore}`);
    assert.ok(next.body.files.every((f: any) => f.createdAt < tab.body.nextBefore));
  });

  test('a non-member cannot list a private conversation\'s files', async () => {
    const r = await ben.get(`/api/conversations/${secret.id}/files`);
    assert.equal(r.status, 403);
  });
});

describe('delete', () => {
  test('a member cannot delete someone else\'s file', async () => {
    const f = (await upload(env.app, ava.cookie, wid, general.id, [{ filename: 'keep.txt', type: 'text/plain', data: txt('k') }])).body.files[0];
    const r = await ben.del(`/api/files/${f.id}`);
    assert.equal(r.status, 403);
    assert.equal((await env.app.inject({ method: 'GET', url: f.url, headers: { cookie: ava.cookie } })).statusCode, 200);
  });

  test('the uploader can delete; the bytes go away and downloads 404', async () => {
    const f = (await upload(env.app, ben.cookie, wid, general.id, [{ filename: 'mine.txt', type: 'text/plain', data: txt('m') }])).body.files[0];
    const path = `${env.app.ctx.config.uploadsDir}/${f.id}`;
    assert.ok(existsSync(path));
    assert.equal((await ben.del(`/api/files/${f.id}`)).status, 200);
    assert.ok(!existsSync(path));
    assert.equal((await env.app.inject({ method: 'GET', url: f.url, headers: { cookie: ben.cookie } })).statusCode, 404);
  });

  test('a workspace admin (owner) can delete any file', async () => {
    const f = (await upload(env.app, ben.cookie, wid, general.id, [{ filename: 'admin.txt', type: 'text/plain', data: txt('a') }])).body.files[0];
    assert.equal((await ava.del(`/api/files/${f.id}`)).status, 200);
  });

  test('deleting an attached file removes it from the message', async () => {
    const f = (await upload(env.app, ben.cookie, wid, general.id, [{ filename: 'attached.txt', type: 'text/plain', data: txt('a') }])).body.files[0];
    const post = await ben.post(`/api/conversations/${general.id}/messages`, { text: 'with attachment', fileIds: [f.id] });
    assert.equal(post.body.message.files.length, 1);
    assert.equal((await ben.del(`/api/files/${f.id}`)).status, 200);
    const list = await ben.get(`/api/conversations/${general.id}/messages`);
    const m = list.body.messages.find((x: any) => x.id === post.body.message.id);
    assert.deepEqual(m.files, []);
  });

  test('deleting a message hides its files', async () => {
    const f = (await upload(env.app, ben.cookie, wid, general.id, [{ filename: 'deleted-msg.txt', type: 'text/plain', data: txt('d') }])).body.files[0];
    const post = await ben.post(`/api/conversations/${general.id}/messages`, { text: 'soon deleted', fileIds: [f.id] });
    assert.equal((await ben.del(`/api/messages/${post.body.message.id}`)).status, 200);
    const list = await ben.get(`/api/conversations/${general.id}/files`);
    assert.ok(!list.body.files.some((x: any) => x.id === f.id));
  });

  test('deleting an unknown file is 404', async () => {
    assert.equal((await ava.del('/api/files/FNOPE')).status, 404);
  });
});
