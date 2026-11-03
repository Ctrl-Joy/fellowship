# Deploying to Render

Fellowship runs as **one Render web service**: the Node server serves the API, the WebSocket
endpoint and the built web client. Everything is described in `render.yaml` at the repo root.

The blueprint uses Render's **free plan** (no card needed). Free instances have no persistent
disk and sleep after about 15 minutes idle, so **all data is wiped** whenever the service
restarts, sleeps or redeploys, and the first visit after a sleep takes 30 to 60 seconds. That suits
demos. To keep data, see "Keeping data" below.

## First deploy

1. In the Render dashboard choose **New → Blueprint** and pick the `Ctrl-Joy/fellowship`
   repository (connect GitHub to Render if asked).
2. Render reads `render.yaml` and shows one service, `fellowship`, on the free plan.
3. Fill in the two secret values it asks for:
   - `BREVO_API_KEY`: your Brevo API key
   - `BREVO_SENDER_EMAIL`: a sender address verified in Brevo
4. Click **Apply**. The first build takes a few minutes. The app is then live at
   `https://fellowship-<something>.onrender.com`.

Without the Brevo values, sign-up still creates accounts but no verification email is sent, so
nobody can finish signing in.

## What the blueprint sets

| setting | value | why |
|---|---|---|
| plan | `free` | no card needed; no persistent disk, sleeps when idle |
| build | `npm ci --include=dev && npm run build` | type-checks the server and builds the client into `client/dist` |
| start | `npm start -w server` | runs the server with `tsx`; it serves `client/dist` too |
| `NODE_VERSION` | `24` | the database uses Node's built-in `node:sqlite` |
| `HOST`, `API_PORT` | `0.0.0.0`, `10000` | listen where Render routes traffic |
| health check | `/api/health` | Render restarts the service if it stops answering |

The public URL used in email links comes from Render's `RENDER_EXTERNAL_URL`. Set `APP_URL` to
override it, for example with a custom domain.

## Updates

`autoDeploy` is on: every push to `master` builds and deploys again.

## Keeping data

Switch `plan` to `starter` (paid), uncomment the `disk` block in `render.yaml` and add
`FELLOWSHIP_DB=/var/data/fellowship.db`. The database and uploads (`/var/data/uploads`) then survive
restarts and deploys.

## Notes

- Huddles use the browser's camera and microphone, which need HTTPS. Render provides it.
- Huddles connect people directly (WebRTC mesh with STUN). Some strict networks also need a TURN
  server; see `docs/HUDDLES.md`.
