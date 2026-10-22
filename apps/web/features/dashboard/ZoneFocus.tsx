'use client';

import { Bike, MapPin, Store, UsersRound } from 'lucide-react';
import { StatCard } from '../../components/shared/StatCard';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { formatPaise } from '../audit/format';
import { useZone } from '../zones/api';
import { CardError, CardSkeleton } from './parts';

// The Super Admin dashboard with one zone picked in the top bar (owner bug, 2026-10-22): the zone cards show that zone
// (status, team, records) instead of the platform totals. One GET /zones/{id}, shared with the zone page's cache.

const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: 'success',
  UPCOMING: 'warning',
  INACTIVE: 'neutral',
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  UPCOMING: 'Upcoming',
  INACTIVE: 'Inactive',
};

/** The three zone KPI cards for one zone. */
export function ZoneFocusKpis({ zoneId }: { zoneId: string }) {
  const zone = useZone(zoneId);
  const z = zone.data;
  const loading = zone.isPending;
  return (
    <>
      <StatCard
        label="Zone status"
        value={z ? (STATUS_LABEL[z.status] ?? z.status) : zone.isError ? '—' : null}
        hint={z ? `${z.code} · ${z.pincodeCount} pincodes` : undefined}
        icon={MapPin}
        tone={z?.status === 'ACTIVE' ? 'success' : 'warning'}
        href={`/super-admin/zones/${zoneId}`}
        loading={loading}
      />
      <StatCard
        label="Zone team"
        value={z ? z.team.total : zone.isError ? '—' : null}
        hint={
          z
            ? z.team.total === 0
              ? 'Needs a Zonal Admin'
              : z.team.top.map((m) => m.name).join(', ')
            : undefined
        }
        icon={UsersRound}
        tone={z && z.team.total === 0 ? 'warning' : 'info'}
        href={`/super-admin/zones/${zoneId}?tab=team`}
        loading={loading}
      />
      <StatCard
        label="Restaurants and Home Food"
        value={z ? z.counts.restaurants + z.counts.homemakers : zone.isError ? '—' : null}
        hint={
          z ? `${z.counts.restaurants} restaurants · ${z.counts.homemakers} Home Food` : undefined
        }
        icon={Store}
        tone="neutral"
        loading={loading}
      />
    </>
  );
}

/** "Zones by status" for one zone: its status, delivery charge, team and records. */
export function ZoneFocusCard({ zoneId }: { zoneId: string }) {
  const zone = useZone(zoneId);
  const z = zone.data;
  return (
    <Card className="xl:col-span-2" aria-labelledby="zone-focus">
      <CardHeader
        id="zone-focus"
        title={z ? `${z.name} (${z.code})` : 'Zone'}
        subtitle="The zone picked in the top bar"
        actions={
          <a
            href={`/super-admin/zones/${zoneId}`}
            className="text-sm font-medium text-primary-strong hover:underline"
          >
            Open zone
          </a>
        }
      />
      <CardBody>
        {zone.isError ? (
          <CardError what="This zone" onRetry={() => void zone.refetch()} error={zone.error} />
        ) : !z ? (
          <CardSkeleton rows={3} />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge tone={STATUS_TONE[z.status] ?? 'neutral'} dot>
                {STATUS_LABEL[z.status] ?? z.status}
              </Badge>
              <span className="text-muted">
                {z.city} · {z.pincodeCount} pincodes · delivery {formatPaise(z.deliveryChargePaise)}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              {(
                [
                  ['Restaurants', z.counts.restaurants, Store],
                  ['Home Food', z.counts.homemakers, Store],
                  ['Delivery partners', z.counts.partners, Bike],
                  ['Customers', z.counts.customers, UsersRound],
                  ['Team', z.team.total, UsersRound],
                ] as const
              ).map(([label, value, Icon]) => (
                <div key={label} className="rounded-input bg-surface-muted p-3">
                  <dt className="flex items-center gap-1 text-xs text-muted">
                    <Icon aria-hidden className="size-3" /> {label}
                  </dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-muted">
              {z.team.total === 0
                ? 'No Zonal Admin manages this zone yet.'
                : `Managed by ${z.team.top.map((m) => m.name).join(', ')}${
                    z.team.total > z.team.top.length
                      ? ` and ${z.team.total - z.team.top.length} more`
                      : ''
                  }.`}
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
