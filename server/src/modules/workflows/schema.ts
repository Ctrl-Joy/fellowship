// Append-only migrations for the workflows module.
export const workflowMigrations: string[] = [
  `
  CREATE TABLE workflows (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    emoji TEXT NOT NULL DEFAULT '',
    owner_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'draft',
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    trigger_json TEXT NOT NULL,
    steps_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    published_version INTEGER,
    webhook_secret TEXT NOT NULL UNIQUE,
    sched_state_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX workflows_ws ON workflows(workspace_id, status, trigger_type);

  CREATE TABLE workflow_versions (
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    trigger_json TEXT NOT NULL,
    steps_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (workflow_id, version)
  );

  CREATE TABLE workflow_runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    status TEXT NOT NULL,
    trigger_user_id TEXT,
    context_json TEXT NOT NULL,
    current_step TEXT NOT NULL,
    wake_at INTEGER,
    waiting_step_id TEXT,
    error TEXT,
    steps_count INTEGER NOT NULL DEFAULT 0,
    depth INTEGER NOT NULL DEFAULT 0,
    is_test INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE INDEX workflow_runs_wf ON workflow_runs(workflow_id, started_at);
  CREATE INDEX workflow_runs_status ON workflow_runs(status, wake_at);

  CREATE TABLE workflow_run_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL,
    step_type TEXT NOT NULL,
    status TEXT NOT NULL,
    input_json TEXT,
    output_json TEXT,
    error TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE INDEX workflow_run_steps_run ON workflow_run_steps(run_id, id);

  CREATE TABLE workflow_form_responses (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    values_json TEXT NOT NULL,
    submitted_at INTEGER NOT NULL
  );
  CREATE INDEX workflow_form_responses_msg ON workflow_form_responses(message_id, user_id);

  CREATE TABLE workflow_approvals (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL,
    message_id TEXT NOT NULL UNIQUE,
    approver_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    decided_by TEXT,
    decided_at INTEGER,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE workflow_bots (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id)
  );
  `,
];
