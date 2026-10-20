import { describe, expect, it } from 'vitest';
import {
  createUuidV7,
  uuidv7Bounds,
  diff,
  redact,
  maskEmail,
  maskPhone,
  findUncoveredSecretLikeColumns,
  classifyField,
  uuidv7,
} from '../../src/lib/audit';

describe('TC-AUD-5 diff', () => {
  it('stores only changed fields (deep), arrays as whole values', () => {
    const d = diff(
      { name: 'A', commissionPct: 15, hours: { open: '09:00', close: '22:00' }, tags: ['x', 'y'] },
      {
        name: 'A',
        commissionPct: 18,
        hours: { open: '09:00', close: '23:00' },
        tags: ['x', 'y', 'z'],
      },
    );
    expect(d.before).toEqual({ commissionPct: 15, hours: { close: '22:00' }, tags: ['x', 'y'] });
    expect(d.after).toEqual({
      commissionPct: 18,
      hours: { close: '23:00' },
      tags: ['x', 'y', 'z'],
    });
    expect(d.changedFields).toEqual(['commissionPct', 'hours.close', 'tags']);
    expect(d.isNoop).toBe(false);
  });
  it('create: before=null, after=all non-null fields', () => {
    const d = diff(null, { name: 'A', note: null, zoneId: 'z1' });
    expect(d.before).toBeNull();
    expect(d.after).toEqual({ name: 'A', zoneId: 'z1' });
  });
  it('soft delete: snapshot in before, deleted marker in after', () => {
    const d = diff({ name: 'A', status: 'ACTIVE' }, { deletedAt: '2026-10-10T00:00:00.000Z' });
    expect(d.before).toEqual({ name: 'A', status: 'ACTIVE' });
    expect(d.after).toEqual({ deletedAt: '2026-10-10T00:00:00.000Z' });
    expect(d.isNoop).toBe(false);
  });
  it('TC-AUD-4 identical values are a no-op (Dates compared by value)', () => {
    expect(
      diff({ a: 1, d: new Date('2026-01-01') }, { a: 1, d: new Date('2026-01-01') }).isNoop,
    ).toBe(true);
  });
  it('removed and added keys are changes', () => {
    const d = diff({ a: 1 }, { b: 2 });
    expect(d.changedFields).toEqual(['a', 'b']);
  });
});

