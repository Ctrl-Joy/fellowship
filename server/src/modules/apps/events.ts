import type { ModuleContext } from '../../context';
import type { AppRow } from './helpers';
import { appDto, parseEventTypes, signedHeaders } from './helpers';
import type { AppsService } from './service';

/** Event types an app may subscribe to. */
export const EVENT_TYPES = ['message.created', 'reaction.added', 'member.joined', 'conversation.created'] as const;
const SUPPORTED = new Set<string>(EVENT_TYPES);

/** Retries after the first attempt (4 attempts total). */
export const DELIVERY_RETRIES = 3;
const DELIVERY_TIMEOUT_MS = 5000;

export interface DeliveryRow {
  id: string;
  eventId: string;
  eventType: string;
  url: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface EventDeliveries {
  recent(appId: string, limit: number): DeliveryRow[];
  enqueueTest(app: AppRow): string;
}

/**
 * Subscribes to the bus and POSTs signed JSON to each interested app's events URL, for
 * conversations the bot belongs to. Failed deliveries retry with exponential backoff.
 */
export function createEventDeliveries(ctx: ModuleContext, svc: AppsService): EventDeliveries {
  const { db, bus, ids, access } = ctx;
  // Tests set a tiny base so retries finish quickly; production waits 1s, 2s, 4s.
  const backoffBase = Number(process.env.FELLOWSHIP_APPS_BACKOFF_MS ?? 1000);
  const controllers = new Set<AbortController>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let closed = false;

  ctx.onClose(() => {
    closed = true;
    for (const c of controllers) c.abort();
    for (const t of timers) clearTimeout(t);
    timers.clear();
  });

  function recent(appId: string, limit: number): DeliveryRow[] {
    const rows = db.prepare(
      'SELECT * FROM apps_event_deliveries WHERE app_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    ).all(appId, limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      eventId: r.event_id,
      eventType: r.event_type,
      url: r.url,
      status: r.status,
      attempts: r.attempts,
      lastStatus: r.last_status,
      lastError: r.last_error,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  function enqueue(app: AppRow, eventType: string, body: Record<string, unknown>): string {
    const eventId = ids.next('Ev');
    const deliveryId = ids.next('ED');
    const now = Date.now();
    const json = JSON.stringify({ ...body, event_id: eventId });
    db.prepare(
      `INSERT INTO apps_event_deliveries (id, app_id, event_id, event_type, url, status, attempts, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
    ).run(deliveryId, app.id, eventId, eventType, app.events_url ?? '', json, now, now);
    void attempt(deliveryId, app.id, app.events_url ?? '', json, 1);
    return deliveryId;
  }

  async function attempt(deliveryId: string, appId: string, url: string, body: string, n: number): Promise<void> {
    if (closed) return;
    const app = svc.appById(appId);
    if (!app) return;
    const ac = new AbortController();
    controllers.add(ac);
    let status: number | null = null;
    let error: string | null = null;
    let ok = false;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: signedHeaders(app.signing_secret, body, 'application/json'),
        body,
        signal: AbortSignal.any([ac.signal, AbortSignal.timeout(DELIVERY_TIMEOUT_MS)]),
      });
      status = res.status;
      ok = res.ok;
      if (!ok) error = `HTTP ${res.status}`;
      await res.arrayBuffer().catch(() => undefined);
    } catch (err: any) {
      error = err?.name === 'TimeoutError' ? 'timeout' : String(err?.message ?? err);
    } finally {
      controllers.delete(ac);
    }
    if (closed) return;
    const giveUp = ok || n > DELIVERY_RETRIES;
    db.prepare(
      'UPDATE apps_event_deliveries SET attempts = ?, last_status = ?, last_error = ?, status = ?, updated_at = ? WHERE id = ?',
    ).run(n, status, ok ? null : error, ok ? 'delivered' : giveUp ? 'failed' : 'pending', Date.now(), deliveryId);
    if (giveUp) return;
    const t = setTimeout(() => {
      timers.delete(t);
      void attempt(deliveryId, appId, url, body, n + 1);
    }, backoffBase * 2 ** (n - 1));
    timers.add(t);
  }

  function enqueueTest(app: AppRow): string {
    return enqueue(app, 'app.test', {
      type: 'event_callback',
      team_id: app.workspace_id,
      api_app_id: app.id,
      event_time: Math.floor(Date.now() / 1000),
      event: { type: 'app.test', app: appDto(app) },
    });
  }

  bus.on('*', (e) => {
    if (!SUPPORTED.has(e.type) || !e.workspaceId || !e.conversationId) return;
    const apps = db.prepare(
      'SELECT * FROM apps WHERE workspace_id = ? AND events_url IS NOT NULL AND is_system = 0',
    ).all(e.workspaceId) as unknown as AppRow[];
    for (const app of apps) {
      if (!parseEventTypes(app.event_types).includes(e.type)) continue;
      if (e.actorId === app.bot_user_id) continue; // never echo an app's own actions back to it
      if (!access.isConversationMember(e.conversationId, app.bot_user_id)) continue;
      enqueue(app, e.type, {
        type: 'event_callback',
        team_id: e.workspaceId,
        api_app_id: app.id,
        event_time: Math.floor(Date.now() / 1000),
        event: { type: e.type, channel: e.conversationId, user: e.actorId ?? null, ...(e.payload ?? {}) },
      });
    }
  });

  return { recent, enqueueTest };
}
