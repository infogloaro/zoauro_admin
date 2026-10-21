/**
 * Permission keys for M16 Dashboards (doc 04 §3 matrix "Dashboard",
 * doc 09 `/dashboard` catalogue lines 30-32).
 *
 * Routes declare `dashboard:view`; enforcement today is role-based (see
 * `dashboard.scope.ts`) until SA-1.7 resolves grants per member per zone —
 * the same seam as `customer.scope.ts` / `payment` module (TD-32). Doc 04
 * §57 adds the tile rule: a dashboard tile appears only if the member can
 * view its source module in at least one scoped zone; with grants unbuilt,
 * only Super Admins load aggregates today.
 */
export const DASHBOARD_PERMISSIONS = {
  view: 'dashboard:view',
} as const;

export type DashboardPermission =
  (typeof DASHBOARD_PERMISSIONS)[keyof typeof DASHBOARD_PERMISSIONS];
