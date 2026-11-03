# Contributing a feature

Read `docs/SPEC.md` first (binding). This guide covers the concrete hooks the `core` foundation
gives you. **Edit only** `server/src/modules/<module>/`, `server/test/<module>*.test.ts` and
`client/src/features/<feature>/`. If you truly need a shared-file change, keep it additive and
mention it in your pull request.

## Commands
```
npm install            # once
npm run seed           # recreate server/data/fellowship.db (ava@/ben@/cleo@fellowship.test, pw fellowship123)
npm run dev            # API :4000 (tsx watch) + Vite :5173 (proxies /api, /ws, /files)
cp .env.example .env   # optional: BREVO_API_KEY etc. Unset = emails print to the server console (docs/EMAIL.md)
npm test               # node:test, all server/test/**/*.test.ts (sequential)
npm run build          # server tsc --noEmit, client tsc + vite build
```
Run a single file: `cd server && node --import tsx --test test/reactions.test.ts`.

## Server

### Module shape — `server/src/modules/<name>/index.ts`
```ts
import type { FellowshipModule } from '../../context';
const mod: FellowshipModule = {
  name: 'reactions',
  migrations: [ `CREATE TABLE reactions (...);`, /* append only — never edit a shipped entry */ ],
  register(app, ctx) { /* routes, enrichers, bus listeners, ws handlers */ },
};
export default mod;
```
All modules are already listed in `server/src/modules/index.ts` (core first). Migrations are SQL
strings run once each, tracked in `_migrations(module, idx)`; add new ones at the end of the array.
FTS5 is available in node:sqlite.

### `ctx` (`server/src/context.ts`)
| field | use |
|---|---|
| `db` | `node:sqlite` `DatabaseSync`: `db.prepare(sql).get/all/run(...)`; transactions: `tx(db, fn)` from `server/src/db.ts` |
| `ids.next(prefix)` | ULID-like ids (`'F'` files, `'H'` huddles, `'D'` canvases, `'WF'` workflows…) |
| `auth.requireUser` | preHandler; then `me(req)` (from `server/src/auth.ts`) returns the user row |
| `access` | `requireWorkspaceMember(wid, uid)`, `requireWorkspaceAdmin`, `requireConversationRead(cid, uid)` → `{conv, wsMember, isMember}`, `requireConversationMember`, `getConversation`, `isConversationMember`, `workspaceMember` |
| `messages` | `serialize(rows, viewerId)`, `serializeOne`, `get(id, viewerId)`, `getRow`, `post(input)`, `edit`, `remove`, `emitUpdated(row, actorId)`, `listReplies(rootId, viewerId)`, `recountThread`, `addEnricher(fn)`, `addPostHook(fn)` |
| `core` | `createUser`, `createWorkspace`, `joinWorkspace`, `createChannel`, `addMember`, `openDm` |
| `bus` | `emit(event)`, `on(type \| '*', fn)` → unsubscribe |
| `realtime` | see below |
| `config` | `dbPath`, `dataDir`, `uploadsDir`, `port`, `isTest` |
| `onClose(fn)` | cleanup (clear intervals!) — tests close the app |

### Routes
Register on `app` inside `register()`. Prefix `/api`; workspace-scoped `/api/w/:wid/...`.
```ts
import { me } from '../../auth';
import { parse, z } from '../../validate';
import { badRequest, forbidden, notFound } from '../../errors';
app.post<{ Params: { mid: string } }>('/api/messages/:mid/reactions', { preHandler: ctx.auth.requireUser }, async (req) => {
  const user = me(req);
  const body = parse(z.object({ emoji: z.string().min(1).max(64) }), req.body); // 400 on failure
  const row = ctx.messages.getRow(req.params.mid); if (!row) throw notFound();
  ctx.access.requireConversationMember(row.conversation_id, user.id);
  ...
  return { message: ctx.messages.serializeOne(row, user.id) };
});
```
Throw `HttpError`s (`server/src/errors.ts`); the error handler renders `{ error: { code, message } }`.
`@fastify/multipart` is registered globally (files module: `await req.file()`); `@fastify/static`
is **not** registered for `/files` — the files module registers it (`decorateReply: false`).

