import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, signup, lastEmail, cookieFrom, clientFor } from './helpers';
import { createBrevoMailer, mailerFromEnv, BREVO_ENDPOINT, MailError } from '../src/mailer';
import { MAX_ATTEMPTS, MAX_SENDS_PER_HOUR, RESEND_COOLDOWN_MS } from '../src/modules/core/verification';

let env: Awaited<ReturnType<typeof makeTestApp>>;
before(async () => { env = await makeTestApp(); });
after(() => env.cleanup());

let n = 0;
const fresh = () => `verify${++n}-${Date.now()}@example.test`;
const post = (url: string, payload: any, cookie?: string) =>
  env.app.inject({ method: 'POST', url, payload, headers: cookie ? { cookie } : {} });
const signupRaw = (email: string, password = 'password123') =>
  post('/api/auth/signup', { email, password, fullName: 'Vera Fy' });
/** Pretend the latest code for an address was sent `ms` ago (to step past cooldowns/expiry). */
const age = (email: string, ms: number) => env.app.ctx.db.prepare(
  `UPDATE email_codes SET created_at = created_at - ?, expires_at = expires_at - ?
   WHERE user_id = (SELECT id FROM users WHERE email = ?)`,
).run(ms, ms, email);

describe('signup → verify → login', () => {
  test('signup sends a code and link but no session', async () => {
    const email = fresh();
    const r = await signupRaw(email);
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().verificationRequired, true);
    assert.equal(r.json().emailSent, true);
    assert.equal(r.headers['set-cookie'], undefined);
    const mail = lastEmail(env.app, email);
    assert.match(mail.code, /^\d{6}$/);
    assert.ok(mail.token);
    assert.match(mail.text, /http:\/\/localhost:5173\/verify\?token=/);
    assert.match(mail.html, new RegExp(mail.code));
    // codes are stored hashed
    const row = env.app.ctx.db.prepare('SELECT code_hash, link_hash FROM email_codes ORDER BY created_at DESC LIMIT 1').get() as any;
    assert.notEqual(row.code_hash, mail.code);
    assert.ok(!String(row.link_hash).includes(mail.token));
  });

  test('unverified login is blocked; code verifies and signs in; then password login works', async () => {
    const email = fresh();
    await signupRaw(email);
    const blocked = await post('/api/auth/login', { email, password: 'password123' });
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json().error.code, 'email_unverified');
    assert.equal(blocked.headers['set-cookie'], undefined);
    // wrong password still says wrong password (no verification hint)
    const wrong = await post('/api/auth/login', { email, password: 'nope-nope' });
    assert.equal(wrong.statusCode, 401);

    const v = await post('/api/auth/verify', { email, code: lastEmail(env.app, email).code });
    assert.equal(v.statusCode, 200);
    assert.equal(v.json().user.email, email);
    const me = await env.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieFrom(v) } });
    assert.equal(me.statusCode, 200);

    const ok = await post('/api/auth/login', { email, password: 'password123' });
    assert.equal(ok.statusCode, 200);
    assert.match(cookieFrom(ok), /^fs_session=/);
  });

  test('magic link verifies once', async () => {
    const email = fresh();
    await signupRaw(email);
    const { token, code } = lastEmail(env.app, email);
    const v = await post('/api/auth/verify', { token });
    assert.equal(v.statusCode, 200);
    assert.match(cookieFrom(v), /^fs_session=/);
    const again = await post('/api/auth/verify', { token });
    assert.equal(again.statusCode, 400);
    assert.equal(again.json().error.code, 'invalid_link');
    // the paired code is spent too
    assert.equal((await post('/api/auth/verify', { email, code })).json().error.code, 'invalid_code');
  });
});

describe('bad codes', () => {
  test('wrong code, then reused code', async () => {
    const email = fresh();
    await signupRaw(email);
    const { code } = lastEmail(env.app, email);
    const wrongCode = code === '000000' ? '111111' : '000000';
    const bad = await post('/api/auth/verify', { email, code: wrongCode });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().error.code, 'invalid_code');
    assert.equal((await post('/api/auth/verify', { email, code: `${code.slice(0, 3)} ${code.slice(3)}` })).statusCode, 200);
    const reuse = await post('/api/auth/verify', { email, code });
    assert.equal(reuse.statusCode, 400);
    assert.equal(reuse.json().error.code, 'invalid_code');
  });

  test('expired code and link are rejected', async () => {
    const email = fresh();
    await signupRaw(email);
    const { code, token } = lastEmail(env.app, email);
    age(email, 16 * 60 * 1000);
    const r = await post('/api/auth/verify', { email, code });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().error.code, 'code_expired');
    assert.equal((await post('/api/auth/verify', { token })).json().error.code, 'link_expired');
  });

  test(`code dies after ${MAX_ATTEMPTS} wrong attempts`, async () => {
    const email = fresh();
    await signupRaw(email);
    const { code } = lastEmail(env.app, email);
    const wrongCode = code === '000000' ? '111111' : '000000';
    let last: any;
    for (let i = 0; i < MAX_ATTEMPTS; i++) last = await post('/api/auth/verify', { email, code: wrongCode });
    assert.equal(last.statusCode, 429);
    assert.equal(last.json().error.code, 'too_many_attempts');
    assert.equal((await post('/api/auth/verify', { email, code })).statusCode, 400);
  });

  test('unknown email and malformed input', async () => {
    assert.equal((await post('/api/auth/verify', { email: 'nobody@example.test', code: '123456' })).json().error.code, 'invalid_code');
    assert.equal((await post('/api/auth/verify', { token: 'x'.repeat(43) })).json().error.code, 'invalid_link');
    assert.equal((await post('/api/auth/verify', {})).statusCode, 400);
  });
});

