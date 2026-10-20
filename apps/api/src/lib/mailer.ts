import nodemailer from 'nodemailer';

// Outbound email (doc 06: SMTP locally to Mailpit, an SMTP provider or SES later). One small port so modules never
// depend on the transport, and tests use a capture double. Message bodies may hold reset links or codes: they are
// never logged; a failed send logs the error class only.

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** When SMTP_URL is not set: nothing is sent (and nothing is logged, so no link or code can leak into logs). */
export const noopMailer: Mailer = { send: async () => undefined };

/** Default sender when SES_FROM_ADDRESS is not set (doc 12). */
export const DEFAULT_FROM = 'ZOAURO Admin <no-reply@zoauro.local>';

/** SMTP through nodemailer; `transport` lets tests use nodemailer's JSON transport instead of a server. */
export function createSmtpMailer(opts: {
  smtpUrl?: string;
  from?: string;
  transport?: Parameters<typeof nodemailer.createTransport>[0];
}): Mailer & { transporter: ReturnType<typeof nodemailer.createTransport> } {
  const transporter = nodemailer.createTransport(opts.transport ?? opts.smtpUrl);
  const from = opts.from ?? DEFAULT_FROM;
  return {
    transporter,
    async send(m) {
      await transporter.sendMail({
        from,
        to: m.to,
        subject: m.subject,
        text: m.text,
        html: m.html,
      });
    },
  };
}

/** Escapes text for an HTML body (names and user agents are user-controlled). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Fire and forget for notices: the response must not wait for (or reveal) mail delivery. */
export function sendInBackground(mailer: Mailer, message: MailMessage, what: string): void {
  mailer
    .send(message)
    .catch((err: unknown) =>
      console.error(`${what} mail failed (${err instanceof Error ? err.name : 'unknown'})`),
    );
}
