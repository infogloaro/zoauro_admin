import type { MeZone } from '@zoauro/shared';
import { comingSoonHref, visibleModules, type ShellRole } from '../../lib/navigation';
import { Badge } from '../ui/badge';

// The Dashboard of this release (doc 56 P14): an honest status page, not a metrics board. It says who is signed in, in
// which zones, and which modules work today. No numbers are shown because none are measured yet.

const ROLE_LABEL = { SUPER_ADMIN: 'Super Admin', ZONAL_ADMIN: 'Zonal Admin' } as const;

export function DashboardStatus({
  name,
  userRole: role,
  zones,
}: {
  name: string;
  userRole: ShellRole;
  zones: readonly MeZone[];
}) {
  const modules = visibleModules(role, zones);
  const live = modules.filter((m) => m.status === 'live' && m.id !== 'M16');
  const soon = modules.filter((m) => m.status === 'coming-soon');
  const href = (m: (typeof modules)[number]) =>
    (role === 'SUPER_ADMIN' ? m.superAdminHref : m.zonal?.href) ?? comingSoonHref(m.slug);
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Welcome, {name}</h1>
        <p className="mt-1 text-sm text-muted">
          Signed in as {ROLE_LABEL[role]}.{' '}
          {role === 'SUPER_ADMIN'
            ? 'You have access to all zones.'
            : `You are assigned to ${zones.length === 1 ? 'one zone' : `${zones.length} zones`}.`}
        </p>
      </header>

      {role === 'ZONAL_ADMIN' ? (
        <section
          aria-labelledby="zones-title"
          className="rounded-card border border-line bg-surface p-5"
        >
          <h2 id="zones-title" className="text-base font-semibold">
            My zones
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {zones.map((z) => (
              <li
                key={z.zoneId}
                className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-sm"
              >
                <span
                  aria-hidden
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: z.colorHex }}
                />
                {z.name} <span className="text-xs text-muted">({z.code})</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <section
          aria-labelledby="live-title"
          className="rounded-card border border-line bg-surface p-5"
        >
          <h2 id="live-title" className="text-base font-semibold">
            Available now
          </h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {live.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3">
                <a
                  href={href(m)}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  {m.label}
                </a>
                <Badge tone="success">Live</Badge>
              </li>
            ))}
          </ul>
        </section>
        <section
          aria-labelledby="soon-title"
          className="rounded-card border border-line bg-surface p-5"
        >
          <h2 id="soon-title" className="text-base font-semibold">
            Coming soon
          </h2>
          <p className="mt-1 text-sm text-muted">Not available in this release.</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {soon.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3">
                <a href={comingSoonHref(m.slug)} className="underline-offset-2 hover:underline">
                  {m.label}
                </a>
                <Badge>Coming Soon</Badge>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
