import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalString, checkTimestamp, matchesAny, MAX_SKEW_SEC, sign } from './signature';

const SECRET = 'test-secret-0123456789abcdef';
const OLD_SECRET = 'old-secret-0123456789abcdef';

/** The sender code printed in doc 42 section 1, verbatim in logic: the server must accept what it produces. */
function docSender(secret: string, ts: string, path: string, payload: unknown): string {
  const body = JSON.stringify(payload);
  const canon = `${ts}.POST.${path}.${createHash('sha256').update(body).digest('hex')}`;
  return 'v1=' + createHmac('sha256', secret).update(canon).digest('hex');
}

describe('intake signature (doc 42 section 1)', () => {
  const ts = '1760000000';
  const payload = { orderId: 'CUST-ORD-88421', items: [{ itemId: 'itm_301', qty: 2 }] };
  const raw = JSON.stringify(payload);
  const canonical = canonicalString({
    timestamp: ts,
    method: 'post',
    pathWithQuery: '/api/v1/intake/orders',
    rawBody: Buffer.from(raw),
  });

  it('accepts exactly what the documented sender code produces', () => {
    const given = docSender(SECRET, ts, '/api/v1/intake/orders', payload);
    expect(sign(SECRET, canonical)).toBe(given);
    expect(matchesAny([SECRET], canonical, given)).toBe(true);
  });

  it('an empty body hashes the empty string; the query string is part of the path', () => {
    const c = canonicalString({
      timestamp: ts,
      method: 'GET',
      pathWithQuery: '/api/v1/intake/zones/resolve?pincode=641002',
      rawBody: '',
    });
    expect(c).toBe(
      `${ts}.GET./api/v1/intake/zones/resolve?pincode=641002.${createHash('sha256').update('').digest('hex')}`,
    );
  });

  it('refuses a changed body, path, method or timestamp, a wrong secret and malformed headers', () => {
    const given = sign(SECRET, canonical);
    const other = (o: Partial<Parameters<typeof canonicalString>[0]>) =>
      canonicalString({
        timestamp: ts,
        method: 'POST',
        pathWithQuery: '/api/v1/intake/orders',
        rawBody: raw,
        ...o,
      });
    expect(matchesAny([SECRET], other({ rawBody: raw.replace('2', '3') }), given)).toBe(false);
    expect(matchesAny([SECRET], other({ pathWithQuery: '/api/v1/intake/vendors' }), given)).toBe(
      false,
    );
    expect(matchesAny([SECRET], other({ method: 'PUT' }), given)).toBe(false);
    expect(matchesAny([SECRET], other({ timestamp: '1760000001' }), given)).toBe(false);
    expect(matchesAny(['wrong-secret'], canonical, given)).toBe(false);
    for (const bad of [undefined, '', 'v1=', given.toUpperCase(), given.slice(3), `${given}00`]) {
      expect(matchesAny([SECRET], canonical, bad)).toBe(false);
    }
  });

  it('during rotation both the new and the old secret are accepted', () => {
    expect(matchesAny([SECRET, OLD_SECRET], canonical, sign(OLD_SECRET, canonical))).toBe(true);
    expect(matchesAny([SECRET, OLD_SECRET], canonical, sign(SECRET, canonical))).toBe(true);
    expect(matchesAny([SECRET], canonical, sign(OLD_SECRET, canonical))).toBe(false);
  });

  it('timestamps: within 300 s either way, otherwise SKEW; non-numeric is MALFORMED', () => {
    const now = new Date(Number(ts) * 1000);
    expect(checkTimestamp(ts, now)).toEqual({ ok: true });
    expect(checkTimestamp(String(Number(ts) - MAX_SKEW_SEC), now)).toEqual({ ok: true });
    expect(checkTimestamp(String(Number(ts) + MAX_SKEW_SEC + 1), now)).toEqual({
      ok: false,
      reason: 'SKEW',
    });
    expect(checkTimestamp(String(Number(ts) - MAX_SKEW_SEC - 1), now)).toEqual({
      ok: false,
      reason: 'SKEW',
    });
    for (const bad of [undefined, '', '17e8', '-5', '1760000000.5']) {
      expect(checkTimestamp(bad, now)).toEqual({ ok: false, reason: 'MALFORMED' });
    }
  });
});
