import type { FastifyInstance } from 'fastify';
import type { ModuleContext } from '../../context';
import { me } from '../../auth';
import { parse, z } from '../../validate';
import { badRequest, forbidden, HttpError, notFound } from '../../errors';
import { randomToken } from '../../ids';
import type { Engine } from './engine';
import type { Step, Trigger, WorkflowRow } from './types';
import { stepsSchema, structuralError, triggerSchema, validateDefinition } from './definition';
import { TEMPLATES } from './templates';

const createBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  emoji: z.string().max(16).optional(),
  templateId: z.string().optional(),
  trigger: triggerSchema.optional(),
  steps: stepsSchema.optional(),
});

const patchBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  emoji: z.string().max(16).optional(),
  trigger: triggerSchema.optional(),
  steps: stepsSchema.optional(),
});

const runBody = z.object({
  conversationId: z.string().optional(),
  test: z.boolean().optional(),
  /** Test runs: sample trigger data (e.g. webhook body, message text). */
  sample: z.record(z.any()).optional(),
});

const formBody = z.object({ values: z.record(z.any()) });
const approvalBody = z.object({ decision: z.enum(['approve', 'deny']), note: z.string().max(1000).optional() });

class IssuesError extends HttpError {
  constructor(public issues: { stepId?: string; message: string }[]) {
    super(400, 'invalid_workflow', issues[0]?.message ?? 'The workflow is incomplete');
  }
}

