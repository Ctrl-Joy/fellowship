// Client-side workflow types, API calls and the variable catalogue used by the builder.
import { api } from '../../api';

export type TriggerType = 'manual' | 'reaction' | 'member_joined' | 'message' | 'schedule' | 'webhook';
export type StepType =
  | 'send_message' | 'send_form' | 'request_approval' | 'add_reaction' | 'create_channel'
  | 'invite_to_channel' | 'update_topic' | 'delay' | 'http_request' | 'set_variable' | 'branch' | 'end';

export type Schedule =
  | { kind: 'once'; at: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; days: number[]; time: string }
  | { kind: 'cron'; expr: string };

export interface Trigger {
  type: TriggerType;
  channelIds?: string[];
  channelId?: string;
  emoji?: string;
  match?: 'any' | 'contains' | 'regex';
  pattern?: string;
  schedule?: Schedule;
  tzOffset?: number;
}

export interface Step {
  id: string;
  type: StepType;
  name?: string;
  config: Record<string, any>;
  then?: Step[];
  else?: Step[];
}

export interface FormField {
  id: string;
  label: string;
  type: 'short_text' | 'long_text' | 'select' | 'multi_select' | 'number' | 'date' | 'user';
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

export interface RunSummary {
  id: string; workflowId: string; version: number;
  status: 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
  triggerUserId: string | null; waitingStepId: string | null; wakeAt: number | null;
  error: string | null; stepsCount: number; isTest: boolean; startedAt: number; finishedAt: number | null;
}

export interface RunStepLog {
  id: number; stepId: string; type: StepType; status: string; input: any; output: any;
  error: string | null; startedAt: number; finishedAt: number | null;
}

export interface RunDetail extends RunSummary { context: any; steps: RunStepLog[] }

export interface Workflow {
  id: string; workspaceId: string; name: string; description: string; emoji: string; ownerId: string;
  status: 'draft' | 'published'; triggerType: TriggerType; version: number; publishedVersion: number | null;
  hasUnpublishedChanges: boolean; canEdit: boolean; createdAt: number; updatedAt: number;
  trigger?: Trigger; steps?: Step[]; webhookPath?: string; lastRun?: RunSummary | null; nextRunAt?: number | null;
}

export interface Issue { stepId?: string; message: string }

export interface Template { id: string; name: string; description: string; emoji: string; trigger: Trigger; steps: Step[] }

export const wfApi = {
  list: (wid: string, scope: 'mine' | 'workspace') => api.get<{ workflows: Workflow[] }>(`/api/w/${wid}/workflows?scope=${scope}`),
  templates: (wid: string) => api.get<{ templates: Template[] }>(`/api/w/${wid}/workflow-templates`),
  create: (wid: string, body: any) => api.post<{ workflow: Workflow }>(`/api/w/${wid}/workflows`, body),
  get: (id: string) => api.get<{ workflow: Workflow; issues?: Issue[] }>(`/api/workflows/${id}`),
  update: (id: string, body: any) => api.patch<{ workflow: Workflow; issues: Issue[] }>(`/api/workflows/${id}`, body),
  remove: (id: string) => api.del(`/api/workflows/${id}`),
  publish: (id: string) => api.post<{ workflow: Workflow }>(`/api/workflows/${id}/publish`),
  unpublish: (id: string) => api.post<{ workflow: Workflow }>(`/api/workflows/${id}/unpublish`),
  rotateSecret: (id: string) => api.post<{ workflow: Workflow }>(`/api/workflows/${id}/webhook-secret`),
  run: (id: string, body: any) => api.post<{ run: RunSummary }>(`/api/workflows/${id}/run`, body),
  runs: (id: string) => api.get<{ runs: RunSummary[] }>(`/api/workflows/${id}/runs`),
  runDetail: (rid: string) => api.get<{ run: RunDetail }>(`/api/workflow-runs/${rid}`),
  cancelRun: (rid: string) => api.post<{ run: RunDetail }>(`/api/workflow-runs/${rid}/cancel`),
  shortcuts: (wid: string, conversationId: string) =>
    api.get<{ shortcuts: { id: string; name: string; emoji: string; description: string }[] }>(`/api/w/${wid}/workflow-shortcuts?conversationId=${encodeURIComponent(conversationId)}`),
  submitForm: (mid: string, values: Record<string, any>) => api.post(`/api/workflow-messages/${mid}/form`, { values }),
  myResponses: (mid: string) => api.get<{ responses: { values: any; submittedAt: number }[] }>(`/api/workflow-messages/${mid}/form`),
  decide: (mid: string, decision: 'approve' | 'deny', note: string) => api.post(`/api/workflow-messages/${mid}/approval`, { decision, note }),
};

// ------------------------------------------------------------------ catalogue

export const TRIGGER_INFO: Record<TriggerType, { label: string; hint: string; icon: string }> = {
  manual: { label: 'From a shortcut', hint: 'People start it from the "Run workflow" menu in a conversation', icon: '▶️' },
  reaction: { label: 'Emoji reaction', hint: 'Someone reacts with a chosen emoji in a channel', icon: '😀' },
  member_joined: { label: 'Someone joins a channel', hint: 'A person joins a chosen channel', icon: '🚪' },
  message: { label: 'New message', hint: 'A message in a channel matches some text', icon: '💬' },
  schedule: { label: 'On a schedule', hint: 'Once, daily, weekly or a cron expression', icon: '⏰' },
  webhook: { label: 'Incoming webhook', hint: 'Another system POSTs JSON to a secret URL', icon: '🔗' },
};

export const STEP_INFO: Record<StepType, { label: string; icon: string; group: 'Messages' | 'People & channels' | 'Logic' | 'Integrations' }> = {
  send_message: { label: 'Send a message', icon: '✉️', group: 'Messages' },
  send_form: { label: 'Collect a form', icon: '📝', group: 'Messages' },
  request_approval: { label: 'Ask for approval', icon: '✅', group: 'Messages' },
  add_reaction: { label: 'Add a reaction', icon: '😀', group: 'Messages' },
  create_channel: { label: 'Create a channel', icon: '#️⃣', group: 'People & channels' },
  invite_to_channel: { label: 'Invite to channel', icon: '➕', group: 'People & channels' },
  update_topic: { label: 'Update channel topic', icon: '🏷️', group: 'People & channels' },
  delay: { label: 'Wait', icon: '⏳', group: 'Logic' },
  set_variable: { label: 'Set a variable', icon: '🧮', group: 'Logic' },
  branch: { label: 'If / else', icon: '🔀', group: 'Logic' },
  end: { label: 'End workflow', icon: '⏹️', group: 'Logic' },
  http_request: { label: 'HTTP request', icon: '🌐', group: 'Integrations' },
};

export const CONTAINER: StepType[] = ['branch', 'request_approval'];

export const FIELD_TYPES: { value: FormField['type']; label: string }[] = [
  { value: 'short_text', label: 'Short text' }, { value: 'long_text', label: 'Paragraph' },
  { value: 'select', label: 'Dropdown' }, { value: 'multi_select', label: 'Multiple choice' },
  { value: 'number', label: 'Number' }, { value: 'date', label: 'Date' }, { value: 'user', label: 'Person' },
];

const STEP_OUTPUTS: Record<StepType, [string, string][]> = {
  send_message: [['messageId', 'message id'], ['channel', 'conversation']],
  send_form: [['submittedBy', 'submitted by'], ['submittedAt', 'submitted at'], ['messageId', 'form message id']],
  request_approval: [['outcome', 'outcome (approved/denied)'], ['approver', 'approver'], ['decidedBy', 'decided by'], ['decidedAt', 'decided at'], ['note', 'note']],
  add_reaction: [['emoji', 'emoji']],
  create_channel: [['channel', 'new channel'], ['channelName', 'channel name']],
  invite_to_channel: [['invited', 'number invited']],
  update_topic: [['topic', 'topic']],
  delay: [['resumedAt', 'resumed at']],
  http_request: [['status', 'status code'], ['ok', 'ok'], ['body', 'response body'], ['json', 'response JSON']],
  set_variable: [],
  branch: [['result', 'condition result']],
  end: [],
};

const TRIGGER_VARS: Record<TriggerType, [string, string][]> = {
  manual: [['user', 'person who ran it'], ['channel', 'conversation it ran in']],
  reaction: [['user', 'person who reacted'], ['channel', 'channel'], ['emoji', 'emoji'], ['message.id', 'message id'], ['message.text', 'message text'], ['message.user', 'message author']],
  member_joined: [['user', 'person who joined'], ['channel', 'channel']],
  message: [['user', 'message author'], ['channel', 'channel'], ['message.id', 'message id'], ['message.text', 'message text']],
  schedule: [['firedAt', 'time it fired']],
  webhook: [['webhook.<field>', 'any field of the JSON body']],
};

export interface VarOption { token: string; label: string; group: string }

export function walk(steps: Step[], fn: (s: Step, parents: Step[]) => void, parents: Step[] = []) {
  for (const s of steps ?? []) {
    fn(s, parents);
    if (CONTAINER.includes(s.type)) {
      walk(s.then ?? [], fn, [...parents, s]);
      walk(s.else ?? [], fn, [...parents, s]);
    }
  }
}

/** Ids of steps guaranteed to have run before `targetId` (siblings before it + enclosing containers). */
export function stepsBefore(steps: Step[], targetId: string): Step[] {
  function search(list: Step[], acc: Step[]): Step[] | null {
    const seen: Step[] = [];
    for (const s of list) {
      if (s.id === targetId) return [...acc, ...seen];
      if (CONTAINER.includes(s.type)) {
        for (const arm of ['then', 'else'] as const) {
          const r = search(s[arm] ?? [], [...acc, ...seen, s]);
          if (r) return r;
        }
      }
      seen.push(s);
    }
    return null;
  }
  return search(steps, []) ?? [];
}

export function stepTitle(s: Step) {
  return s.name?.trim() || STEP_INFO[s.type]?.label || s.type;
}

/** Variables the step `stepId` may use. */
export function variablesFor(trigger: Trigger, steps: Step[], stepId: string): VarOption[] {
  const out: VarOption[] = TRIGGER_VARS[trigger.type].map(([k, label]) => ({
    token: k === 'webhook.<field>' ? '{{trigger.webhook.}}' : `{{trigger.${k}}}`, label, group: 'Trigger',
  }));
  out.push({ token: '{{now}}', label: 'current time', group: 'Trigger' });
  for (const s of stepsBefore(steps, stepId)) {
    const group = `${STEP_INFO[s.type].icon} ${stepTitle(s)}`;
    if (s.type === 'send_form') {
      for (const f of (s.config.fields ?? []) as FormField[]) if (f.id) out.push({ token: `{{steps.${s.id}.${f.id}}}`, label: f.label || f.id, group });
    }
    if (s.type === 'set_variable' && s.config.name) out.push({ token: `{{vars.${s.config.name}}}`, label: `variable ${s.config.name}`, group });
    for (const [k, label] of STEP_OUTPUTS[s.type]) out.push({ token: `{{steps.${s.id}.${k}}}`, label, group });
  }
  return out;
}

export function newStepId(steps: Step[], type: StepType) {
  const used = new Set<string>();
  walk(steps, (s) => used.add(s.id));
  const base = ({
    send_message: 'msg', send_form: 'form', request_approval: 'approval', add_reaction: 'react', create_channel: 'channel',
    invite_to_channel: 'invite', update_topic: 'topic', delay: 'wait', http_request: 'http', set_variable: 'setvar', branch: 'branch', end: 'end',
  } as Record<StepType, string>)[type];
  for (let i = 1; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
}

export function defaultConfig(type: StepType): Record<string, any> {
  switch (type) {
    case 'send_message': return { target: { kind: 'trigger_channel' }, text: '' };
    case 'send_form': return { target: { kind: 'trigger_user' }, title: '', intro: '', fields: [{ id: 'answer', label: 'Your answer', type: 'short_text', required: true }], allowMultiple: false, postResponsesTo: '' };
    case 'request_approval': return { approver: { kind: 'user', userId: '' }, text: '' };
    case 'add_reaction': return { messageId: '{{trigger.message.id}}', emoji: '👍' };
    case 'create_channel': return { name: '', isPrivate: false, topic: '' };
    case 'invite_to_channel': return { channelId: '', userIds: ['{{trigger.user}}'] };
    case 'update_topic': return { channelId: '{{trigger.channel}}', topic: '' };
    case 'delay': return { mode: 'duration', amount: 1, unit: 'hours' };
    case 'http_request': return { method: 'POST', url: 'https://', headers: [], body: '', failOnError: false };
    case 'set_variable': return { name: 'myVar', value: '' };
    case 'branch': return { match: 'all', groups: [{ match: 'all', conditions: [{ left: '', op: 'equals', right: '' }] }] };
    case 'end': return {};
  }
}

/** Immutable helpers over the nested step tree. */
export function mapSteps(steps: Step[], fn: (s: Step) => Step): Step[] {
  return steps.map((s) => {
    const n = fn(s);
    if (!CONTAINER.includes(n.type)) return n;
    return { ...n, then: mapSteps(n.then ?? [], fn), else: mapSteps(n.else ?? [], fn) };
  });
}

export function updateStep(steps: Step[], id: string, patch: (s: Step) => Step) {
  return mapSteps(steps, (s) => (s.id === id ? patch(s) : s));
}

export function removeStep(steps: Step[], id: string): Step[] {
  return steps.filter((s) => s.id !== id).map((s) => (CONTAINER.includes(s.type)
    ? { ...s, then: removeStep(s.then ?? [], id), else: removeStep(s.else ?? [], id) } : s));
}

/** Address of a list: [] = root, or [parentId, arm]. */
export type ListAddr = { parentId: string | null; arm: 'then' | 'else' | null };

export function editList(steps: Step[], addr: ListAddr, fn: (list: Step[]) => Step[]): Step[] {
  if (!addr.parentId) return fn(steps);
  return mapSteps(steps, (s) => (s.id === addr.parentId ? { ...s, [addr.arm!]: fn(s[addr.arm!] ?? []) } : s));
}

export function findStep(steps: Step[], id: string): Step | null {
  let found: Step | null = null;
  walk(steps, (s) => { if (s.id === id) found = s; });
  return found;
}
