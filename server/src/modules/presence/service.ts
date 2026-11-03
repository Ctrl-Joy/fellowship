import type { ModuleContext } from '../../context';
import { clockFor } from './clock';
import { publicUser } from '../core/serializers';

/** A user counts as active for this long after their last presence.active frame. */
export const ACTIVITY_WINDOW_MS = 10 * 60 * 1000;

export type PresenceState = 'active' | 'away';

export interface PresenceService {
  /** Current state of a user (computed, not cached). */
  state(userId: string): PresenceState;
  isActive(userId: string): boolean;
  /** presence.active frame: records activity. */
  activity(userId: string): void;
  /** presence.away frame: the client detected idleness. */
  idle(userId: string): void;
  setManualAway(userId: string, away: boolean): PresenceState;
  isManualAway(userId: string): boolean;
  /** Recompute one user and emit presence.changed to workspace co-members on a transition. */
  refresh(userId: string): void;
  /** Scheduler tick: re-evaluate every tracked user (activity expiry) and clear expired custom statuses. */
  tick(): void;
  /** Presence of every active member of a workspace. */
  workspaceStates(workspaceId: string): Record<string, PresenceState>;
}

const services = new WeakMap<object, PresenceService>();

/**
 * Presence rules: a user is active when they have at least one open socket, are not manually
 * set to away, and sent a presence.active frame within the last 10 minutes. Everything else is away.
 * Shared by the presence and notifications modules (`@here` only notifies active members).
 */
export function presenceFor(ctx: ModuleContext): PresenceService {
  const existing = services.get(ctx);
  if (existing) return existing;

  const { db, realtime, bus } = ctx;
  const clock = clockFor(ctx);
  const lastState = new Map<string, PresenceState>();

  const getRow = db.prepare('SELECT last_activity_at, manual_away FROM presence_state WHERE user_id = ?');
  const upsertActivity = db.prepare(
    `INSERT INTO presence_state (user_id, last_activity_at, manual_away) VALUES (?, ?, 0)
     ON CONFLICT(user_id) DO UPDATE SET last_activity_at = excluded.last_activity_at`,
  );
  const setManual = db.prepare(
    `INSERT INTO presence_state (user_id, last_activity_at, manual_away) VALUES (?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET manual_away = excluded.manual_away`,
  );
  const workspacesOf = db.prepare('SELECT workspace_id FROM workspace_members WHERE user_id = ? AND deactivated = 0');
  const membersOf = db.prepare(
    'SELECT user_id FROM workspace_members WHERE workspace_id = ? AND deactivated = 0',
  );

  function compute(userId: string): PresenceState {
    const row = getRow.get(userId) as { last_activity_at: number; manual_away: number } | undefined;
    if (!realtime.isOnline(userId)) return 'away';
    if (row?.manual_away) return 'away';
    if (!row || clock.now() - row.last_activity_at > ACTIVITY_WINDOW_MS) return 'away';
    return 'active';
  }

  function emitTransition(userId: string, next: PresenceState) {
    const manual = !!(getRow.get(userId) as any)?.manual_away;
    for (const w of workspacesOf.all(userId) as any[]) {
      bus.emit({
        type: 'presence.changed', workspaceId: w.workspace_id, actorId: userId,
        payload: { userId, presence: next, manualAway: manual },
      });
    }
  }

  function refresh(userId: string) {
    const next = compute(userId);
    const prev = lastState.get(userId) ?? 'away';
    lastState.set(userId, next);
    if (prev !== next) emitTransition(userId, next);
  }

  function clearExpiredStatuses() {
    const now = clock.now();
    const expired = ctx.db.prepare(
      'SELECT id FROM users WHERE status_expires IS NOT NULL AND status_expires <= ?',
    ).all(now) as { id: string }[];
    if (!expired.length) return;
    const clear = ctx.db.prepare(
      "UPDATE users SET status_emoji = '', status_text = '', status_expires = NULL WHERE id = ?",
    );
    const load = ctx.db.prepare('SELECT * FROM users WHERE id = ?');
    for (const { id } of expired) {
      clear.run(id);
      const user = load.get(id) as any;
      const dto = publicUser(user);
      for (const w of workspacesOf.all(id) as any[]) {
        bus.emit({ type: 'user.updated', workspaceId: w.workspace_id, actorId: id, payload: { user: dto } });
      }
    }
  }

  const service: PresenceService = {
    state: (userId) => compute(userId),
    isActive: (userId) => compute(userId) === 'active',
    activity(userId) {
      upsertActivity.run(userId, clock.now());
      refresh(userId);
    },
    idle(userId) {
      upsertActivity.run(userId, 0);
      refresh(userId);
    },
    setManualAway(userId, away) {
      setManual.run(userId, away ? 1 : 0);
      refresh(userId);
      return compute(userId);
    },
    isManualAway: (userId) => !!(getRow.get(userId) as any)?.manual_away,
    refresh,
    tick() {
      for (const uid of [...lastState.keys()]) refresh(uid);
      clearExpiredStatuses();
    },
    workspaceStates(workspaceId) {
      const out: Record<string, PresenceState> = {};
      for (const m of membersOf.all(workspaceId) as any[]) out[m.user_id] = compute(m.user_id);
      return out;
    },
  };

  realtime.onConnect((userId) => refresh(userId));
  realtime.onDisconnect((userId) => refresh(userId));

  services.set(ctx, service);
  return service;
}
