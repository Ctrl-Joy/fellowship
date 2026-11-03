import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

/** Build an app on a fresh temp database. Call `cleanup()` in `after()`. */
export async function makeTestApp() {
  const dir = mkdtempSync(join(tmpdir(), 'fellowship-test-'));
  const app = await buildApp({ dbPath: join(dir, 'test.db'), isTest: true });
  return {
    app,
    async cleanup() {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface TestClient {
  user: any;
  cookie: string;
  get(url: string): Promise<{ status: number; body: any }>;
  post(url: string, payload?: any): Promise<{ status: number; body: any }>;
  patch(url: string, payload?: any): Promise<{ status: number; body: any }>;
  del(url: string, payload?: any): Promise<{ status: number; body: any }>;
}

let counter = 0;

/** Latest email the test mailer captured for an address, with its 6-digit code and link token. */
export function lastEmail(app: FastifyInstance, to: string) {
  const outbox = app.ctx.mailer.outbox;
  if (!outbox) throw new Error('test app has no mail outbox');
  const msg = [...outbox].reverse().find((m) => m.to === to.toLowerCase());
  if (!msg) throw new Error(`no email sent to ${to}`);
  const code = /^\s+(\d{6})$/m.exec(msg.text)?.[1];
  const token = /[?&]token=([^\s&]+)/.exec(msg.text)?.[1];
  return { ...msg, code: code!, token: token ? decodeURIComponent(token) : undefined! };
}

export function cookieFrom(res: { headers: Record<string, any> }): string {
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
  return raw.split(';')[0];
}

/** Sign up a fresh user, verify the emailed code, and return a client that sends its session cookie. */
export async function signup(app: FastifyInstance, name = 'Test User', email?: string): Promise<TestClient> {
  counter++;
  const address = email ?? `user${counter}-${Date.now()}@example.test`;
  const res = await app.inject({
    method: 'POST', url: '/api/auth/signup',
    payload: { email: address, password: 'password123', fullName: name },
  });
  if (res.statusCode !== 200) throw new Error(`signup failed: ${res.body}`);
  const verified = await app.inject({
    method: 'POST', url: '/api/auth/verify', payload: { email: address, code: lastEmail(app, address).code },
  });
  if (verified.statusCode !== 200) throw new Error(`verify failed: ${verified.body}`);
  return clientFor(app, cookieFrom(verified), verified.json().user);
}

export function clientFor(app: FastifyInstance, cookie: string, user: any): TestClient {
  const call = async (method: any, url: string, payload?: any) => {
    const res = await app.inject({ method, url, payload, headers: { cookie } });
    let body: any = null;
    try { body = res.json(); } catch { body = res.body; }
    return { status: res.statusCode, body };
  };
  return {
    user, cookie,
    get: (url) => call('GET', url),
    post: (url, payload = {}) => call('POST', url, payload),
    patch: (url, payload = {}) => call('PATCH', url, payload),
    del: (url, payload) => call('DELETE', url, payload),
  };
}
