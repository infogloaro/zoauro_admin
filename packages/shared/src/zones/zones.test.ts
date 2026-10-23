import { describe, expect, it } from 'vitest';
import {
  MAX_PINCODE_RANGE,
  ZONE_COLOR_HEXES,
  ZONE_ERROR_STATUS,
  ZONE_PALETTE,
  activateZoneSchema,
  createZoneSchema,
  deactivateZoneSchema,
  expandRange,
  isValidPincode,
  normalisePincode,
  parsePincodeList,
  patchZoneSchema,
  zonePincodesSchema,
} from './index';
import { ERROR_STATUS, errorBodySchema } from '../errors';

describe('pincodes', () => {
  it.each([
    ['560001', true],
    ['110001', true],
    ['999999', true],
    ['100000', true],
    ['060001', false],
    ['56000', false],
    ['5600011', false],
    ['56000a', false],
    ['56 001', false],
    ['', false],
  ])('isValidPincode(%j) = %s', (v, ok) => {
    expect(isValidPincode(v)).toBe(ok);
  });

  it('normalise trims and refuses everything else', () => {
    expect(normalisePincode('  560001 ')).toBe('560001');
    expect(normalisePincode('560 001')).toBeNull();
    expect(normalisePincode('012345')).toBeNull();
  });

  it(`expandRange: ${MAX_PINCODE_RANGE} pincodes pass, one more is refused`, () => {
    const ok = expandRange('560000', String(560000 + MAX_PINCODE_RANGE - 1));
    expect(ok.ok && ok.pincodes.length).toBe(2000);
    expect(ok.ok && [ok.pincodes[0], ok.pincodes.at(-1)]).toEqual(['560000', '561999']);
    expect(expandRange('560000', String(560000 + MAX_PINCODE_RANGE))).toEqual({
      ok: false,
      error: 'RANGE_TOO_LARGE',
      size: 2001,
    });
  });

  it('expandRange: single pincode, reversed and invalid ends', () => {
    expect(expandRange('560001', '560001')).toEqual({ ok: true, pincodes: ['560001'] });
    expect(expandRange('560010', '560001')).toEqual({ ok: false, error: 'RANGE_REVERSED' });
    expect(expandRange('060001', '560001')).toEqual({ ok: false, error: 'INVALID_PINCODE' });
    expect(expandRange('100000', '999999')).toMatchObject({ ok: false, error: 'RANGE_TOO_LARGE' });
  });

  it('parsePincodeList: commas, semicolons, newlines; duplicates once; invalid reported', () => {
    expect(parsePincodeList('560001, 560002\n560001;560003\t12345 abc')).toEqual({
      valid: ['560001', '560002', '560003'],
      invalid: ['12345', 'abc'],
    });
    expect(parsePincodeList('  ')).toEqual({ valid: [], invalid: [] });
  });
});

describe('palette', () => {
  it('has exactly 12 distinct upper-case 7-character hex colours', () => {
    expect(ZONE_PALETTE).toHaveLength(12);
    expect(new Set(ZONE_COLOR_HEXES).size).toBe(12);
    expect(new Set(ZONE_PALETTE.map((c) => c.token)).size).toBe(12);
    for (const hex of ZONE_COLOR_HEXES) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
  });
});

const validZone = {
  name: 'Coimbatore North',
  code: 'CBE1',
  city: 'Coimbatore',
  state: 'Tamil Nadu',
  deliveryChargePaise: 2500,
  colorHex: '#2563EB',
};

