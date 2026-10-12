import { describe, expect, it } from 'vitest';
import {
  CROCKFORD_ALPHABET,
  findBackupCode,
  generateBackupCodes,
  hashBackupCode,
  normaliseBackupCode,
} from './backup-codes';
import { createOtpHasher } from './otp-hash';
import { SecretBoxError, createSecretBox } from './secret-box';
import { newTotpSecret, totpAt, totpStepAt, totpUri, verifyTotp } from './totp';

// P7 (doc 56) / doc 52 sections 2.2 and 11 (unit level): RFC 6238 vectors, replay guard, AES-GCM tamper and key rotation,
// timing-safe HMAC, backup-code normalisation.

const RFC_SECRET = new TextEncoder().encode('12345678901234567890'); // RFC 6238 appendix B, SHA-1
const at = (unixSeconds: number) => new Date(unixSeconds * 1000);

describe('TOTP: RFC 6238 SHA-1 test vectors (6 digits = the last 6 of the 8-digit values)', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('T=%i -> %s', async (t, code) => {
    expect(await totpAt(RFC_SECRET, at(t))).toBe(code);
    expect(await verifyTotp({ secret: RFC_SECRET, code, now: at(t), lastUsedStep: null })).toEqual({
      ok: true,
      step: Math.floor(t / 30),
    });
  });
});

describe('TOTP verification window and replay guard (TC-AUTH-11)', () => {
  const secret = newTotpSecret();
  const now = at(1_800_000_015); // 15 s into a step

  it('accepts the current step and one either side; two away is refused', async () => {
    const step = totpStepAt(now);
    for (const d of [-1, 0, 1]) {
      const code = await totpAt(secret, at((step + d) * 30 + 1));
      expect(await verifyTotp({ secret, code, now, lastUsedStep: null }), `delta ${d}`).toEqual({
        ok: true,
        step: step + d,
      });
    }
    for (const d of [-2, 2]) {
      const code = await totpAt(secret, at((step + d) * 30 + 1));
      expect((await verifyTotp({ secret, code, now, lastUsedStep: null })).ok, `delta ${d}`).toBe(
        false,
      );
    }
  });

  it('a code at or below the last accepted step is refused even though it is valid', async () => {
    const code = await totpAt(secret, now);
    const first = await verifyTotp({ secret, code, now, lastUsedStep: null });
    expect(first.ok).toBe(true);
    const step = first.ok ? first.step : -1;
    expect((await verifyTotp({ secret, code, now, lastUsedStep: step })).ok).toBe(false);
    const previous = await totpAt(secret, at((step - 1) * 30 + 1));
    expect((await verifyTotp({ secret, code: previous, now, lastUsedStep: step })).ok).toBe(false);
    const next = await totpAt(secret, at((step + 1) * 30 + 1));
    expect(await verifyTotp({ secret, code: next, now, lastUsedStep: step })).toEqual({
      ok: true,
      step: step + 1,
    });
  });

  it('anything that is not 6 digits, a wrong code or a broken secret is simply "not ok"', async () => {
    for (const code of ['', '12345', '1234567', 'abcdef', ' 12345']) {
      expect((await verifyTotp({ secret, code, now, lastUsedStep: null })).ok, code).toBe(false);
    }
    const right = await totpAt(secret, now);
    const wrong = String((Number(right) + 1) % 1_000_000).padStart(6, '0');
    expect((await verifyTotp({ secret, code: wrong, now, lastUsedStep: null })).ok).toBe(false);
    expect(
      (await verifyTotp({ secret: '!!!not base32', code: right, now, lastUsedStep: null })).ok,
    ).toBe(false);
  });

  it('secrets are 20 random bytes in base32; the URI carries issuer and account', () => {
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(newTotpSecret()).not.toBe(s);
    const uri = totpUri({ issuer: 'ZOAURO Admin', account: 'asha@example.test', secret: s });
    expect(uri.startsWith('otpauth://totp/ZOAURO%20Admin:asha%40example.test?')).toBe(true);
    expect(uri).toContain(`secret=${s}`);
    expect(uri).toContain('issuer=ZOAURO%20Admin');
  });
});

