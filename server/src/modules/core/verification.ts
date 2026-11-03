import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { ModuleContext } from '../../context';
import type { UserRow } from '../../auth';
import { randomToken } from '../../ids';
import { HttpError, badRequest } from '../../errors';
import { MailError, type MailMessage } from '../../mailer';

/** One emailed code + magic link. 'verify' doubles as passwordless sign-in. */
export type CodePurpose = 'verify' | 'reset';

export const CODE_TTL_MS = 15 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const MAX_SENDS_PER_HOUR = 5;
export const MAX_ATTEMPTS = 5;

interface CodeRow {
  id: string;
  user_id: string;
  purpose: CodePurpose;
  code_hash: string;
  link_hash: string;
  attempts: number;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hashCode = (userId: string, code: string) => sha256(`${userId}:${code}`);

const tooMany = (message: string, retryAfterMs: number) =>
  new HttpError(429, 'rate_limited', message, { retryAfter: Math.ceil(retryAfterMs / 1000) });

export function createVerification(ctx: ModuleContext) {
  const { db, ids, mailer, config } = ctx;

  function sendRateCheck(userId: string, purpose: CodePurpose, now: number) {
    const recent = db.prepare(
      'SELECT created_at FROM email_codes WHERE user_id = ? AND purpose = ? AND created_at > ? ORDER BY created_at DESC',
    ).all(userId, purpose, now - 60 * 60 * 1000) as unknown as { created_at: number }[];
    if (recent.length && now - recent[0].created_at < RESEND_COOLDOWN_MS) {
      throw tooMany('Please wait a moment before requesting another code', RESEND_COOLDOWN_MS - (now - recent[0].created_at));
    }
    if (recent.length >= MAX_SENDS_PER_HOUR) {
      const oldest = recent[recent.length - 1].created_at;
      throw tooMany('Too many codes requested. Try again later', oldest + 60 * 60 * 1000 - now);
    }
  }

  function composeEmail(user: UserRow, purpose: CodePurpose, code: string, token: string): MailMessage {
    const name = user.display_name || user.full_name;
    const path = purpose === 'reset' ? '/reset-password' : '/verify';
    const link = `${config.appUrl}${path}?token=${encodeURIComponent(token)}`;
    const [subject, intro, action] = purpose === 'reset'
      ? [`Reset your Fellowship password`, 'Use this code to choose a new password:', 'Reset password']
      : [`Your Fellowship code: ${code}`, 'Use this code to confirm your email and sign in to Fellowship:', 'Confirm and sign in'];
    const text = [
      `Hi ${name},`, '', intro, '', `    ${code}`, '', `Or open this link: ${link}`, '',
      'The code and link expire in 15 minutes and work once. If you did not ask for this, you can ignore this email.',
    ].join('\n');
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    const html = `<!doctype html><html><body style="margin:0;background:#F4F7F6;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1D2B27">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:12px;padding:32px">
<tr><td style="font-size:20px;font-weight:800;color:#1F6F5C;padding-bottom:16px">Fellowship</td></tr>
<tr><td style="font-size:15px;line-height:1.5">Hi ${esc(name)},<br><br>${intro}</td></tr>
<tr><td style="font-size:32px;font-weight:700;letter-spacing:8px;padding:20px 0;font-family:Consolas,monospace">${code}</td></tr>
<tr><td><a href="${esc(link)}" style="display:inline-block;background:#1F6F5C;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${action}</a></td></tr>
<tr><td style="font-size:13px;color:#5B6B66;padding-top:24px;line-height:1.5">The code and link expire in 15 minutes and work once. If you did not ask for this, you can ignore this email.</td></tr>
</table></td></tr></table></body></html>`;
    return { to: user.email, toName: user.full_name, subject, text, html };
  }

  /** Create a fresh code + link (invalidating older ones) and email it. Throws 429 when rate-limited. */
  async function issue(user: UserRow, purpose: CodePurpose): Promise<{ expiresAt: number; resendAfter: number }> {
    const now = Date.now();
    sendRateCheck(user.id, purpose, now);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const token = randomToken(32);
    const id = ids.next('EC');
    db.prepare('UPDATE email_codes SET consumed_at = ? WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL')
      .run(now, user.id, purpose);
    db.prepare(
      `INSERT INTO email_codes (id, user_id, purpose, code_hash, link_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, user.id, purpose, hashCode(user.id, code), sha256(token), now, now + CODE_TTL_MS);
    try {
      await mailer.send(composeEmail(user, purpose, code, token));
    } catch (err) {
      // Don't let a failed send count against the cooldown.
      db.prepare('DELETE FROM email_codes WHERE id = ?').run(id);
      const message = err instanceof MailError ? err.message : 'Could not send email';
      console.error(`[mail] send to ${user.email} failed: ${message}`);
      throw new HttpError(502, 'email_failed', 'We could not send the email. Please try again shortly');
    }
    return { expiresAt: now + CODE_TTL_MS, resendAfter: Math.ceil(RESEND_COOLDOWN_MS / 1000) };
  }

  /** Check a typed 6-digit code against the user's latest one; consumes it on success. */
  function consumeCode(userId: string | undefined, purpose: CodePurpose, rawCode: string): void {
    const code = rawCode.replace(/[\s-]/g, '');
    const invalid = () => badRequest('That code is not right. Check the email and try again', 'invalid_code');
    if (!userId || !/^\d{6}$/.test(code)) throw invalid();
    const row = db.prepare(
      'SELECT * FROM email_codes WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1',
    ).get(userId, purpose) as unknown as CodeRow | undefined;
    if (!row) throw invalid();
    const now = Date.now();
    if (row.expires_at <= now) throw badRequest('That code has expired. Request a new one', 'code_expired');
    const ok = timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(hashCode(userId, code), 'hex'));
    if (!ok) {
      const attempts = row.attempts + 1;
      db.prepare('UPDATE email_codes SET attempts = ?, consumed_at = ? WHERE id = ?')
        .run(attempts, attempts >= MAX_ATTEMPTS ? now : null, row.id);
      if (attempts >= MAX_ATTEMPTS) {
        throw new HttpError(429, 'too_many_attempts', 'Too many wrong codes. Request a new one');
      }
      throw invalid();
    }
    const res = db.prepare('UPDATE email_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').run(now, row.id);
    if (res.changes !== 1) throw invalid();
  }

  /** Redeem a magic-link token; returns the user id. Single use. */
  function consumeLink(token: string, purpose: CodePurpose): string {
    const row = db.prepare('SELECT * FROM email_codes WHERE link_hash = ? AND purpose = ?')
      .get(sha256(token), purpose) as unknown as CodeRow | undefined;
    if (!row || row.consumed_at != null) {
      throw badRequest('This link has already been used or replaced by a newer one', 'invalid_link');
    }
    const now = Date.now();
    if (row.expires_at <= now) throw badRequest('This link has expired. Request a new one', 'link_expired');
    const res = db.prepare('UPDATE email_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').run(now, row.id);
    if (res.changes !== 1) throw badRequest('This link has already been used', 'invalid_link');
    return row.user_id;
  }

  return { issue, consumeCode, consumeLink };
}

export type Verification = ReturnType<typeof createVerification>;
