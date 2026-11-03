# Email verification and the mailer

Only people who have proved they own their email address can sign in. Email goes out through
[Brevo](https://www.brevo.com/) (formerly Sendinblue) transactional email.

## Configuration

Copy `.env.example` to `.env` in the repo root (it is git-ignored; the API server loads it on start)
and set:

| variable | meaning |
|---|---|
| `BREVO_API_KEY` | Brevo API key (Settings → SMTP & API → API keys). Never commit it. |
| `BREVO_SENDER_EMAIL` | From address. Must be a sender or domain verified in Brevo. Required when the key is set. |
| `BREVO_SENDER_NAME` | From name, default `Fellowship`. |
| `APP_URL` | Public URL of the web client, used for magic links. Default `http://localhost:5173`. |

Restart `npm run dev` after editing `.env`.

**Without `BREVO_API_KEY`** the server does not call Brevo. Outside production it prints each email
(including the code and link) to the server console as `[mail] email would be sent to …`, so local
sign-up works. With `NODE_ENV=production` and no key, sending fails with a 502 `email_failed`.
Tests always use an in-memory outbox (`app.ctx.mailer.outbox`) and never touch the network.

Sending uses `POST https://api.brevo.com/v3/smtp/email` with the `api-key` header, via Node's
built-in `fetch` with a 10 s timeout (`server/src/mailer.ts`). The key is never logged.

## Flow

1. `POST /api/auth/signup` creates an **unverified** account and emails a 6-digit code plus a magic
   link (`/verify?token=…`). It does not sign in. Response:
   `{ verificationRequired: true, email, emailSent, resendAfter }`.
2. `POST /api/auth/verify` with `{ email, code }` or `{ token }` marks the email verified, starts a
   session (`fs_session` cookie) and returns `{ user }`.
3. `POST /api/auth/login` with the right password for an unverified account returns
   403 `email_unverified`; the client then offers to send a code.
4. `requireUser` returns 403 `email_unverified` for a session whose user is not verified; WebSocket
   connections from such sessions are refused.

Codes and links (`email_codes` table, core migration 1):

- stored as SHA-256 hashes only; expire after 15 minutes; single use (the code and link of one email
  share a row, so using either spends both); requesting a new one invalidates the previous one;
- 5 wrong codes kill the code (429 `too_many_attempts`);
- sending is limited per account and purpose: one per 60 s and five per hour
  (429 `rate_limited`, with `error.retryAfter` in seconds). A failed send does not count.

Other endpoints over the same mailer:

- `POST /api/auth/resend` `{ email }` — send a new code. For an already verified account this is a
  passwordless sign-in code ("Email me a sign-in code" on the login screen). Unknown addresses get
  the same `{ ok: true }` response and no email.
- `POST /api/auth/password/forgot` `{ email }` — email a reset code + link (`/reset-password?token=…`).
- `POST /api/auth/password/reset` `{ email, code, password }` or `{ token, password }` — set the new
  password, sign out every existing session, verify the email if needed, and sign in.

Error codes: `invalid_code`, `code_expired`, `invalid_link`, `link_expired`, `too_many_attempts`,
`rate_limited`, `email_failed`, `email_unverified`.

## Existing users

The migration marks the demo users (`ava@`, `ben@`, `cleo@fellowship.test`) and all bots as verified;
`npm run seed` creates the demo users verified. Any other existing account must verify on its next
sign-in (the login screen offers to send the code). `ctx.core.createUser({ …, verified: true })`
creates a pre-verified user; bot users are always verified.

## Client screens

`/signup` → `/verify?email=…` (code entry, resend with cooldown) → app. `/verify?token=…` is the
magic-link landing. `/forgot-password` → `/reset-password?email=…` or `?token=…`.
Code lives in `client/src/pages/AuthPage.tsx` and `client/src/pages/VerifyPages.tsx`.
