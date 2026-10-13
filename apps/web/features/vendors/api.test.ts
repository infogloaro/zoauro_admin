import { describe, expect, it } from 'vitest';
import { vendorQueryString, type VendorFilters } from './api';

const base: VendorFilters = { page: 1, pageSize: 25, sort: '-createdAt' };

describe('vendorQueryString', () => {
  it('always sends page, pageSize and sort', () => {
    const qs = vendorQueryString(base);
    expect(qs).toContain('page=1');
    expect(qs).toContain('pageSize=25');
    expect(qs).toContain('sort=-createdAt');
  });

  it('omits empty filters', () => {
    const qs = vendorQueryString(base);
    expect(qs).not.toContain('q=');
    expect(qs).not.toContain('status=');
    expect(qs).not.toContain('verification=');
    expect(qs).not.toContain('area=');
    expect(qs).not.toContain('tag=');
    expect(qs).not.toContain('foodCategory=');
    expect(qs).not.toContain('zoneId=');
  });

  it('includes set filters and encodes values', () => {
    const qs = vendorQueryString({
      ...base,
      q: 'biryani & co',
      status: 'ACTIVE',
      verification: 'VERIFIED',
      area: 'T. Nagar',
      tag: 'Biryani',
      foodCategory: 'Home Food',
      zoneId: '11111111-1111-4111-8111-111111111111',
    });
    expect(qs).toContain('q=biryani+%26+co');
    expect(qs).toContain('status=ACTIVE');
    expect(qs).toContain('verification=VERIFIED');
    expect(qs).toContain('area=T.+Nagar');
    expect(qs).toContain('tag=Biryani');
    expect(qs).toContain('foodCategory=Home+Food');
    expect(qs).toContain('zoneId=11111111-1111-4111-8111-111111111111');
  });
});
