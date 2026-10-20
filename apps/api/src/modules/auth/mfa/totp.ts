import { generate, generateSecret, generateURI, verify } from 'otplib';

// Authenticator app codes (doc 52 section 2.2): SHA-1, 6 digits, 30-second steps, the combination every authenticator
// app supports. The current step and one either side are accepted (±30 s drift). Replay protection: the caller stores
// the highest accepted step (user_mfa_methods.last_used_step) and passes it back; a code at or below it is refused even
// if it is mathematically valid. otplib 13 functional API (verify returns the matched time step).

export const TOTP_PERIOD_SEC = 30;
export const TOTP_DIGITS = 6;
const ALGORITHM = 'sha1';
/** 20 random bytes (doc 52), shown once as base32 */
export const TOTP_SECRET_BYTES = 20;

const CODE = /^\d{6}$/;

/** A fresh base32 secret for enrolment. */
export function newTotpSecret(): string {
  return generateSecret({ length: TOTP_SECRET_BYTES });
}

/** otpauth://totp/ZOAURO%20Admin:<account>?secret=…&issuer=ZOAURO%20Admin, for the QR code. */
export function totpUri(opts: { issuer: string; account: string; secret: string }): string {
  return generateURI({ issuer: opts.issuer, label: opts.account, secret: opts.secret });
}

export type TotpResult = { ok: true; step: number } | { ok: false };

/**
 * Checks a 6-digit code at `now`. `lastUsedStep`: the highest step already accepted for this method (null = none).
 * Returns the matched step on success; the caller saves it in the same transaction as the login.
 */
export async function verifyTotp(opts: {
  secret: string | Uint8Array;
  code: string;
  now: Date;
  lastUsedStep: number | null;
}): Promise<TotpResult> {
  if (!CODE.test(opts.code)) return { ok: false };
  try {
    const result = await verify({
      secret: opts.secret,
      token: opts.code,
      algorithm: ALGORITHM,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SEC,
      epoch: Math.floor(opts.now.getTime() / 1000),
      // [epoch - 30 s, epoch + 30 s] covers exactly the previous, the current and the next step
      epochTolerance: TOTP_PERIOD_SEC,
      ...(opts.lastUsedStep === null ? {} : { afterTimeStep: opts.lastUsedStep }),
    });
    return result.valid && 'timeStep' in result
      ? { ok: true, step: result.timeStep }
      : { ok: false };
  } catch {
    return { ok: false }; // malformed secret or token: a failure like any other, never an exception to the caller
  }
}

/** The code an authenticator shows at `at` (tests, the seed's one-time enrolment helper). */
export function totpAt(secret: string | Uint8Array, at: Date): Promise<string> {
  return generate({
    secret,
    algorithm: ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SEC,
    epoch: Math.floor(at.getTime() / 1000),
  });
}

/** RFC 6238 time step of an instant. */
export const totpStepAt = (at: Date): number => Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SEC);
