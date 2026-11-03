import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { signup, type TestClient } from './helpers';

let counter = 0;

/** Start the app on a random local port so tests can open real WebSockets. */
export async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  return (app.server.address() as AddressInfo).port;
}

export interface Sock {
  ws: WebSocket;
  frames: any[];
  send(type: string, payload?: unknown): void;
  /** Resolve with the first frame matching `pred` (polls the received frames). */
  waitFor(pred: (f: any) => boolean, timeoutMs?: number): Promise<any>;
  /** Wait a moment and return the frames matching `pred` (used to assert that nothing arrived). */
  settle(ms?: number): Promise<void>;
  close(): Promise<void>;
}

/** A WebSocket authenticated with the given session cookie. */
export async function openSocket(port: number, cookie: string): Promise<Sock> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie } });
  const frames: any[] = [];
  ws.on('message', (raw) => {
    try { frames.push(JSON.parse(String(raw))); } catch { /* ignore */ }
  });
  await once(ws, 'open');
  return {
    ws,
    frames,
    send(type, payload = {}) {
      ws.send(JSON.stringify({ type, payload }));
    },
    async waitFor(pred, timeoutMs = 2000) {
      const started = Date.now();
      for (;;) {
        const hit = frames.find(pred);
        if (hit) return hit;
        if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for frame');
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    async settle(ms = 120) {
      await new Promise((r) => setTimeout(r, ms));
    },
    async close() {
      if (ws.readyState === WebSocket.CLOSED) return;
      await new Promise<void>((resolve) => {
        ws.once('close', () => resolve());
        ws.close();
      });
    },
  };
}

export interface Fixture {
  wid: string;
  ava: TestClient;
  ben: TestClient;
  cleo: TestClient;
  dan: TestClient;
  general: string;
  random: string;
  inviteCode: string;
}

/**
 * A fresh workspace: Ava owns it; Ben, Cleo and Dan join through the invite link
 * (so they are members of #general and #random).
 */
export async function workspaceFixture(app: FastifyInstance): Promise<Fixture> {
  counter++;
  const ava = await signup(app, `Ava ${counter}`);
  const ws = (await ava.post('/api/workspaces', { name: `Team ${counter}` })).body.workspace;
  const join = async (c: TestClient) => {
    const r = await c.post(`/api/workspaces/join/${ws.inviteCode}`);
    if (r.status !== 200) throw new Error(`join failed: ${JSON.stringify(r.body)}`);
  };
  const ben = await signup(app, `Ben ${counter}`);
  const cleo = await signup(app, `Cleo ${counter}`);
  const dan = await signup(app, `Dan ${counter}`);
  for (const c of [ben, cleo, dan]) await join(c);
  const list = (await ava.get(`/api/w/${ws.id}/conversations`)).body.conversations as any[];
  const general = list.find((c) => c.name === 'general').id as string;
  const random = list.find((c) => c.name === 'random').id as string;
  return { wid: ws.id, ava, ben, cleo, dan, general, random, inviteCode: ws.inviteCode };
}

/** Create a private channel with the given members (creator is always included). */
export async function privateChannel(f: Fixture, name: string, memberIds: string[]): Promise<string> {
  const r = await f.ava.post(`/api/w/${f.wid}/channels`, { name, isPrivate: true, memberIds });
  if (r.status !== 200) throw new Error(`channel failed: ${JSON.stringify(r.body)}`);
  return r.body.conversation.id as string;
}

export async function dm(f: Fixture, from: TestClient, toIds: string[]): Promise<string> {
  const r = await from.post(`/api/w/${f.wid}/dms`, { userIds: toIds });
  if (r.status !== 200) throw new Error(`dm failed: ${JSON.stringify(r.body)}`);
  return r.body.conversation.id as string;
}

export async function say(client: TestClient, cid: string, text: string, threadRootId?: string) {
  const r = await client.post(`/api/conversations/${cid}/messages`, { text, threadRootId: threadRootId ?? null });
  if (r.status !== 200) throw new Error(`post failed: ${JSON.stringify(r.body)}`);
  return r.body.message as { id: string; createdAt: number };
}

export async function notifications(client: TestClient, wid: string, filter = 'all', extra = '') {
  const r = await client.get(`/api/w/${wid}/notifications?filter=${filter}${extra}`);
  if (r.status !== 200) throw new Error(`list failed: ${JSON.stringify(r.body)}`);
  return r.body as { notifications: any[]; unreadCount: number; hasMore: boolean; nextCursor: string | null };
}

/** Notifications for one user in one conversation (any kind). */
export async function notificationsIn(client: TestClient, wid: string, cid: string) {
  return (await notifications(client, wid)).notifications.filter((n) => n.conversationId === cid);
}