### Messages
- Create every message via `ctx.messages.post({ conversationId, userId, text, clientMsgId?, threadRootId?, alsoSendToChannel?, fileIds?, subtype?, meta?, force? })`.
  It dedupes by `(userId, clientMsgId)`, updates thread counts, emits `message.created` (and `message.updated` for the root). `force: true` skips the membership check (bots/workflows).
- Fill your fields on every serialized message: `ctx.messages.addEnricher((msgs, viewerId) => { … mutate msgs[i].reactions / .files … })`. Batch-query by `msgs.map(m => m.id)`.
- Attach data at post time: `ctx.messages.addPostHook((row, input) => { /* e.g. link input.fileIds to row.id */ })` — runs inside the insert transaction.
- After changing your own tables for a message, broadcast with `ctx.messages.emitUpdated(row, actorId)`.
- Mention wire format in `text`: `<@USERID>`, `<#CONVID>`, `<!channel>`, `<!here>`, `<!everyone>`. Thread replies have `threadRootId`; replies also shown in the channel have `subtype = 'thread_broadcast'`. Soft-deleted messages have `deletedAt` and empty text.

### Events
`ctx.bus.emit({ type, workspaceId, conversationId?, actorId?, payload, audience?, internal? })`.
Every event is forwarded over WS automatically: to `audience` if set (use for per-user events, e.g.
`notification.created`), else to conversation members (+ `payload.userId` for `member.left`),
else to workspace members. `internal: true` keeps it server-side. Payloads core emits:
`message.*` → `{ message }` (serialized with viewer `null`, so `saved=false`; personal copies carry `personal: true`),
`conversation.created|updated|archived` → `{ conversation }`, `member.joined` → `{ conversationId, userId, conversation }`,
`member.left` → `{ conversationId, userId }`, `workspace.member_joined` → `{ workspaceId, member }`,
`user.updated` → `{ user }` (one per workspace), extra: `conversation.read` (audience = reader), `workspace.updated`.
Consume with `ctx.bus.on('reaction.added', (e) => …)` (workflows/webhooks/notifications).

### WebSocket (`server/src/realtime.ts`)
- `ctx.realtime.onClientMessage('huddle.signal', (user, payload, conn) => …)` — add client→server frame types. Built in: `ping`→`pong`, `typing {conversationId, threadRootId?}` → others get `typing {conversationId, userId, threadRootId}`.
- Send: `sendToUser(uid, {type, payload})`, `sendToUsers(ids, frame, exceptUid?)`, `broadcastToConversation(cid, frame, exceptUid?)`, `broadcastToWorkspace(wid, frame, exceptUid?)`.
- Presence helpers: `onConnect((uid, conn) => …)`, `onDisconnect((uid, remaining, conn) => …)`, `isOnline(uid)`, `onlineUserIds()`.

### Tests — `server/test/<module>.test.ts`
```ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, signup } from './helpers';   // temp db per file
let env; before(async () => { env = await makeTestApp(); }); after(() => env.cleanup());
test('…', async () => {
  const ava = await signup(env.app, 'Ava');          // client with cookie: get/post/patch/del → {status, body}
  const ws = (await ava.post('/api/workspaces', { name: 'T' })).body.workspace;
});
```
`env.app.ctx` exposes the full module context (e.g. `env.app.ctx.bus.on('*', …)`).

## Client (`client/src`)

