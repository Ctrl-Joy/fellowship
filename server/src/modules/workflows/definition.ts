// Structural parsing (on save) and full validation (before publish / run) of workflow definitions.
import { z } from 'zod';
import type { Step, Trigger, StepType, FormField } from './types';
import { STEP_TYPES, CONTAINER_TYPES } from './types';
import { scheduleError } from './cron';
import { referencedVars, stepsBefore, walkSteps } from './variables';

export const MAX_STEPS = 100;
export const MAX_DEPTH = 6;
export const STEP_ID_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
export const FIELD_ID_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
export const VAR_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

const stepSchema: z.ZodType<Step, z.ZodTypeDef, any> = z.lazy(() => z.object({
  id: z.string().regex(STEP_ID_RE, 'Step ids must be letters, numbers or _'),
  type: z.enum(STEP_TYPES as [StepType, ...StepType[]]),
  name: z.string().max(80).optional(),
  config: z.record(z.any()).default({}),
  then: z.array(stepSchema).optional(),
  else: z.array(stepSchema).optional(),
}));

export const stepsSchema = z.array(stepSchema).max(MAX_STEPS);

export const triggerSchema = z.object({
  type: z.enum(['manual', 'reaction', 'member_joined', 'message', 'schedule', 'webhook']),
  channelIds: z.array(z.string()).max(50).optional(),
  channelId: z.string().optional(),
  emoji: z.string().max(64).optional(),
  match: z.enum(['any', 'contains', 'regex']).optional(),
  pattern: z.string().max(500).optional(),
  schedule: z.any().optional(),
  tzOffset: z.number().int().min(-14 * 60).max(14 * 60).optional(),
}).passthrough();

/** Fields each step type exposes as {{steps.<id>.<field>}} (forms add their field ids). */
export const STEP_OUTPUTS: Record<StepType, string[]> = {
  send_message: ['messageId', 'channel'],
  send_form: ['submittedBy', 'submittedAt', 'messageId', 'channel'],
  request_approval: ['outcome', 'approver', 'decidedBy', 'decidedAt', 'note', 'messageId'],
  add_reaction: ['emoji'],
  create_channel: ['channel', 'channelName'],
  invite_to_channel: ['invited'],
  update_topic: ['topic'],
  delay: ['resumedAt'],
  http_request: ['status', 'ok', 'body', 'json'],
  set_variable: ['value'],
  branch: ['result'],
  end: [],
};

/** Trigger variables (`trigger.<x>`) per trigger type. webhook allows any trigger.webhook.* path. */
export const TRIGGER_VARS: Record<Trigger['type'], string[]> = {
  manual: ['user', 'channel'],
  reaction: ['user', 'channel', 'emoji', 'message.id', 'message.text', 'message.user'],
  member_joined: ['user', 'channel'],
  message: ['user', 'channel', 'message.id', 'message.text', 'message.user'],
  schedule: ['firedAt'],
  webhook: ['webhook'],
};

export interface DefinitionIssue { stepId?: string; message: string }

function countSteps(steps: Step[]): { count: number; depth: number } {
  let count = 0; let depth = 0;
  walkSteps(steps, (_s, anc) => { count++; depth = Math.max(depth, anc.length + 1); });
  return { count, depth };
}

/** Structural checks used on every save. Returns the first problem or null. */
export function structuralError(steps: Step[]): string | null {
  const { count, depth } = countSteps(steps);
  if (count > MAX_STEPS) return `A workflow can have at most ${MAX_STEPS} steps`;
  if (depth > MAX_DEPTH) return `Branches can be nested at most ${MAX_DEPTH} levels deep`;
  const ids = new Set<string>();
  let dup: string | null = null;
  walkSteps(steps, (s) => {
    if (ids.has(s.id)) dup = s.id;
    ids.add(s.id);
    if (!CONTAINER_TYPES.includes(s.type) && (s.then?.length || s.else?.length)) dup = dup ?? `!${s.id}`;
  });
  if (dup) return (dup as string).startsWith('!') ? `Step ${(dup as string).slice(1)} cannot contain nested steps` : `Duplicate step id ${dup}`;
  return null;
}

function targetIssue(t: any, label: string): string | null {
  if (!t || typeof t !== 'object') return `Choose where to send the ${label}`;
  if (t.kind === 'channel') return t.channelId ? null : 'Choose a channel';
  if (t.kind === 'user') return t.userId ? null : 'Choose a person';
  if (t.kind === 'trigger_user' || t.kind === 'trigger_channel') return null;
  return `Choose where to send the ${label}`;
}

