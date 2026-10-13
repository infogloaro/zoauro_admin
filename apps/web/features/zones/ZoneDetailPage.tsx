'use client';

import type { ZoneDto } from '@zoauro/shared';
import {
  Bike,
  CalendarClock,
  ChefHat,
  Info,
  IndianRupee,
  MapPin,
  Pencil,
  Power,
  PowerOff,
  Store,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { useUrlState } from '../../lib/url-state';
import { ActivityTab } from '../audit/ActivityTab';
import { formatPaise, formatTimestamp } from '../audit/format';
import { failureKind } from '../audit/useAuditLogs';
import { CardError, CardSkeleton, EmptyState } from '../dashboard/parts';
import { useZone, useZoneImpact, useZoneTeam } from './api';
import {
  ZONE_STATUS_LABEL,
  ZONE_STATUS_TONE,
  countOrDash,
  missingLabel,
  pincodeSummary,
} from './format';
import { PincodesTab } from './PincodesTab';
import { ZoneFormDialog } from './ZoneFormDialog';
import { ImpactTable, ZoneStatusDialog, type ZoneAction } from './ZoneStatusDialogs';

// Zone Details workspace (doc 53 section 6, roadmap R10): header with status and actions, and the tabs Overview
// (facts, counts, operational snapshot), Pincodes, Team (read-only until Access Control, M03) and Activity (the audit
// trail of this zone). The tab is kept in the URL so a reload or a shared link opens the same view.

const TABS = ['overview', 'pincodes', 'team', 'activity'] as const;
type Tab = (typeof TABS)[number];

export function ZoneDetailPage({ id }: { id: string }) {
  const url = useUrlState();
  const raw = url.params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'overview';
  const zone = useZone(id);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<ZoneAction | null>(null);

  if (zone.isError) {
    const kind = failureKind(zone.error);
    return (
      <div className="mx-auto mt-12 max-w-lg">
        {kind === 404 ? (
          <EmptyState
            icon={<MapPin aria-hidden className="size-5" />}
            title="Zone not found"
            action={
              <a
                href="/super-admin/zones"
                className="text-sm font-medium text-primary-strong hover:underline"
              >
                Back to zones
              </a>
            }
          >
            It may have been deleted, or the link is wrong.
          </EmptyState>
        ) : (
          <CardError what="This zone" onRetry={() => void zone.refetch()} />
        )}
      </div>
    );
  }
  const z = zone.data;
  if (!z) return <CardSkeleton rows={6} />;

  return (
    <div>
      <PageHeader
        title={z.name}
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Zones', href: '/super-admin/zones' },
          { label: z.name },
        ]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden
              className="size-3 rounded-full"
              style={{ backgroundColor: z.colorHex }}
            />
            <span className="font-medium text-text">{z.code}</span> · {z.city}
            {z.state ? `, ${z.state}` : ''} · {pincodeSummary(z)}
          </span>
        }
        badge={
          <Badge tone={ZONE_STATUS_TONE[z.status]} dot>
            {ZONE_STATUS_LABEL[z.status]}
          </Badge>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil aria-hidden className="size-4" /> Edit
            </Button>
            {z.status !== 'ACTIVE' ? (
              <Button variant="secondary" onClick={() => setAction('delete')}>
                <Trash2 aria-hidden className="size-4" /> Delete
              </Button>
            ) : null}
            {z.status === 'ACTIVE' ? (
              <Button variant="danger" onClick={() => setAction('deactivate')}>
                <PowerOff aria-hidden className="size-4" /> Deactivate
              </Button>
            ) : (
              <Button onClick={() => setAction('activate')}>
                <Power aria-hidden className="size-4" /> Activate
              </Button>
            )}
          </>
        }
      />

      {z.status === 'INACTIVE' && z.deactivationReason ? (
        <div className="mb-6 flex items-start gap-3 rounded-card border border-line bg-surface-muted p-4 text-sm">
          <PowerOff aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
          <p>
            <span className="font-semibold">
              Paused{z.deactivatedAt ? ` on ${formatTimestamp(z.deactivatedAt)}` : ''}.
            </span>{' '}
            <span className="text-muted">
              Reason: “{z.deactivationReason}”. New orders are refused; open orders continued.
            </span>
          </p>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(v) => url.patch({ tab: v === 'overview' ? null : v })}>
        <TabsList aria-label="Zone sections" className="mb-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="pincodes">Pincodes</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Overview zone={z} missing={z.missingSources} counts={z.counts} />
        </TabsContent>
        <TabsContent value="pincodes">
          <PincodesTab zone={z} />
        </TabsContent>
        <TabsContent value="team">
          <TeamTab zoneId={z.id} />
        </TabsContent>
        <TabsContent value="activity">
          <Card>
            <CardHeader title="Activity" subtitle="Every change to this zone, newest first." />
            <CardBody>
              <ActivityTab entityType="zone" entityId={z.id} />
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>

      <ZoneFormDialog open={editing} zone={z} onClose={() => setEditing(false)} />
      <ZoneStatusDialog
        action={action}
        zone={z}
        onClose={() => setAction(null)}
        onDone={(a) => {
          if (a === 'delete') window.location.assign('/super-admin/zones');
        }}
      />
    </div>
  );
}

