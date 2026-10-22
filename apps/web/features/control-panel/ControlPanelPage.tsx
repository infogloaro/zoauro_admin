'use client';

import {
  type ControlAreas,
  ZONE_SERVICES,
  ZONE_SERVICE_DEFAULTS,
  ZONE_SERVICE_LABELS,
  type ZoneServiceKind,
} from '@zoauro/shared';
import {
  BedDouble,
  ChefHat,
  History,
  KeyRound,
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
import { areaAllows } from '../../lib/navigation';
import { cn } from '../../lib/utils';
import { CardError, CardSkeleton, EmptyState } from '../dashboard/parts';
import { usePlatformSettings } from '../platform-settings/api';
import { effectBadge } from '../platform-settings/PlatformSettingsPage';
import { useZoneList } from '../zones/api';
import { ZONE_STATUS_LABEL, ZONE_STATUS_TONE } from '../zones/format';
import { ServiceSwitchConfirm } from './ServiceSwitchConfirm';
import { useSwitchService } from './useZoneServices';

// Super Admin Control Panel (owner's D92: "all settings and control under the Super Admin"): which services run in
// each zone (switch per zone × service, PASSWORD re-auth, confirmation before switching off), and one place to reach
// every control the Super Admin allocates: Zonal Admin accounts, access profiles, zone teams, access history, zones and
// security. The Platform settings card lists every setting with whether it was changed and whether it is enforced yet;
// they are edited on /super-admin/settings/platform (doc 59). D178: a non-primary Super Admin sees only the controls of
// the areas granted (the menu's check); the service switches are zone writes and need the zones area.

const SERVICE_ICON: Record<ZoneServiceKind, LucideIcon> = {
  RESTAURANTS: Store,
  HOME_FOOD: ChefHat,
  HOTEL_BOOKING: BedDouble,
};

/** `area`: the D178 Control Panel area the control needs; none = every Super Admin (as in the menu). */
const CONTROLS: { href: string; title: string; text: string; icon: LucideIcon; area?: string }[] = [
  {
    href: '/super-admin/super-admins',
    title: 'Super Admins',
    text: 'Accounts, primaries, Control Panel areas, 2-step reset',
    icon: KeyRound,
  },
  {
    href: '/super-admin/zonal-admins',
    title: 'Zonal Admins',
    text: 'Accounts, status, passwords, 2-step, sessions',
    icon: UserCog,
    area: 'access',
  },
  {
    href: '/super-admin/access/profiles',
    title: 'Access profiles',
    text: 'Permission templates and default refund limits',
    icon: ShieldCheck,
    area: 'access',
  },
  {
    href: '/super-admin/access/teams',
    title: 'Zone teams',
    text: 'Who runs each zone, with which profile',
    icon: UsersRound,
    area: 'access',
  },
  {
    href: '/super-admin/access/history',
    title: 'Access history',
    text: 'Every access change, before and after',
    icon: History,
    area: 'access',
  },
  {
    href: '/super-admin/zones',
    title: 'Zones',
    text: 'Pincodes, delivery charge, activate or pause',
    icon: Map,
    area: 'zones',
  },
  {
    href: '/super-admin/settings/security',
    title: 'Security',
    text: '2-step policy, codes, SMS provider',
    icon: Lock,
    area: 'settings.security',
  },
];

export function ControlPanelPage({ areas }: { areas?: ControlAreas | null }) {
  const can = (area?: string) => areaAllows(area, areas);
  const controls = CONTROLS.filter((c) => can(c.area));
  const [q, setQ] = useState('');
  const settings = usePlatformSettings(can('settings'));
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
          subtitle={
            can('zones')
              ? 'Switch a service off to stop new onboarding and new orders for it in that zone. Each change asks for your password and is audited.'
              : 'Which services run in each zone. Switching them needs the Zones area of the Control Panel.'
          }
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
                                disabled={busy !== null || !can('zones')}
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
        {controls.length > 0 ? (
          <Card aria-labelledby="controls-title">
            <CardHeader
              id="controls-title"
              title="People and access"
              subtitle="Allocated by the Super Admin only"
            />
            <CardBody>
              <ul className="grid gap-3 sm:grid-cols-2">
                {controls.map((c) => (
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
        ) : null}

        {can('settings') ? (
          <Card aria-labelledby="defaults-title">
            <CardHeader
              id="defaults-title"
              title="Platform settings"
              subtitle="The default rule applies until you save a value (D109)."
              actions={
                <a
                  href="/super-admin/settings/platform"
                  className="text-sm font-medium text-primary-strong hover:underline"
                >
                  Open
                </a>
              }
            />
            <CardBody>
              {settings.isError ? (
                <CardError what="Settings" onRetry={() => void settings.refetch()} />
              ) : !settings.data ? (
                <CardSkeleton rows={4} />
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {settings.data.data
                    .filter((s) => s.editable)
                    .map((s) => {
                      const effect = effectBadge(s);
                      return (
                        <li
                          key={s.key}
                          className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                        >
                          <span>{s.label}</span>
                          <span className="flex gap-1.5">
                            {s.source !== 'DEFAULT' ? <Badge tone="brand">Changed</Badge> : null}
                            <Badge tone={effect.tone} dot>
                              {effect.label}
                            </Badge>
                          </span>
                        </li>
                      );
                    })}
                </ul>
              )}
            </CardBody>
          </Card>
        ) : null}
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
