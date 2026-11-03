export type BusEventType =
  | 'message.created' | 'message.updated' | 'message.deleted'
  | 'reaction.added' | 'reaction.removed'
  | 'conversation.created' | 'conversation.updated' | 'conversation.archived'
  | 'member.joined' | 'member.left'
  | 'workspace.member_joined'
  | 'file.uploaded'
  | 'file.deleted'
  | 'user.updated'
  | 'presence.changed'
  | 'huddle.started' | 'huddle.updated' | 'huddle.ended'
  | 'canvas.updated'
  | 'workflow.run_updated'
  | 'notification.created'
  | 'project.created' | 'project.updated' | 'project.deleted' | 'project.dev_updated'
  | 'item.created' | 'item.updated' | 'item.deleted' | 'item.assigned' | 'item.commented';

export interface BusEvent<P = any> {
  type: BusEventType | (string & {});
  workspaceId: string | null;
  conversationId?: string | null;
  actorId?: string | null;
  payload: P;
  /**
   * Optional explicit WS audience. When set, realtime delivers ONLY to these users
   * (still requiring them to be connected). Use for per-user events like notifications.
   */
  audience?: string[];
  /** Set true to keep an event server-internal (never forwarded over WS). */
  internal?: boolean;
}

export type BusHandler = (event: BusEvent) => void;

export interface Bus {
  emit(event: BusEvent): void;
  /** Subscribe to one type, or '*' for every event. Returns an unsubscribe fn. */
  on(type: BusEvent['type'] | '*', fn: BusHandler): () => void;
}

export function createBus(onError: (err: unknown, event: BusEvent) => void = (e) => console.error(e)): Bus {
  const handlers = new Map<string, Set<BusHandler>>();
  return {
    emit(event) {
      for (const key of [event.type, '*']) {
        const set = handlers.get(key);
        if (!set) continue;
        for (const fn of [...set]) {
          try { fn(event); } catch (err) { onError(err, event); }
        }
      }
    },
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
  };
}
