import { z } from 'zod';

/**
 * M16 Dashboards contract (doc 09 `/dashboard/*` lines 30-32, docs 20/39 M16,
 * D34 platform health).
 *
 * Only aggregates the current schema can prove are in this contract. The
 * order/revenue KPIs and charts from doc 20 (Total Orders, Total Revenue,
 * Platform Commission, Restaurant Payouts, Total Refunds, Avg Order Value,
 * Cancellation Rate, Order Overview, Revenue Overview, Order Status, Top
 * Food Categories, Zone Performance, Recent Orders) need the M11 `orders`
 * table and real payment records (Payments Phase 2C verdict: the current
 * `payments` table is a placeholder, not a financial system of record).
 * They stay out of the contract — the web renders them as honest
 * placeholders, never invented numbers.
 */

const nonNegInt = z.number().int().nonnegative();

/** Doc 09 line 30: scoped aggregates; repeatable `?zoneId` (doc 09 conventions). */
export const listDashboardQuerySchema = z.object({
  zoneId: z.union([z.uuid(), z.array(z.uuid())]).optional(),
});
export type ListDashboardQuery = z.infer<typeof listDashboardQuerySchema>;

/** Normalises the repeatable `?zoneId=` parameter (doc 09). */
export function requestedDashboardZoneIds(query: ListDashboardQuery): string[] | undefined {
  if (query.zoneId === undefined) return undefined;
  return Array.isArray(query.zoneId) ? query.zoneId : [query.zoneId];
}

/**
 * `GET /dashboard/summary` (doc 09 line 30).
 *
 * Definitions (aligned to doc 20 row 10 and doc 39 W-flow "Pending
 * verification" counter):
 * - `pendingVerification` = restaurants + homemakers with
 *   `verificationStatus=PENDING` plus delivery partners with
 *   `status=PENDING_VERIFICATION`.
 * - `suspended` = restaurants + homemakers + delivery partners with
 *   `status=SUSPENDED`.
 * - `platformHealth` is DB-derived only (D34): pending verifications across
 *   the same three populations plus currently-active admin sessions
 *   (`revokedAt IS NULL` and `expiresAt` in the future). No uptime figure.
 */
export const dashboardSummarySchema = z.object({
  customers: nonNegInt,
  restaurants: nonNegInt,
  activeRestaurants: nonNegInt,
  homemakers: nonNegInt,
  deliveryPartners: nonNegInt,
  pendingVerification: nonNegInt,
  suspended: nonNegInt,
  platformHealth: z.object({
    pendingVerifications: nonNegInt,
    activeSessions: nonNegInt,
  }),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

/** `GET /dashboard/new-registrations` (doc 09 line 32; from/to per doc 09 conventions). */
export const newRegistrationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).default(5),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, 'from must be an ISO date (YYYY-MM-DD)')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, 'to must be an ISO date (YYYY-MM-DD)')
    .optional(),
  zoneId: z.union([z.uuid(), z.array(z.uuid())]).optional(),
});
export type NewRegistrationsQuery = z.infer<typeof newRegistrationsQuerySchema>;

export const registrationItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.string(),
});
export type RegistrationItem = z.infer<typeof registrationItemSchema>;

export const newRegistrationsResponseSchema = z.object({
  data: z.object({
    customers: z.array(registrationItemSchema),
    restaurants: z.array(registrationItemSchema),
    deliveryPartners: z.array(registrationItemSchema),
  }),
  meta: z.object({
    limit: nonNegInt,
    from: z.string().optional(),
    to: z.string().optional(),
  }),
});
export type NewRegistrationsResponse = z.infer<typeof newRegistrationsResponseSchema>;
