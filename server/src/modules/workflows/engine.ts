// Durable workflow engine: runs are a persisted state machine (cursor into the step tree +
// context JSON). Steps either continue, park the run (`waiting`: forms, approvals, delays) or end it.
import type { FastifyInstance } from 'fastify';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { ModuleContext } from '../../context';
import { randomToken } from '../../ids';
import { badRequest, conflict, forbidden, notFound } from '../../errors';
import { loadConversation } from '../core/serializers';
import type { MessageRow } from '../core/messages';
import type {
  BranchConfig, Cursor, FormField, RunContext, RunRow, Step, Trigger, WorkflowRow,
} from './types';
import { advance, evalBranch, render, renderValue, stepAt } from './variables';
import { nextFireAt, scheduleMatchesMinute } from './cron';
import { CONV_ID_RE, USER_ID_RE } from './variables';

export const MAX_STEPS_PER_RUN = 200;
export const MAX_CHAIN_DEPTH = 3;
export const HTTP_TIMEOUT_MS = 10_000;
const MAX_HTTP_BODY = 1024 * 1024;
const UNIT_MS: Record<string, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

export interface Definition { trigger: Trigger; steps: Step[] }

type Outcome =
  | { kind: 'next'; output?: any; arm?: 'then' | 'else' }
  | { kind: 'wait'; output?: any; wakeAt?: number | null }
  | { kind: 'end'; output?: any };

class StepError extends Error {}

export interface StartOptions {
  version: number;
  trigger: Record<string, any>;
  triggerUserId: string | null;
  depth?: number;
  isTest?: boolean;
}

const engines = new WeakMap<ModuleContext, Engine>();
/** Test / module access to the engine attached to an app context. */
export function getEngine(ctx: ModuleContext): Engine {
  const e = engines.get(ctx);
  if (!e) throw new Error('workflows engine not registered');
  return e;
}

export type Engine = ReturnType<typeof createEngine>;

