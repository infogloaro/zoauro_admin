import { describe, expect, it } from 'vitest';
import { listDeliveryPartnersResponseSchema } from '@zoauro/shared';
import {
  isPartnerPreview,
  mockPartnersList,
  setPartnerPreview,
  PREVIEW_ZONE_OPTIONS,
} from './preview';

/**
 * Preview-mode guard rails (dev-only mock data for the M10 screen): the mock
 * payloads must satisfy the shared contracts, and the flag must stay off
 * outside `next dev` (vitest runs with NODE_ENV=test, so an activated flag
 * must still read as false).
 */
describe('delivery partner preview mode', () => {
  it('never activates outside a development build', () => {
    setPartnerPreview(true);
    expect(isPartnerPreview()).toBe(false);
    setPartnerPreview(false);
    expect(isPartnerPreview()).toBe(false);
  });

  it('list satisfies the shared list contract', () => {
    const response = mockPartnersList({ page: 1, pageSize: 25, sort: '-createdAt' });
    expect(() => listDeliveryPartnersResponseSchema.parse(response)).not.toThrow();
    expect(response.data.length).toBeGreaterThan(0);
    expect(response.meta.counts.total).toBe(response.data.length);
    expect(response.meta.facets.areas.length).toBeGreaterThan(0);
    expect(response.meta.facets.vehicleTypes.length).toBeGreaterThan(1);
    expect(response.meta.facets.zones.length).toBeGreaterThan(1);
    expect(PREVIEW_ZONE_OPTIONS).toHaveLength(response.meta.facets.zones.length);
  });

  it('honours status and isOnline filters while KPI counts stay scope-wide', () => {
    const all = mockPartnersList({ page: 1, pageSize: 25, sort: '-createdAt' });
    expect(all.meta.counts.pendingVerification).toBe(1);
    expect(all.meta.counts.onDuty).toBe(1);
    expect(all.meta.counts.suspended).toBe(1);

    const pending = mockPartnersList({
      page: 1,
      pageSize: 25,
      sort: 'name',
      status: 'PENDING_VERIFICATION',
    });
    expect(pending.data).toHaveLength(1);
    expect(pending.data[0]?.name).toBe('Anitha Devi');
    // KPI counts stay scope-wide even when rows are filtered (doc 20).
    expect(pending.meta.counts.total).toBe(all.meta.counts.total);

    const onDuty = mockPartnersList({ page: 1, pageSize: 25, sort: 'name', isOnline: 'true' });
    expect(onDuty.data).toHaveLength(1);
    expect(onDuty.data[0]?.name).toBe('Karthik Raja');
    expect(onDuty.data[0]?.isOnline).toBe(true);

    const offDuty = mockPartnersList({ page: 1, pageSize: 25, sort: 'name', isOnline: 'false' });
    expect(offDuty.data.every((p) => p.isOnline === false)).toBe(true);
    expect(offDuty.data).toHaveLength(all.meta.counts.total - all.meta.counts.onDuty);
  });

  it('filters by vehicle type', () => {
    const vans = mockPartnersList({ page: 1, pageSize: 25, sort: 'name', vehicleType: 'VAN' });
    expect(vans.data).toHaveLength(1);
    expect(vans.data[0]?.name).toBe('Farooq Ahmed');
  });

  it('unknown filters return no rows but keep counts', () => {
    const response = mockPartnersList({
      page: 1,
      pageSize: 25,
      sort: '-createdAt',
      zoneId: '99999999-9999-4999-8999-999999999999',
    });
    expect(response.data).toHaveLength(0);
    expect(response.meta.total).toBe(0);
    expect(response.meta.counts.total).toBeGreaterThan(0);
  });

  it('sorts by rating and name in both directions', () => {
    const byRating = mockPartnersList({ page: 1, pageSize: 25, sort: '-rating' });
    expect(byRating.data[0]?.name).toBe('Karthik Raja');

    const byName = mockPartnersList({ page: 1, pageSize: 25, sort: 'name' });
    expect(byName.data[0]?.name).toBe('Anitha Devi');
  });
});
