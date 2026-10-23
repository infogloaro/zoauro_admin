import { describe, expect, it } from 'vitest';
import { queryString } from './api';

describe('queryString — list params reach the API, empties are dropped', () => {
  it('always carries page, pageSize and sort', () => {
    expect(queryString({ page: 2, pageSize: 6, sort: '-createdAt' })).toBe(
      'page=2&pageSize=6&sort=-createdAt',
    );
  });

  it('serialises the availability filter and the featured flag into the query', () => {
    const qs = queryString({
      page: 1,
      pageSize: 6,
      sort: 'name',
      availability: 'out_of_stock',
      featured: 'true',
      category: 'South Indian',
    });
    expect(qs).toContain('availability=out_of_stock');
    expect(qs).toContain('featured=true');
    expect(qs).toContain('category=South+Indian');
  });

  it('omits empty filters so “All availability” never narrows the request', () => {
    const qs = queryString({
      page: 1,
      pageSize: 6,
      sort: '-createdAt',
      availability: '',
      featured: '',
      category: '',
      q: '',
    });
    expect(qs).not.toContain('availability');
    expect(qs).not.toContain('featured');
    expect(qs).not.toContain('category');
    expect(qs).not.toContain('q=');
  });
});
