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
  /** doc 52 sections 2.5 and 2.7: a backup code was used to sign in */
  sendBackupCodeUsed(m: { to: string; name: string; at: Date; remaining: number }): Promise<void>;
  /** doc 52 section 2.7: a 2-step method added or removed, backup codes regenerated, 2-step reset by an admin */
  sendMfaChanged(m: {
    to: string;
    name: string;
    at: Date;
    change: 'METHOD_ADDED' | 'METHOD_REMOVED' | 'BACKUP_CODES_REGENERATED' | 'RESET_BY_ADMIN';
    method?: string;
  }): Promise<void>;
  /** doc 52 section 2.2: a one-time code; the body is the only place the code ever appears */
  sendOtpCode(m: {
    to: string;
    name: string;
    code: string;
    expiresAt: Date;
    purpose: 'LOGIN' | 'ENROL_PROOF' | 'ENROL_EMAIL' | 'ENROL_SMS' | 'REAUTH';
  }): Promise<void>;
}

/** Until a mailer is configured nothing is sent (and never logged). */
export const noopAuthMailer: AuthMailer = {
  sendPasswordReset: async () => undefined,
  sendNewLogin: async () => undefined,
  sendPasswordChanged: async () => undefined,
  sendBackupCodeUsed: async () => undefined,
  sendOtpCode: async () => undefined,
  sendMfaChanged: async () => undefined,
};

const UA_IN_MAIL_MAX = 120;

const METHOD_NAMES: Record<string, string> = {
  AUTHENTICATOR: 'authenticator app',
  EMAIL_OTP: 'email code',
  SMS_OTP: 'SMS code',
};

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

    sendOtpCode: (m) =>
      mailer.send(
        message(
          m.to,
          m.purpose === 'LOGIN' || m.purpose === 'REAUTH'
            ? `${m.code} is your ZOAURO Admin sign-in code`
            : `${m.code} is your ZOAURO Admin verification code`,
          [
            `Hello ${m.name},`,
            `Your code is ${m.code}. It works once, until ${formatIst(m.expiresAt)}.`,
            'Never share this code. Nobody from ZOAURO will ever ask you for it.',
            'If you did not just sign in or set up 2-step verification, change your password and tell your Super Admin.',
          ],
        ),
      ),

    sendMfaChanged: (m) => {
      const what = {
        METHOD_ADDED: `A 2-step method (${METHOD_NAMES[m.method ?? ''] ?? 'a method'}) was added to your account`,
        METHOD_REMOVED: `A 2-step method (${METHOD_NAMES[m.method ?? ''] ?? 'a method'}) was removed from your account`,
        BACKUP_CODES_REGENERATED:
          'New backup codes were generated for your account; the old ones no longer work',
        RESET_BY_ADMIN:
          'A Super Admin reset your 2-step verification. All your sessions were signed out; you will set it up again at your next sign-in',
      }[m.change];
      return mailer.send(
        message(m.to, 'Your ZOAURO Admin 2-step verification changed', [
          `Hello ${m.name},`,
          `${what} on ${formatIst(m.at)}.`,
          IF_NOT_YOU,
        ]),
      );
    },

    sendBackupCodeUsed: (m) =>
      mailer.send(
        message(m.to, 'A backup code was used to sign in', [
          `Hello ${m.name},`,
          `A backup code was used to sign in to your account on ${formatIst(m.at)}. Each code works once; you have ${m.remaining} left.`,
          m.remaining <= 3
            ? 'You are running low: generate new backup codes in Account security.'
            : 'If you lost your phone, add a new authenticator in Account security.',
          IF_NOT_YOU,
        ]),
      ),
  };
}
