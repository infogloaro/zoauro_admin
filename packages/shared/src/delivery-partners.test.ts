import { describe, expect, it } from 'vitest';
import { DELIVERY_PARTNER_STATUSES } from './enums';
import {
  deliveryPartnerCreateSchema,
  deliveryPartnerEditFormSchema,
  deliveryPartnerEditFormToUpdate,
  deliveryPartnerForceOfflineSchema,
  deliveryPartnerFormSchema,
  deliveryPartnerFormToPayload,
  deliveryPartnerUpdateSchema,
  deliveryPartnerVerificationSchema,
  listDeliveryPartnersQuerySchema,
  requestedPartnerZoneIds,
  type DeliveryPartnerFormValues,
} from './delivery-partners';

const zoneId = '11111111-1111-4111-8111-111111111111';

const form: DeliveryPartnerFormValues = {
  zoneId,
  name: 'Karthik Raja',
  phone: '9840065432',
  vehicleType: 'BIKE',
  vehicleNo: 'TN 09 AB 1234',
  area: 'Velachery',
  status: 'PENDING_VERIFICATION',
};

describe('deliveryPartnerFormToPayload', () => {
  it('keeps the assigned zone and drops a blank area (whitespace included)', () => {
    const payload = deliveryPartnerFormToPayload({ ...form, area: '   ' });
    expect(payload).toEqual({
      zoneId,
      name: 'Karthik Raja',
      phone: '9840065432',
      vehicleType: 'BIKE',
      vehicleNo: 'TN 09 AB 1234',
      status: 'PENDING_VERIFICATION',
    });
    expect(payload.area).toBeUndefined();
  });
});

describe('deliveryPartnerEditFormToUpdate', () => {
  it('mirrors the intake PartnerPatch field set and clears the area with null', () => {
    expect(
      deliveryPartnerEditFormToUpdate({
        name: 'Karthik R',
        vehicleType: 'SCOOTER',
        vehicleNo: 'TN 10 CD 5678',
        area: '  ',
      }),
    ).toEqual({
      name: 'Karthik R',
      vehicleType: 'SCOOTER',
      vehicleNo: 'TN 10 CD 5678',
      area: null,
    });
  });

  it('refuses an empty patch', () => {
    expect(deliveryPartnerUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe('deliveryPartner schemas', () => {
  it('requires a zone on create (doc 22 / doc 36 create rule)', () => {
    expect(deliveryPartnerCreateSchema.safeParse({ ...form, zoneId: '' }).success).toBe(false);
  });

  it('rejects a vehicle number that does not match the format rule', () => {
    expect(deliveryPartnerFormSchema.safeParse({ ...form, vehicleNo: '!!' }).success).toBe(false);
  });

  it('edit form covers only the PartnerPatch fields and validates the same format rule', () => {
    const edit = deliveryPartnerEditFormSchema.parse({
      name: 'Karthik Raja',
      vehicleType: 'BIKE',
      vehicleNo: 'TN 09 AB 1234',
      area: 'Velachery',
    });
    expect(edit).toEqual({
      name: 'Karthik Raja',
      vehicleType: 'BIKE',
      vehicleNo: 'TN 09 AB 1234',
      area: 'Velachery',
    });
    expect('zoneId' in edit).toBe(false);
    expect('phone' in edit).toBe(false);
    expect(deliveryPartnerEditFormSchema.safeParse({ ...edit, vehicleNo: '!!' }).success).toBe(
      false,
    );
  });
});

describe('deliveryPartnerVerificationSchema', () => {
  it('accepts a verification without a note', () => {
    expect(deliveryPartnerVerificationSchema.parse({ decision: 'VERIFIED' })).toEqual({
      decision: 'VERIFIED',
    });
  });

  it('requires a note when rejecting (mirrors the vendor rule, doc 10 §4)', () => {
    expect(deliveryPartnerVerificationSchema.safeParse({ decision: 'REJECTED' }).success).toBe(
      false,
    );
    expect(
      deliveryPartnerVerificationSchema.parse({
        decision: 'REJECTED',
        note: 'Vehicle documents do not match.',
      }),
    ).toEqual({ decision: 'REJECTED', note: 'Vehicle documents do not match.' });
  });
});

describe('deliveryPartnerForceOfflineSchema', () => {
  it('accepts an omitted until (force offline with no end time)', () => {
    expect(deliveryPartnerForceOfflineSchema.parse({})).toEqual({});
  });

  it('rejects a until value that is not an ISO datetime', () => {
    expect(deliveryPartnerForceOfflineSchema.safeParse({ until: 'tomorrow 6pm' }).success).toBe(
      false,
    );
    expect(deliveryPartnerForceOfflineSchema.parse({ until: '2026-10-20T12:00:00.000Z' })).toEqual({
      until: '2026-10-20T12:00:00.000Z',
    });
  });
});

describe('listDeliveryPartnersQuerySchema', () => {
  it('defaults to page 1, pageSize 25 and -createdAt (repo list convention)', () => {
    expect(listDeliveryPartnersQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
      sort: '-createdAt',
    });
  });

  it('parses the online filter as a real boolean — "false" must not become true', () => {
    expect(listDeliveryPartnersQuerySchema.parse({ isOnline: 'false' }).isOnline).toBe(false);
    expect(listDeliveryPartnersQuerySchema.parse({ isOnline: 'true' }).isOnline).toBe(true);
    expect(listDeliveryPartnersQuerySchema.safeParse({ isOnline: 'yes' }).success).toBe(false);
  });

  it('rejects an unsupported sort field', () => {
    expect(listDeliveryPartnersQuerySchema.safeParse({ sort: 'cashInHand' }).success).toBe(false);
  });

  it('normalises a repeatable zoneId into an array', () => {
    const base = listDeliveryPartnersQuerySchema.parse({});
    expect(requestedPartnerZoneIds({ ...base, zoneId: [zoneId] })).toEqual([zoneId]);
    expect(requestedPartnerZoneIds({ ...base, zoneId })).toEqual([zoneId]);
    expect(requestedPartnerZoneIds(base)).toBeUndefined();
  });
});

describe('doc 10 §5 state machine values', () => {
  it('keeps PENDING_VERIFICATION → VERIFIED → ACTIVE ↔ INACTIVE and SUSPENDED', () => {
    expect(DELIVERY_PARTNER_STATUSES).toEqual([
      'PENDING_VERIFICATION',
      'VERIFIED',
      'ACTIVE',
      'INACTIVE',
      'SUSPENDED',
    ]);
  });
});