describe('resend', () => {
  test('cooldown, new code replaces old, hourly cap', async () => {
    const email = fresh();
    await signupRaw(email);
    const first = lastEmail(env.app, email);
    const tooSoon = await post('/api/auth/resend', { email });
    assert.equal(tooSoon.statusCode, 429);
    assert.equal(tooSoon.json().error.code, 'rate_limited');
    assert.ok(tooSoon.json().error.retryAfter > 0);

    age(email, RESEND_COOLDOWN_MS);
    const again = await post('/api/auth/resend', { email });
    assert.equal(again.statusCode, 200);
    const second = lastEmail(env.app, email);
    assert.notEqual(second.token, first.token);
    assert.equal((await post('/api/auth/verify', { token: first.token })).json().error.code, 'invalid_link');

    for (let i = 2; i < MAX_SENDS_PER_HOUR; i++) {
      age(email, RESEND_COOLDOWN_MS);
      assert.equal((await post('/api/auth/resend', { email })).statusCode, 200);
    }
    age(email, RESEND_COOLDOWN_MS);
    const capped = await post('/api/auth/resend', { email });
    assert.equal(capped.statusCode, 429);
    assert.match(capped.json().error.message, /Too many/);
    assert.equal((await post('/api/auth/verify', { email, code: lastEmail(env.app, email).code })).statusCode, 200);
  });

  test('unknown address gets the same answer and no email', async () => {
    const before = env.app.ctx.mailer.outbox!.length;
    const r = await post('/api/auth/resend', { email: 'ghost@example.test' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().ok, true);
    assert.equal(env.app.ctx.mailer.outbox!.length, before);
  });

  test('a failed send returns 502 and does not start the cooldown', async () => {
    const email = fresh();
    await signupRaw(email);
    age(email, RESEND_COOLDOWN_MS);
    const mailer = env.app.ctx.mailer;
    const original = mailer.send;
    const errors: unknown[] = [];
    const origErr = console.error;
    console.error = (...a: unknown[]) => { errors.push(a); };
    mailer.send = async () => { throw new MailError('boom'); };
    try {
      const r = await post('/api/auth/resend', { email });
      assert.equal(r.statusCode, 502);
      assert.equal(r.json().error.code, 'email_failed');
    } finally {
      mailer.send = original;
      console.error = origErr;
    }
    assert.equal(errors.length, 1);
    assert.equal((await post('/api/auth/resend', { email })).statusCode, 200);
  });
});

describe('passwordless and reset', () => {
  test('a verified user can sign in with an emailed code', async () => {
    const email = fresh();
    await signup(env.app, 'Pat Less', email);
    age(email, RESEND_COOLDOWN_MS);
    assert.equal((await post('/api/auth/resend', { email })).statusCode, 200);
    const r = await post('/api/auth/verify', { email, code: lastEmail(env.app, email).code });
    assert.equal(r.statusCode, 200);
    assert.match(cookieFrom(r), /^fs_session=/);
  });

  test('password reset by code signs out other sessions', async () => {
    const email = fresh();
    const old = await signup(env.app, 'Reese Et', email);
    assert.equal((await post('/api/auth/password/forgot', { email })).statusCode, 200);
    const mail = lastEmail(env.app, email);
    assert.match(mail.subject, /Reset/);
    assert.match(mail.text, /\/reset-password\?token=/);
    // a reset code is not a sign-in code
    assert.equal((await post('/api/auth/verify', { email, code: mail.code })).statusCode, 400);
    const short = await post('/api/auth/password/reset', { email, code: mail.code, password: 'short' });
    assert.equal(short.statusCode, 400);
    const r = await post('/api/auth/password/reset', { email, code: mail.code, password: 'brand-new-pass' });
    assert.equal(r.statusCode, 200);
    assert.equal((await old.get('/api/auth/me')).status, 401);
    assert.equal((await post('/api/auth/login', { email, password: 'password123' })).statusCode, 401);
    assert.equal((await post('/api/auth/login', { email, password: 'brand-new-pass' })).statusCode, 200);
  });

  test('password reset by link also verifies an unverified account', async () => {
    const email = fresh();
    await signupRaw(email);
    await post('/api/auth/password/forgot', { email });
    const { token } = lastEmail(env.app, email);
    const r = await post('/api/auth/password/reset', { token, password: 'another-pass' });
    assert.equal(r.statusCode, 200);
    assert.equal((await post('/api/auth/password/reset', { token, password: 'another-pass' })).statusCode, 400);
    assert.equal((await post('/api/auth/login', { email, password: 'another-pass' })).statusCode, 200);
  });
});

describe('requireUser', () => {
  test('rejects a session belonging to an unverified user', async () => {
    const ava = await signup(env.app, 'Una Verified');
    env.app.ctx.db.prepare('UPDATE users SET email_verified_at = NULL WHERE id = ?').run(ava.user.id);
    const r = await ava.get('/api/auth/me');
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'email_unverified');
    assert.equal((await ava.get('/api/workspaces')).status, 403);
    assert.equal(env.app.ctx.auth.userFromToken(ava.cookie.split('=')[1]), null);
    const forged = clientFor(env.app, 'fs_session=nope', null);
    assert.equal((await forged.get('/api/auth/me')).status, 401);
  });

  test('bots are created verified', async () => {
    const bot = env.app.ctx.core.createUser({ email: `bot-${Date.now()}@bots.test`, password: 'x'.repeat(12), fullName: 'Bot', isBot: true });
    assert.ok(bot.email_verified_at);
  });
});