export function registerWorkflowRoutes(app: FastifyInstance, ctx: ModuleContext, engine: Engine) {
  const { db, access } = ctx;
  const pre = { preHandler: ctx.auth.requireUser };

  function canEdit(wf: WorkflowRow, userId: string) {
    if (wf.owner_id === userId) return true;
    const m = access.workspaceMember(wf.workspace_id, userId);
    return !!m && (m.role === 'owner' || m.role === 'admin');
  }

  function loadFor(id: string, userId: string, edit = false): WorkflowRow {
    const wf = engine.getWorkflow(id);
    if (!wf || !access.workspaceMember(wf.workspace_id, userId)) throw notFound('Workflow not found');
    const editable = canEdit(wf, userId);
    if (!editable && wf.status !== 'published') throw notFound('Workflow not found');
    if (edit && !editable) throw forbidden('Only the workflow owner or a workspace admin can do that');
    return wf;
  }

  function lastRun(wfId: string) {
    const r = db.prepare('SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC, id DESC LIMIT 1').get(wfId) as any;
    return r ? engine.serializeRun(r) : null;
  }

  function serialize(wf: WorkflowRow, viewerId: string, full = false) {
    const editable = canEdit(wf, viewerId);
    const trigger = JSON.parse(wf.trigger_json) as Trigger;
    const out: any = {
      id: wf.id, workspaceId: wf.workspace_id, name: wf.name, description: wf.description, emoji: wf.emoji,
      ownerId: wf.owner_id, status: wf.status, triggerType: wf.trigger_type, version: wf.version,
      publishedVersion: wf.published_version,
      hasUnpublishedChanges: wf.status === 'published' && wf.published_version !== wf.version,
      canEdit: editable, createdAt: wf.created_at, updatedAt: wf.updated_at,
    };
    if (editable) out.lastRun = lastRun(wf.id);
    if (full || editable) {
      out.trigger = trigger;
      if (full) out.steps = JSON.parse(wf.steps_json);
    }
    if (editable) {
      out.webhookPath = `/api/hooks/workflows/${wf.webhook_secret}`;
      const def = engine.publishedDefinition(wf);
      out.nextRunAt = def ? engine.nextScheduledRun(def) : null;
    }
    return out;
  }

  const validationEnv = (workspaceId: string) => ({
    channelExists: (id: string) => {
      const c = access.getConversation(id);
      return !!c && c.workspace_id === workspaceId && !c.is_archived;
    },
    userExists: (id: string) => !!access.workspaceMember(workspaceId, id),
  });

  function issuesFor(wf: WorkflowRow) {
    return validateDefinition(JSON.parse(wf.trigger_json), JSON.parse(wf.steps_json), validationEnv(wf.workspace_id));
  }

  function sendIssues(reply: any, err: IssuesError) {
    return reply.status(400).send({ error: { code: err.code, message: err.message, issues: err.issues } });
  }

  // ---- templates ----
  app.get<{ Params: { wid: string } }>('/api/w/:wid/workflow-templates', pre, async (req) => {
    access.requireWorkspaceMember(req.params.wid, me(req).id);
    return { templates: TEMPLATES };
  });

  // ---- list / create ----
  app.get<{ Params: { wid: string }; Querystring: { scope?: string } }>('/api/w/:wid/workflows', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceMember(req.params.wid, user.id);
    const scope = req.query.scope === 'workspace' ? 'workspace' : 'mine';
    const rows = (scope === 'mine'
      ? db.prepare('SELECT * FROM workflows WHERE workspace_id = ? AND owner_id = ? ORDER BY updated_at DESC').all(req.params.wid, user.id)
      : db.prepare("SELECT * FROM workflows WHERE workspace_id = ? AND (status = 'published' OR owner_id = ?) ORDER BY name COLLATE NOCASE").all(req.params.wid, user.id)
    ) as unknown as WorkflowRow[];
    return { workflows: rows.map((w) => serialize(w, user.id)) };
  });

  app.get<{ Params: { wid: string }; Querystring: { conversationId?: string } }>('/api/w/:wid/workflow-shortcuts', pre, async (req) => {
    const user = me(req);
    access.requireWorkspaceMember(req.params.wid, user.id);
    const rows = db.prepare("SELECT * FROM workflows WHERE workspace_id = ? AND status = 'published' AND trigger_type = 'manual' ORDER BY name COLLATE NOCASE")
      .all(req.params.wid) as unknown as WorkflowRow[];
    const cid = req.query.conversationId;
    const out = [];
    for (const wf of rows) {
      const def = engine.publishedDefinition(wf);
      if (!def) continue;
      const allowed = def.trigger.channelIds ?? [];
      if (allowed.length && (!cid || !allowed.includes(cid))) continue;
      out.push({ id: wf.id, name: wf.name, emoji: wf.emoji, description: wf.description });
    }
    return { shortcuts: out };
  });

  app.post<{ Params: { wid: string } }>('/api/w/:wid/workflows', pre, async (req) => {
    const user = me(req);
    const m = access.requireWorkspaceMember(req.params.wid, user.id);
    if (m.role === 'guest') throw forbidden('Guests cannot create workflows');
    const body = parse(createBody, req.body);
    const tpl = body.templateId ? TEMPLATES.find((t) => t.id === body.templateId) : null;
    if (body.templateId && !tpl) throw badRequest('Unknown template');
    const trigger: Trigger = body.trigger ?? tpl?.trigger ?? { type: 'manual', channelIds: [] };
    const steps: Step[] = body.steps ?? tpl?.steps ?? [];
    const err = structuralError(steps);
    if (err) throw badRequest(err);
    const id = ctx.ids.next('WF');
    const now = Date.now();
    db.prepare(
      `INSERT INTO workflows (id, workspace_id, name, description, emoji, owner_id, status, trigger_type, trigger_json, steps_json,
        version, webhook_secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, 1, ?, ?, ?)`,
    ).run(id, req.params.wid, body.name ?? tpl?.name ?? 'Untitled workflow', body.description ?? tpl?.description ?? '',
      body.emoji ?? tpl?.emoji ?? '⚡', user.id, trigger.type, JSON.stringify(trigger), JSON.stringify(steps), randomToken(24), now, now);
    return { workflow: serialize(engine.getWorkflow(id)!, user.id, true) };
  });

  // ---- single workflow ----
  app.get<{ Params: { id: string } }>('/api/workflows/:id', pre, async (req) => {
    const user = me(req);
    const wf = loadFor(req.params.id, user.id);
    if (!canEdit(wf, user.id)) return { workflow: serialize(wf, user.id) };
    return { workflow: serialize(wf, user.id, true), issues: issuesFor(wf) };
  });

  app.patch<{ Params: { id: string } }>('/api/workflows/:id', pre, async (req) => {
    const user = me(req);
    const wf = loadFor(req.params.id, user.id, true);
    const body = parse(patchBody, req.body);
    if (body.steps) { const err = structuralError(body.steps); if (err) throw badRequest(err); }
    const trigger = body.trigger ?? JSON.parse(wf.trigger_json);
    const triggerJson = JSON.stringify(trigger);
    const stepsJson = body.steps ? JSON.stringify(body.steps) : wf.steps_json;
    const defChanged = triggerJson !== wf.trigger_json || stepsJson !== wf.steps_json;
    db.prepare(
      `UPDATE workflows SET name = ?, description = ?, emoji = ?, trigger_type = ?, trigger_json = ?, steps_json = ?,
        version = version + ?, updated_at = ? WHERE id = ?`,
    ).run(body.name ?? wf.name, body.description ?? wf.description, body.emoji ?? wf.emoji,
      // a published workflow keeps matching events of its published trigger type until republished
      wf.status === 'published' ? wf.trigger_type : trigger.type,
      triggerJson, stepsJson, defChanged ? 1 : 0, Date.now(), wf.id);
    const updated = engine.getWorkflow(wf.id)!;
    return { workflow: serialize(updated, user.id, true), issues: issuesFor(updated) };
  });

  app.delete<{ Params: { id: string } }>('/api/workflows/:id', pre, async (req) => {
    const user = me(req);
    const wf = loadFor(req.params.id, user.id, true);
    const active = db.prepare("SELECT id FROM workflow_runs WHERE workflow_id = ? AND status IN ('running','waiting')").all(wf.id) as any[];
    for (const r of active) engine.cancelRun(r.id);
    db.prepare('DELETE FROM workflows WHERE id = ?').run(wf.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/workflows/:id/validate', pre, async (req) => {
    const user = me(req);
    const wf = loadFor(req.params.id, user.id, true);
    return { issues: issuesFor(wf) };
  });

  app.post<{ Params: { id: string } }>('/api/workflows/:id/publish', pre, async (req, reply) => {
    const user = me(req);
    const wf = loadFor(req.params.id, user.id, true);
    const issues = issuesFor(wf);
    if (issues.length) return sendIssues(reply, new IssuesError(issues));
    engine.ensureSnapshot(wf);
    const trigger = JSON.parse(wf.trigger_json) as Trigger;
    db.prepare("UPDATE workflows SET status = 'published', published_version = version, trigger_type = ?, updated_at = ? WHERE id = ?")
      .run(trigger.type, Date.now(), wf.id);
    const updated = engine.getWorkflow(wf.id)!;
    engine.initScheduleState(updated);
    return { workflow: serialize(updated, user.id, true) };
  });

  app.post<{ Params: { id: string } }>('/api/workflows/:id/unpublish', pre, async (req) => {
    const user = me(req);
    const wf = loadFor(req.params.id, user.id, true);
    db.prepare("UPDATE workflows SET status = 'draft', updated_at = ? WHERE id = ?").run(Date.now(), wf.id);
    return { workflow: serialize(engine.getWorkflow(wf.id)!, user.id, true) };
  });

  app.post<{ Params: { id: string } }>('/api/workflows/:id/webhook-secret', pre, async (req) => {
    const user = me(req);
    const wf = loadFor(req.params.id, user.id, true);
    db.prepare('UPDATE workflows SET webhook_secret = ? WHERE id = ?').run(randomToken(24), wf.id);
    return { workflow: serialize(engine.getWorkflow(wf.id)!, user.id, true) };
  });

  // ---- running ----
  app.post<{ Params: { id: string } }>('/api/workflows/:id/run', pre, async (req, reply) => {
    const user = me(req);
    const body = parse(runBody, req.body);
    const wf = loadFor(req.params.id, user.id, !!body.test);
    let channel: string | null = null;
    if (body.conversationId) {
      const { conv } = access.requireConversationRead(body.conversationId, user.id);
      if (conv.workspace_id !== wf.workspace_id) throw notFound('Conversation not found');
      channel = conv.id;
    }
    let version: number;
    let trigger: Trigger;
    if (body.test) {
      const issues = issuesFor(wf);
      if (issues.length) return sendIssues(reply, new IssuesError(issues));
      engine.ensureSnapshot(wf);
      version = wf.version;
      trigger = JSON.parse(wf.trigger_json);
    } else {
      const def = engine.publishedDefinition(wf);
      if (!def) throw badRequest('This workflow is not published');
      if (def.trigger.type !== 'manual') throw badRequest('This workflow starts automatically and cannot be run by hand');
      const allowed = def.trigger.channelIds ?? [];
      if (allowed.length && (!channel || !allowed.includes(channel))) throw forbidden('This workflow is not available in this conversation');
      version = wf.published_version!;
      trigger = def.trigger;
    }
    const sample = body.sample ?? {};
    const triggerCtx: Record<string, any> = { user: user.id, channel: channel ?? trigger.channelId ?? null };
    if (body.test) {
      if (trigger.type === 'webhook') triggerCtx.webhook = sample.webhook ?? sample;
      if (trigger.type === 'schedule') { triggerCtx.firedAt = new Date(engine.now()).toISOString(); }
      if (trigger.type === 'reaction') triggerCtx.emoji = trigger.emoji ?? '';
      if (trigger.type === 'reaction' || trigger.type === 'message') {
        triggerCtx.message = { id: sample.messageId ?? '', text: sample.text ?? 'Sample message text', user: user.id };
      }
    }
    const run = engine.startRun(wf, { version, trigger: triggerCtx, triggerUserId: user.id, isTest: !!body.test });
    return { run: engine.serializeRun(run) };
  });

  app.post<{ Params: { secret: string } }>('/api/hooks/workflows/:secret', async (req) => {
    const run = engine.fireWebhook(req.params.secret, req.body);
    return { ok: true, runId: run.id };
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/api/workflows/:id/runs', pre, async (req) => {
    const user = me(req);
    const wf = loadFor(req.params.id, user.id, true);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 30) || 30, 1), 200);
    const rows = db.prepare('SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC, id DESC LIMIT ?').all(wf.id, limit) as any[];
    return { runs: rows.map((r) => engine.serializeRun(r)) };
  });

  function loadRun(id: string, userId: string) {
    const run = engine.getRun(id);
    if (!run) throw notFound('Run not found');
    loadFor(run.workflow_id, userId, true);
    return run;
  }

  app.get<{ Params: { rid: string } }>('/api/workflow-runs/:rid', pre, async (req) => {
    const run = loadRun(req.params.rid, me(req).id);
    return { run: engine.serializeRun(run, true) };
  });

  app.post<{ Params: { rid: string } }>('/api/workflow-runs/:rid/cancel', pre, async (req) => {
    const run = loadRun(req.params.rid, me(req).id);
    engine.cancelRun(run.id);
    return { run: engine.serializeRun(engine.getRun(run.id)!, true) };
  });

  // ---- interactive messages ----
  app.post<{ Params: { mid: string } }>('/api/workflow-messages/:mid/form', pre, async (req) => {
    const user = me(req);
    const body = parse(formBody, req.body);
    const res = engine.submitForm(req.params.mid, user.id, body.values);
    return { ok: true, ...res };
  });

  app.get<{ Params: { mid: string } }>('/api/workflow-messages/:mid/form', pre, async (req) => {
    const user = me(req);
    const row = ctx.messages.getRow(req.params.mid);
    if (!row || row.subtype !== 'workflow_form') throw notFound('Form not found');
    access.requireConversationRead(row.conversation_id, user.id);
    const mine = (db.prepare('SELECT values_json, submitted_at FROM workflow_form_responses WHERE message_id = ? AND user_id = ? ORDER BY submitted_at')
      .all(row.id, user.id) as any[]).map((r) => ({ values: JSON.parse(r.values_json), submittedAt: r.submitted_at }));
    return { responses: mine };
  });

  app.post<{ Params: { mid: string } }>('/api/workflow-messages/:mid/approval', pre, async (req) => {
    const user = me(req);
    const body = parse(approvalBody, req.body);
    const res = engine.decideApproval(req.params.mid, user.id, body.decision, body.note ?? '');
    return { ok: true, ...res };
  });
}
