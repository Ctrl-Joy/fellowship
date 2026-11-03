// Client-side canvas document: optimistic local state, batched block ops (~300 ms debounce),
// per-block versions with rebase on conflict, and live application of remote ops.
import { api } from '../../api';
import { keyBetween } from './fractional';
import { merge3, randomId } from './text';
import type { AppliedOp, Block, BlockType, Op, OpResult } from './types';

type Field = 'text' | 'type' | 'checked' | 'position';
const FLUSH_DELAY = 300;
const MAX_WAIT = 1200;

const byPos = (a: Block, b: Block) => (a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class CanvasDoc {
  readonly clientId = randomId('cl');
  /** What the user sees (optimistic). */
  private local = new Map<string, Block>();
  /** Latest known server state per block. */
  private server = new Map<string, Block>();
  /** Server state the pending local edits of a block are based on. */
  private base = new Map<string, Block>();
  private dirty = new Map<string, Set<Field>>();
  private created = new Set<string>();
  private deleted = new Map<string, number | undefined>();
  private inflight: Set<string> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstPendingAt = 0;
  private retryDelay = 1000;
  private ordered: Block[] = [];
  private listeners = new Set<() => void>();
  private closed = false;
  /** Called with a short human message (e.g. an edit collided with someone else's). */
  onNotice: (msg: string) => void = () => {};
  onSaving: (saving: boolean) => void = () => {};

  constructor(readonly canvasId: string, blocks: Block[]) {
    for (const b of blocks) { this.server.set(b.id, b); this.local.set(b.id, b); }
    this.reorder();
  }

  // ---- reading ----
  blocks(): Block[] { return this.ordered; }
  get(id: string): Block | undefined { return this.local.get(id); }
  hasPending(): boolean { return this.created.size + this.dirty.size + this.deleted.size > 0 || !!this.inflight; }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  private reorder() { this.ordered = [...this.local.values()].sort(byPos); }
  private emit() { this.reorder(); for (const fn of this.listeners) fn(); }

  private neighbours(afterId: string | null): [string | null, string | null] {
    const list = this.ordered;
    if (afterId === null) return [null, list[0]?.position ?? null];
    const i = list.findIndex((b) => b.id === afterId);
    if (i === -1) return [list[list.length - 1]?.position ?? null, null];
    let next = list[i + 1]?.position ?? null;
    // Equal keys can briefly exist (concurrent inserts) — step past them.
    let j = i + 1;
    while (next !== null && next <= list[i].position) next = list[++j]?.position ?? null;
    return [list[i].position, next];
  }

  // ---- local edits ----
  insertAfter(afterId: string | null, init: { type?: BlockType; text?: string; checked?: boolean } = {}): string {
    const id = randomId('B');
    const [a, b] = this.neighbours(afterId);
    const block: Block = { id, position: keyBetween(a, b), type: init.type ?? 'paragraph', text: init.type === 'divider' ? '' : init.text ?? '', checked: !!init.checked, version: 0 };
    this.local.set(id, block);
    this.created.add(id);
    this.emit();
    this.schedule();
    return id;
  }

  update(id: string, patch: Partial<Pick<Block, 'text' | 'type' | 'checked'>>) {
    const cur = this.local.get(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    if (next.type === 'divider') next.text = '';
    const fields = (['text', 'type', 'checked'] as const).filter((f) => next[f] !== cur[f]);
    if (!fields.length) return;
    this.local.set(id, next);
    this.markDirty(id, fields);
    this.emit();
    this.schedule();
  }

  move(id: string, afterId: string | null) {
    const cur = this.local.get(id);
    if (!cur || afterId === id) return;
    // Compute neighbours without the moving block.
    this.local.delete(id); this.reorder();
    const [a, b] = this.neighbours(afterId);
    this.local.set(id, { ...cur, position: keyBetween(a, b) });
    this.markDirty(id, ['position']);
    this.emit();
    this.schedule();
  }

  remove(id: string) {
    if (!this.local.has(id)) return;
    this.local.delete(id);
    this.dirty.delete(id);
    this.base.delete(id);
    if (this.created.has(id)) this.created.delete(id);
    else this.deleted.set(id, this.server.get(id)?.version);
    this.emit();
    this.schedule();
  }

  private markDirty(id: string, fields: readonly Field[]) {
    if (this.created.has(id)) return; // the insert op carries the latest fields
    let set = this.dirty.get(id);
    if (!set) {
      set = new Set();
      this.dirty.set(id, set);
      const s = this.server.get(id);
      if (s && !this.base.has(id)) this.base.set(id, s);
    }
    for (const f of fields) set.add(f);
  }

  // ---- sync ----
  private schedule() {
    if (this.closed) return;
    const now = Date.now();
    if (!this.firstPendingAt) this.firstPendingAt = now;
    if (this.timer) clearTimeout(this.timer);
    const wait = now - this.firstPendingAt >= MAX_WAIT ? 0 : FLUSH_DELAY;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, wait);
  }

  /** Send everything pending now (one batch in flight at a time). */
  async flush(): Promise<void> {
    if (this.inflight) return;
    const ops: Op[] = [];
    const sentBase = new Map<string, Block | undefined>();
    const sentFields = new Map<string, Set<Field>>();
    const inserts = [...this.created].map((id) => this.local.get(id)!).filter(Boolean).sort(byPos);
    for (const b of inserts) {
      ops.push({ op: 'insert', blockId: b.id, position: b.position, type: b.type, text: b.text, checked: b.checked });
    }
    for (const [id, fields] of this.dirty) {
      const l = this.local.get(id);
      const base = this.base.get(id) ?? this.server.get(id);
      if (!l || !base) continue;
      const u: Op = { op: 'update', blockId: id, baseVersion: base.version };
      if (fields.has('text')) u.text = l.text;
      if (fields.has('type')) u.type = l.type;
      if (fields.has('checked')) u.checked = l.checked;
      if (fields.has('text') || fields.has('type') || fields.has('checked')) ops.push(u);
      if (fields.has('position')) ops.push({ op: 'move', blockId: id, baseVersion: base.version, position: l.position });
      sentBase.set(id, base);
      sentFields.set(id, fields);
    }
    for (const [id, v] of this.deleted) ops.push({ op: 'delete', blockId: id, baseVersion: v });
    if (!ops.length) { this.firstPendingAt = 0; return; }

    const createdSnapshot = new Set(this.created);
    const deletedSnapshot = new Map(this.deleted);
    this.inflight = new Set(ops.map((o) => o.blockId));
    this.created.clear(); this.dirty.clear(); this.deleted.clear(); this.base.clear();
    this.firstPendingAt = 0;
    this.onSaving(true);

    let results: OpResult[];
    try {
      const r = await api.post<{ results: OpResult[] }>(`/api/canvases/${this.canvasId}/ops`, { clientId: this.clientId, ops });
      results = r.results;
    } catch (err: any) {
      // Put everything back and retry later (offline, server restart…). 4xx other than
      // network/5xx means we lost access; stop retrying.
      this.inflight = null;
      for (const id of createdSnapshot) if (this.local.has(id)) this.created.add(id);
      for (const [id, fields] of sentFields) {
        if (!this.local.has(id)) continue;
        const set = this.dirty.get(id) ?? new Set<Field>();
        for (const f of fields) set.add(f);
        this.dirty.set(id, set);
        const b = sentBase.get(id); if (b) this.base.set(id, b);
      }
      for (const [id, v] of deletedSnapshot) if (!this.local.has(id)) this.deleted.set(id, v);
      this.onSaving(false);
      if (err?.status && err.status >= 400 && err.status < 500) { this.onNotice(err.message ?? 'Could not save changes'); return; }
      this.retryDelay = Math.min(this.retryDelay * 2, 15000);
      if (!this.closed) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.retryDelay);
      return;
    }
    this.retryDelay = 1000;
    const touched = this.inflight;
    this.inflight = null;
    let collided = false;

    for (const res of results) {
      const id = res.blockId;
      const sb = res.block;
      switch (res.status) {
        case 'ok':
        case 'noop':
          if (res.op === 'delete') { if (!this.local.has(id)) { this.server.delete(id); this.base.delete(id); } }
          else if (sb) this.acceptServer(sb, true);
          break;
        case 'gone':
          this.server.delete(id); this.local.delete(id); this.dirty.delete(id); this.base.delete(id);
          break;
        case 'error':
          console.warn('[canvas] op rejected', res);
          break;
        case 'conflict': {
          if (!sb) break;
          this.serverSet(sb);
          if (res.op === 'delete') {
            // Someone wrote into the block we removed: bring it back rather than lose their text.
            if (!this.local.has(id)) this.local.set(id, sb);
            collided = true;
            break;
          }
          const l = this.local.get(id);
          if (!l) break;
          const fields = sentFields.get(id) ?? new Set<Field>();
          const oldBase = sentBase.get(id) ?? sb;
          const again = this.dirty.get(id) ?? new Set<Field>();
          const next = { ...l, version: sb.version };
          for (const f of ['text', 'type', 'checked', 'position'] as Field[]) {
            if (!fields.has(f) && !again.has(f)) { (next as any)[f] = (sb as any)[f]; continue; }
            if (f === 'text') {
              const m = merge3(oldBase.text, l.text, sb.text);
              if (m.conflict) collided = true;
              next.text = m.text;
              if (m.text !== sb.text) again.add('text'); else again.delete('text');
            } else if ((res.conflictFields ?? []).includes(f) && !this.dirty.get(id)?.has(f)) {
              (next as any)[f] = (sb as any)[f]; // someone else changed it first: theirs wins
              again.delete(f);
            } else if ((next as any)[f] !== (sb as any)[f]) again.add(f);
          }
          this.local.set(id, next);
          if (again.size) { this.dirty.set(id, again); this.base.set(id, sb); } else { this.dirty.delete(id); this.base.delete(id); }
          break;
        }
      }
    }
    // Remote events that arrived while we were in flight are folded in now.
    for (const id of touched) this.reconcile(id);
    if (collided) this.onNotice('A collaborator edited the same text at the same time — your version was kept.');
    this.onSaving(false);
    this.emit();
    if (this.created.size || this.dirty.size || this.deleted.size) this.schedule();
  }

  private serverSet(b: Block): boolean {
    const prev = this.server.get(b.id);
    if (prev && prev.version > b.version) return false;
    this.server.set(b.id, b);
    return true;
  }

  /** A server block for something we sent: becomes the base of any edits made since. */
  private acceptServer(b: Block, ours: boolean) {
    this.serverSet(b);
    if (ours && this.dirty.has(b.id)) this.base.set(b.id, b);
  }

  /** Fold the latest server state of a block into the local view, keeping unsent local edits. */
  private reconcile(id: string) {
    if (this.inflight?.has(id)) return;
    const s = this.server.get(id);
    if (!s) return;
    if (this.deleted.has(id)) return;
    const l = this.local.get(id);
    const d = this.dirty.get(id);
    if (!l || !d || !d.size) {
      if (!this.created.has(id)) this.local.set(id, s);
      return;
    }
    const base = this.base.get(id) ?? s;
    if (base.version >= s.version) return;
    const next = { ...l, version: s.version };
    for (const f of ['type', 'checked', 'position'] as const) if (!d.has(f)) (next as any)[f] = s[f];
    if (d.has('text')) {
      const m = merge3(base.text, l.text, s.text);
      next.text = m.text;
      if (m.conflict) this.onNotice('A collaborator edited the same text at the same time — your version was kept.');
    } else next.text = s.text;
    this.local.set(id, next);
    this.base.set(id, s);
  }

  /** Apply ops broadcast by the server for someone else's change. */
  applyRemote(ops: AppliedOp[]) {
    for (const op of ops) {
      if (op.op === 'delete') {
        this.server.delete(op.blockId);
        this.local.delete(op.blockId);
        this.dirty.delete(op.blockId);
        this.base.delete(op.blockId);
        this.deleted.delete(op.blockId);
        continue;
      }
      if (!this.serverSet(op.block)) continue;
      this.reconcile(op.block.id);
    }
    this.emit();
  }

  /** Full refresh after a reconnect: adopt server truth, keep unsent local work. */
  resync(blocks: Block[]) {
    const ids = new Set(blocks.map((b) => b.id));
    for (const id of [...this.local.keys()]) {
      if (!ids.has(id) && !this.created.has(id) && !this.inflight?.has(id)) {
        this.local.delete(id); this.server.delete(id); this.dirty.delete(id); this.base.delete(id);
      }
    }
    for (const b of blocks) if (this.serverSet(b)) this.reconcile(b.id);
    this.emit();
  }

  /** (Re)start syncing — StrictMode mounts, unmounts and mounts again. */
  open() {
    this.closed = false;
    if (this.created.size || this.dirty.size || this.deleted.size) this.schedule();
  }

  close() {
    this.closed = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    // Last chance to save what was typed in the final 300 ms.
    if (this.created.size || this.dirty.size || this.deleted.size) void this.flush();
  }
}
