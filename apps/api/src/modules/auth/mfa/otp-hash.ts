import { createHmac, timingSafeEqual } from 'node:crypto';

// One-time codes and backup codes are stored only as HMAC-SHA256(OTP_HMAC_KEY, ...) (doc 52 section 2.2): the code itself
// is never stored or logged. Comparison is timing-safe (doc 52: every code and hash).

const SEPARATOR = '\u001f'; // unit separator: no field can contain it, so ("ab","c") and ("a","bc") never collide

export interface OtpHasher {
  /** hex HMAC of the parts, e.g. ['challenge', challengeId, code] or ['backup', normalisedCode] */
  hash(parts: readonly string[]): string;
  /** timing-safe comparison of two hex hashes */
  equals(a: string, b: string): boolean;
}

export function createOtpHasher(otpHmacKey: string): OtpHasher {
  return {
    hash: (parts) => createHmac('sha256', otpHmacKey).update(parts.join(SEPARATOR)).digest('hex'),
    equals(a, b) {
      const ab = Buffer.from(a, 'hex');
      const bb = Buffer.from(b, 'hex');
      return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
    },
  };
}
