import { randomInt } from 'node:crypto';
import { BACKUP_CODE_COUNT, backupCodeSchema } from '@zoauro/shared';
import type { OtpHasher } from './otp-hash';

// Backup codes (doc 52 section 2.2): 10 codes of 10 Crockford base32 characters (50 bits each), shown once as
// XXXXX-XXXXX, stored as HMAC(OTP_HMAC_KEY, 'backup', normalised code), single use. Characters come from crypto.randomInt
// (CSPRNG), never Math.random.

/** Crockford base32: no I, L, O, U (no confusion with 1, 0 and no accidental words). */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 10;

export interface BackupCode {
  /** what the user sees and writes down: XXXXX-XXXXX */
  display: string;
  /** what is hashed: 10 characters, upper case, no separator */
  normalised: string;
}

export function generateBackupCodes(count = BACKUP_CODE_COUNT): BackupCode[] {
  const seen = new Set<string>();
  const codes: BackupCode[] = [];
  while (codes.length < count) {
    let normalised = '';
    for (let i = 0; i < CODE_LENGTH; i++) normalised += CROCKFORD_ALPHABET[randomInt(32)];
    if (seen.has(normalised)) continue; // 2^-50 per pair, but a batch must never repeat
    seen.add(normalised);
    codes.push({ normalised, display: `${normalised.slice(0, 5)}-${normalised.slice(5)}` });
  }
  return codes;
}

/** Input as typed (any case, spaces, hyphen) → the normalised code, or null when it cannot be a backup code. */
export function normaliseBackupCode(input: string): string | null {
  const r = backupCodeSchema.safeParse(input);
  return r.success ? r.data : null;
}

export const hashBackupCode = (hasher: OtpHasher, normalised: string): string =>
  hasher.hash(['backup', normalised]);

/**
 * The unused stored code that matches the input, or null. Every stored hash is compared (timing-safe, no early exit), so
 * the time taken does not depend on which code matched.
 */
export function findBackupCode<T extends { codeHash: string }>(
  hasher: OtpHasher,
  input: string,
  unused: readonly T[],
): T | null {
  const normalised = normaliseBackupCode(input);
  const candidate = hashBackupCode(hasher, normalised ?? '-');
  let match: T | null = null;
  for (const row of unused) {
    if (hasher.equals(row.codeHash, candidate) && normalised !== null) match = row;
  }
  return match;
}
