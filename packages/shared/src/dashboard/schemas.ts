import { z } from 'zod';
import { ORDER_STATUSES } from '../orders/schemas';

// Dashboard tiles (M16; doc 09 /dashboard/*, SA-5.1, ZA-5.1, doc 36, doc 04 section 4.3). Every tile counts only the
// zones where the member can view its source module; a tile they cannot see anywhere is null (the UI hides it).
// Money tiles wait for the ledger (doc 34: SA-6.7). Days are India days (IST, UTC+05:30).

export const DASHBOARD_RANGES = ['today', '7d', '30d', 'month'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

/**
 * `?zoneId=` (repeatable): the top-bar zone. The auth context narrows every tile to requested ∩ the tile's zones (an
 * unassigned zone is 404 ZONE_NOT_FOUND) and the cache key holds the narrowed scope.
 */
const zoneIdsParam = z.preprocess(
  (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
  z.array(z.uuid()).min(1).max(50).optional(),
);

export const dashboardQuerySchema = z.object({
  range: z.enum(DASHBOARD_RANGES).default('7d'),
  zoneId: zoneIdsParam,
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
const DAY_MS = 86_400_000;

/** Start of the IST day containing `at`, as a UTC Date. */
export function istDayStart(at: Date): Date {
  const local = at.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}

/**
 * The window of a range ending now: today = since IST midnight (hourly buckets); 7d / 30d = the last 7 / 30 IST days
 * including today (daily); month = since the 1st of this IST month (daily).
 */
export function dashboardWindow(
  range: DashboardRange,
  now: Date,
): { from: Date; to: Date; bucket: 'hour' | 'day' } {
  const today = istDayStart(now);
  if (range === 'today') return { from: today, to: now, bucket: 'hour' };
  if (range === '7d')
    return { from: new Date(today.getTime() - 6 * DAY_MS), to: now, bucket: 'day' };
  if (range === '30d')
    return { from: new Date(today.getTime() - 29 * DAY_MS), to: now, bucket: 'day' };
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  const first = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - IST_OFFSET_MS;
  return { from: new Date(first), to: now, bucket: 'day' };
}

const count = z.number().int().min(0);
const nullableCount = count.nullable();
const iso = z.iso.datetime();

/** GET /dashboard/summary. Entity counts are all-time; orders follow the range. */
export const dashboardSummarySchema = z.object({
  range: z.enum(DASHBOARD_RANGES),
  orders: z
    .object({ total: count, delivered: count, cancelled: count, cancellationRate: z.number() })
    .nullable(),
  restaurants: z
    .object({ total: count, active: count, pendingVerification: count, suspended: count })
    .nullable(),
  homemakers: z
    .object({ total: count, active: count, pendingVerification: count, suspended: count })
    .nullable(),
  deliveryPartners: z
    .object({ total: count, active: count, pendingVerification: count, onDuty: count })
    .nullable(),
  customers: nullableCount,
  /** Super Admin only (R-ACC-4) */
  zonesWithoutTeam: nullableCount,
  /** Super Admin only, database-derived (D34) */
  platformHealth: z.object({ pendingVerifications: count, activeSessions: count }).nullable(),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

/** GET /dashboard/order-status: the donut. */
export const dashboardOrderStatusSchema = z.object({
  range: z.enum(DASHBOARD_RANGES),
  data: z.array(z.object({ status: z.enum(ORDER_STATUSES), count })).nullable(),
});
export type DashboardOrderStatus = z.infer<typeof dashboardOrderStatusSchema>;

/** GET /dashboard/order-overview: orders per IST hour (today) or day. */
export const dashboardOrderOverviewSchema = z.object({
  range: z.enum(DASHBOARD_RANGES),
  bucket: z.enum(['hour', 'day']),
  data: z.array(z.object({ at: iso, orders: count, delivered: count })).nullable(),
});
export type DashboardOrderOverview = z.infer<typeof dashboardOrderOverviewSchema>;

/** GET /dashboard/zone-orders: per zone when the scope has more than one zone, else per vendor area. */
export const dashboardZoneOrdersSchema = z.object({
  range: z.enum(DASHBOARD_RANGES),
  by: z.enum(['zone', 'area']),
  data: z.array(z.object({ key: z.string(), label: z.string(), orders: count })).nullable(),
});
export type DashboardZoneOrders = z.infer<typeof dashboardZoneOrdersSchema>;

/** GET /dashboard/top-restaurants: restaurants and home kitchens by delivered orders. */
export const dashboardTopVendorsSchema = z.object({
  range: z.enum(DASHBOARD_RANGES),
  data: z
    .array(
      z.object({
        id: z.uuid(),
        vendorType: z.enum(['RESTAURANT', 'HOMEMAKER']),
        name: z.string(),
        zone: z.object({ id: z.uuid(), name: z.string(), code: z.string() }).nullable(),
        deliveredOrders: count,
      }),
    )
    .nullable(),
});
export type DashboardTopVendors = z.infer<typeof dashboardTopVendorsSchema>;

/** GET /dashboard/top-categories: categories by item quantity of delivered orders. */
export const dashboardTopCategoriesSchema = z.object({
  range: z.enum(DASHBOARD_RANGES),
  data: z.array(z.object({ id: z.uuid(), name: z.string(), quantity: count })).nullable(),
});
export type DashboardTopCategories = z.infer<typeof dashboardTopCategoriesSchema>;

const recentEntry = z.object({ id: z.uuid(), name: z.string(), createdAt: iso });

/** GET /dashboard/new-registrations: counts in the range and the latest five of each (contacts never included). */
export const dashboardNewRegistrationsSchema = z.object({
  range: z.enum(DASHBOARD_RANGES),
  customers: z.object({ count, latest: z.array(recentEntry) }).nullable(),
  vendors: z
    .object({
      count,
      latest: z.array(recentEntry.extend({ vendorType: z.enum(['RESTAURANT', 'HOMEMAKER']) })),
    })
    .nullable(),
  deliveryPartners: z.object({ count, latest: z.array(recentEntry) }).nullable(),
});
export type DashboardNewRegistrations = z.infer<typeof dashboardNewRegistrationsSchema>;
