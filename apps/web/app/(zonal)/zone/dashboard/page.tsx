/**
 * SA-1.1: the Zonal Admin shell (zone scope switcher, doc 18 §4) and
 * dashboards arrive in a later task. Login already routes Zonal Admins here.
 */
export default function ZoneDashboard() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
      <h1 className="text-2xl font-semibold text-text">ZOAURO Admin</h1>
      <p className="text-sm text-muted">
        The Zonal Admin dashboard arrives in a later task. Your sign-in succeeded.
      </p>
      <a href="/login" className="text-sm font-medium text-nav-active hover:underline">
        Back to sign in
      </a>
    </main>
  );
}
