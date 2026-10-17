import { describe, expect, it } from 'vitest';
import {
  PARTNER_DOCUMENT_TYPES,
  partnerCreateSchema,
  partnerListQuerySchema,
  partnerUpdateSchema,
  partnerVerificationSchema,
  vehicleNoSchema,
} from './schemas';

// M10 / R12 request schemas (doc 22, D130–D133).

const ZONE = '0192f1d2-0000-7000-8000-00000000000a';

describe('partner schemas', () => {
  it('create: one zone, a normalised phone and vehicle number', () => {
    const v = partnerCreateSchema.parse({
      zoneId: ZONE,
      name: 'Ravi Kumar',
      phone: '98765 43210',
      vehicleNo: 'tn-09 ab 1234',
    });
    expect(v).toMatchObject({ phone: '+919876543210', vehicleNo: 'TN09AB1234' });
    expect(partnerCreateSchema.safeParse({ name: 'Ravi', phone: '9876543210' }).success).toBe(
      false,
    );
    expect(vehicleNoSchema.safeParse('12345').success).toBe(false);
  });

  it('update needs the version and at least one change', () => {
    expect(partnerUpdateSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(partnerUpdateSchema.safeParse({ area: 'Adyar' }).success).toBe(false);
    expect(partnerUpdateSchema.parse({ area: 'Adyar', version: 2 })).toEqual({
      area: 'Adyar',
      version: 2,
    });
  });

  it('verification: a rejection needs a note (D132 "more information")', () => {
    expect(partnerVerificationSchema.safeParse({ decision: 'REJECTED' }).success).toBe(false);
    expect(
      partnerVerificationSchema.safeParse({ decision: 'REJECTED', note: 'RC photo unreadable' })
        .success,
    ).toBe(true);
  });

  it('list: the R12 queue and the D133 picker are filters', () => {
    const q = partnerListQuerySchema.parse({
      verification: 'PENDING',
      available: 'true',
      online: 'false',
      zoneId: ZONE,
    });
    expect(q).toMatchObject({
      verification: 'PENDING',
      available: true,
      online: false,
      zoneId: [ZONE],
      sort: { field: 'createdAt', direction: 'desc' },
    });
  });

  it('partner document types: the partner checklist vocabulary', () => {
    expect(PARTNER_DOCUMENT_TYPES).toEqual(
      expect.arrayContaining([
        'DRIVING_LICENCE',
        'VEHICLE_RC',
        'ID_PROOF',
        'BANK_DETAILS',
        'OTHER',
      ]),
    );
    expect(PARTNER_DOCUMENT_TYPES).not.toContain('FSSAI');
  });
});
