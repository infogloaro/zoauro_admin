import { describe, expect, it } from 'vitest';
import {
  listVendorsResponseSchema,
  onboardingRequirementSchema,
  vendorDetailSchema,
  vendorOnboardingSchema,
  vendorReviewQueueItemSchema,
} from '@zoauro/shared';
import {
  PREVIEW_ZONE_OPTIONS,
  isVendorPreview,
  mockOnboarding,
  mockOnboardingChecklist,
  mockReviewQueue,
  mockVendorDetail,
  mockVendorsList,
  setVendorPreview,
} from './preview';

/**
 * Preview-mode guard rails (dev-only mock data for the M06/M07 screens):
 * the mock payloads must satisfy the shared contracts, and the flag must
 * stay off outside `next dev` (vitest runs with NODE_ENV=test, so an
 * activated flag must still read as false).
 */
describe('vendor preview mode', () => {
  it('never activates outside a development build', () => {
    setVendorPreview(true);
    expect(isVendorPreview()).toBe(false);
    setVendorPreview(false);
    expect(isVendorPreview()).toBe(false);
  });

  it('restaurant list satisfies the shared list contract', () => {
    const response = mockVendorsList('restaurant', { page: 1, pageSize: 25, sort: '-createdAt' });
    expect(() => listVendorsResponseSchema.parse(response)).not.toThrow();
    expect(response.data.length).toBeGreaterThan(0);
    expect(response.meta.counts.total).toBe(response.data.length);
    expect(response.meta.facets.areas.length).toBeGreaterThan(0);
    expect(response.meta.facets.zones.length).toBeGreaterThan(1);
    expect(PREVIEW_ZONE_OPTIONS).toHaveLength(response.meta.facets.zones.length);
  });

  it('homemaker list honours q and status filters', () => {
    const all = mockVendorsList('homemaker', { page: 1, pageSize: 25, sort: '-createdAt' });
    expect(() => listVendorsResponseSchema.parse(all)).not.toThrow();

    const filtered = mockVendorsList('homemaker', {
      page: 1,
      pageSize: 25,
      sort: 'name',
      q: 'fathima',
      status: 'PENDING',
    });
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0]?.name).toBe("Fathima's Bakes");
    // KPI counts stay scope-wide even when rows are filtered (doc 20).
    expect(filtered.meta.counts.total).toBe(all.meta.counts.total);
  });

  it('unknown filters return no rows but keep counts', () => {
    const response = mockVendorsList('restaurant', {
      page: 1,
      pageSize: 25,
      sort: '-createdAt',
      zoneId: '99999999-9999-4999-8999-999999999999',
    });
    expect(response.data).toHaveLength(0);
    expect(response.meta.total).toBe(0);
    expect(response.meta.counts.total).toBeGreaterThan(0);
  });

  it('restaurant detail satisfies the shared detail contract', () => {
    const list = mockVendorsList('restaurant', { page: 1, pageSize: 25, sort: 'name' });
    const first = list.data.at(0);
    expect(first).toBeDefined();
    if (!first) return;
    const detail = mockVendorDetail('restaurant', first.id);
    expect(() => vendorDetailSchema.parse(detail)).not.toThrow();
    expect(detail.documents).toEqual([]);
    expect(detail.activity).toEqual([]);
  });

  it('unknown ids fall back to the first mock so dialogs still render', () => {
    const detail = mockVendorDetail('homemaker', '00000000-0000-4000-8000-000000000000');
    expect(() => vendorDetailSchema.parse(detail)).not.toThrow();
    expect(detail.kind).toBe('homemaker');
  });

  it('A1 onboarding mocks satisfy the shared contracts', () => {
    const checklist = mockOnboardingChecklist('restaurant');
    for (const row of checklist) expect(() => onboardingRequirementSchema.parse(row)).not.toThrow();
    const onboarding = mockOnboarding('restaurant', 'a1000001-0000-4000-8000-000000000001');
    expect(() => vendorOnboardingSchema.parse(onboarding)).not.toThrow();
    expect(onboarding.readiness.provisional).toBe(true);
    expect(onboarding.checklist.every((item) => item.state === 'MISSING')).toBe(true);
  });

  it('A1 review queue mock satisfies the shared contract', () => {
    const queue = mockReviewQueue('homemaker');
    expect(queue.length).toBeGreaterThan(0);
    for (const row of queue) expect(() => vendorReviewQueueItemSchema.parse(row)).not.toThrow();
  });
});