describe('mailer', () => {
  test('Brevo transport posts the right request', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"messageId":"x"}', { status: 201 });
    }) as unknown as typeof fetch;
    const mailer = createBrevoMailer({ apiKey: 'test-key', senderEmail: 'no-reply@example.test', senderName: 'Fellowship', fetchImpl: fake });
    await mailer.send({ to: 'a@example.test', toName: 'A', subject: 'Hi', text: 'hello', html: '<p>hello</p>' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, BREVO_ENDPOINT);
    assert.equal((calls[0].init.headers as any)['api-key'], 'test-key');
    assert.ok(calls[0].init.signal);
    const body = JSON.parse(String(calls[0].init.body));
    assert.deepEqual(body.sender, { email: 'no-reply@example.test', name: 'Fellowship' });
    assert.deepEqual(body.to, [{ email: 'a@example.test', name: 'A' }]);
    assert.equal(body.subject, 'Hi');
    assert.equal(body.htmlContent, '<p>hello</p>');
    assert.equal(body.textContent, 'hello');
  });

  test('Brevo errors and timeouts become MailError without the key', async () => {
    const rejecting = (async () => new Response('{"code":"unauthorized","message":"Key not found"}', { status: 401 })) as unknown as typeof fetch;
    const m1 = createBrevoMailer({ apiKey: 'secret-key-123', senderEmail: 's@example.test', senderName: 'F', fetchImpl: rejecting });
    await assert.rejects(m1.send({ to: 'a@example.test', subject: 's', text: 't', html: 'h' }), (e: any) =>
      e instanceof MailError && /401/.test(e.message) && !e.message.includes('secret-key-123'));
    const hanging = ((_u: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    })) as unknown as typeof fetch;
    const m2 = createBrevoMailer({ apiKey: 'k', senderEmail: 's@example.test', senderName: 'F', fetchImpl: hanging, timeoutMs: 20 });
    await assert.rejects(m2.send({ to: 'a@example.test', subject: 's', text: 't', html: 'h' }), /timed out/);
  });

  test('mailerFromEnv picks transports without network', async () => {
    assert.equal(mailerFromEnv({ BREVO_API_KEY: 'k' }, true).kind, 'memory');
    assert.equal(mailerFromEnv({ BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 's@example.test' }).kind, 'brevo');
    assert.throws(() => mailerFromEnv({ BREVO_API_KEY: 'k' }), /BREVO_SENDER_EMAIL/);
    assert.equal(mailerFromEnv({}).kind, 'console');
    const disabled = mailerFromEnv({ NODE_ENV: 'production' });
    assert.equal(disabled.kind, 'disabled');
    await assert.rejects(disabled.send({ to: 'a@example.test', subject: 's', text: 't', html: 'h' }), MailError);
  });

  test('demo seed users are grandfathered by the migration', async () => {
    const sql = (await import('../src/modules/core/schema')).coreMigrations[1];
    assert.match(sql, /ava@fellowship\.test/);
    assert.match(sql, /email_verified_at = created_at/);
  });
});