### Your entry files (already wired into the shell — keep the exported props)
| file | rendered where | props |
|---|---|---|
| `features/threads/ThreadPanel.tsx` | right panel (`{kind:'thread'}`) | `workspaceId, conversation, rootId, currentUser, onClose` |
| `features/threads/ThreadsView.tsx` | route `/w/:wid/threads` | `workspaceId, currentUser` |
| `features/reactions/ReactionBar.tsx` | under every message | `message, conversation, currentUser` |
| `features/reactions/EmojiPicker.tsx` | hover-toolbar popover | `onPick(emoji), onClose()` |
| `features/reactions/api.ts` | `toggleReaction(message, emoji, userId)` called by toolbar + bar | |
| `features/files/Attachments.tsx` | under message text | `message, files` |
| `features/files/useUpload.ts` | composer (button, paste, drop) | `useUpload(conversationId)` → `{items, uploading, fileIds, upload(files), remove(key), clear()}`; composer sends `fileIds` |
| `features/files/FilesTab.tsx` | conversation "Files" tab | `workspaceId, conversation, currentUser` |
| `features/search/SearchBox.tsx` | top bar | `workspaceId, workspaceName` |
| `features/search/SearchResults.tsx` | route `/w/:wid/search?q=` | `workspaceId, query, currentUser` |
| `features/notifications/ActivityView.tsx` | route `/w/:wid/activity` | `workspaceId, currentUser` |
| `features/notifications/NotificationPrefs.tsx` | modal `{kind:'notificationPrefs', conversationId?}` | `workspaceId, currentUser, conversation?, onClose` |
| `features/presence/PresenceDot.tsx` | avatars in sidebar/header/members/top bar | `userId, size?, className?` |
| `features/presence/StatusEditor.tsx` | modal `{kind:'status'}` | `currentUser, onClose` |
| `features/presence/ProfilePanel.tsx` | right panel (`{kind:'profile'}`) | `workspaceId, userId, currentUser, onClose` |
| `features/huddles/HuddleButton.tsx` | conversation header | `workspaceId, conversation, currentUser` |
| `features/huddles/HuddleWindow.tsx` | always mounted in shell | `workspaceId, currentUser` |
| `features/canvases/CanvasView.tsx` | conversation "Canvas" tab | `workspaceId, conversation?, canvasId?, currentUser` |
| `features/apps/AppsView.tsx` | route `/w/:wid/apps` | `workspaceId, currentUser` |
| `features/workflows/WorkflowsView.tsx` | route `/w/:wid/workflows` | `workspaceId, currentUser` |
| `features/workflows/WorkflowMessageParts.tsx` | inside every message | `message, conversation, currentUser` |
| `features/<name>/setup.ts` | run once per workspace load (`features/index.ts`) | `({workspaceId, me}) => cleanup` — subscribe to WS here |

Add any other components/stores inside your feature folder.

### Shared client APIs
- `api` (`client/src/api.ts`): `api.get/post/patch/put/del(path, body)`, `api.upload(path, formData)`; throws `ApiError {status, code, message}`.
- `ws` (`client/src/ws.ts`): `ws.on(type, (payload, frame) => …)` → unsubscribe; `ws.send(type, payload)`; `ws.onStatus(fn)`. Core already applies `message.*`, `conversation.*`, `member.*`, `workspace.member_joined`, `user.updated`, `typing` to the stores (`client/src/store/realtime.ts`).
- Stores (`client/src/store/index.ts`, Zustand; use `useX(selector)` in components, `useX.getState()` in handlers):
  - `useSession` — `me`, `workspaces`, `workspaceId`, `members` (by id), `upsertMember`, `setMe`; helpers `useMe()`, `useMember(id)`, `displayName(u)`.
  - `useConversations` — `byId`, `activeId`, `upsert(c, {fromBroadcast})`, `patch(id, partial)`; helpers `useConversation(id)`, `conversationTitle(c, members, me)`, `dmPartnerId(c, meId)`.
  - `useMessages` — `byId`, `channels[cid].ids`, `threads[rootId].ids`, `upsert(m, {keepPersonal})` (places a message in channel/thread lists, reconciles optimistic sends), `patch(id, partial)`, `setThread(rootId, root, replies)`; helper `useMessage(id)`.
  - `useUi` — `rightPanel` / `openRightPanel(p)` / `closeRightPanel()`, `modal` / `openModal(m)` / `closeModal()`, `theme`. Kinds: `{kind:'custom', key, props}` exist for features but the shell does not render them yet (ask core to add a case).
  - `useTyping`, `useTypingUsers(cid, rootId?)`.
  - `actions` (`client/src/store/actions.ts`): `sendMessage`, `editMessage`, `deleteMessage`, `togglePin`, `toggleSave`, `markRead`, `loadThread`, `openDm`, `joinConversation`, `fetchConversation`, `updateConversation`, …
- Shell components you may reuse: `shell/MessageItem.tsx` (`MessageItem`), `shell/Composer.tsx` (`Composer` with `threadRootId`), `shell/TypingIndicator.tsx`, `components/Avatar.tsx`, `components/Icon.tsx`, `components/Modal.tsx`, `lib/markdown.tsx` (`Markdown`, `renderInline`, `plainText`), `lib/time.ts`.
- Styling: hand-written CSS; use the tokens in `client/src/styles/theme.css` (`--brand`, `--accent`, `--mention`, `--bg*`, `--fg*`, `--border`). Put feature CSS in your folder and import it from your component.
