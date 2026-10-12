import { escapeHtml, type MailMessage, type Mailer } from '../../lib/mailer';

// Auth emails (doc 52 section 2.7, doc 14 section 2): reset link, new-login notice, password changed. None of them
// contains a link that signs in or turns off a second step; the reset link only lets the holder set a new password.

export interface AuthMailer {
  sendPasswordReset(m: { to: string; name: string; token: string; expiresAt: Date }): Promise<void>;
  sendNewLogin(m: {
    to: string;
    name: string;
    at: Date;
    ip: string | null;
    userAgent: string | null;
  }): Promise<void>;
  sendPasswordChanged(m: { to: string; name: string; at: Date; ip: string | null }): Promise<void>;
}

/** Until a mailer is configured nothing is sent (and never logged). */
export const noopAuthMailer: AuthMailer = {
  sendPasswordReset: async () => undefined,
  sendNewLogin: async () => undefined,
  sendPasswordChanged: async () => undefined,
};

const UA_IN_MAIL_MAX = 120;

/** Times in mails are shown in India Standard Time, as the panel shows them (doc 19). */
export function formatIst(at: Date): string {
  return `${new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at)} IST`;
}

function message(
  to: string,
  subject: string,
  lines: string[],
  link?: { href: string; label: string },
): MailMessage {
  const text = [...lines, ...(link ? ['', `${link.label}: ${link.href}`] : [])].join('\n');
  const html = [
    ...lines.map((l) => (l === '' ? '' : `<p>${escapeHtml(l)}</p>`)),
    ...(link ? [`<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p>`] : []),
  ]
    .filter((l) => l !== '')
    .join('\n');
  return { to, subject, text, html };
}

const IF_NOT_YOU =
  'If this was not you, reset your password now and tell your Super Admin. Nobody from ZOAURO will ever ask you for a code.';

export function createAuthMailer(mailer: Mailer, opts: { appUrl: string }): AuthMailer {
  const base = opts.appUrl.replace(/\/+$/, '');
  return {
    sendPasswordReset: (m) =>
      mailer.send(
        message(
          m.to,
          'Reset your ZOAURO Admin password',
          [
            `Hello ${m.name},`,
            `Someone asked to reset the password of your ZOAURO Admin account. The link works once, until ${formatIst(m.expiresAt)}.`,
            'If you did not ask for this, ignore this email; your password stays as it is.',
          ],
          {
            href: `${base}/reset-password?token=${encodeURIComponent(m.token)}`,
            label: 'Set a new password',
          },
        ),
      ),

    sendNewLogin: (m) =>
      mailer.send(
        message(m.to, 'New sign-in to your ZOAURO Admin account', [
          `Hello ${m.name},`,
          `Your account was signed in to on ${formatIst(m.at)}.`,
          `IP address: ${m.ip ?? 'unknown'}`,
          `Device: ${(m.userAgent ?? 'unknown').slice(0, UA_IN_MAIL_MAX)}`,
          IF_NOT_YOU,
        ]),
      ),

    sendPasswordChanged: (m) =>
      mailer.send(
        message(m.to, 'Your ZOAURO Admin password was changed', [
          `Hello ${m.name},`,
          `The password of your account was changed on ${formatIst(m.at)} (IP address: ${m.ip ?? 'unknown'}). Sessions on other devices were signed out.`,
          IF_NOT_YOU,
        ]),
      ),
  };
}
