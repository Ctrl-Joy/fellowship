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

/** Sign up a fresh user and return a client that sends its session cookie. */
export async function signup(app: FastifyInstance, name = 'Test User', email?: string): Promise<TestClient> {
  counter++;
  const res = await app.inject({
    method: 'POST', url: '/api/auth/signup',
    payload: { email: email ?? `user${counter}-${Date.now()}@example.test`, password: 'password123', fullName: name },
  });
  if (res.statusCode !== 200) throw new Error(`signup failed: ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
  const cookie = raw.split(';')[0];
  return clientFor(app, cookie, res.json().user);
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
