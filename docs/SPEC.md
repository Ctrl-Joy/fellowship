# Fellowship — engineering spec and contracts

Every contributor must follow this file. Read `docs/ANALYSIS.md` for the product
behaviour. **Never copy Slack's code, logos, icons, colours or text** — Fellowship is an original brand.

## Brand
- Name **Fellowship**, logo: a simple ring of three linked circles (inline SVG, our own).
- Palette (CSS variables in `client/src/styles/theme.css`): primary `#1F6F5C` (deep teal),
  accent `#F2A541` (amber), sidebar bg `#12302A`, mention `#E2574C`. Light + dark themes.
- Font: Inter (Google Fonts) with system fallback.

## Stack
- Node 24, TypeScript everywhere, npm workspaces. No Docker, no external services.
- **server/**: Fastify 5, `@fastify/websocket`, `@fastify/multipart`, `@fastify/static`,
  `@fastify/cookie`, zod, `node:sqlite` (`DatabaseSync`, WAL, FTS5), run with `tsx`.
- **client/**: React 19, Vite, TypeScript, Zustand, react-router. No UI kit; hand-written CSS.
- Tests: `node:test` + Fastify `inject()` for API (`server/test/*.test.ts`, run `npm test -w server`).
  End-to-end checks are done in a real browser against the running app.

## Layout
```
package.json               workspaces: server, client; scripts: dev, build, test, seed
server/src/index.ts        builds app, listens on :4000
server/src/app.ts          buildApp({dbPath}) — used by tests
server/src/db.ts           open db, run migrations from every module in order
server/src/bus.ts          typed in-process event bus: emit(event), on(type, fn)
server/src/realtime.ts     WS hub: connections by userId, broadcast helpers
server/src/auth.ts         sessions, requireUser preHandler, password hashing (scrypt)
server/src/modules/index.ts  ordered list of modules (ALL feature modules pre-registered)
server/src/modules/<name>/index.ts  export default { name, migrations: string[], register(app, ctx) }
client/src/api.ts          fetch wrapper (credentials: 'include', JSON, throws ApiError)
client/src/ws.ts           single socket, auto-reconnect, on(type, fn), send(type, payload)
client/src/store/          Zustand slices
client/src/features/<name>/  each feature's components; shell imports from fixed entry files
```
Module names: `core` (auth, users, workspaces, channels, conversations, messages, read state),
`threads`, `reactions`, `files`, `search`, `notifications`, `presence`, `huddles`, `canvases`,
`apps` (bots, webhooks, slash commands), `workflows`.

**Ownership rule:** a feature edits only `server/src/modules/<its module>/`,
`server/test/<its module>*.test.ts` and `client/src/features/<its feature>/`. Shared files
(`db.ts`, `bus.ts`, `realtime.ts`, shell components, stores) belong to `core`; if a feature needs a
change there, keep it minimal and additive and note it in the final report.

## Module context
`register(app, ctx)` receives `ctx = { db, bus, realtime, auth, config }`.
- Migrations are SQL strings, run once each, tracked in `_migrations(module, idx)`.
- IDs: ULID-like strings from `ctx.ids.next(prefix)` e.g. `U…` users, `W…` workspaces,
  `C…` conversations, `M…` messages, `F…` files, `H…` huddles, `D…` canvases, `WF…` workflows.
- Timestamps: integer milliseconds (`Date.now()`).

## Core schema (owned by core)
```
users(id, email unique, password_hash, full_name, display_name, title, pronouns, phone,
      timezone, avatar_url, status_emoji, status_text, status_expires, created_at, is_bot)
sessions(token pk, user_id, created_at, expires_at)
workspaces(id, name, slug unique, icon_url, invite_code, created_by, created_at)
workspace_members(workspace_id, user_id, role: owner|admin|member|guest, joined_at, deactivated)
conversations(id, workspace_id, kind: channel|dm|group_dm|self, name, topic, description,
              is_private, is_archived, created_by, created_at, dm_key)
conversation_members(conversation_id, user_id, joined_at, last_read_ts, notify_pref, muted)
messages(id, conversation_id, user_id, text, thread_root_id null, reply_count, last_reply_at,
         edited_at, deleted_at, client_msg_id, created_at, subtype null, meta_json null)
pins(conversation_id, message_id, pinned_by, pinned_at)
saved_items(user_id, message_id, saved_at)
```

## REST conventions
- Prefix `/api`. JSON in/out. Errors: `{ error: { code, message } }` with 4xx/5xx.
- Auth: `POST /api/auth/signup|login|logout`, `GET /api/auth/me`. Session cookie `fs_session`
  (httpOnly, sameSite lax).
- Workspace-scoped routes: `/api/w/:workspaceId/...`; membership enforced.
- Core endpoints (minimum):
  - `GET/POST /api/workspaces`, `POST /api/workspaces/join/:inviteCode`
  - `GET /api/w/:wid/members`, `GET/PATCH /api/users/me`, `GET /api/users/:id`
  - `GET /api/w/:wid/conversations` (mine, with unread + mention counts),
    `GET /api/w/:wid/channels/browse`, `POST /api/w/:wid/channels`,
    `POST /api/w/:wid/dms` `{userIds}` (returns existing or new dm/group_dm),
    `GET/PATCH /api/conversations/:cid`, `POST /api/conversations/:cid/join|leave|members|archive`,
    `POST /api/conversations/:cid/read` `{ts}`
  - `GET /api/conversations/:cid/messages?before=&limit=` (root messages only),
    `POST /api/conversations/:cid/messages` `{text, clientMsgId, threadRootId?, alsoSendToChannel?, fileIds?}`,
    `PATCH/DELETE /api/messages/:mid`, pins + saved endpoints.

## Message serialization (every API and WS payload uses this shape)
```ts
type Message = {
  id, conversationId, userId, text, threadRootId: string|null,
  replyCount, lastReplyAt: number|null, replyUserIds: string[],
  editedAt: number|null, deletedAt: number|null, createdAt, clientMsgId: string|null,
  subtype: string|null, meta: any|null,
  reactions: { emoji: string, userIds: string[] }[],
  files: FileInfo[],
  pinned: boolean, saved: boolean
}
```
Core exposes `ctx.messages.serialize(rows, viewerId)` and **enrichment hooks**:
`ctx.messages.addEnricher(fn(messages, viewerId))` — reactions/files modules fill their fields.
Core exposes `ctx.messages.post({conversationId, userId, text, ...})` so bots, workflows and
webhooks create messages through the same path (emits `message.created`).

## Event bus (server-internal, also what workflows/webhooks consume)
`bus.emit({ type, workspaceId, conversationId?, actorId?, payload })`. Types:
`message.created|updated|deleted`, `reaction.added|removed`, `conversation.created|updated|archived`,
`member.joined|left` (conversation), `workspace.member_joined`, `file.uploaded`,
`user.updated`, `presence.changed`, `huddle.started|updated|ended`, `canvas.updated`,
`workflow.run_updated`, `notification.created`.

## WebSocket protocol (`/ws`, authenticated by cookie)
Frames are JSON `{ type, payload }`.
- Server → client: every bus event above that the user is allowed to see (realtime.ts filters by
  conversation membership / workspace membership), plus `typing`, `hello {userId}`, `pong`.
- Client → server: `ping`, `typing {conversationId}`, `presence.active`, `presence.away`,
  `huddle.signal {huddleId, to, data}` (relayed only to `to`), `canvas.cursor {canvasId, blockId}`.
- Modules add client→server handlers via `ctx.realtime.onClientMessage(type, (user, payload) => …)`.

## Client shell slots (owned by core; each feature fills its entry files)
- `features/threads/ThreadPanel.tsx`, `features/reactions/ReactionBar.tsx` + `EmojiPicker.tsx`,
  `features/files/Attachments.tsx` + `useUpload.ts`, `features/search/SearchBox.tsx` +
  `SearchResults.tsx`, `features/notifications/ActivityView.tsx` + `NotificationPrefs.tsx`,
  `features/presence/PresenceDot.tsx` + `StatusEditor.tsx` + `ProfilePanel.tsx`,
  `features/huddles/HuddleButton.tsx` + `HuddleWindow.tsx`, `features/canvases/CanvasView.tsx`,
  `features/apps/AppsView.tsx`, `features/workflows/WorkflowsView.tsx` +
  `WorkflowMessageParts.tsx` (renders form/approval buttons in messages).
- Core creates each as a working stub with the final props signature so the shell compiles; the
  feature replaces the internals.

## Dev & ports
- `npm run dev` runs server (:4000) and Vite (:5173, proxies `/api`, `/ws`, `/files`).
- `npm run seed` creates demo workspace "Fellowship HQ" with users `ava@fellowship.test`,
  `ben@fellowship.test`, `cleo@fellowship.test` (password `fellowship123`), channels and messages.
- Data at `server/data/fellowship.db`, uploads at `server/data/uploads/`.