describe('TC-AUD-6 redaction', () => {
  it('drops secrets (value replaced by a marker), at any depth', () => {
    const r = redact({
      passwordHash: 'x',
      nested: {
        clientSecret: 'y',
        sessionToken: 'z',
        upiPin: '1234',
        totpSecret: 's',
        apiKey: 'k',
        cvv: '123',
        ok: 'fine',
      },
    }) as Record<string, unknown>;
    expect(r.passwordHash).toBe('[redacted]');
    expect(r.nested).toEqual({
      clientSecret: '[redacted]',
      sessionToken: '[redacted]',
      upiPin: '[redacted]',
      totpSecret: '[redacted]',
      apiKey: '[redacted]',
      cvv: '[redacted]',
      ok: 'fine',
    });
  });
  it('drops prefix-style secret names from the doc list (token*, secret*, totp*, otp*, upi*Pin)', () => {
    expect(
      redact({
        otpCode: '1',
        totpCode: '2',
        tokenValue: '3',
        secretKey: '4',
        upiAppPin: '5',
        tokenExpiresAt: 'x',
      }),
    ).toEqual({
      otpCode: '[redacted]',
      totpCode: '[redacted]',
      tokenValue: '[redacted]',
      secretKey: '[redacted]',
      upiAppPin: '[redacted]',
      tokenExpiresAt: '[redacted]',
    });
  });
  it('masks phone, email, bank/tax ids', () => {
    expect(redact({ phone: '9876541234' })).toEqual({ phone: '98****1234' });
    expect(redact({ email: 'karthik@example.com' })).toEqual({ email: 'k***@example.com' });
    expect(
      redact({
        accountNumber: '123456789012',
        gstNumber: '33ABCDE1234F1Z5',
        aadhaar: '123412341234',
      }),
    ).toEqual({ accountNumber: '****9012', gstNumber: '****F1Z5', aadhaar: '****1234' });
    expect(maskPhone('12345')).toBe('****');
    expect(maskEmail('nope')).toBe('***');
  });
  it('truncates long strings and summarises long arrays', () => {
    const r = redact({
      big: 'x'.repeat(2500),
      ids: Array.from({ length: 150 }, (_, i) => ({ id: `id${i}` })),
    }) as { big: string; ids: { count: number; first100Ids: string[] } };
    expect(r.big.length).toBeLessThan(2100);
    expect(r.big.endsWith('…[truncated]')).toBe(true);
    expect(r.ids.count).toBe(150);
    expect(r.ids.first100Ids).toHaveLength(100);
    expect(r.ids.first100Ids[0]).toBe('id0');
  });
  it('keeps allow-listed safe flags', () => {
    expect(classifyField('twoFactorEnabled')).toBe('keep');
    expect(classifyField('mustChangePassword')).toBe('keep');
    expect(classifyField('cardLast4')).toBe('keep');
  });
  it('schema walker flags a secret-like column that is not covered, and passes covered/allow-listed ones', () => {
    const schema = `
model User {
  id String @id
  passwordHash String @map("password_hash")
  twoFactorEnabled Boolean @map("two_factor_enabled")
  totpSecret String? @map("totp_secret")
  recoveryCodes String
  pinCode String @map("pin_code")
  @@map("users")
}
model Vendor {
  gstNumber String @map("gst_number")
  merchantPassphrase String
}`;
    const bad = findUncoveredSecretLikeColumns(schema);
    expect(bad).toContain('Vendor.merchantPassphrase'); // "pass…" but not covered by any rule
    expect(bad).not.toContain('User.passwordHash');
    expect(bad).not.toContain('User.totpSecret');
    expect(bad).not.toContain('User.twoFactorEnabled');
    expect(bad).not.toContain('Vendor.gstNumber');
  });
});

describe('uuid v7', () => {
  it('is version 7, variant 10xx, and strictly increasing across a burst (also string-sortable)', () => {
    const ids = Array.from({ length: 5000 }, () => uuidv7());
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!).toBe(true);
  });
  it('survives a clock that goes backwards', () => {
    let t = 2_000_000_000_000;
    const gen = createUuidV7(() => t);
    const a = gen();
    t = 1_000_000_000_000;
    const b = gen();
    expect(b > a).toBe(true);
  });
});

describe('uuidv7Bounds (date filters use the primary-key index)', () => {
  const idAt = (ms: number, tail: string) => {
    const h = ms.toString(16).padStart(12, '0');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${tail}`;
  };
  it('bounds are valid uuids and bracket every id with a timestamp inside the window, exclude ids outside it', () => {
    const from = new Date('2026-10-01T00:00:00Z');
    const to = new Date('2026-10-02T00:00:00Z');
    const { lower, upper } = uuidv7Bounds(from, to, 0);
    expect(lower).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(upper).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    for (const t of [
      from.getTime(),
      from.getTime() + 1,
      (from.getTime() + to.getTime()) / 2,
      to.getTime(),
    ]) {
      for (const tail of [
        '7000-8000-000000000000',
        '7abc-9def-0123456789ab',
        '7fff-bfff-ffffffffffff',
      ]) {
        const id = idAt(t, tail);
        expect(id >= lower && id <= upper).toBe(true);
      }
    }
    expect(idAt(from.getTime() - 1, '7fff-bfff-ffffffffffff') < lower).toBe(true);
    expect(idAt(to.getTime() + 1, '7000-8000-000000000000') > upper).toBe(true);
  });
  it('an id made by the real generator right now lies inside bounds around now', () => {
    const now = Date.now();
    const { lower, upper } = uuidv7Bounds(new Date(now - 1000), new Date(now + 1000), 0);
    const id = uuidv7();
    expect(id >= lower && id <= upper).toBe(true);
  });
});
