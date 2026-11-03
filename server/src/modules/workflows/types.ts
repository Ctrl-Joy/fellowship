// Workflow definition + run types (shared by engine, routes and validation).

export type TriggerType = 'manual' | 'reaction' | 'member_joined' | 'message' | 'schedule' | 'webhook';

export type Schedule =
  | { kind: 'once'; at: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; days: number[]; time: string }
  | { kind: 'cron'; expr: string };

export interface Trigger {
  type: TriggerType;
  /** manual: channels where the shortcut is offered (empty = everywhere). */
  channelIds?: string[];
  /** reaction / member_joined / message */
  channelId?: string;
  emoji?: string;
  match?: 'any' | 'contains' | 'regex';
  pattern?: string;
  schedule?: Schedule;
  /** Minutes east of UTC used to evaluate local schedule times (e.g. +60 for UTC+1). */
  tzOffset?: number;
}

export type StepType =
  | 'send_message' | 'send_form' | 'request_approval' | 'add_reaction' | 'create_channel'
  | 'invite_to_channel' | 'update_topic' | 'delay' | 'http_request' | 'set_variable' | 'branch' | 'end';

export const STEP_TYPES: StepType[] = [
  'send_message', 'send_form', 'request_approval', 'add_reaction', 'create_channel',
  'invite_to_channel', 'update_topic', 'delay', 'http_request', 'set_variable', 'branch', 'end',
];

/** Steps that own nested `then` / `else` step lists. */
export const CONTAINER_TYPES: StepType[] = ['branch', 'request_approval'];

export interface Step {
  id: string;
  type: StepType;
  name?: string;
  config: Record<string, any>;
  then?: Step[];
  else?: Step[];
}

export type Target =
  | { kind: 'channel'; channelId: string }
  | { kind: 'user'; userId: string }
  | { kind: 'trigger_user' }
  | { kind: 'trigger_channel' };

export type FieldType = 'short_text' | 'long_text' | 'select' | 'multi_select' | 'number' | 'date' | 'user';

export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

export type ConditionOp = 'equals' | 'not_equals' | 'contains' | 'gt' | 'lt' | 'is_empty' | 'not_empty';

export interface Condition { left: string; op: ConditionOp; right?: string }
export interface ConditionGroup { match: 'all' | 'any'; conditions: Condition[] }
export interface BranchConfig { match: 'all' | 'any'; groups: ConditionGroup[] }

/** Position inside the (nested) step tree. Root segment has no arm. */
export type Cursor = { arm?: 'then' | 'else'; i: number }[];

export type RunStatus = 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';

export interface RunContext {
  trigger: Record<string, any>;
  steps: Record<string, any>;
  vars: Record<string, any>;
}

export interface WorkflowRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  emoji: string;
  owner_id: string;
  status: 'draft' | 'published';
  trigger_type: string;
  trigger_json: string;
  steps_json: string;
  version: number;
  published_version: number | null;
  webhook_secret: string;
  sched_state_json: string | null;
  created_at: number;
  updated_at: number;
}

export interface RunRow {
  id: string;
  workflow_id: string;
  workspace_id: string;
  version: number;
  status: RunStatus;
  trigger_user_id: string | null;
  context_json: string;
  current_step: string;
  wake_at: number | null;
  waiting_step_id: string | null;
  error: string | null;
  steps_count: number;
  depth: number;
  is_test: number;
  started_at: number;
  finished_at: number | null;
}
