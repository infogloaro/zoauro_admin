import { describe, expect, it } from 'vitest';
import { partnerQueryString, type DeliveryPartnerFilters } from './api';

const base: DeliveryPartnerFilters = { page: 1, pageSize: 6, sort: '-createdAt' };

describe('partnerQueryString', () => {
  it('always sends page, pageSize and sort', () => {
    const qs = partnerQueryString(base);
    expect(qs).toContain('page=1');
    expect(qs).toContain('pageSize=6');
    expect(qs).toContain('sort=-createdAt');
  });

  it('omits empty filters', () => {
    const qs = partnerQueryString(base);
    expect(qs).not.toContain('q=');
    expect(qs).not.toContain('status=');
    expect(qs).not.toContain('isOnline=');
    expect(qs).not.toContain('vehicleType=');
    expect(qs).not.toContain('area=');
    expect(qs).not.toContain('zoneId=');
  });

  it('includes set filters and encodes values', () => {
    const qs = partnerQueryString({
      ...base,
      q: 'karthik & co',
      status: 'PENDING_VERIFICATION',
      isOnline: 'false',
      vehicleType: 'SCOOTER',
      area: 'T. Nagar',
      zoneId: '11111111-1111-4111-8111-111111111111',
    });
    expect(qs).toContain('q=karthik+%26+co');
    expect(qs).toContain('status=PENDING_VERIFICATION');
    // The string value must survive — z.coerce.boolean() would read "false" as true.
    expect(qs).toContain('isOnline=false');
    expect(qs).toContain('vehicleType=SCOOTER');
    expect(qs).toContain('area=T.+Nagar');
    expect(qs).toContain('zoneId=11111111-1111-4111-8111-111111111111');
  });
});
