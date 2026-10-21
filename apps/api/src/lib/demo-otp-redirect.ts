import type { AuthMailer } from '../modules/auth/auth.mails';

// DEMO ONLY (owner, 2026-10-21): during the demo on zoauro_demo, the one-time sign-in and verification codes of the
// demo logins (@zoauro.demo addresses that have no real mailbox) are ALSO sent to the inboxes of the people presenting.
//  - only `sendOtpCode`; every other mail (reset links, notices, member emails) is untouched;
//  - the normal send happens first and unchanged, so a copy still lands where it always does (Mailpit locally);
//  - the copy goes through its own SMTP transport (DEMO_OTP_SMTP_URL), to the address the map gives for that login;
//  - the account, the audit trail and the code are the real account's: only the copy's recipient differs;
//  - the env schema refuses it unless DEMO_MODE=true, and refuses DEMO_* entirely when NODE_ENV=production;
//  - no address and no code is ever logged; a failed copy logs the error class only and never blocks the sign-in.

/** `login@x=inbox@y` pairs separated by commas or semicolons; keys and values are email addresses (lowercased). */
export function parseOtpRedirect(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of raw.split(/[,;]/)) {
    const pair = part.trim();
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const from = pair.slice(0, eq).trim().toLowerCase();
    const to = pair
      .slice(eq + 1)
      .trim()
      .toLowerCase();
    const email = /^[^\s@=]+@[^\s@=]+\.[^\s@=]+$/;
    if (eq < 1 || !email.test(from) || !email.test(to))
      throw new Error('DEMO_OTP_REDIRECT: every entry must be login-email=inbox-email');
    map.set(from, to);
  }
  if (map.size === 0) throw new Error('DEMO_OTP_REDIRECT: no entries');
  return map;
}

/** The copy's sender: the SMTP account itself (a mail provider rejects or rewrites any other From). */
export function demoCopyFrom(smtpUrl: string): string | undefined {
  try {
    const user = decodeURIComponent(new URL(smtpUrl).username);
    return user.includes('@') ? `ZOAURO Demo <${user}>` : undefined;
  } catch {
    return undefined;
  }
}

export function withDemoOtpRedirect(
  base: AuthMailer,
  copy: Pick<AuthMailer, 'sendOtpCode'>,
  redirect: ReadonlyMap<string, string>,
  onCopyError: (err: unknown) => void = (err) =>
    console.error(`demo code copy not sent ${err instanceof Error ? err.name : 'unknown'}`),
): AuthMailer {
  return {
    ...base,
    sendOtpCode: async (m) => {
      await base.sendOtpCode(m);
      const inbox = redirect.get(m.to.toLowerCase());
      if (!inbox) return;
      try {
        await copy.sendOtpCode({ ...m, to: inbox });
      } catch (err) {
        onCopyError(err);
      }
    },
  };
}
