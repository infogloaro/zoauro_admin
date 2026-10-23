'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUrlState } from '../../lib/url-state';
import { cn } from '../../lib/utils';
import { selectedZone, ZONE_PARAM, type ScopeZone } from '../../lib/zone-scope';
import { useZoneOptions } from '../platform-settings/api';
import type { AdsPageProps } from './ads-page-props';

// The Advertising section: Dashboard | Requests | Campaigns | Slots, each its own page, the top-bar zone (?zone=CODE)
// carried across. useAdsZone gives every page the same zone answer: the picked zone, whether its code is still being
// resolved (nothing is asked for until it is), and whether rows need the zone chip.

const TABS = [
  { path: '', label: 'Dashboard' },
  { path: '/requests', label: 'Requests' },
  { path: '/campaigns', label: 'Campaigns' },
  { path: '/slots', label: 'Slots' },
] as const;

export const adsBase = (role: AdsPageProps['role']): string =>
  role === 'SUPER_ADMIN' ? '/super-admin/ads' : '/zone/ads';

export function AdsTabs({ role }: { role: AdsPageProps['role'] }) {
  const pathname = usePathname();
  const url = useUrlState();
  const zone = url.params.get(ZONE_PARAM);
  const base = adsBase(role);
  return (
    <nav aria-label="Advertising" className="flex flex-wrap gap-2 border-b border-line">
      {TABS.map((t) => {
        const href = `${base}${t.path}`;
        const current = pathname === href;
        return (
          <Link
            key={t.path}
            href={zone ? `${href}?${ZONE_PARAM}=${encodeURIComponent(zone)}` : href}
            prefetch={false}
            aria-current={current ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary',
              current
                ? 'border-primary text-primary-strong'
                : 'border-transparent text-muted hover:text-text',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function useAdsZone({ role, myZones }: Pick<AdsPageProps, 'role' | 'myZones'>) {
  const url = useUrlState();
  const superAdmin = role === 'SUPER_ADMIN';
  const code = url.params.get(ZONE_PARAM);
  const all = useZoneOptions(superAdmin && code !== null);
  const zones: ScopeZone[] = superAdmin
    ? (all.data?.data ?? []).map((z) => ({
        id: z.id,
        name: z.name,
        code: z.code,
        colorHex: z.colorHex,
      }))
    : myZones;
  const zone = selectedZone(code, zones);
  return {
    zone,
    /** a picked zone's code is still being resolved: ask for nothing yet */
    waiting: superAdmin && code !== null && all.isPending,
    /** rows carry the zone chip: more than one zone in view */
    showZone: !zone && (superAdmin || myZones.length > 1),
  };
}
