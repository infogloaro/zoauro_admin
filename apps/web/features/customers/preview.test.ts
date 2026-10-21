import { describe, expect, it } from 'vitest';
import { customerDetailSchema, listCustomersResponseSchema } from '@zoauro/shared';
import {
  isCustomerPreview,
  mockCustomerDetail,
  mockCustomersList,
  previewCustomerReveal,
  setCustomerPreview,
} from './preview';

/**
 * Preview-mode guard rails (dev-only mock data for the M09 screen): the mock
 * payloads must satisfy the shared contracts, and the flag must stay off
 * outside `next dev` (vitest runs with NODE_ENV=test, so an activated flag
 * must still read as false).
 */
describe('customer preview mode', () => {
  it('never activates outside a development build', () => {
    setCustomerPreview(true);
    expect(isCustomerPreview()).toBe(false);
    setCustomerPreview(false);
    expect(isCustomerPreview()).toBe(false);
  });

  it('list satisfies the shared list contract', () => {
    const response = mockCustomersList({ page: 1, pageSize: 25, sort: '-createdAt' });
    expect(() => listCustomersResponseSchema.parse(response)).not.toThrow();
    expect(response.data.length).toBeGreaterThan(0);
    expect(response.meta.counts.total).toBe(response.data.length);
    expect(response.meta.facets.areas.length).toBeGreaterThan(0);
    expect(response.meta.facets.zones.length).toBeGreaterThan(1);
    expect(response.meta.facets.sources).toEqual(['ADMIN', 'APP', 'OTHER', 'REFERRAL']);
  });

  it('honours q, status and area filters while KPI counts stay scope-wide', () => {
    const all = mockCustomersList({ page: 1, pageSize: 25, sort: '-createdAt' });
    expect(all.meta.counts.active).toBe(3);
    expect(all.meta.counts.blocked).toBe(2);

    const blocked = mockCustomersList({ page: 1, pageSize: 25, sort: 'name', status: 'BLOCKED' });
    expect(blocked.data).toHaveLength(2);
    expect(blocked.data.every((c) => c.status === 'BLOCKED')).toBe(true);
    // KPI counts stay scope-wide even when rows are filtered (doc 20).
    expect(blocked.meta.counts.total).toBe(all.meta.counts.total);

    const searched = mockCustomersList({ page: 1, pageSize: 25, sort: '-createdAt', q: 'divya' });
    expect(searched.data).toHaveLength(1);
    expect(searched.data[0]?.name).toBe('Divya Krishnan');

    const byArea = mockCustomersList({ page: 1, pageSize: 25, sort: '-createdAt', area: 'Adyar' });
    expect(byArea.data).toHaveLength(1);
    expect(byArea.data[0]?.name).toBe('Aarti Menon');
  });

  it('unknown filters return no rows but keep counts', () => {
    const response = mockCustomersList({
      page: 1,
      pageSize: 25,
      sort: '-createdAt',
      zoneId: '99999999-9999-4999-8999-999999999999',
    });
    expect(response.data).toHaveLength(0);
    expect(response.meta.total).toBe(0);
    expect(response.meta.counts.total).toBeGreaterThan(0);
  });

  it('detail satisfies the shared detail contract with its addresses', () => {
    const list = mockCustomersList({ page: 1, pageSize: 25, sort: 'name' });
    const first = list.data.at(0);
    expect(first).toBeDefined();
    if (!first) return;
    const detail = mockCustomerDetail(first.id);
    expect(() => customerDetailSchema.parse(detail)).not.toThrow();
    expect(detail.addresses.length).toBeGreaterThan(0);
    // Orders/refunds stay empty until M11/M13 (honest empty states).
    expect('orders' in detail).toBe(false);
  });

  it('unknown ids fall back to the first mock so dialogs still render', () => {
    const detail = mockCustomerDetail('00000000-0000-4000-8000-000000000000');
    expect(() => customerDetailSchema.parse(detail)).not.toThrow();
    expect(detail.name).toBe('Aarti Menon');
  });

  it('reveal returns the unmasked contact for a known row only', () => {
    const revealed = previewCustomerReveal('c1000001-0000-4000-8000-000000000001');
    expect(revealed.phone).toBe('9840011111');
    expect(revealed.phone).not.toContain('•');
    expect(() => previewCustomerReveal('00000000-0000-4000-8000-000000000000')).toThrow();
  });
});
