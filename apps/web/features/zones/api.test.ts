import { describe, expect, it } from 'vitest';
import { zonesQueryString, type ZonesFilters } from './api';

const base: ZonesFilters = { page: 1, pageSize: 25, sort: '-createdAt' };

describe('zonesQueryString', () => {
  it('always sends page, pageSize and sort', () => {
    const qs = zonesQueryString(base);
    expect(qs).toContain('page=1');
    expect(qs).toContain('pageSize=25');
    expect(qs).toContain('sort=-createdAt');
  });

  it('omits empty filters', () => {
    const qs = zonesQueryString(base);
    expect(qs).not.toContain('q=');
    expect(qs).not.toContain('status=');
    expect(qs).not.toContain('state=');
  });

  it('includes set filters and encodes values', () => {
    const qs = zonesQueryString({
      ...base,
      q: 'chennai & co',
      status: 'ACTIVE',
      state: 'Tamil Nadu',
    });
    expect(qs).toContain('q=chennai+%26+co');
    expect(qs).toContain('status=ACTIVE');
    expect(qs).toContain('state=Tamil+Nadu');
  });
});