export interface ValidationEnv {
  channelExists(id: string): boolean;
  userExists(id: string): boolean;
}

/** Full validation (before publish / test run). Returns every issue found. */
export function validateDefinition(trigger: Trigger, steps: Step[], env: ValidationEnv): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const structural = structuralError(steps);
  if (structural) issues.push({ message: structural });

  // Trigger
  switch (trigger.type) {
    case 'manual':
      for (const c of trigger.channelIds ?? []) if (!env.channelExists(c)) issues.push({ message: 'A shortcut channel no longer exists' });
      break;
    case 'reaction':
      if (!trigger.channelId || !env.channelExists(trigger.channelId)) issues.push({ message: 'Choose the channel to watch for reactions' });
      if (!trigger.emoji) issues.push({ message: 'Choose the emoji that starts this workflow' });
      break;
    case 'member_joined':
      if (!trigger.channelId || !env.channelExists(trigger.channelId)) issues.push({ message: 'Choose the channel new members join' });
      break;
    case 'message':
      if (!trigger.channelId || !env.channelExists(trigger.channelId)) issues.push({ message: 'Choose the channel to watch for messages' });
      if (trigger.match === 'regex') {
        try { new RegExp(trigger.pattern ?? ''); } catch { issues.push({ message: 'The message pattern is not a valid regular expression' }); }
      }
      if ((trigger.match ?? 'contains') !== 'any' && !trigger.pattern?.trim()) issues.push({ message: 'Enter the text to match' });
      break;
    case 'schedule': {
      const err = scheduleError(trigger.schedule);
      if (err) issues.push({ message: err });
      break;
    }
    case 'webhook': break;
  }
  if (!steps.length) issues.push({ message: 'Add at least one step' });

  const all = new Map<string, Step>();
  walkSteps(steps, (s) => all.set(s.id, s));
  const triggerVars = TRIGGER_VARS[trigger.type] ?? [];

  const checkVars = (step: Step, text: any) => {
    if (typeof text !== 'string') return;
    const before = stepsBefore(steps, step.id) ?? [];
    for (const path of referencedVars(text)) {
      const [head, ...rest] = path.split('.');
      if (path === 'now') continue;
      if (head === 'trigger') {
        const sub = rest.join('.');
        const ok = trigger.type === 'webhook' ? rest[0] === 'webhook' && rest.length >= 1 : triggerVars.includes(sub);
        if (!ok) issues.push({ stepId: step.id, message: `{{${path}}} is not available for this trigger` });
      } else if (head === 'steps') {
        const id = rest[0];
        if (!id || !before.includes(id)) { issues.push({ stepId: step.id, message: `{{${path}}} refers to a step that hasn't run yet` }); continue; }
        const src = all.get(id)!;
        const field = rest[1];
        const fields = src.type === 'send_form'
          ? [...STEP_OUTPUTS.send_form, ...((src.config.fields ?? []) as FormField[]).map((f) => f.id)]
          : STEP_OUTPUTS[src.type];
        if (!field || (!fields.includes(field) && !(src.type === 'http_request' && (field === 'json' || field === 'body')))) {
          issues.push({ stepId: step.id, message: `{{${path}}} is not an output of step ${id}` });
        }
      } else if (head === 'vars') {
        const name = rest[0];
        const setters = before.map((id) => all.get(id)!).filter((s) => s.type === 'set_variable' && s.config.name === name);
        if (!setters.length) issues.push({ stepId: step.id, message: `{{${path}}} is set by no earlier step` });
      } else {
        issues.push({ stepId: step.id, message: `Unknown variable {{${path}}}` });
      }
    }
  };
  const deepStrings = (step: Step, v: any) => {
    if (typeof v === 'string') checkVars(step, v);
    else if (Array.isArray(v)) v.forEach((x) => deepStrings(step, x));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => deepStrings(step, x));
  };

  walkSteps(steps, (s) => {
    const c = s.config ?? {};
    const add = (message: string) => issues.push({ stepId: s.id, message });
    const badChannel = (t: any) => t?.kind === 'channel' && t.channelId && !String(t.channelId).includes('{{') && !env.channelExists(t.channelId);
    const needsTriggerChannel =(t: any) => t?.kind === 'trigger_channel' && !['manual', 'reaction', 'member_joined', 'message'].includes(trigger.type);
    const needsTriggerUser = (t: any) => t?.kind === 'trigger_user' && ['schedule', 'webhook'].includes(trigger.type);
    switch (s.type) {
      case 'send_message': {
        const e = targetIssue(c.target, 'message'); if (e) add(e);
        if (badChannel(c.target)) add('That channel no longer exists');
        if (needsTriggerChannel(c.target)) add('This trigger has no channel to reply in');
        if (needsTriggerUser(c.target)) add('This trigger has no person who started it');
        if (!String(c.text ?? '').trim()) add('Write the message text');
        break;
      }
      case 'send_form': {
        const e = targetIssue(c.target, 'form'); if (e) add(e);
        if (needsTriggerChannel(c.target)) add('This trigger has no channel to post the form in');
        if (needsTriggerUser(c.target)) add('This trigger has no person who started it');
        if (!String(c.title ?? '').trim()) add('Give the form a title');
        const fields = (c.fields ?? []) as FormField[];
        if (!fields.length) add('Add at least one form field');
        const ids = new Set<string>();
        for (const f of fields) {
          if (!f.id || !FIELD_ID_RE.test(f.id)) add(`Field "${f.label || f.id}" needs a valid id`);
          if (ids.has(f.id)) add(`Duplicate field id ${f.id}`);
          ids.add(f.id);
          if (!f.label?.trim()) add('Every field needs a label');
          if (!['short_text', 'long_text', 'select', 'multi_select', 'number', 'date', 'user'].includes(f.type)) add(`Unknown field type ${f.type}`);
          if ((f.type === 'select' || f.type === 'multi_select') && !(f.options ?? []).filter((o) => o.trim()).length) add(`Add options to "${f.label}"`);
        }
        if (badChannel(c.target)) add('That channel no longer exists');
        if (c.postResponsesTo && c.postResponsesTo !== 'same' && !env.channelExists(c.postResponsesTo)) add('The channel for responses no longer exists');
        break;
      }
      case 'request_approval': {
        const a = c.approver;
        if (!a || !['user', 'trigger_user', 'variable'].includes(a.kind)) add('Choose who approves');
        else if (a.kind === 'user' && (!a.userId || !env.userExists(a.userId))) add('Choose an approver');
        else if (a.kind === 'variable' && !String(a.value ?? '').trim()) add('Choose the variable that holds the approver');
        else if (a.kind === 'trigger_user' && ['schedule', 'webhook'].includes(trigger.type)) add('This trigger has no person who started it');
        if (!String(c.text ?? '').trim()) add('Describe what needs approval');
        break;
      }
      case 'add_reaction':
        if (!String(c.emoji ?? '').trim()) add('Choose an emoji');
        if (!String(c.messageId ?? '').trim()) add('Choose which message to react to');
        break;
      case 'create_channel':
        if (!String(c.name ?? '').trim()) add('Name the new channel');
        break;
      case 'invite_to_channel':
        if (!String(c.channelId ?? '').trim()) add('Choose a channel');
        if (!Array.isArray(c.userIds) || !c.userIds.filter((x: any) => String(x).trim()).length) add('Choose who to invite');
        break;
      case 'update_topic':
        if (!String(c.channelId ?? '').trim()) add('Choose a channel');
        if (typeof c.topic !== 'string') add('Write the new topic');
        break;
      case 'delay':
        if (c.mode === 'until') { if (!String(c.at ?? '').trim()) add('Pick when to continue'); }
        else {
          const n = Number(c.amount);
          if (!Number.isFinite(n) || n <= 0) add('Delay must be a positive number');
          if (!['minutes', 'hours', 'days'].includes(c.unit)) add('Choose minutes, hours or days');
          if (n * ({ minutes: 1, hours: 60, days: 1440 } as any)[c.unit] > 366 * 1440) add('Delays are limited to one year');
        }
        break;
      case 'http_request': {
        if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(c.method)) add('Choose an HTTP method');
        const url = String(c.url ?? '').trim();
        if (!url) add('Enter a URL');
        else if (!/^https?:\/\//i.test(url) && !/^\{\{/.test(url)) add('Only http:// and https:// URLs are allowed');
        break;
      }
      case 'set_variable':
        if (!VAR_NAME_RE.test(String(c.name ?? ''))) add('Variable names must be letters, numbers or _');
        break;
      case 'branch': {
        const groups = c.groups ?? [];
        if (!groups.length || groups.every((g: any) => !(g.conditions ?? []).length)) add('Add at least one condition');
        for (const g of groups) for (const cond of g.conditions ?? []) {
          if (!['equals', 'not_equals', 'contains', 'gt', 'lt', 'is_empty', 'not_empty'].includes(cond.op)) add('Unknown comparison');
          if (!String(cond.left ?? '').trim()) add('Every condition needs a value to check');
        }
        break;
      }
      case 'end': break;
    }
    deepStrings(s, c);
  });
  return issues;
}
