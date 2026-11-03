import type { ModuleContext } from '../../context';
import type { Connection } from '../../realtime';
import type { HuddleService } from './service';

/** How long a participant may be without a live socket before we drop them (reconnect window). */
export function graceMs() {
  const v = Number(process.env.HUDDLE_GRACE_MS);
  return Number.isFinite(v) && v >= 0 ? v : 15_000;
}

/**
 * WebSocket side of huddles:
 *  - `huddle.attach {huddleId}`: the socket that carries this user's media (one tab). Signals for
 *    the user go only there; when it closes the user gets a grace period to re-attach.
 *  - `huddle.signal {huddleId, to, data}`: relayed to `to` as `{huddleId, from, data}` only when
 *    both sender and recipient are current participants of that active huddle.
 *  - Auto-leave after the grace period when the media socket (or the user's last socket) is gone.
 */
export function registerHuddleSignalling(ctx: ModuleContext, svc: HuddleService) {
  const { realtime, bus } = ctx;
  const GRACE = graceMs();
  const key = (hid: string, uid: string) => `${hid}:${uid}`;
  const attached = new Map<string, Connection>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const isLive = (c: Connection) => c.socket.readyState === 1;
  let closing = false;

  function cancel(k: string) {
    const t = timers.get(k);
    if (t) { clearTimeout(t); timers.delete(k); }
  }

  function schedule(huddleId: string, userId: string) {
    const k = key(huddleId, userId);
    cancel(k);
    const t = setTimeout(() => {
      timers.delete(k);
      const conn = attached.get(k);
      const gone = conn ? !isLive(conn) : !realtime.isOnline(userId);
      if (gone) svc.leave(huddleId, userId, 'disconnected');
    }, GRACE);
    (t as any).unref?.();
    timers.set(k, t);
  }

  svc.onParticipantLeft((hid, uid) => {
    const k = key(hid, uid);
    attached.delete(k);
    cancel(k);
  });

  function reject(conn: Connection, payload: any, reason: string) {
    realtime.send(conn, {
      type: 'huddle.signal_error',
      payload: { huddleId: payload?.huddleId ?? null, to: payload?.to ?? null, reason },
    });
  }

  realtime.onClientMessage('huddle.attach', (user, payload, conn) => {
    const huddleId = payload?.huddleId;
    if (typeof huddleId !== 'string' || !svc.isActiveParticipant(huddleId, user.id)) {
      realtime.send(conn, { type: 'huddle.attach_error', payload: { huddleId: huddleId ?? null, reason: 'not_participant' } });
      return;
    }
    const k = key(huddleId, user.id);
    attached.set(k, conn);
    cancel(k);
    realtime.send(conn, { type: 'huddle.attached', payload: { huddleId } });
  });

  realtime.onClientMessage('huddle.signal', (user, payload, conn) => {
    const { huddleId, to, data } = payload ?? {};
    if (typeof huddleId !== 'string' || typeof to !== 'string' || data == null || typeof data !== 'object') {
      return reject(conn, payload, 'invalid');
    }
    if (to === user.id) return reject(conn, payload, 'invalid');
    if (!svc.isActiveParticipant(huddleId, user.id)) return reject(conn, payload, 'sender_not_participant');
    if (!svc.isActiveParticipant(huddleId, to)) return reject(conn, payload, 'recipient_not_participant');
    const frame = { type: 'huddle.signal', payload: { huddleId, from: user.id, data } };
    const target = attached.get(key(huddleId, to));
    if (target && isLive(target)) realtime.send(target, frame);
    else realtime.sendToUser(to, frame);
  });

  realtime.onConnect((userId) => {
    if (closing) return;
    // A reconnect keeps un-attached participations alive; attached ones wait for re-attach.
    for (const h of svc.activeForUser(userId)) {
      if (!attached.has(key(h.id, userId))) cancel(key(h.id, userId));
    }
  });

  realtime.onDisconnect((userId, remaining, conn) => {
    if (closing) return; // app shutdown: sockets close after the db
    for (const h of svc.activeForUser(userId)) {
      const a = attached.get(key(h.id, userId));
      if (remaining === 0 || (a && a.id === conn.id)) schedule(h.id, userId);
    }
  });

  // Leaving the conversation removes you from its huddle; archiving ends it.
  bus.on('member.left', (e) => {
    const cid = e.payload?.conversationId;
    const uid = e.payload?.userId;
    if (typeof cid !== 'string' || typeof uid !== 'string') return;
    const row = svc.activeRowFor(cid);
    if (row) svc.leave(row.id, uid, 'removed');
  });
  bus.on('conversation.archived', (e) => {
    const cid = e.conversationId ?? e.payload?.conversation?.id;
    const row = cid ? svc.activeRowFor(cid) : null;
    if (row) svc.end(row.id, e.actorId ?? null);
  });

  // Joined over REST but never connected (or the server restarted): give them the grace window.
  bus.on('huddle.started', (e) => afterJoin(e));
  bus.on('huddle.updated', (e) => afterJoin(e));
  function afterJoin(e: any) {
    const change = e.payload?.change;
    if (change?.type !== 'joined') return;
    const hid = e.payload.huddle.id;
    if (!realtime.isOnline(change.userId)) schedule(hid, change.userId);
  }
  for (const p of svc.allActiveParticipants()) schedule(p.huddle_id, p.user_id);

  ctx.onClose(() => {
    closing = true;
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    attached.clear();
  });
}
