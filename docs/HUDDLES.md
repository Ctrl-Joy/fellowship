# Huddles

Live audio, camera and screen share inside any channel or DM. Server code:
`server/src/modules/huddles/`, client: `client/src/features/huddles/`.

## Model
- `huddles(id, conversation_id, workspace_id, started_by, started_at, ended_at, message_id)`. A partial
  unique index keeps **one active huddle per conversation**.
- `huddle_participants(huddle_id, user_id, joined_at, left_at, muted, video, screen)`. Re-joining
  reuses the row (`left_at` reset), so the end summary lists everyone who took part.
- Starting a huddle posts a system message (`subtype: 'huddle'`, `meta.huddleId`). Its thread is the
  huddle chat. When the huddle ends, that message is rewritten to "Huddle ended · 12 min · Ava, Ben"
  (`meta.status = 'ended'`, `durationMs`, `participantIds`).

## API (members only. Reading also works for public channels)
| method | path | |
|---|---|---|
| POST | `/api/conversations/:cid/huddle/join` `{muted?}` | join, or start if none is active (409 `huddle_full` past 8) |
| POST | `/api/conversations/:cid/huddle/leave` | leave. The last one out ends the huddle |
| PATCH | `/api/conversations/:cid/huddle/me` `{muted?, video?, screen?}` | my media state |
| GET | `/api/conversations/:cid/huddle` | active huddle or `null` |
| GET | `/api/w/:wid/huddles` | active huddles in conversations I belong to |
| GET | `/api/huddles/:hid` | one huddle (any state) |

Joining a huddle somewhere else leaves your current one. Leaving the channel removes you from its
huddle. Archiving it ends the huddle.

Events go to the members of the conversation: `huddle.started | huddle.updated | huddle.ended`, with
payload `{ huddle, change }`. `change` is one of `{type:'joined'|'left'|'media', userId, reason?}`.

## WebSocket
- `huddle.attach {huddleId}`: marks this socket as the one carrying my media (one tab). The server
  replies `huddle.attached` or `huddle.attach_error`.
- `huddle.signal {huddleId, to, data}`: relayed as `{huddleId, from, data}` only when the sender
  and `to` are both current participants of that active huddle. It goes to the recipient's attached
  socket. Rejections come back as `huddle.signal_error {reason}`.
- **Disconnects**: when the attached socket closes, or the user's last socket closes, a grace timer
  starts (15 s, `HUDDLE_GRACE_MS`). Re-attaching or reconnecting cancels it. Otherwise the user is
  removed, and an empty huddle ends. Participants left over from a server restart get the same
  grace period.

## Client media
- **Full-mesh WebRTC**: one `RTCPeerConnection` per remote participant, STUN
  `stun:stun.l.google.com:19302`.
- **Perfect negotiation**: the user with the greater id is *polite*. Simultaneous joins and
  simultaneous track changes resolve without glare. Every signal carries a per-session `sid`, so a
  peer that reloads gets a fresh connection.
- **Mic**: requested on join. If it's denied, you join listen-only with a notice. Clicking the mic
  button retries.
  - Mute uses `track.enabled`.
  - Changing devices uses `replaceTrack`.
- **Camera**: `addTrack` when it's turned on and `removeTrack` when it's turned off, with
  renegotiation each time. Switching devices uses `replaceTrack`.
- **Screen share**: `getDisplayMedia` adds an extra track in its own stream, announced through
  `data.meta.screen`. The browser's "stop sharing" ends the track, which stops the share.
- **Speaking indicator**: a WebAudio `AnalyserNode` per audio stream (RMS with hysteresis).
- **Chimes**: join and leave chimes are generated with oscillators.

## Mesh limit and the SFU upgrade path
The mesh is capped at **8 participants** (`MAX_PARTICIPANTS`). With N people, each browser
encodes and uploads N-1 copies of its audio and video. At 8 with cameras on, that's 7 uplinks per
person, which is about the practical limit for typical home upload bandwidth and laptop CPUs.
Audio-only huddles hold up much better than video ones.

To go beyond this, add a Selective Forwarding Unit (for example mediasoup, LiveKit or Janus):
1. Each client publishes **one** upstream per track, ideally with simulcast layers.
2. The SFU forwards the right layer to each subscriber.
3. The client swaps `MeshEngine` for a single connection to the SFU (or the SFU's SDK).
   `call.ts` keeps the same API (`setMic`, `setCamera`, `setScreen`), so the UI doesn't change.
4. The server keeps owning huddle state, membership checks and the `huddle.*` events. It mints
   short-lived SFU join tokens in `/huddle/join` instead of relaying `huddle.signal`.
5. Add TURN (for example coturn) for users behind symmetric NATs. STUN alone won't connect every
   network, and that applies to the mesh today too.

## Tests
- `server/test/huddles.test.ts` covers the REST lifecycle, system message and summary, every
  permission rule, the mesh limit, and leave-on-channel-leave.
- `server/test/huddles-ws.test.ts` uses real sockets with a 300 ms grace period. It covers:
  - two users relaying offer, answer and ICE, with the exact frame sequence asserted for each socket
  - rejection reasons
  - delivery to the attached tab only
  - reconnecting within the grace period
  - auto-leave and auto-end on disconnect
  - participants who never connect
