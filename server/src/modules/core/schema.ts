export const coreMigrations: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    pronouns TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    timezone TEXT NOT NULL DEFAULT 'UTC',
    avatar_url TEXT,
    status_emoji TEXT NOT NULL DEFAULT '',
    status_text TEXT NOT NULL DEFAULT '',
    status_expires INTEGER,
    created_at INTEGER NOT NULL,
    is_bot INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    icon_url TEXT,
    invite_code TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE workspace_members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','guest')),
    joined_at INTEGER NOT NULL,
    deactivated INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (workspace_id, user_id)
  );
  CREATE INDEX workspace_members_user ON workspace_members(user_id);

  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('channel','dm','group_dm','self')),
    name TEXT,
    topic TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    is_private INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL,
    dm_key TEXT
  );
  CREATE UNIQUE INDEX conversations_channel_name ON conversations(workspace_id, name) WHERE kind = 'channel';
  CREATE UNIQUE INDEX conversations_dm_key ON conversations(workspace_id, dm_key) WHERE dm_key IS NOT NULL;

  CREATE TABLE conversation_members (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    last_read_ts INTEGER NOT NULL DEFAULT 0,
    notify_pref TEXT NOT NULL DEFAULT 'default',
    muted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id)
  );
  CREATE INDEX conversation_members_user ON conversation_members(user_id);

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    text TEXT NOT NULL DEFAULT '',
    thread_root_id TEXT REFERENCES messages(id),
    reply_count INTEGER NOT NULL DEFAULT 0,
    last_reply_at INTEGER,
    edited_at INTEGER,
    deleted_at INTEGER,
    client_msg_id TEXT,
    created_at INTEGER NOT NULL,
    subtype TEXT,
    meta_json TEXT
  );
  CREATE INDEX messages_conv_created ON messages(conversation_id, created_at, id);
  CREATE INDEX messages_thread ON messages(thread_root_id, created_at);
  CREATE UNIQUE INDEX messages_client_msg ON messages(user_id, client_msg_id) WHERE client_msg_id IS NOT NULL;

  CREATE TABLE pins (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by TEXT NOT NULL REFERENCES users(id),
    pinned_at INTEGER NOT NULL,
    PRIMARY KEY (conversation_id, message_id)
  );

  CREATE TABLE saved_items (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    saved_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, message_id)
  );
  `,
  // 1: email verification. Demo seed users and bots are grandfathered in as verified.
  `
  ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
  UPDATE users SET email_verified_at = created_at
    WHERE is_bot = 1 OR email IN ('ava@fellowship.test', 'ben@fellowship.test', 'cleo@fellowship.test');

  CREATE TABLE email_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,              -- 'verify' (also passwordless sign-in) | 'reset'
    code_hash TEXT NOT NULL,            -- sha256 of user id + 6-digit code
    link_hash TEXT NOT NULL UNIQUE,     -- sha256 of the magic-link token
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER
  );
  CREATE INDEX email_codes_user ON email_codes(user_id, purpose, created_at);
  `,
];
