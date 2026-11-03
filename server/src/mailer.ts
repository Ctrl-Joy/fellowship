/**
 * Transactional email. Uses Brevo's HTTP API when BREVO_API_KEY is set; otherwise prints the
 * email to the server console (non-production only) so local sign-up works without a provider.
 * Tests get an in-memory outbox and never reach the network.
 */

export interface MailMessage {
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /** 'brevo' | 'console' | 'memory' | 'disabled' — handy for logs and tests. */
  kind: string;
  send(msg: MailMessage): Promise<void>;
  /** Only the memory mailer records messages. */
  outbox?: MailMessage[];
}

export class MailError extends Error {}

export const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export interface BrevoOptions {
  apiKey: string;
  senderEmail: string;
  senderName: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createBrevoMailer(opts: BrevoOptions): Mailer {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    kind: 'brevo',
    async send(msg) {
      let res: Response;
      try {
        res = await doFetch(BREVO_ENDPOINT, {
          method: 'POST',
          headers: { 'api-key': opts.apiKey, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            sender: { email: opts.senderEmail, name: opts.senderName },
            to: [{ email: msg.to, ...(msg.toName ? { name: msg.toName } : {}) }],
            subject: msg.subject,
            htmlContent: msg.html,
            textContent: msg.text,
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        });
      } catch (err: any) {
        throw new MailError(err?.name === 'TimeoutError' ? 'Brevo request timed out' : `Brevo request failed: ${err?.message ?? err}`);
      }
      if (!res.ok) {
        // Brevo error bodies are { code, message }; never echo our request (it carries the key header).
        let detail = '';
        try { detail = ((await res.json()) as any)?.message ?? ''; } catch { /* ignore */ }
        throw new MailError(`Brevo rejected the email (${res.status})${detail ? `: ${detail}` : ''}`);
      }
    },
  };
}

export function createMemoryMailer(): Mailer & { outbox: MailMessage[] } {
  const outbox: MailMessage[] = [];
  return { kind: 'memory', outbox, async send(msg) { outbox.push(msg); } };
}

function createConsoleMailer(): Mailer {
  return {
    kind: 'console',
    async send(msg) {
      console.log(`\n[mail] email would be sent to ${msg.to} (BREVO_API_KEY unset)\n  Subject: ${msg.subject}\n${msg.text.replace(/^/gm, '  ')}\n`);
    },
  };
}

function createDisabledMailer(): Mailer {
  return {
    kind: 'disabled',
    async send() { throw new MailError('Email is not configured on this server (set BREVO_API_KEY)'); },
  };
}

/** Pick a mailer from the environment (BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME). */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env, isTest = false): Mailer {
  if (isTest) return createMemoryMailer();
  const apiKey = env.BREVO_API_KEY?.trim();
  if (apiKey) {
    const senderEmail = env.BREVO_SENDER_EMAIL?.trim();
    if (!senderEmail) throw new Error('BREVO_SENDER_EMAIL must be set when BREVO_API_KEY is set');
    return createBrevoMailer({ apiKey, senderEmail, senderName: env.BREVO_SENDER_NAME?.trim() || 'Fellowship' });
  }
  return env.NODE_ENV === 'production' ? createDisabledMailer() : createConsoleMailer();
}
