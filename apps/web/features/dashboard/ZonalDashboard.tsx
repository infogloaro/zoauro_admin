import type { MeZone } from '@zoauro/shared';
import { ArrowRight, Eye, FileDown, IndianRupee, MapPin, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { NavIconGlyph } from '../../components/shell/icons';
import { menuFor } from '../../lib/navigation';
import { formatPaise } from '../audit/format';
import { OperationsTiles } from './tiles/OperationsTiles';
import { greeting, todayLabel } from './time';

// Zonal Admin dashboard (M16): the operations tiles for the member's zones (orders, vendors, partners, customers,
// counted only where they may view each module), then their own zones, what they may do in each (from /me, resolved by
// the API per request) and their refund limits, plus the modules they can open. Money tiles wait for the ledger.

const STATUS_TONE: Record<MeZone['status'], BadgeTone> = {
  ACTIVE: 'success',
  UPCOMING: 'warning',
  INACTIVE: 'neutral',
};
const STATUS_LABEL: Record<MeZone['status'], string> = {
  ACTIVE: 'Active',
  UPCOMING: 'Upcoming',
  INACTIVE: 'Inactive',
};
const ACTION_LABEL: Record<string, string> = {
  view: 'View',
  add: 'Add',
  edit: 'Edit',
  delete: 'Delete',
  status: 'Status',
};

/** Permission keys grouped by module: { orders: ['view', 'edit'], ... } */
export function groupPermissions(keys: readonly string[]): [string, string[]][] {
  const byModule = new Map<string, string[]>();
  for (const key of keys) {
    const [module, action] = key.split(':');
    if (!module || !action) continue;
    byModule.set(module, [...(byModule.get(module) ?? []), action]);
  }
  return [...byModule.entries()].sort(([a], [b]) => a.localeCompare(b));
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ZonalDashboard({ name, zones }: { name: string; zones: readonly MeZone[] }) {
  const menu = menuFor('ZONAL_ADMIN', zones).filter((m) => m.id !== 'M16' && m.group !== 'account');
  const active = zones.filter((z) => z.status === 'ACTIVE').length;
  const highestLimit = Math.max(0, ...zones.map((z) => z.limits.perRefund));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${greeting()}, ${name.split(' ')[0] ?? name}`}
        crumbs={[{ label: 'Dashboard' }, { label: 'Overview' }]}
        description={`Your zones and what you can do in them · ${todayLabel()}`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="My zones" value={zones.length} hint={`${active} active`} icon={MapPin} />
        <StatCard
          label="Modules I can open"
          value={menu.length}
          hint={`${menu.filter((m) => m.status === 'live').length} live now`}
          icon={ShieldCheck}
          tone="info"
        />
        <StatCard
          label="Highest per-refund limit"
          value={highestLimit > 0 ? formatPaise(highestLimit) : 'None'}
          hint="Above it, refunds go to approval"
          icon={IndianRupee}
          tone="warning"
        />
        <StatCard
          label="Account security"
          value="Review"
          hint="2-step, sessions and sign-ins"
          icon={ShieldCheck}
          tone="success"
          href="/account/security"
        />
      </div>

      {zones.length > 0 ? <OperationsTiles userRole="ZONAL_ADMIN" /> : null}

      <h2 className="text-lg font-semibold">My zones and access</h2>

      <div className="grid gap-6 lg:grid-cols-2">
        {zones.map((z) => {
          const groups = groupPermissions(z.permissions);
          return (
            <Card key={z.zoneId} aria-labelledby={`zone-${z.zoneId}`}>
              <CardHeader
                id={`zone-${z.zoneId}`}
                title={
                  <span className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="size-3 rounded-full ring-4 ring-neutral-100"
                      style={{ backgroundColor: z.colorHex }}
                    />
                    {z.name}
                    <span className="text-sm font-normal text-muted">({z.code})</span>
                  </span>
                }
                actions={
                  <Badge tone={STATUS_TONE[z.status]} dot>
                    {STATUS_LABEL[z.status]}
                  </Badge>
                }
              />
              <CardBody className="flex flex-col gap-5">
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div className="rounded-input bg-surface-muted p-3">
                    <dt className="text-xs text-muted">Per refund</dt>
                    <dd className="mt-0.5 font-semibold">{formatPaise(z.limits.perRefund)}</dd>
                  </div>
                  <div className="rounded-input bg-surface-muted p-3">
                    <dt className="text-xs text-muted">Per day</dt>
                    <dd className="mt-0.5 font-semibold">{formatPaise(z.limits.dailyRefund)}</dd>
                  </div>
                  <div className="rounded-input bg-surface-muted p-3">
                    <dt className="flex items-center gap-1 text-xs text-muted">
                      <Eye aria-hidden className="size-3" /> Reveal contacts
                    </dt>
                    <dd className="mt-0.5 font-semibold">{z.limits.canReveal ? 'Yes' : 'No'}</dd>
                  </div>
                  <div className="rounded-input bg-surface-muted p-3">
                    <dt className="flex items-center gap-1 text-xs text-muted">
                      <FileDown aria-hidden className="size-3" /> Export
                    </dt>
                    <dd className="mt-0.5 font-semibold">{z.limits.canExport ? 'Yes' : 'No'}</dd>
                  </div>
                </dl>
                <div>
                  <p className="mb-2 text-xs font-medium text-muted uppercase">
                    What I can do here
                  </p>
                  {groups.length === 0 ? (
                    <p className="text-sm text-muted">
                      No permissions in this zone yet. Ask a Super Admin to set your access.
                    </p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-line rounded-input border border-line">
                      {groups.map(([module, actions]) => (
                        <li
                          key={module}
                          className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
                        >
                          <span className="w-32 font-medium">{titleCase(module)}</span>
                          <span className="flex flex-wrap gap-1">
                            {actions.map((a) => (
                              <Badge key={a} tone="brand">
                                {ACTION_LABEL[a] ?? a}
                              </Badge>
                            ))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <Card aria-labelledby="my-modules">
        <CardHeader
          id="my-modules"
          title="My modules"
          subtitle="Everything you can open, live or coming soon"
        />
        <CardBody>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {menu.map((m) => (
              <li key={m.id}>
                <a
                  href={m.href}
                  className="flex items-center gap-3 rounded-input border border-line p-3 text-sm hover:border-orange-200 hover:bg-primary-soft/40 focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary-strong">
                    <NavIconGlyph icon={m.icon} className="size-4" />
                  </span>
                  <span className="flex-1 font-medium">{m.label}</span>
                  {m.status === 'coming-soon' ? (
                    <Badge tone="brand">Soon</Badge>
                  ) : (
                    <Badge tone="success">Live</Badge>
                  )}
                  <ArrowRight aria-hidden className="size-3.5 text-muted" />
                </a>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
