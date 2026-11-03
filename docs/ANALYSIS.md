# Fellowship — product analysis

Fellowship is an original team-messaging app in the same category as Slack. This analysis is
built from Slack's **publicly observable** behaviour (its website, help-center docs and how the
product behaves for an ordinary user). We do not decompile, copy or reuse Slack's client code,
assets, logos, colours or copy. Fellowship has its own brand, palette and wording.

## 1. Information architecture

```
Organisation (optional, skipped)
└── Workspace            (name, slug, icon, invite link, owner/admins/members/guests)
    ├── Members          (profile, display name, title, timezone, status, presence)
    ├── Channels         (public / private, topic, description, members, pins, bookmarks)
    │   └── Messages     (rich text, mentions, files, reactions, edits, threads)
    ├── Conversations    (1:1 DM, group DM of up to 8, self-DM "notes to self")
    ├── Canvases         (standalone docs + one canvas per channel)
    ├── Huddles          (live audio/video/screen per channel or DM)
    ├── Workflows        (trigger → ordered steps, with branches, forms, approvals)
    ├── Apps & bots      (bot users, incoming webhooks, slash commands, event subscriptions)
    └── Saved items, reminders, drafts, activity feed
```

## 2. UI/UX layout (desktop web)

| Region | What it holds |
|---|---|
| Workspace rail (far left) | Workspace switcher icons, "+" add workspace, Home/DMs/Activity/More tabs |
| Sidebar | Workspace name menu, "New message" compose button, sections: Threads, Huddles, Drafts & sent, Saved, Channels, Direct messages, Apps; unread channels bold, mention badges |
| Top bar | Back/forward history, global search box (with scoped filters), help, your avatar + presence |
| Conversation header | Name, member avatars + count, huddle button, tabs (Messages, Canvas, Files, Pins, Workflows), details "i" |
| Message list | Day dividers, "new messages" line, grouped consecutive messages (same author within 5 min), hover toolbar (react, reply in thread, share, save, more), reactions row, thread summary ("3 replies, last reply 2m ago") |
| Composer | Rich text (bold/italic/strike/code/link/lists/quote/code block), `@` mention autocomplete, `#` channel autocomplete, `:` emoji autocomplete, `/` slash commands, attach files (button, drag-drop, paste), schedule send, Enter to send / Shift+Enter newline, draft persistence per conversation |
| Right panel | Thread view, member profile, channel details, search results, canvas, huddle |

Key interactions: ⌘/Ctrl+K quick switcher, ↑ to edit last message, Esc to mark read, typing
indicators ("Ana is typing…"), unread jump, keyboard navigation, light/dark theme.

## 3. Feature inventory and behaviour

### Messaging
- **Channels**: create (name lowercase, `-`, ≤80 chars), public/private, join/leave, browse,
  topic & description, archive, rename, add/remove members, `#general` default (can't leave).
- **DMs / group DMs**: start from compose; group DM is a conversation keyed by the member set.
- **Messages**: create, edit (shows "(edited)"), delete (shows "This message was deleted" if it has
  replies), markdown-like formatting, link unfurls, code blocks, pinned, saved/bookmarked.
- **Threads**: reply to any root message; optional "also send to #channel"; thread followers get
  notified; "Threads" view lists followed threads with unread replies.
- **Reactions**: any emoji, toggle, count + who reacted tooltip, quick-react bar.
- **Mentions**: `@user`, `@channel`, `@here` (online members only), `@everyone`; highlights + notify.
- **Read state**: per-member `last_read` cursor per conversation → unread counts + mention badges.

### Files
Upload via button / drag / paste, multiple files, image/video preview, file details, per-channel
Files tab, delete; storage limits configurable.

### Search
Full-text over messages and files; modifiers `in:#channel`, `from:@user`, `has:link|file|reaction`,
`before:`/`after:`/`on:` dates, `is:thread`; results grouped by Messages / Files / Channels / People.

### Notifications & activity
Per-user preferences (all / mentions & DMs / nothing), per-channel overrides, muting, keywords,
Do-not-disturb schedule, browser desktop notifications, activity feed (mentions, reactions to your
messages, thread replies), badge counts.

### Presence & profiles
Active / away (auto after inactivity, or manual), custom status (emoji + text + expiry), profile
fields (full name, display name, title, pronouns, phone, timezone with local time, avatar).

### Huddles
Start in any channel/DM, audio first, toggle camera, screen share, participant list with speaking
indicator, join/leave, live "huddle in progress" badge in sidebar, huddle thread for chat.

### Canvases
Rich document per channel (tab) plus standalone canvases; headings, lists, checklists, embedded
mentions; concurrent editing with presence cursors; share to channel.

### Apps, bots & integrations
Bot users that can post, incoming webhooks (POST JSON to a URL → message in a channel), slash
commands (POST to an external URL, respond in-channel or ephemeral), outgoing event subscriptions
(message.posted, reaction.added, member.joined…), app tokens, interactive buttons in messages.

### Workflow Builder
- **Triggers**: from a link/shortcut, emoji reaction added, member joins channel, new message in
  channel matching text, scheduled (once / daily / weekly / cron), incoming webhook.
- **Steps**: send message (to channel / user / trigger user), send form (collect fields, store
  responses), request approval (approve/deny buttons → branch), add reaction, create channel, invite
  to channel, update canvas, wait/delay, call webhook (HTTP), set variable.
- **Logic**: variables from trigger and earlier steps (`{{trigger.user}}`, `{{steps.form1.answer}}`),
  conditional branches (if/else on comparisons), run history with per-step status and errors.
- Publish / unpublish, owners/collaborators, run log.

### Admin
Invite by link/email, roles (owner, admin, member, guest), deactivate members, workspace settings,
channel posting permissions, data export.

## 4. Architecture observations → technology choices

| Concern | Observed product need | Fellowship choice |
|---|---|---|
| Real-time fan-out | Sub-second message, typing, presence, reaction delivery to every open client | Single WebSocket per client to a Node hub; server pushes typed events; clients reconcile optimistically |
| API | CRUD for every object, idempotent message send | REST JSON (Fastify + zod) with a client-generated `clientMsgId` for dedupe |
| Storage | Relational data, read cursors, full-text search | SQLite (Node's built-in `node:sqlite`) with WAL + FTS5; schema is portable to Postgres |
| Files | Uploads with previews | Local disk store behind an interface (swap for S3 later) |
| Media | Group audio/video/screen with low latency | WebRTC mesh (≤ 8 peers) with signalling over the existing WebSocket; STUN only |
| Events | Workflows, webhooks, notifications triggered by domain events | In-process event bus; every domain write emits an event consumed by realtime, notifications, workflows, outgoing webhooks |
| Workflow execution | Durable runs, delays, approvals that wait for humans | Persisted run/step state machine in SQLite; scheduler tick every second resumes due runs; approvals/forms park a run until answered |
| Collaborative docs | Concurrent canvas editing | Block-based document, per-block last-writer-wins with version numbers, live broadcast + presence |
| Front-end | Dense, keyboard-driven SPA | React 19 + TypeScript + Vite, Zustand store, CSS variables theming |

Docker isn't installed on this machine, so the stack runs with nothing but Node 24 — no Redis or
Postgres needed. Scaling path: swap SQLite → Postgres, the in-process bus → Redis/NATS pub-sub, and
the WebRTC mesh → an SFU (e.g. LiveKit / mediasoup).
