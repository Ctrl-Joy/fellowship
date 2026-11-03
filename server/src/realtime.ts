import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { Db } from './db';
import type { Bus, BusEvent } from './bus';
import type { Auth, UserRow } from './auth';
import { SESSION_COOKIE } from './auth';

export interface Frame {
  type: string;
  payload: any;
  workspaceId?: string | null;
  conversationId?: string | null;
  actorId?: string | null;
}

export interface Connection {
  id: number;
  userId: string;
  socket: WebSocket;
  connectedAt: number;
}

export type ClientMessageHandler = (user: UserRow, payload: any, conn: Connection) => void;

export function createRealtime(db: Db, bus: Bus, auth: Auth) {
  const byUser = new Map<string, Set<Connection>>();
  const handlers = new Map<string, ClientMessageHandler>();
  const connectHooks = new Set<(userId: string, conn: Connection) => void>();
  const disconnectHooks = new Set<(userId: string, remaining: number, conn: Connection) => void>();
  let nextConnId = 1;

  const convMembers = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?');
  const wsMembers = db.prepare(
    'SELECT user_id FROM workspace_members WHERE workspace_id = ? AND deactivated = 0',
  );
  const isConvMember = db.prepare(
    'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
  );

  function send(conn: Connection, frame: Frame) {
    if (conn.socket.readyState === 1) conn.socket.send(JSON.stringify(frame));
  }

  function sendToUser(userId: string, frame: Frame) {
    const set = byUser.get(userId);
    if (set) for (const c of set) send(c, frame);
  }

  function sendToUsers(userIds: Iterable<string>, frame: Frame, exceptUserId?: string) {
    for (const uid of new Set(userIds)) if (uid !== exceptUserId) sendToUser(uid, frame);
  }

  function conversationMemberIds(conversationId: string): string[] {
    return (convMembers.all(conversationId) as any[]).map((r) => r.user_id);
  }

  function workspaceMemberIds(workspaceId: string): string[] {
    return (wsMembers.all(workspaceId) as any[]).map((r) => r.user_id);
  }

  function broadcastToConversation(conversationId: string, frame: Frame, exceptUserId?: string) {
    sendToUsers(conversationMemberIds(conversationId), frame, exceptUserId);
  }

  function broadcastToWorkspace(workspaceId: string, frame: Frame, exceptUserId?: string) {
    sendToUsers(workspaceMemberIds(workspaceId), frame, exceptUserId);
  }

  /** Who may see a bus event: explicit audience > conversation members > workspace members. */
  function audienceFor(event: BusEvent): string[] {
    if (event.audience) return event.audience;
    if (event.conversationId) {
      const ids = conversationMemberIds(event.conversationId);
      // A member who just left still needs to hear about it.
      const extra = event.payload?.userId;
      if (event.type === 'member.left' && typeof extra === 'string') ids.push(extra);
      return ids;
    }
    if (event.workspaceId) return workspaceMemberIds(event.workspaceId);
    return [];
  }

  bus.on('*', (event) => {
    if (event.internal) return;
    const frame: Frame = {
      type: event.type,
      payload: event.payload,
      workspaceId: event.workspaceId,
      conversationId: event.conversationId ?? null,
      actorId: event.actorId ?? null,
    };
    sendToUsers(audienceFor(event), frame);
  });

  // Built-in client → server handlers.
  handlers.set('ping', (_u, _p, conn) => send(conn, { type: 'pong', payload: { ts: Date.now() } }));
  handlers.set('typing', (user, payload) => {
    const conversationId = payload?.conversationId;
    if (typeof conversationId !== 'string') return;
    if (!isConvMember.get(conversationId, user.id)) return;
    broadcastToConversation(conversationId, {
      type: 'typing',
      payload: { conversationId, userId: user.id, threadRootId: payload?.threadRootId ?? null },
      conversationId,
    }, user.id);
  });

  function register(app: FastifyInstance) {
    app.get('/ws', { websocket: true }, (socket, req) => {
      const user = auth.userFromToken(req.cookies?.[SESSION_COOKIE]);
      if (!user) {
        socket.send(JSON.stringify({ type: 'error', payload: { code: 'unauthorized' } }));
        socket.close(4401, 'unauthorized');
        return;
      }
      const conn: Connection = { id: nextConnId++, userId: user.id, socket, connectedAt: Date.now() };
      if (!byUser.has(user.id)) byUser.set(user.id, new Set());
      byUser.get(user.id)!.add(conn);
      send(conn, { type: 'hello', payload: { userId: user.id } });
      for (const fn of connectHooks) safe(() => fn(user.id, conn));

      socket.on('message', (raw) => {
        let msg: any;
        try { msg = JSON.parse(String(raw)); } catch { return; }
        if (!msg || typeof msg.type !== 'string') return;
        const handler = handlers.get(msg.type);
        if (!handler) return;
        // Re-read the user so handlers see fresh profile data.
        const fresh = auth.userFromToken(req.cookies?.[SESSION_COOKIE]);
        if (!fresh) { socket.close(4401, 'unauthorized'); return; }
        safe(() => handler(fresh, msg.payload, conn));
      });

      socket.on('close', () => {
        const set = byUser.get(user.id);
        set?.delete(conn);
        const remaining = set?.size ?? 0;
        if (set && remaining === 0) byUser.delete(user.id);
        for (const fn of disconnectHooks) safe(() => fn(user.id, remaining, conn));
      });
    });
  }

  function safe(fn: () => void) {
    try { fn(); } catch (err) { console.error('[realtime]', err); }
  }

  function closeAll() {
    for (const set of byUser.values()) for (const c of set) c.socket.close(1001, 'server shutdown');
    byUser.clear();
  }

  return {
    register,
    send,
    sendToUser,
    sendToUsers,
    broadcastToConversation,
    broadcastToWorkspace,
    conversationMemberIds,
    workspaceMemberIds,
    /** Add a client → server frame handler. */
    onClientMessage(type: string, fn: ClientMessageHandler) { handlers.set(type, fn); },
    onConnect(fn: (userId: string, conn: Connection) => void) { connectHooks.add(fn); return () => connectHooks.delete(fn); },
    onDisconnect(fn: (userId: string, remaining: number, conn: Connection) => void) { disconnectHooks.add(fn); return () => disconnectHooks.delete(fn); },
    isOnline(userId: string) { return (byUser.get(userId)?.size ?? 0) > 0; },
    onlineUserIds() { return [...byUser.keys()]; },
    closeAll,
  };
}

export type Realtime = ReturnType<typeof createRealtime>;
