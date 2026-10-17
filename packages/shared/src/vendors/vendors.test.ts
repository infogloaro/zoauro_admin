import { describe, expect, it } from 'vitest';
import { uploadPresignSchema } from '../uploads';
import {
  homemakerCreateSchema,
  restaurantCreateSchema,
  restaurantUpdateSchema,
  VENDOR_DOCUMENT_TYPES,
  vendorDocumentVerifySchema,
  vendorListQuerySchema,
  vendorVerificationSchema,
} from './schemas';

const ZONE = '0192f1d2-0000-7000-8000-000000000001';
const restaurant = {
  zoneId: ZONE,
  name: 'Anna Mess',
  ownerName: 'Anna',
  phone: '98765 43210',
  address: '12 Gandhi Road',
  cuisineTags: ['South Indian'],
};

describe('vendor contract', () => {
  it('normalises the phone to E.164 and defaults the restaurant kind', () => {
    const r = restaurantCreateSchema.parse(restaurant);
    expect(r.phone).toBe('+919876543210');
    expect(r.kind).toBe('RESTAURANT');
    expect(restaurantCreateSchema.safeParse({ ...restaurant, phone: '12345' }).success).toBe(false);
  });

  it('needs both coordinates or neither, at most two decimals of commission, and no unknown fields', () => {
    expect(restaurantCreateSchema.safeParse({ ...restaurant, lat: 13.08 }).success).toBe(false);
    expect(
      restaurantCreateSchema.safeParse({ ...restaurant, lat: 13.08, lng: 80.27 }).success,
    ).toBe(true);
    expect(restaurantCreateSchema.safeParse({ ...restaurant, commissionPct: 12.5 }).success).toBe(
      true,
    );
    expect(restaurantCreateSchema.safeParse({ ...restaurant, commissionPct: 12.555 }).success).toBe(
      false,
    );
    expect(restaurantCreateSchema.safeParse({ ...restaurant, commissionPct: 51 }).success).toBe(
      false,
    );
    expect(restaurantCreateSchema.safeParse({ ...restaurant, status: 'ACTIVE' }).success).toBe(
      false,
    );
  });

  it('home food defaults: available, capacity 1, no tags', () => {
    const h = homemakerCreateSchema.parse({
      zoneId: ZONE,
      name: 'Meena Kitchen',
      phone: '+91 91234 56789',
      address: '4 Lake View',
    });
    expect(h).toMatchObject({ isAvailable: true, dailyCapacity: 1, specialityTags: [] });
  });

  it('an update needs a field and never carries the zone', () => {
    expect(restaurantUpdateSchema.safeParse({}).success).toBe(false);
    expect(restaurantUpdateSchema.safeParse({ zoneId: ZONE }).success).toBe(false);
    expect(restaurantUpdateSchema.safeParse({ email: null }).success).toBe(true);
  });

  it('rejecting a vendor or a document needs a note', () => {
    for (const s of [vendorVerificationSchema, vendorDocumentVerifySchema]) {
      expect(s.safeParse({ decision: 'REJECTED' }).success).toBe(false);
      expect(s.safeParse({ decision: 'REJECTED', note: 'FSSAI expired' }).success).toBe(true);
      expect(s.safeParse({ decision: 'VERIFIED' }).success).toBe(true);
    }
  });

  it('list query: repeatable zoneId, sort allow-list, defaults', () => {
    const q = vendorListQuerySchema.parse({ zoneId: ZONE });
    expect(q).toMatchObject({ page: 1, pageSize: 25, zoneId: [ZONE] });
    expect(q.sort).toEqual({ field: 'createdAt', direction: 'desc' });
    expect(vendorListQuerySchema.parse({ zoneId: [ZONE, ZONE] }).zoneId).toHaveLength(2);
    expect(vendorListQuerySchema.safeParse({ sort: '-phone' }).success).toBe(false);
  });

  it('document types follow the D97 checklist without the partner-only documents', () => {
    expect(VENDOR_DOCUMENT_TYPES).toEqual([
      'FSSAI',
      'GST',
      'PAN',
      'BANK_DETAILS',
      'ID_PROOF',
      'OTHER',
    ]);
  });

  it('presign needs the zone and the entity (D120)', () => {
    const base = { purpose: 'VENDOR_DOC', contentType: 'application/pdf', sizeBytes: 1000 };
    expect(uploadPresignSchema.safeParse(base).success).toBe(false);
    expect(uploadPresignSchema.safeParse({ ...base, zoneId: ZONE, entityId: ZONE }).success).toBe(
      true,
    );
  });
});