describe('secret box: AES-256-GCM with key id (TC-AUTH-30 unit part)', () => {
  const current = 'current-encryption-key-0123456789-abcdef';
  const previous = 'previous-encryption-key-0123456789-abcde';
  const aad = 'user_mfa_methods.secret:0192f1d2-0000-7000-8000-000000000001';

  it('round-trips; the sealed value has the v1.<kid> format and never contains the plaintext', () => {
    const box = createSecretBox({ current });
    const sealed = box.seal('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', aad);
    expect(sealed).toMatch(/^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed.split('.')[1]).toBe(box.currentKid);
    expect(sealed).not.toContain('JBSWY3DP');
    expect(box.open(sealed, aad)).toBe('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
    expect(box.seal('same', aad)).not.toBe(box.seal('same', aad)); // fresh nonce each time
  });

  it('flipping one character of the ciphertext or the tag fails (tamper detection)', () => {
    const box = createSecretBox({ current });
    const sealed = box.seal('secret value', aad);
    const parts = sealed.split('.');
    for (const i of [3, 4]) {
      const p = parts[i] ?? '';
      const flipped = [...parts];
      flipped[i] = `${p[0] === 'A' ? 'B' : 'A'}${p.slice(1)}`;
      expect(() => box.open(flipped.join('.'), aad)).toThrow(SecretBoxError);
    }
  });

  it('another associated data (another user) does not open it', () => {
    const box = createSecretBox({ current });
    const sealed = box.seal('secret value', aad);
    expect(() => box.open(sealed, `${aad}x`)).toThrow('TAMPERED');
  });

  it('rotation: a value sealed with the old key opens with current + previous, not with the new key alone', () => {
    const old = createSecretBox({ current: previous });
    const sealed = old.seal('secret value', aad);
    expect(createSecretBox({ current, previous }).open(sealed, aad)).toBe('secret value');
    expect(() => createSecretBox({ current }).open(sealed, aad)).toThrow('UNKNOWN_KEY');
  });

  it('malformed input is refused without leaking anything', () => {
    const box = createSecretBox({ current });
    for (const bad of ['', 'v1.x', 'v2.a.b.c.d', 'plaintext-secret']) {
      expect(() => box.open(bad, aad)).toThrow(SecretBoxError);
    }
    try {
      box.open('plaintext-secret', aad);
    } catch (e) {
      expect((e as Error).message).not.toContain('plaintext-secret');
    }
  });
});

describe('OTP hasher', () => {
  const hasher = createOtpHasher('otp-hmac-key-for-tests-0123456789-abcdef');

  it('is deterministic per key and parts, and parts cannot be shifted to collide', () => {
    expect(hasher.hash(['challenge', 'id-1', '123456'])).toBe(
      hasher.hash(['challenge', 'id-1', '123456']),
    );
    expect(hasher.hash(['ab', 'c'])).not.toBe(hasher.hash(['a', 'bc']));
    expect(createOtpHasher('another-key-0123456789-abcdefghijkl').hash(['x'])).not.toBe(
      hasher.hash(['x']),
    );
  });

  it('compares timing-safely and never treats empty or malformed hashes as equal', () => {
    const h = hasher.hash(['x']);
    expect(hasher.equals(h, h)).toBe(true);
    expect(hasher.equals(h, hasher.hash(['y']))).toBe(false);
    expect(hasher.equals('', '')).toBe(false);
    expect(hasher.equals(h, h.slice(0, 10))).toBe(false);
  });
});

describe('backup codes', () => {
  const hasher = createOtpHasher('otp-hmac-key-for-tests-0123456789-abcdef');

  it('10 distinct codes of 10 Crockford characters, shown as XXXXX-XXXXX', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes.map((c) => c.normalised)).size).toBe(10);
    for (const c of codes) {
      expect(c.display).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
      expect(c.display.replace('-', '')).toBe(c.normalised);
      for (const ch of c.normalised) expect(CROCKFORD_ALPHABET).toContain(ch);
    }
  });

  it.each([
    ['abcde-fghjk', 'ABCDEFGHJK'],
    [' ABCDE FGHJK ', 'ABCDEFGHJK'],
    ['abcdefghjk', 'ABCDEFGHJK'],
    ['ABCDE-FGHIK', null], // I is not Crockford
    ['ABCDE-FGHJ', null],
    ['', null],
  ])('normalise %j -> %j', (input, want) => {
    expect(normaliseBackupCode(input)).toBe(want);
  });

  it('finds the unused stored code that matches, whatever the typing; nothing for a wrong or used one', () => {
    const [a, b] = generateBackupCodes(2);
    const stored = [a, b].map((c, i) => ({
      id: `row-${i}`,
      codeHash: hashBackupCode(hasher, c?.normalised ?? ''),
    }));
    expect(findBackupCode(hasher, (b?.display ?? '').toLowerCase(), stored)?.id).toBe('row-1');
    expect(findBackupCode(hasher, 'ZZZZZ-ZZZZZ', stored)).toBeNull();
    expect(findBackupCode(hasher, 'not a code', stored)).toBeNull();
    expect(findBackupCode(hasher, a?.display ?? '', stored.slice(1))).toBeNull(); // already used = not in the list
  });
});
