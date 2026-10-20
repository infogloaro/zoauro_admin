import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// HMAC request signing for the Integration API (doc 42 section 1, D51). Pure: no I/O, no clock of its own.
// Canonical string: timestamp + "." + METHOD + "." + pathWithQuery + "." + sha256hex(rawBody); empty body hashes "".
// Header X-Zoauro-Signature: "v1=" + hex HMAC-SHA256(secret, canonical).

/** A request whose timestamp is further than this from server time is refused (TIMESTAMP_SKEW). Doc 42, fixed. */
export const MAX_SKEW_SEC = 300;

export const HEADER_KEY_ID = 'x-zoauro-key-id';
export const HEADER_TIMESTAMP = 'x-zoauro-timestamp';
export const HEADER_SIGNATURE = 'x-zoauro-signature';

export function bodyHash(rawBody: Buffer | string): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

export function canonicalString(i: {
  timestamp: string;
  method: string;
  pathWithQuery: string;
  rawBody: Buffer | string;
}): string {
  return `${i.timestamp}.${i.method.toUpperCase()}.${i.pathWithQuery}.${bodyHash(i.rawBody)}`;
}

export function sign(secret: string, canonical: string): string {
  return `v1=${createHmac('sha256', secret).update(canonical).digest('hex')}`;
}

/** Constant-time comparison against every candidate secret (the current one and one still inside its overlap). */
export function matchesAny(
  secrets: readonly string[],
  canonical: string,
  given: string | undefined,
): boolean {
  if (!given || !/^v1=[0-9a-f]{64}$/.test(given)) return false;
  const actual = Buffer.from(given, 'utf8');
  let ok = false;
  for (const secret of secrets) {
    const expected = Buffer.from(sign(secret, canonical), 'utf8');
    // every candidate is compared, so the time taken does not tell which secret matched
    if (timingSafeEqual(expected, actual)) ok = true;
  }
  return ok;
}

export type TimestampCheck = { ok: true } | { ok: false; reason: 'MALFORMED' | 'SKEW' };

export function checkTimestamp(value: string | undefined, now: Date): TimestampCheck {
  if (!value || !/^\d{1,12}$/.test(value)) return { ok: false, reason: 'MALFORMED' };
  const skew = Math.abs(Math.floor(now.getTime() / 1000) - Number(value));
  return skew > MAX_SKEW_SEC ? { ok: false, reason: 'SKEW' } : { ok: true };
}
