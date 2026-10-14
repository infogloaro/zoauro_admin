'use client';

import {
  ZONE_SERVICES,
  ZONE_SERVICE_DEFAULTS,
  ZONE_SERVICE_LABELS,
  type ZoneServiceKind,
} from '@zoauro/shared';
import {
  BedDouble,
  ChefHat,
  History,
  Lock,
  Map,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  UserCog,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { cn } from '../../lib/utils';
import { CardError, EmptyState } from '../dashboard/parts';
import { useZoneList } from '../zones/api';
import { ZONE_STATUS_LABEL, ZONE_STATUS_TONE } from '../zones/format';
import { ServiceSwitchConfirm } from './ServiceSwitchConfirm';
import { useSwitchService } from './useZoneServices';

// Super Admin Control Panel (owner's D92: "all settings and control under the Super Admin"): which services run in
// each zone (switch per zone × service, PASSWORD re-auth, confirmation before switching off), and one place to reach
// every control the Super Admin allocates: Zonal Admin accounts, access profiles, zone teams, access history, zones and
// security. Platform settings (refund limits, documents, SLAs, notification timing, order numbers) are listed with the
// decided defaults until their screens arrive with the settings API (doc 57 workstream 2).

const SERVICE_ICON: Record<ZoneServiceKind, LucideIcon> = {
  RESTAURANTS: Store,
  HOME_FOOD: ChefHat,
  HOTEL_BOOKING: BedDouble,
};

const CONTROLS: { href: string; title: string; text: string; icon: LucideIcon }[] = [
  {
    href: '/super-admin/zonal-admins',
    title: 'Zonal Admins',
    text: 'Accounts, status, passwords, 2-step, sessions',
    icon: UserCog,
  },
  {
    href: '/super-admin/access/profiles',
    title: 'Access profiles',
    text: 'Permission templates and default refund limits',
    icon: ShieldCheck,
  },
  {
    href: '/super-admin/access/teams',
    title: 'Zone teams',
    text: 'Who runs each zone, with which profile',
    icon: UsersRound,
  },
  {
    href: '/super-admin/access/history',
    title: 'Access history',
    text: 'Every access change, before and after',
    icon: History,
  },
  {
    href: '/super-admin/zones',
    title: 'Zones',
    text: 'Pincodes, delivery charge, activate or pause',
    icon: Map,
  },
  {
    href: '/super-admin/settings/security',
    title: 'Security',
    text: '2-step policy, codes, SMS provider',
    icon: Lock,
  },
];

const DEFAULTS: { title: string; value: string; ref: string }[] = [
  { title: 'Refund limits per zone', value: '₹1,000 per refund · ₹5,000 per day', ref: 'D13' },
  { title: 'Second approver', value: 'Refunds above ₹10,000', ref: 'D95' },
  { title: 'Restaurant documents', value: 'FSSAI, GST, PAN, bank details', ref: 'D97' },
  { title: 'Delivery partner documents', value: 'Licence, RC, ID, bank details', ref: 'D97' },
  {
    title: 'Support SLAs',
    value: 'Reply 2 h · resolve 24 h · escalate 12 h · reopen 7 days',
    ref: 'D98',
  },
  {
    title: 'Notification timing',
    value: 'Order updates any time · promotions 09:00–21:00',
    ref: 'D100',
  },
  { title: 'Order number', value: 'ZO-<zone code>-<number>', ref: 'D88' },
  { title: 'SMS provider', value: 'MSG91 (needs the DLT template)', ref: 'D68' },
];

export function ControlPanelPage() {
  const [q, setQ] = useState('');
  const zones = useZoneList(q.trim() ? { q: q.trim() } : {});
  const { switchService, dialog } = useSwitchService();
  const [confirm, setConfirm] = useState<{
    zone: { id: string; name: string };
    service: ZoneServiceKind;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = zones.data?.pages.flatMap((p) => p.data) ?? [];
  const flags = (z: (typeof rows)[number]) => z.services ?? ZONE_SERVICE_DEFAULTS;

  const run = async (zone: { id: string; name: string }, service: ZoneServiceKind, on: boolean) => {
    setBusy(`${zone.id}:${service}`);
    await switchService(zone, service, ZONE_SERVICE_LABELS[service], on);
    setBusy(null);
  };

  return (
    <div>
      <PageHeader
        title="Control Panel"
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Administration' },
          { label: 'Control Panel' },
        ]}
        description="Everything the Super Admin allocates in one place: which services run in each zone, who manages them and with which access."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Zones"
          value={zones.data ? rows.length : null}
          hint={zones.hasNextPage ? 'more below' : 'all zones'}
          icon={Map}
          loading={zones.isPending}
        />
        {ZONE_SERVICES.map((s) => (
          <StatCard
            key={s}
            label={`${ZONE_SERVICE_LABELS[s]} on`}
            value={zones.data ? rows.filter((z) => flags(z)[s]).length : null}
            hint={`of ${rows.length} zone${rows.length === 1 ? '' : 's'}`}
            icon={SERVICE_ICON[s]}
            tone={s === 'HOTEL_BOOKING' ? 'info' : s === 'HOME_FOOD' ? 'warning' : 'brand'}
            loading={zones.isPending}
          />
        ))}
      </div>

      <Card className="mb-6" aria-labelledby="services-title">
        <CardHeader
          id="services-title"
          title={
            <span className="flex items-center gap-2">
              <SlidersHorizontal aria-hidden className="size-4 text-primary-strong" /> Services by
              zone
            </span>
          }
          subtitle="Switch a service off to stop new onboarding and new orders for it in that zone. Each change asks for your password and is audited."
          actions={
            <div className="relative w-64">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              />
              <input
                type="search"
                aria-label="Find a zone"
                placeholder="Find a zone…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className={inputClass('h-9 pl-9')}
              />
            </div>
          }
        />
        <CardBody>
          {zones.isError ? (
            <CardError what="The zones" onRetry={() => void zones.refetch()} />
          ) : zones.isPending ? (
            <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading zones">
              {Array.from({ length: 4 }, (_, i) => (
                <span key={i} className="h-11 animate-pulse rounded-input bg-neutral-100" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Map aria-hidden className="size-5" />}
              title={q ? 'No zone matches' : 'No zones yet'}
            >
              {q ? 'Try another name or code.' : 'Create a zone in Zone Management first.'}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">Services by zone</caption>
                <thead className="text-left text-xs font-semibold tracking-wide text-muted uppercase">
                  <tr>
                    <th scope="col" className="pb-3">
                      Zone
                    </th>
                    {ZONE_SERVICES.map((s) => (
                      <th key={s} scope="col" className="pb-3 text-center">
                        {ZONE_SERVICE_LABELS[s]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((z) => (
                    <tr key={z.id}>
                      <th scope="row" className="py-3 pr-4 text-left font-normal">
                        <a
                          href={`/super-admin/zones/${z.id}?tab=services`}
                          className="group flex items-center gap-3"
                        >
                          <span
                            aria-hidden
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: z.colorHex }}
                          />
                          <span>
                            <span className="block font-semibold group-hover:underline">
                              {z.name}
                            </span>
                            <span className="block text-xs text-muted">{z.code}</span>
                          </span>
                          <Badge tone={ZONE_STATUS_TONE[z.status]} className="ml-1">
                            {ZONE_STATUS_LABEL[z.status]}
                          </Badge>
                        </a>
                      </th>
                      {ZONE_SERVICES.map((s) => {
                        const on = flags(z)[s];
                        const key = `${z.id}:${s}`;
                        return (
                          <td
                            key={s}
                            className={cn('py-3 text-center', busy === key && 'opacity-60')}
                          >
                            <span className="inline-flex">
                              <Switch
                                checked={on}
                                disabled={busy !== null}
                                label={`${ZONE_SERVICE_LABELS[s]} in ${z.name}`}
                                onChange={(next) => {
                                  if (next) void run(z, s, true);
                                  else setConfirm({ zone: { id: z.id, name: z.name }, service: s });
                                }}
                              />
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {zones.hasNextPage ? (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={zones.isFetchingNextPage}
                    onClick={() => void zones.fetchNextPage()}
                  >
                    {zones.isFetchingNextPage ? 'Loading…' : 'Load more zones'}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card aria-labelledby="controls-title">
          <CardHeader
            id="controls-title"
            title="People and access"
            subtitle="Allocated by the Super Admin only"
          />
          <CardBody>
            <ul className="grid gap-3 sm:grid-cols-2">
              {CONTROLS.map((c) => (
                <li key={c.href}>
                  <a
                    href={c.href}
                    className="flex h-full items-start gap-3 rounded-input border border-line p-3 hover:border-orange-200 hover:bg-primary-soft/40 focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-strong">
                      <c.icon aria-hidden className="size-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{c.title}</span>
                      <span className="block text-xs text-muted">{c.text}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card aria-labelledby="defaults-title">
          <CardHeader
            id="defaults-title"
            title="Platform settings"
            subtitle="Decided defaults. Each becomes editable here, per zone where it applies, when the settings API lands."
            actions={<Badge tone="brand">Soon</Badge>}
          />
          <CardBody>
            <dl className="divide-y divide-line text-sm">
              {DEFAULTS.map((d) => (
                <div
                  key={d.title}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2.5"
                >
                  <dt className="text-muted">
                    {d.title} <span className="text-xs">({d.ref})</span>
                  </dt>
                  <dd className="font-medium">{d.value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>

      <ServiceSwitchConfirm
        pending={
          confirm
            ? { zoneName: confirm.zone.name, label: ZONE_SERVICE_LABELS[confirm.service] }
            : null
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c) void run(c.zone, c.service, false);
        }}
      />
      {dialog}
    </div>
  );
}