describe('createZoneSchema', () => {
  const ok = (patch: Record<string, unknown>) =>
    createZoneSchema.safeParse({ ...validZone, ...patch }).success;

  it('accepts a valid zone; status defaults to UPCOMING; code is upper-cased', () => {
    const r = createZoneSchema.parse({ ...validZone, code: 'cbe1' });
    expect(r.status).toBe('UPCOMING');
    expect(r.code).toBe('CBE1');
  });

  it.each([
    ['AB', true],
    ['ABCDEF', true],
    ['A1', true],
    ['A', false],
    ['ABCDEFG', false],
    ['1AB', false],
    ['AB-1', false],
  ])('code %j -> %s', (code, want) => {
    expect(ok({ code })).toBe(want);
  });

  it('name 2-60 characters', () => {
    expect(ok({ name: 'AB' })).toBe(true);
    expect(ok({ name: 'A' })).toBe(false);
    expect(ok({ name: 'x'.repeat(60) })).toBe(true);
    expect(ok({ name: 'x'.repeat(61) })).toBe(false);
  });

  it('delivery charge: integer paise 0..100000', () => {
    expect(ok({ deliveryChargePaise: 0 })).toBe(true);
    expect(ok({ deliveryChargePaise: 100000 })).toBe(true);
    expect(ok({ deliveryChargePaise: 100001 })).toBe(false);
    expect(ok({ deliveryChargePaise: -1 })).toBe(false);
    expect(ok({ deliveryChargePaise: 10.5 })).toBe(false);
  });

  it('colour must be a palette token; description up to 500', () => {
    expect(ok({ colorHex: '#123456' })).toBe(false);
    expect(ok({ description: 'x'.repeat(500) })).toBe(true);
    expect(ok({ description: 'x'.repeat(501) })).toBe(false);
  });

  it('range: both ends or neither, ordered, at most 2000', () => {
    expect(ok({ pincodeFrom: '560001', pincodeTo: '560100' })).toBe(true);
    expect(ok({ pincodeFrom: '560001' })).toBe(false);
    expect(ok({ pincodeFrom: '560100', pincodeTo: '560001' })).toBe(false);
    expect(ok({ pincodeFrom: '560000', pincodeTo: '561999' })).toBe(true);
    expect(ok({ pincodeFrom: '560000', pincodeTo: '562000' })).toBe(false);
  });

  it('pincode list: valid pincodes only, at most 2000', () => {
    expect(ok({ pincodes: ['560001', '560002'] })).toBe(true);
    expect(ok({ pincodes: ['060001'] })).toBe(false);
    const many = (n: number) => Array.from({ length: n }, (_, i) => String(560000 + i));
    expect(ok({ pincodes: many(2000) })).toBe(true);
    expect(ok({ pincodes: many(2001) })).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(ok({ version: 3 })).toBe(false);
  });
});

describe('patch, pincodes, activate, deactivate', () => {
  it('patch needs a version and can never change the code or the status', () => {
    expect(patchZoneSchema.safeParse({ version: 1, name: 'New name' }).success).toBe(true);
    expect(patchZoneSchema.safeParse({ name: 'New name' }).success).toBe(false);
    expect(patchZoneSchema.safeParse({ version: 1, code: 'NEW' }).success).toBe(false);
    expect(patchZoneSchema.safeParse({ version: 1, status: 'ACTIVE' }).success).toBe(false);
  });

  it('pincodes change needs at least one of range, add, remove', () => {
    expect(zonePincodesSchema.safeParse({}).success).toBe(false);
    expect(zonePincodesSchema.safeParse({ add: [] }).success).toBe(false);
    expect(zonePincodesSchema.safeParse({ add: ['560001'] }).success).toBe(true);
    expect(zonePincodesSchema.safeParse({ range: { from: '560001', to: '560010' } }).success).toBe(
      true,
    );
    expect(zonePincodesSchema.safeParse({ range: { from: '560000', to: '562000' } }).success).toBe(
      false,
    );
  });

  it('activate carries the version', () => {
    expect(activateZoneSchema.safeParse({ version: 2 }).success).toBe(true);
    expect(activateZoneSchema.safeParse({}).success).toBe(false);
  });

  it('deactivate needs a reason of 10-500 characters and the impact version', () => {
    const base = { version: 2, impactVersion: 'v-123' };
    expect(deactivateZoneSchema.safeParse({ ...base, reason: 'Monsoon pause' }).success).toBe(true);
    expect(deactivateZoneSchema.safeParse({ ...base, reason: 'too short' }).success).toBe(false);
    expect(deactivateZoneSchema.safeParse({ ...base, reason: 'x'.repeat(501) }).success).toBe(
      false,
    );
    expect(deactivateZoneSchema.safeParse({ version: 2, reason: 'Monsoon pause' }).success).toBe(
      false,
    );
  });
});

describe('error codes', () => {
  it('are the doc 53 section 5 list with their statuses', () => {
    expect(ZONE_ERROR_STATUS).toEqual({
      ZONE_NAME_TAKEN: 409,
      ZONE_CODE_TAKEN: 409,
      PINCODE_OVERLAP: 409,
      RANGE_TOO_LARGE: 422,
      CODE_IMMUTABLE: 422,
      ZONE_NOT_ACTIVATABLE: 422,
      IMPACT_CHANGED: 409,
      REASON_REQUIRED: 422,
      ZONE_HAS_HISTORY: 409,
      // D92 service switches
      ZONE_SERVICE_DISABLED: 409,
    });
  });

  it('are part of the shared error list (P11), with STALE_VERSION and error.meta', () => {
    expect(ERROR_STATUS).toMatchObject({ ...ZONE_ERROR_STATUS, STALE_VERSION: 409 });
    const body = {
      error: {
        code: 'PINCODE_OVERLAP',
        message: 'Pincode already in another zone',
        meta: { conflicts: [{ pincode: '560001', zoneId: 'z', zoneName: 'Zone A' }] },
      },
    };
    expect(errorBodySchema.safeParse(body).success).toBe(true);
  });
});