function Overview({
  zone: z,
  counts,
  missing,
}: {
  zone: ZoneDto;
  counts: {
    restaurants: number;
    homemakers: number;
    partners: number;
    customers: number;
    members: number;
  };
  missing: Parameters<typeof countOrDash>[2];
}) {
  const impact = useZoneImpact(z.id);
  const dash = (v: number, s: Parameters<typeof countOrDash>[1]) => {
    const shown = countOrDash(v, s, missing);
    return shown === '—' ? null : shown;
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Restaurants"
          value={dash(counts.restaurants, 'restaurants')}
          icon={Store}
          hint={missing.includes('restaurants') ? 'Module not built yet' : undefined}
        />
        <StatCard
          label="Home Food"
          value={dash(counts.homemakers, 'homemakers')}
          icon={ChefHat}
          tone="warning"
          hint={missing.includes('homemakers') ? 'Module not built yet' : undefined}
        />
        <StatCard
          label="Delivery partners"
          value={dash(counts.partners, 'delivery')}
          icon={Bike}
          tone="info"
          hint={missing.includes('delivery') ? 'Module not built yet' : undefined}
        />
        <StatCard
          label="Customers"
          value={dash(counts.customers, 'customers')}
          icon={UsersRound}
          tone="success"
          hint={missing.includes('customers') ? 'Module not built yet' : undefined}
        />
        <StatCard
          label="Zonal Admins"
          value={dash(counts.members, 'access')}
          icon={UsersRound}
          tone="neutral"
          hint={missing.includes('access') ? 'Access Control not built yet' : undefined}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" aria-labelledby="zone-facts">
          <CardHeader id="zone-facts" title="Zone details" />
          <CardBody>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <Fact
                icon={<MapPin aria-hidden className="size-4" />}
                label="Name and code"
                value={`${z.name} (${z.code})`}
              />
              <Fact
                icon={<MapPin aria-hidden className="size-4" />}
                label="City, state"
                value={`${z.city}${z.state ? `, ${z.state}` : ''}`}
              />
              <Fact
                icon={<IndianRupee aria-hidden className="size-4" />}
                label="Default delivery charge"
                value={
                  z.deliveryChargePaise === 0 ? 'Free (₹0)' : formatPaise(z.deliveryChargePaise)
                }
              />
              <Fact
                icon={<MapPin aria-hidden className="size-4" />}
                label="Coverage"
                value={pincodeSummary(z)}
              />
              <Fact
                icon={<CalendarClock aria-hidden className="size-4" />}
                label="Created"
                value={formatTimestamp(z.createdAt)}
              />
              <Fact
                icon={<CalendarClock aria-hidden className="size-4" />}
                label="Last activated"
                value={z.activatedAt ? formatTimestamp(z.activatedAt) : 'Never'}
              />
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-muted uppercase">Description</dt>
                <dd className="mt-1">
                  {z.description ?? <span className="text-muted">No description.</span>}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card aria-labelledby="zone-impact">
          <CardHeader
            id="zone-impact"
            title="Operational snapshot"
            subtitle="What a status change would touch right now"
          />
          <CardBody>
            {impact.isError ? (
              <CardError what="The snapshot" onRetry={() => void impact.refetch()} />
            ) : !impact.data ? (
              <CardSkeleton rows={4} />
            ) : (
              <ImpactTable impact={impact.data} />
            )}
          </CardBody>
        </Card>
      </div>

      {missing.length > 0 ? (
        <p className="flex items-start gap-2 text-xs text-muted">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" /> Figures from{' '}
          {missingLabel(missing)} appear when those modules are built; until then they show “—”.
        </p>
      ) : null}
    </div>
  );
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    // a <dl> group may hold only <dt> and <dd>: the icon lives inside the term
    <div>
      <dt className="flex items-center gap-2 text-xs font-medium text-muted uppercase">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 pl-6 font-medium">{value}</dd>
    </div>
  );
}

function TeamTab({ zoneId }: { zoneId: string }) {
  const team = useZoneTeam(zoneId);
  if (team.isError) return <CardError what="The team" onRetry={() => void team.refetch()} />;
  if (!team.data) return <CardSkeleton rows={3} />;
  return (
    <Card>
      <CardHeader
        title="Team"
        subtitle="Zonal Admins assigned to this zone, with their access profile and limits. Editing arrives with Access Control."
        actions={<Badge tone="brand">Read-only</Badge>}
      />
      <CardBody>
        {team.data.partial ? (
          <EmptyState
            icon={<UsersRound aria-hidden className="size-5" />}
            title="Teams arrive with Access Control"
          >
            Zone teams are managed in the Access Control module (M03), which is not built yet.
            Assigned members will be listed here with their profile, overrides and refund limits.
          </EmptyState>
        ) : team.data.data.length === 0 ? (
          <EmptyState icon={<UsersRound aria-hidden className="size-5" />} title="No team yet">
            This zone has no Zonal Admin. It can still be activated; it is flagged on the dashboard.
          </EmptyState>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Team</caption>
            <thead className="text-left text-xs font-semibold text-muted uppercase">
              <tr>
                <th scope="col" className="pb-2">
                  Member
                </th>
                <th scope="col" className="pb-2">
                  Profile
                </th>
                <th scope="col" className="pb-2 text-right">
                  Overrides
                </th>
                <th scope="col" className="pb-2 text-right">
                  Per refund
                </th>
                <th scope="col" className="pb-2 text-right">
                  Per day
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {team.data.data.map((m) => (
                <tr key={m.userId}>
                  <td className="py-2.5 font-medium">{m.name}</td>
                  <td className="py-2.5">{m.profileName}</td>
                  <td className="py-2.5 text-right tabular-nums">{m.overridesCount}</td>
                  <td className="py-2.5 text-right tabular-nums">
                    {formatPaise(m.limits.perRefundPaise)}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    {formatPaise(m.limits.dailyRefundPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}