export function createEngine(app: FastifyInstance, ctx: ModuleContext) {
  const { db, bus, access, messages } = ctx;
  let clock: () => number = () => Date.now();
  let httpTimeoutMs = HTTP_TIMEOUT_MS;
  let allowPrivateHttp = ctx.config.isTest || process.env.FELLOWSHIP_WORKFLOW_ALLOW_PRIVATE === '1';
  const queues = new Map<string, Promise<void>>();
  const botSessions = new Map<string, string>();
  /** Workflow whose synchronous action is currently emitting bus events (loop guard). */
  let origin: { workflowId: string; depth: number } | null = null;

  // ------------------------------------------------------------------ data access

  const getWorkflow = (id: string) => (db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as unknown as WorkflowRow) ?? null;
  const getRun = (id: string) => (db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as unknown as RunRow) ?? null;

  /** Make sure a snapshot of the workflow's current definition exists for its version. */
  function ensureSnapshot(wf: WorkflowRow) {
    db.prepare(
      'INSERT OR IGNORE INTO workflow_versions (workflow_id, version, trigger_json, steps_json, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(wf.id, wf.version, wf.trigger_json, wf.steps_json, Date.now());
  }

  function loadDefinition(workflowId: string, version: number): Definition {
    const row = db.prepare('SELECT * FROM workflow_versions WHERE workflow_id = ? AND version = ?').get(workflowId, version) as any;
    if (!row) throw new Error(`Missing workflow snapshot ${workflowId}@${version}`);
    return { trigger: JSON.parse(row.trigger_json), steps: JSON.parse(row.steps_json) };
  }

  function publishedDefinition(wf: WorkflowRow): Definition | null {
    if (wf.status !== 'published' || wf.published_version == null) return null;
    try { return loadDefinition(wf.id, wf.published_version); } catch { return null; }
  }

  /** Per-workspace bot user that authors workflow messages. Created lazily. */
  function botUserId(workspaceId: string): string {
    const row = db.prepare('SELECT user_id FROM workflow_bots WHERE workspace_id = ?').get(workspaceId) as any;
    if (row) return row.user_id;
    const user = ctx.core.createUser({
      email: `workflows+${workspaceId.toLowerCase()}@bots.fellowship.invalid`,
      password: randomToken(24), fullName: 'Workflow Builder', displayName: 'Workflows', isBot: true,
    });
    const now = Date.now();
    db.prepare('INSERT INTO workflow_bots (workspace_id, user_id) VALUES (?, ?)').run(workspaceId, user.id);
    db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)")
      .run(workspaceId, user.id, now);
    bus.emit({
      type: 'workspace.member_joined', workspaceId, actorId: user.id,
      payload: {
        workspaceId,
        member: {
          id: user.id, email: user.email, fullName: user.full_name, displayName: user.display_name, title: '', pronouns: '',
          phone: '', timezone: 'UTC', avatarUrl: null, statusEmoji: '', statusText: '', statusExpires: null, isBot: true,
          createdAt: user.created_at, role: 'member', joinedAt: now, deactivated: false,
        },
      },
    });
    return user.id;
  }

  function isBot(userId: string | null | undefined) {
    if (!userId) return false;
    const r = db.prepare('SELECT is_bot FROM users WHERE id = ?').get(userId) as any;
    return !!r?.is_bot;
  }

  // ------------------------------------------------------------------ run lifecycle

  function serializeRun(run: RunRow, withSteps = false) {
    const out: any = {
      id: run.id, workflowId: run.workflow_id, workspaceId: run.workspace_id, version: run.version,
      status: run.status, triggerUserId: run.trigger_user_id, waitingStepId: run.waiting_step_id,
      wakeAt: run.wake_at, error: run.error, stepsCount: run.steps_count, isTest: !!run.is_test,
      startedAt: run.started_at, finishedAt: run.finished_at,
    };
    if (withSteps) {
      out.context = JSON.parse(run.context_json);
      out.steps = (db.prepare('SELECT * FROM workflow_run_steps WHERE run_id = ? ORDER BY id').all(run.id) as any[]).map((s) => ({
        id: s.id, stepId: s.step_id, type: s.step_type, status: s.status,
        input: s.input_json ? JSON.parse(s.input_json) : null,
        output: s.output_json ? JSON.parse(s.output_json) : null,
        error: s.error, startedAt: s.started_at, finishedAt: s.finished_at,
      }));
    }
    return out;
  }

  function emitRun(runId: string) {
    const run = getRun(runId);
    if (!run) return;
    const wf = getWorkflow(run.workflow_id);
    const audience = [...new Set([wf?.owner_id, run.trigger_user_id].filter(Boolean) as string[])];
    bus.emit({
      type: 'workflow.run_updated', workspaceId: run.workspace_id, actorId: null, audience,
      payload: { run: serializeRun(run) },
    });
  }

  function startRun(wf: WorkflowRow, opts: StartOptions): RunRow {
    const def = loadDefinition(wf.id, opts.version);
    const id = ctx.ids.next('WR');
    const now = clock();
    const context: RunContext = { trigger: opts.trigger, steps: {}, vars: {} };
    const cursor: Cursor | null = def.steps.length ? [{ i: 0 }] : null;
    db.prepare(
      `INSERT INTO workflow_runs (id, workflow_id, workspace_id, version, status, trigger_user_id, context_json, current_step,
        depth, is_test, started_at) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)`,
    ).run(id, wf.id, wf.workspace_id, opts.version, opts.triggerUserId, JSON.stringify(context), JSON.stringify(cursor),
      opts.depth ?? 0, opts.isTest ? 1 : 0, now);
    emitRun(id);
    kick(id);
    return getRun(id)!;
  }

  function kick(runId: string) {
    const prev = queues.get(runId) ?? Promise.resolve();
    const next = prev.then(() => drive(runId)).catch((err) => { app.log.error({ err, runId }, 'workflow drive failed'); });
    queues.set(runId, next);
    next.finally(() => { if (queues.get(runId) === next) queues.delete(runId); });
  }

  /** Resolve when no run is executing (tests). */
  async function idle() {
    while (queues.size) await Promise.all([...queues.values()]);
  }

  function finish(runId: string, status: 'succeeded' | 'failed' | 'cancelled', error: string | null = null) {
    db.prepare('UPDATE workflow_runs SET status = ?, error = ?, finished_at = ?, wake_at = NULL, waiting_step_id = NULL WHERE id = ?')
      .run(status, error, clock(), runId);
    if (status !== 'succeeded') closeOpenMessages(runId, status);
    emitRun(runId);
  }

  function saveContext(runId: string, context: RunContext) {
    db.prepare('UPDATE workflow_runs SET context_json = ? WHERE id = ?').run(JSON.stringify(context), runId);
  }

  async function drive(runId: string) {
    for (;;) {
      const run = getRun(runId);
      if (!run || run.status !== 'running') return;
      let def: Definition;
      try { def = loadDefinition(run.workflow_id, run.version); } catch (e: any) { finish(runId, 'failed', e.message); return; }
      const cursor = JSON.parse(run.current_step) as Cursor | null;
      const step = cursor ? stepAt(def.steps, cursor) : null;
      if (!cursor || !step) { finish(runId, 'succeeded'); return; }
      if (run.steps_count >= MAX_STEPS_PER_RUN) {
        finish(runId, 'failed', `Stopped after ${MAX_STEPS_PER_RUN} steps (loop guard)`);
        return;
      }
      const wf = getWorkflow(run.workflow_id);
      if (!wf) { finish(runId, 'failed', 'Workflow was deleted'); return; }
      const context = JSON.parse(run.context_json) as RunContext;
      const now = clock();
      // A step left "running" by a crash is re-executed (at-least-once).
      db.prepare("UPDATE workflow_run_steps SET status = 'interrupted', finished_at = ? WHERE run_id = ? AND status = 'running'").run(now, runId);
      const input = renderConfigPreview(step, context, now);
      const rs = db.prepare(
        "INSERT INTO workflow_run_steps (run_id, step_id, step_type, status, input_json, started_at) VALUES (?, ?, ?, 'running', ?, ?)",
      ).run(runId, step.id, step.type, JSON.stringify(input), now);
      const rsId = Number(rs.lastInsertRowid);
      db.prepare('UPDATE workflow_runs SET steps_count = steps_count + 1 WHERE id = ?').run(runId);

      let outcome: Outcome;
      try {
        outcome = await executeStep(wf, run, step, context);
      } catch (err: any) {
        const msg = err instanceof StepError || err?.statusCode ? err.message : (err?.message ?? String(err));
        db.prepare("UPDATE workflow_run_steps SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(msg, clock(), rsId);
        finish(runId, 'failed', `${step.name || labelOf(step)} (${step.id}): ${msg}`);
        return;
      }
      // The run may have been cancelled while the step was awaiting.
      const after = getRun(runId);
      if (!after || after.status !== 'running') {
        db.prepare("UPDATE workflow_run_steps SET status = 'cancelled', finished_at = ? WHERE id = ?").run(clock(), rsId);
        return;
      }
      if (outcome.output !== undefined) context.steps[step.id] = outcome.output;
      if (outcome.kind === 'wait') {
        db.prepare("UPDATE workflow_run_steps SET status = 'waiting', output_json = ? WHERE id = ?")
          .run(JSON.stringify(outcome.output ?? null), rsId);
        db.prepare("UPDATE workflow_runs SET status = 'waiting', context_json = ?, wake_at = ?, waiting_step_id = ? WHERE id = ?")
          .run(JSON.stringify(context), outcome.wakeAt ?? null, step.id, runId);
        emitRun(runId);
        return;
      }
      db.prepare("UPDATE workflow_run_steps SET status = 'succeeded', output_json = ?, finished_at = ? WHERE id = ?")
        .run(JSON.stringify(outcome.output ?? null), clock(), rsId);
      saveContext(runId, context);
      if (outcome.kind === 'end') { finish(runId, 'succeeded'); return; }
      const next = advance(def.steps, cursor, outcome.arm);
      db.prepare('UPDATE workflow_runs SET current_step = ? WHERE id = ?').run(JSON.stringify(next), runId);
      if (!next) { finish(runId, 'succeeded'); return; }
      emitRun(runId);
    }
  }

  /** Finish a waiting step (form submitted, approval decided, delay elapsed) and continue the run. */
  function completeWaiting(runId: string, stepId: string, output: any, arm?: 'then' | 'else'): boolean {
    const run = getRun(runId);
    if (!run || run.status !== 'waiting' || run.waiting_step_id !== stepId) return false;
    const def = loadDefinition(run.workflow_id, run.version);
    const context = JSON.parse(run.context_json) as RunContext;
    const merged = { ...(context.steps[stepId] ?? {}), ...output };
    context.steps[stepId] = merged;
    const cursor = JSON.parse(run.current_step) as Cursor;
    const next = advance(def.steps, cursor, arm);
    const now = clock();
    db.prepare(
      "UPDATE workflow_run_steps SET status = 'succeeded', output_json = ?, finished_at = ? WHERE id = (SELECT MAX(id) FROM workflow_run_steps WHERE run_id = ? AND step_id = ?)",
    ).run(JSON.stringify(merged), now, runId, stepId);
    db.prepare("UPDATE workflow_runs SET status = 'running', context_json = ?, current_step = ?, wake_at = NULL, waiting_step_id = NULL WHERE id = ?")
      .run(JSON.stringify(context), JSON.stringify(next), runId);
    if (!next) { finish(runId, 'succeeded'); return true; }
    emitRun(runId);
    kick(runId);
    return true;
  }

  function cancelRun(runId: string) {
    const run = getRun(runId);
    if (!run) throw notFound('Run not found');
    if (run.status !== 'running' && run.status !== 'waiting') throw conflict('This run has already finished');
    db.prepare("UPDATE workflow_run_steps SET status = 'cancelled', finished_at = ? WHERE run_id = ? AND status IN ('running','waiting')").run(clock(), runId);
    finish(runId, 'cancelled');
  }

  /** Mark form / approval messages of a finished run as closed so the UI stops offering buttons. */
  function closeOpenMessages(runId: string, status: string) {
    const ids = [
      ...(db.prepare("SELECT message_id FROM workflow_approvals WHERE run_id = ? AND status = 'pending'").all(runId) as any[]).map((r) => r.message_id),
      ...(db.prepare("SELECT id AS message_id FROM messages WHERE subtype = 'workflow_form' AND json_extract(meta_json, '$.runId') = ?").all(runId) as any[]).map((r) => r.message_id),
    ];
    db.prepare("UPDATE workflow_approvals SET status = 'cancelled' WHERE run_id = ? AND status = 'pending'").run(runId);
    for (const mid of ids) updateMeta(mid, (m) => ({ ...m, closed: true, closedReason: status, ...(m.kind === 'approval' && m.status === 'pending' ? { status: 'cancelled' } : {}) }));
  }

  function updateMeta(messageId: string, fn: (meta: any) => any) {
    const row = messages.getRow(messageId);
    if (!row || row.deleted_at) return;
    const meta = row.meta_json ? JSON.parse(row.meta_json) : {};
    db.prepare('UPDATE messages SET meta_json = ? WHERE id = ?').run(JSON.stringify(fn(meta)), messageId);
    messages.emitUpdated(messages.getRow(messageId)!, null);
  }

  // ------------------------------------------------------------------ step execution

  function labelOf(step: Step) {
    return step.type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }

  function renderOpts() {
    return {
      mentions: true,
      isUser: (id: string) => !!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id),
      isChannel: (id: string) => !!access.getConversation(id),
    };
  }

  /** What the step was given (templates rendered), for the run log. */
  function renderConfigPreview(step: Step, context: RunContext, now: number) {
    const walk = (v: any): any => {
      if (typeof v === 'string') return render(v, context, now);
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
      return v;
    };
    const cfg = walk(step.config ?? {});
    if (step.type === 'http_request' && Array.isArray(cfg.headers)) {
      cfg.headers = cfg.headers.map((h: any) => (/authorization|token|secret|key/i.test(h?.key ?? '') ? { ...h, value: '••••' } : h));
    }
    return cfg;
  }

  function ownerCheck(wf: WorkflowRow) {
    if (!access.workspaceMember(wf.workspace_id, wf.owner_id)) throw new StepError('The workflow owner is no longer in this workspace');
  }

  /** Resolve a channel reference (id or template) to a usable channel the owner may act in. */
  function resolveChannel(wf: WorkflowRow, raw: any, context: RunContext, now: number) {
    let id = renderValue(raw, context, now);
    if (Array.isArray(id)) id = id[0];
    id = String(id ?? '').trim().replace(/^<#(.+)>$/, '$1');
    const conv = id ? access.getConversation(id) : null;
    if (!conv || conv.workspace_id !== wf.workspace_id) throw new StepError('Channel not found');
    if (conv.is_archived) throw new StepError('That channel is archived');
    const ownerMember = access.isConversationMember(conv.id, wf.owner_id);
    if (conv.kind !== 'channel' ? !ownerMember : (conv.is_private && !ownerMember)) {
      throw new StepError('The workflow owner cannot access that conversation');
    }
    return conv;
  }

  function resolveUser(wf: WorkflowRow, raw: any, context: RunContext, now: number): string {
    let id = renderValue(raw, context, now);
    if (Array.isArray(id)) id = id[0];
    id = String(id ?? '').trim().replace(/^<@(.+)>$/, '$1');
    if (!id || !access.workspaceMember(wf.workspace_id, id)) throw new StepError('Person not found in this workspace');
    return id;
  }

  function resolveTarget(wf: WorkflowRow, target: any, context: RunContext, now: number): string {
    switch (target?.kind) {
      case 'channel': return resolveChannel(wf, target.channelId, context, now).id;
      case 'trigger_channel': {
        if (!context.trigger.channel) throw new StepError('This run has no trigger channel');
        return resolveChannel(wf, context.trigger.channel, context, now).id;
      }
      case 'user':
      case 'trigger_user': {
        const uid = target.kind === 'user' ? resolveUser(wf, target.userId, context, now) : resolveUser(wf, context.trigger.user ?? '', context, now);
        return ctx.core.openDm(wf.workspace_id, botUserId(wf.workspace_id), [uid]).id;
      }
      default: throw new StepError('No destination chosen');
    }
  }

  function post(wf: WorkflowRow, run: RunRow, conversationId: string, text: string, extra: { subtype?: string; meta?: any; threadRootId?: string } = {}) {
    const bot = botUserId(wf.workspace_id);
    const meta = { ...(extra.meta ?? {}), workflow: { id: wf.id, name: wf.name, emoji: wf.emoji, runId: run.id, depth: run.depth } };
    return withOrigin(wf.id, run.depth, () => messages.post({
      conversationId, userId: bot, text, force: true, subtype: extra.subtype ?? 'workflow', meta, threadRootId: extra.threadRootId ?? null,
    }));
  }

  function withOrigin<T>(workflowId: string, depth: number, fn: () => T): T {
    const prev = origin;
    origin = { workflowId, depth };
    try { return fn(); } finally { origin = prev; }
  }

  async function executeStep(wf: WorkflowRow, run: RunRow, step: Step, context: RunContext): Promise<Outcome> {
    const c = step.config ?? {};
    const now = clock();
    ownerCheck(wf);
    switch (step.type) {
      case 'send_message': {
        const cid = resolveTarget(wf, c.target, context, now);
        const text = render(String(c.text ?? ''), context, now, renderOpts());
        if (!text.trim()) throw new StepError('Message text is empty');
        const m = post(wf, run, cid, text);
        return { kind: 'next', output: { messageId: m.id, channel: cid } };
      }
      case 'send_form': {
        const cid = resolveTarget(wf, c.target, context, now);
        const title = render(String(c.title ?? 'Form'), context, now);
        const intro = render(String(c.intro ?? ''), context, now, renderOpts());
        const fields: FormField[] = (c.fields ?? []).map((f: FormField) => ({
          id: f.id, label: render(f.label, context, now), type: f.type, required: !!f.required,
          options: (f.options ?? []).map((o) => String(o)).filter((o) => o.trim()), placeholder: f.placeholder ?? '',
        }));
        const m = post(wf, run, cid, `*${title}*${intro ? `\n${intro}` : ''}`, {
          subtype: 'workflow_form',
          meta: {
            kind: 'form', runId: run.id, stepId: step.id, title, fields,
            submitLabel: c.submitLabel || 'Submit', allowMultiple: !!c.allowMultiple,
            postResponsesTo: c.postResponsesTo || null, responseCount: 0, respondedUserIds: [], closed: false,
          },
        });
        return { kind: 'wait', output: { messageId: m.id, channel: cid } };
      }
      case 'request_approval': {
        const a = c.approver ?? {};
        const approverId = a.kind === 'user' ? resolveUser(wf, a.userId, context, now)
          : a.kind === 'trigger_user' ? resolveUser(wf, context.trigger.user ?? '', context, now)
          : resolveUser(wf, a.value, context, now);
        const cid = c.channelId ? resolveChannel(wf, c.channelId, context, now).id
          : ctx.core.openDm(wf.workspace_id, botUserId(wf.workspace_id), [approverId]).id;
        const text = render(String(c.text ?? ''), context, now, renderOpts());
        const m = post(wf, run, cid, `*Approval requested* from <@${approverId}>\n${text}`, {
          subtype: 'workflow_approval',
          meta: {
            kind: 'approval', runId: run.id, stepId: step.id, approverId, requestedBy: context.trigger.user ?? null,
            text, status: 'pending', decidedBy: null, decidedAt: null, note: '',
          },
        });
        db.prepare('INSERT INTO workflow_approvals (id, run_id, step_id, message_id, approver_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(ctx.ids.next('WA'), run.id, step.id, m.id, approverId, now);
        return { kind: 'wait', output: { messageId: m.id, approver: approverId } };
      }
      case 'add_reaction': {
        const mid = String(renderValue(c.messageId, context, now) ?? '').trim();
        const row = mid ? messages.getRow(mid) : null;
        if (!row || row.deleted_at) throw new StepError('Message to react to was not found');
        const conv = access.getConversation(row.conversation_id)!;
        if (conv.workspace_id !== wf.workspace_id) throw new StepError('Message to react to was not found');
        const emoji = render(String(c.emoji ?? ''), context, now).trim().replace(/^:|:$/g, '');
        if (!emoji) throw new StepError('No emoji chosen');
        await reactAsBot(wf, run, row, emoji);
        return { kind: 'next', output: { emoji } };
      }
      case 'create_channel': {
        const name = render(String(c.name ?? ''), context, now).trim().toLowerCase().replace(/\s+/g, '-');
        let conv;
        try {
          conv = withOrigin(wf.id, run.depth, () => ctx.core.createChannel(wf.workspace_id, wf.owner_id, {
            name, isPrivate: !!c.isPrivate, topic: render(String(c.topic ?? ''), context, now).slice(0, 250),
          }));
        } catch (e: any) { throw new StepError(e.message); }
        return { kind: 'next', output: { channel: conv.id, channelName: conv.name } };
      }
      case 'invite_to_channel': {
        const conv = resolveChannel(wf, c.channelId, context, now);
        if (conv.kind !== 'channel') throw new StepError('People can only be invited to channels');
        const ids = new Set<string>();
        for (const raw of (c.userIds ?? []) as any[]) {
          const v = renderValue(raw, context, now);
          for (const x of Array.isArray(v) ? v : String(v ?? '').split(/[\s,]+/)) {
            const id = String(x).trim().replace(/^<@(.+)>$/, '$1');
            if (id) ids.add(id);
          }
        }
        let invited = 0;
        for (const uid of ids) {
          if (!USER_ID_RE.test(uid) || !access.workspaceMember(wf.workspace_id, uid)) throw new StepError(`Person ${uid} not found in this workspace`);
          if (withOrigin(wf.id, run.depth, () => ctx.core.addMember(conv.id, uid, botUserId(wf.workspace_id)))) invited++;
        }
        return { kind: 'next', output: { invited } };
      }
      case 'update_topic': {
        const conv = resolveChannel(wf, c.channelId, context, now);
        if (conv.kind !== 'channel') throw new StepError('Only channels have topics');
        const topic = render(String(c.topic ?? ''), context, now).trim().slice(0, 250);
        db.prepare('UPDATE conversations SET topic = ? WHERE id = ?').run(topic, conv.id);
        withOrigin(wf.id, run.depth, () => bus.emit({
          type: 'conversation.updated', workspaceId: conv.workspace_id, conversationId: conv.id, actorId: botUserId(wf.workspace_id),
          payload: { conversation: loadConversation(db, wf.owner_id, conv.id, true) },
        }));
        return { kind: 'next', output: { topic } };
      }
      case 'delay': {
        let wakeAt: number;
        if (c.mode === 'until') {
          const v = renderValue(c.at, context, now);
          wakeAt = typeof v === 'number' ? v : /^\d+$/.test(String(v)) ? Number(v) : Date.parse(String(v));
          if (!Number.isFinite(wakeAt)) throw new StepError(`"${v}" is not a date and time`);
        } else {
          const ms = Number(c.amount) * (UNIT_MS[c.unit] ?? NaN);
          if (!Number.isFinite(ms) || ms <= 0) throw new StepError('Invalid delay');
          wakeAt = now + ms;
        }
        if (wakeAt <= now) return { kind: 'next', output: { resumedAt: now } };
        return { kind: 'wait', wakeAt, output: { wakeAt } };
      }
      case 'http_request': return { kind: 'next', output: await httpRequest(c, context, now) };
      case 'set_variable': {
        const name = String(c.name ?? '');
        if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(name)) throw new StepError('Invalid variable name');
        const value = renderValue(c.value ?? '', context, now);
        context.vars[name] = value;
        return { kind: 'next', output: { value } };
      }
      case 'branch': {
        const result = evalBranch(c as BranchConfig, context, now);
        return { kind: 'next', output: { result }, arm: result ? 'then' : 'else' };
      }
      case 'end': return { kind: 'end', output: {} };
      default: throw new StepError(`Unknown step type ${(step as any).type}`);
    }
  }

  async function reactAsBot(wf: WorkflowRow, run: RunRow, row: MessageRow, emoji: string) {
    const bot = botUserId(wf.workspace_id);
    const conv = access.getConversation(row.conversation_id)!;
    if (!access.isConversationMember(conv.id, bot)) {
      if (conv.kind !== 'channel') throw new StepError('Workflows can only react in channels');
      if (conv.is_private && !access.isConversationMember(conv.id, wf.owner_id)) throw new StepError('The workflow owner cannot access that channel');
      withOrigin(wf.id, run.depth, () => ctx.core.addMember(conv.id, bot, bot));
    }
    let token = botSessions.get(bot);
    let retried = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!token) { token = ctx.auth.createSession(bot).token; botSessions.set(bot, token); }
      const prev = origin;
      origin = { workflowId: wf.id, depth: run.depth };
      let res;
      try {
        res = await app.inject({
          method: 'POST', url: `/api/messages/${row.id}/reactions`, payload: { emoji },
          headers: { cookie: `fs_session=${token}` },
        });
      } finally { origin = prev; }
      if (res.statusCode === 401) { botSessions.delete(bot); token = undefined; continue; }
      if (res.statusCode === 404 && /No route/.test(res.body)) throw new StepError('Reactions are not available');
      if (res.statusCode >= 400) {
        let msg = `Reaction failed (${res.statusCode})`;
        try { msg = res.json().error?.message ?? msg; } catch { /* keep */ }
        throw new StepError(msg);
      }
      // The reactions endpoint toggles: if the bot had already reacted, add it back.
      let added = true;
      try { added = res.json().added !== false; } catch { /* assume added */ }
      if (!added && !retried) { retried = true; continue; }
      return;
    }
    throw new StepError('Could not authenticate the workflow bot');
  }

  async function httpRequest(c: any, context: RunContext, now: number) {
    const urlStr = render(String(c.url ?? ''), context, now).trim();
    let url: URL;
    try { url = new URL(urlStr); } catch { throw new StepError(`Invalid URL "${urlStr}"`); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new StepError('Only http:// and https:// URLs are allowed');
    if (!allowPrivateHttp) await assertPublicHost(url.hostname);
    const method = String(c.method ?? 'GET').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new StepError(`Unsupported method ${method}`);
    const headers: Record<string, string> = {};
    for (const h of (c.headers ?? []) as { key: string; value: string }[]) {
      const k = String(h?.key ?? '').trim();
      if (k) headers[k] = render(String(h.value ?? ''), context, now);
    }
    let body: string | undefined;
    if (method !== 'GET' && c.body != null && String(c.body).length) {
      body = render(String(c.body), context, now);
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
        let isJson = false; try { JSON.parse(body); isJson = true; } catch { /* text */ }
        headers['Content-Type'] = isJson ? 'application/json' : 'text/plain';
      }
    }
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(httpTimeoutMs) });
    } catch (e: any) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new StepError(`Request timed out after ${httpTimeoutMs / 1000} s`);
      throw new StepError(`Request failed: ${e?.cause?.message ?? e?.message ?? e}`);
    }
    let text = await res.text();
    if (text.length > MAX_HTTP_BODY) text = text.slice(0, MAX_HTTP_BODY);
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = null; }
    if (c.failOnError && !res.ok) throw new StepError(`Server answered ${res.status}`);
    return { status: res.status, ok: res.ok, body: json ?? text, json };
  }

  // ------------------------------------------------------------------ triggers

  function publishedWithTrigger(workspaceId: string | null, type: string): { wf: WorkflowRow; def: Definition }[] {
    const rows = (workspaceId
      ? db.prepare("SELECT * FROM workflows WHERE workspace_id = ? AND status = 'published' AND trigger_type = ?").all(workspaceId, type)
      : db.prepare("SELECT * FROM workflows WHERE status = 'published' AND trigger_type = ?").all(type)) as unknown as WorkflowRow[];
    const out: { wf: WorkflowRow; def: Definition }[] = [];
    for (const wf of rows) {
      const def = publishedDefinition(wf);
      if (def && def.trigger.type === type) out.push({ wf, def });
    }
    return out;
  }

  /** Start a run from an event unless it was caused by this same workflow or the chain is too deep. */
  function fireFromEvent(wf: WorkflowRow, trigger: Record<string, any>, triggerUserId: string | null, sourceWorkflowId: string | null, sourceDepth: number | null) {
    if (sourceWorkflowId === wf.id) return null;
    const depth = sourceDepth == null ? 0 : sourceDepth + 1;
    if (depth > MAX_CHAIN_DEPTH) return null;
    return startRun(wf, { version: wf.published_version!, trigger, triggerUserId, depth });
  }

  function messageSummary(row: MessageRow | null) {
    if (!row) return null;
    return { id: row.id, text: row.text, user: row.user_id, threadRootId: row.thread_root_id };
  }

  bus.on('message.created', (e) => {
    const m = e.payload?.message;
    if (!m || !e.workspaceId || m.deletedAt) return;
    if (m.subtype === 'workflow_form' || m.subtype === 'workflow_approval') return;
    const src = m.meta?.workflow ?? (origin ? { id: origin.workflowId, depth: origin.depth } : null);
    for (const { wf, def } of publishedWithTrigger(e.workspaceId, 'message')) {
      const t = def.trigger;
      if (t.channelId !== m.conversationId) continue;
      const text: string = m.text ?? '';
      const mode = t.match ?? 'contains';
      let ok = mode === 'any';
      if (mode === 'contains') ok = text.toLowerCase().includes((t.pattern ?? '').toLowerCase());
      if (mode === 'regex') { try { ok = new RegExp(t.pattern ?? '', 'i').test(text); } catch { ok = false; } }
      if (!ok) continue;
      fireFromEvent(wf, {
        user: m.userId, channel: m.conversationId,
        message: { id: m.id, text, user: m.userId, threadRootId: m.threadRootId },
      }, m.userId, src?.id ?? null, src?.depth ?? null);
    }
  });

  bus.on('reaction.added', (e) => {
    if (!e.workspaceId) return;
    const p = e.payload ?? {};
    const emoji: string = String(p.emoji ?? p.reaction?.emoji ?? '').replace(/^:|:$/g, '');
    const userId: string | null = p.userId ?? p.reaction?.userId ?? e.actorId ?? null;
    const messageId: string | null = p.messageId ?? p.message?.id ?? p.reaction?.messageId ?? null;
    if (!emoji || !userId || !messageId) return;
    if (isBot(userId)) return; // workflow / app reactions never start workflows
    const row = messages.getRow(messageId);
    const channelId = e.conversationId ?? p.conversationId ?? p.message?.conversationId ?? row?.conversation_id;
    for (const { wf, def } of publishedWithTrigger(e.workspaceId, 'reaction')) {
      const t = def.trigger;
      if (t.channelId !== channelId) continue;
      if (String(t.emoji ?? '').replace(/^:|:$/g, '') !== emoji) continue;
      const msgMeta = row?.meta_json ? (() => { try { return JSON.parse(row.meta_json!); } catch { return null; } })() : null;
      fireFromEvent(wf, { user: userId, channel: channelId, emoji, message: messageSummary(row) }, userId,
        origin?.workflowId ?? null, origin?.depth ?? (msgMeta?.workflow?.depth ?? null));
    }
  });

  bus.on('member.joined', (e) => {
    const p = e.payload ?? {};
    const uid: string | undefined = p.userId;
    const cid: string | undefined = p.conversationId ?? e.conversationId ?? undefined;
    if (!uid || !cid || !e.workspaceId || isBot(uid)) return;
    for (const { wf, def } of publishedWithTrigger(e.workspaceId, 'member_joined')) {
      if (def.trigger.channelId !== cid) continue;
      fireFromEvent(wf, { user: uid, channel: cid }, uid, origin?.workflowId ?? null, origin?.depth ?? null);
    }
  });

  function fireWebhook(secret: string, body: any) {
    const wf = db.prepare('SELECT * FROM workflows WHERE webhook_secret = ?').get(secret) as unknown as WorkflowRow | undefined;
    if (!wf) throw notFound('Unknown webhook');
    const def = publishedDefinition(wf);
    if (!def || def.trigger.type !== 'webhook') throw notFound('This workflow is not accepting webhooks');
    if (body == null || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Send a JSON object');
    return startRun(wf, { version: wf.published_version!, trigger: { webhook: body }, triggerUserId: null });
  }

  // ------------------------------------------------------------------ scheduler

  function fireSchedules(now: number) {
    const minute = Math.floor(now / 60_000);
    for (const { wf, def } of publishedWithTrigger(null, 'schedule')) {
      const s = def.trigger.schedule;
      if (!s) continue;
      const state = wf.sched_state_json ? JSON.parse(wf.sched_state_json) : {};
      if (state.version !== wf.published_version) { state.version = wf.published_version; state.checkedMinute = minute; state.fired = false; }
      let fire = false;
      try {
        if (s.kind === 'once') {
          if (!state.fired && now >= s.at) { fire = true; state.fired = true; }
        } else {
          const from = Math.max((state.checkedMinute ?? minute - 1) + 1, minute - 60);
          for (let m = from; m <= minute && !fire; m++) {
            if (scheduleMatchesMinute(s, m * 60_000, def.trigger.tzOffset ?? 0)) fire = true;
          }
        }
      } catch (err) {
        app.log.warn({ err, workflowId: wf.id }, 'invalid workflow schedule');
      }
      state.checkedMinute = Math.max(state.checkedMinute ?? minute, minute);
      db.prepare('UPDATE workflows SET sched_state_json = ? WHERE id = ?').run(JSON.stringify(state), wf.id);
      if (fire) startRun(wf, { version: wf.published_version!, trigger: { firedAt: new Date(now).toISOString() }, triggerUserId: null });
    }
  }

  function initScheduleState(wf: WorkflowRow) {
    db.prepare('UPDATE workflows SET sched_state_json = ? WHERE id = ?')
      .run(JSON.stringify({ version: wf.published_version, checkedMinute: Math.floor(clock() / 60_000), fired: false }), wf.id);
  }

  function nextScheduledRun(def: Definition): number | null {
    if (def.trigger.type !== 'schedule' || !def.trigger.schedule) return null;
    try { return nextFireAt(def.trigger.schedule, clock(), def.trigger.tzOffset ?? 0); } catch { return null; }
  }

  /** One scheduler pass: resume due delays, fire due schedules. */
  function tick() {
    const now = clock();
    const due = db.prepare("SELECT id, waiting_step_id FROM workflow_runs WHERE status = 'waiting' AND wake_at IS NOT NULL AND wake_at <= ?").all(now) as any[];
    for (const r of due) completeWaiting(r.id, r.waiting_step_id, { resumedAt: now });
    fireSchedules(now);
  }

  /** After a restart: continue runs that were mid-step. Waiting runs resume via tick / user action. */
  function resumeOnBoot() {
    const rows = db.prepare("SELECT id FROM workflow_runs WHERE status = 'running'").all() as any[];
    for (const r of rows) kick(r.id);
  }

  // ------------------------------------------------------------------ forms & approvals

  function validateFormValues(fields: FormField[], values: Record<string, any>, workspaceId: string) {
    const out: Record<string, any> = {};
    for (const f of fields) {
      let v = values?.[f.id];
      const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
      if (empty) {
        if (f.required) throw badRequest(`"${f.label}" is required`);
        out[f.id] = f.type === 'multi_select' ? [] : '';
        continue;
      }
      switch (f.type) {
        case 'short_text': case 'long_text':
          v = String(v); if (v.length > (f.type === 'short_text' ? 500 : 4000)) throw badRequest(`"${f.label}" is too long`); break;
        case 'number': {
          const n = Number(v); if (!Number.isFinite(n)) throw badRequest(`"${f.label}" must be a number`); v = n; break;
        }
        case 'date':
          v = String(v); if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw badRequest(`"${f.label}" must be a date`); break;
        case 'select':
          v = String(v); if (!(f.options ?? []).includes(v)) throw badRequest(`Pick one of the options for "${f.label}"`); break;
        case 'multi_select':
          if (!Array.isArray(v)) v = [v];
          v = [...new Set((v as any[]).map(String))];
          if ((v as string[]).some((x) => !(f.options ?? []).includes(x))) throw badRequest(`Pick from the options for "${f.label}"`);
          break;
        case 'user':
          v = String(v); if (!access.workspaceMember(workspaceId, v)) throw badRequest(`Pick a person for "${f.label}"`); break;
      }
      out[f.id] = v;
    }
    return out;
  }

  function submitForm(messageId: string, userId: string, values: Record<string, any>) {
    const row = messages.getRow(messageId);
    if (!row || row.deleted_at || row.subtype !== 'workflow_form') throw notFound('Form not found');
    const { conv } = access.requireConversationRead(row.conversation_id, userId);
    const meta = JSON.parse(row.meta_json ?? '{}');
    if (meta.closed) throw conflict('This form is closed', 'form_closed');
    const run = getRun(meta.runId);
    if (!run) throw conflict('This form is closed', 'form_closed');
    const prior = db.prepare('SELECT COUNT(*) AS n FROM workflow_form_responses WHERE message_id = ? AND user_id = ?').get(messageId, userId) as any;
    if (prior.n > 0 && !meta.allowMultiple) throw conflict('You already submitted this form', 'already_submitted');
    const clean = validateFormValues(meta.fields ?? [], values ?? {}, conv.workspace_id);
    const now = clock();
    db.prepare('INSERT INTO workflow_form_responses (id, run_id, step_id, message_id, user_id, values_json, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.ids.next('WFR'), run.id, meta.stepId, messageId, userId, JSON.stringify(clean), now);
    updateMeta(messageId, (m) => ({
      ...m, responseCount: (m.responseCount ?? 0) + 1,
      respondedUserIds: [...new Set([...(m.respondedUserIds ?? []), userId])],
    }));
    const wf = getWorkflow(run.workflow_id);
    if (meta.postResponsesTo && wf) {
      const lines = (meta.fields as FormField[]).map((f) => {
        const v = clean[f.id];
        const shown = f.type === 'user' && v ? `<@${v}>` : Array.isArray(v) ? v.join(', ') : String(v ?? '');
        return `*${f.label}:* ${shown || '—'}`;
      });
      const text = `<@${userId}> submitted *${meta.title}*\n${lines.join('\n')}`;
      try {
        if (meta.postResponsesTo === 'same') post(wf, run, row.conversation_id, text, { threadRootId: row.id });
        else post(wf, run, resolveChannel(wf, meta.postResponsesTo, JSON.parse(run.context_json), now).id, text);
      } catch (err) { app.log.warn({ err }, 'could not post form response'); }
    }
    completeWaiting(run.id, meta.stepId, { ...clean, submittedBy: userId, submittedAt: new Date(now).toISOString() });
    return { values: clean, submittedAt: now };
  }

  function decideApproval(messageId: string, userId: string, decision: 'approve' | 'deny', note: string) {
    const row = messages.getRow(messageId);
    if (!row || row.deleted_at || row.subtype !== 'workflow_approval') throw notFound('Approval not found');
    access.requireConversationRead(row.conversation_id, userId);
    const ap = db.prepare('SELECT * FROM workflow_approvals WHERE message_id = ?').get(messageId) as any;
    if (!ap) throw notFound('Approval not found');
    if (ap.approver_id !== userId) throw forbidden('Only the designated approver can respond');
    if (ap.status !== 'pending') throw conflict('This request was already handled', 'already_decided');
    const now = clock();
    const status = decision === 'approve' ? 'approved' : 'denied';
    db.prepare('UPDATE workflow_approvals SET status = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ?').run(status, userId, now, note, ap.id);
    updateMeta(messageId, (m) => ({ ...m, status, decidedBy: userId, decidedAt: now, note }));
    completeWaiting(ap.run_id, ap.step_id, {
      outcome: status, approver: ap.approver_id, decidedBy: userId, decidedAt: new Date(now).toISOString(), note,
    }, status === 'approved' ? 'then' : 'else');
    return { status, decidedAt: now };
  }

  // ------------------------------------------------------------------ SSRF guard

  async function assertPublicHost(hostname: string) {
    const host = hostname.replace(/^\[|\]$/g, '');
    if (/^localhost$/i.test(host) || /\.localhost$/i.test(host)) throw new StepError('Requests to private network addresses are blocked');
    let addrs: string[];
    if (isIP(host)) addrs = [host];
    else {
      try { addrs = (await lookup(host, { all: true })).map((a) => a.address); } catch { throw new StepError(`Could not resolve ${host}`); }
    }
    if (addrs.some(isPrivateAddress)) throw new StepError('Requests to private network addresses are blocked');
  }

  const engine = {
    now: () => clock(),
    setClock(fn: () => number) { clock = fn; },
    setAllowPrivateHttp(v: boolean) { allowPrivateHttp = v; },
    setHttpTimeout(ms: number) { httpTimeoutMs = ms; },
    getWorkflow, getRun, ensureSnapshot, loadDefinition, publishedDefinition, botUserId,
    startRun, completeWaiting, cancelRun, serializeRun, idle, tick, resumeOnBoot,
    submitForm, decideApproval, fireWebhook, initScheduleState, nextScheduledRun,
    isUserId: (s: string) => USER_ID_RE.test(s), isConvId: (s: string) => CONV_ID_RE.test(s),
  };
  engines.set(ctx, engine as any);
  return engine;
}

export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254)
    || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}
