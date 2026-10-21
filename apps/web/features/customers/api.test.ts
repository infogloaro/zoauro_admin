import { describe, expect, it } from 'vitest';
import { customerQueryString, type CustomerFilters } from './api';

const base: CustomerFilters = { page: 1, pageSize: 6, sort: '-createdAt' };

describe('customerQueryString', () => {
  it('always sends page, pageSize and sort', () => {
    const qs = customerQueryString(base);
    expect(qs).toContain('page=1');
    expect(qs).toContain('pageSize=6');
    expect(qs).toContain('sort=-createdAt');
  });

  it('omits empty filters', () => {
    const qs = customerQueryString(base);
    expect(qs).not.toContain('q=');
    expect(qs).not.toContain('status=');
    expect(qs).not.toContain('source=');
    expect(qs).not.toContain('area=');
    expect(qs).not.toContain('userType=');
    expect(qs).not.toContain('zoneId=');
  });

  it('includes set filters and encodes values', () => {
    const qs = customerQueryString({
      ...base,
      q: 'aarti & co',
      status: 'BLOCKED',
      source: 'REFERRAL',
      area: 'T. Nagar',
      userType: 'CUSTOMER',
      zoneId: '11111111-1111-4111-8111-111111111111',
    });
    expect(qs).toContain('q=aarti+%26+co');
    expect(qs).toContain('status=BLOCKED');
    expect(qs).toContain('source=REFERRAL');
    expect(qs).toContain('area=T.+Nagar');
    expect(qs).toContain('userType=CUSTOMER');
    expect(qs).toContain('zoneId=11111111-1111-4111-8111-111111111111');
  });
});
