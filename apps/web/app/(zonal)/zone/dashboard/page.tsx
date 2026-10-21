/**
 * M16 Zonal Admin dashboard (doc 18 §2: Zonal Admin lands on /zone/dashboard).
 *
 * The Zonal Admin shell (zone scope switcher, doc 18 §4) and per-zone
 * aggregates need M03/SA-1.7 `admin_zone_assignments` — without them the
 * server has no zone scope for a member, and the dashboard API is
 * Super-Admin-only until the `dashboard:view` grant seam lands (doc 04 §3,
 * doc 36 TC-AC-3). Until then this page shows the honest access-pending
 * state instead of calling the API (a request would only 403) or rendering
 * any fabricated tile. Login already routes Zonal Admins here.
 */
export default function ZoneDashboard() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
      <h1 className="text-2xl font-semibold text-text">Zone Dashboard</h1>
      <p className="max-w-md text-sm text-muted">
        Your zone-scoped dashboard activates once a Super Admin assigns your zones (M03 access
        control). Nothing is shown yet — no zone data is loaded for your account.
      </p>
      <a href="/login" className="text-sm font-medium text-nav-active hover:underline">
        Back to sign in
      </a>
    </main>
  );
}
