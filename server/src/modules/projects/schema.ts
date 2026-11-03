/** Append-only migrations for the projects module. */
export const migrations = [
  `CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    icon_emoji TEXT NOT NULL DEFAULT '🧭',
    color TEXT NOT NULL DEFAULT '#6E5BD8',
    description TEXT NOT NULL DEFAULT '',
    lead_id TEXT,
    tabs_json TEXT NOT NULL DEFAULT '{}',
    next_number INTEGER NOT NULL DEFAULT 1,
    dev_secret TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE UNIQUE INDEX projects_key ON projects(workspace_id, key) WHERE deleted_at IS NULL;

  CREATE TABLE project_stars (project_id TEXT NOT NULL, user_id TEXT NOT NULL, starred_at INTEGER NOT NULL, PRIMARY KEY (project_id, user_id));
  CREATE TABLE project_visits (project_id TEXT NOT NULL, user_id TEXT NOT NULL, visited_at INTEGER NOT NULL, PRIMARY KEY (project_id, user_id));

  CREATE TABLE work_items (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    number INTEGER NOT NULL,
    type TEXT NOT NULL,
    summary TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'none',
    assignee_id TEXT,
    reporter_id TEXT,
    parent_id TEXT,
    start_date TEXT,
    due_date TEXT,
    rank REAL NOT NULL,
    labels_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER,
    reopened_count INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER
  );
  CREATE UNIQUE INDEX work_items_number ON work_items(project_id, number);
  CREATE INDEX work_items_parent ON work_items(parent_id);
  CREATE INDEX work_items_assignee ON work_items(assignee_id);

  CREATE TABLE work_item_activity (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    actor_id TEXT,
    field TEXT NOT NULL,
    from_value TEXT,
    to_value TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX work_item_activity_project ON work_item_activity(project_id, created_at);
  CREATE INDEX work_item_activity_item ON work_item_activity(item_id, created_at);

  CREATE TABLE work_item_comments (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    edited_at INTEGER
  );
  CREATE INDEX work_item_comments_item ON work_item_comments(item_id, created_at);

  CREATE TABLE project_forms (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    template TEXT NOT NULL DEFAULT 'blank',
    item_type TEXT NOT NULL DEFAULT 'task',
    fields_json TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE project_filters (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    query_json TEXT NOT NULL,
    starred INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE project_dashboards (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    widgets_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE project_dev_events (
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, kind, ref)
  );`,
];
