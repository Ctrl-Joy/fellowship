import type { FellowshipModule } from '../../context';
import { createHuddleService } from './service';
import { registerHuddleRoutes } from './routes';
import { registerHuddleSignalling } from './signalling';

/**
 * Huddles: live audio/video/screen share per conversation.
 * The server keeps state + relays WebRTC signalling; media flows peer-to-peer (full mesh, ≤ 8).
 * See docs/HUDDLES.md.
 */
const huddles: FellowshipModule = {
  name: 'huddles',
  migrations: [
    `CREATE TABLE huddles (
       id TEXT PRIMARY KEY,
       conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
       workspace_id TEXT NOT NULL,
       started_by TEXT NOT NULL,
       started_at INTEGER NOT NULL,
       ended_at INTEGER,
       message_id TEXT
     );
     CREATE UNIQUE INDEX huddles_one_active ON huddles(conversation_id) WHERE ended_at IS NULL;
     CREATE INDEX huddles_ws_active ON huddles(workspace_id, ended_at);
     CREATE TABLE huddle_participants (
       huddle_id TEXT NOT NULL REFERENCES huddles(id) ON DELETE CASCADE,
       user_id TEXT NOT NULL,
       joined_at INTEGER NOT NULL,
       left_at INTEGER,
       muted INTEGER NOT NULL DEFAULT 0,
       video INTEGER NOT NULL DEFAULT 0,
       screen INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (huddle_id, user_id)
     );
     CREATE INDEX huddle_participants_user ON huddle_participants(user_id, left_at);`,
  ],
  register(app, ctx) {
    const svc = createHuddleService(ctx);
    registerHuddleRoutes(app, ctx, svc);
    registerHuddleSignalling(ctx, svc);
  },
};

export default huddles;
