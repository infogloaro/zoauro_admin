import type { MfaType } from '@zoauro/shared';

// What the 2-step screens need to know about a sign-in that passed the password (doc 52 section 2.1): which methods the
// account has (hints only), where to go afterwards, and who is signing in (masked). Kept in sessionStorage so a refresh
// of /2fa keeps working; it holds no secret (the pending login itself is the HttpOnly zo_mfa cookie, 5 minutes).

export interface PendingSignIn {
  status: 'MFA_REQUIRED' | 'ENROLMENT_REQUIRED';
  methods: { type: MfaType; hint: string }[];
  preferred?: MfaType | undefined;
  /** the ?next= the visitor came with (checked again with safeNext before use) */
  next?: string | undefined;
  /** masked email, for "Signing in as a***@example.com" */
  who: string;
}

const KEY = 'zo.pending-sign-in';

export function savePending(value: PendingSignIn): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* storage disabled: the screens fall back to "start again" */
  }
}

export function readPending(): PendingSignIn | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PendingSignIn>;
    if (v.status !== 'MFA_REQUIRED' && v.status !== 'ENROLMENT_REQUIRED') return null;
    return {
      status: v.status,
      methods: Array.isArray(v.methods) ? v.methods : [],
      preferred: v.preferred,
      next: v.next,
      who: typeof v.who === 'string' ? v.who : '',
    };
  } catch {
    return null;
  }
}

export function clearPending(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** "asha.rao@gloaro.com" -> "a***@gloaro.com" (lists and screens mask email, D26). */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
