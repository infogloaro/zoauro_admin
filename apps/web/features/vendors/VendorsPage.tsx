'use client';

import type { VendorModule } from '@zoauro/shared';
import { Plus, Store } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { useUrlState } from '../../lib/url-state';
import { cn } from '../../lib/utils';
import { selectedZone, type ScopeZone } from '../../lib/zone-scope';
import { CardError, EmptyState } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { useZoneOptions } from '../platform-settings/api';
import { useVendorList, type VendorListFilters } from './api';
import {
  SORTS,
  VENDOR_META,
  VENDOR_STATUS_LABEL,
  VENDOR_STATUS_TONE,
  VENDOR_TABS,
  VERIFICATION_LABEL,
  VERIFICATION_TONE,
  sortFromParam,
  tabFromParam,
} from './labels';
import { VendorFormDialog } from './VendorFormDialog';

// Restaurants (M06) and Home Food (M07) lists for both roles (doc 20, ported from Chittra Priya's vendors screen, D117):
// tabs with counts from the API, search, sort, 25 rows a page, all in the URL; the zone switcher's ?zone narrows to one
// zone; the Zone column shows when more than one zone is in scope. No invented KPIs: every number comes from the API.

type Row = NonNullable<ReturnType<typeof useVendorList>['data']>['data'][number];

export function VendorsPage({
  module,
  role,
  myZones = [],
  canAdd,
}: {
  module: VendorModule;
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  /** a Zonal Admin's zones from /me (a Super Admin's come from the zone list) */
  myZones?: ScopeZone[];
  /** Super Admin, or a Zonal Admin with {module}:add in at least one zone */
  canAdd: boolean;
}) {
  const meta = VENDOR_META[module];
  const router = useRouter();
  const url = useUrlState();
  const allZones = useZoneOptions(role === 'SUPER_ADMIN');
  const zones: ScopeZone[] =
    role === 'SUPER_ADMIN'
      ? (allZones.data?.data ?? []).map((z) => ({
          id: z.id,
          name: z.name,
          code: z.code,
          colorHex: z.colorHex,
        }))
      : myZones;
  const zoneCode = url.params.get('zone');
  const zone = selectedZone(zoneCode, zones);
  const waitingForZone = role === 'SUPER_ADMIN' && zoneCode !== null && !allZones.data;

  const tab = tabFromParam(url.params.get('tab'));
  const tabDef = VENDOR_TABS.find((t) => t.id === tab) ?? VENDOR_TABS[0];
  const q = url.params.get('q') ?? '';
  const sort = sortFromParam(url.params.get('sort'));
  const page = pageFromParam(url.params.get('page'));
  const [search, setSearch] = useState(q);
  const [creating, setCreating] = useState(url.params.get('new') === '1');

  const filters: VendorListFilters = {
    page,
    sort,
    ...(q ? { q } : {}),
    ...(zone ? { zoneId: zone.id } : {}),
    ...tabDef.filter,
  };
  const list = useVendorList(module, filters, !waitingForZone);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  const base = role === 'SUPER_ADMIN' ? meta.superAdminPath : meta.zonalPath;
  const showZone = role === 'SUPER_ADMIN' ? !zone : zones.length > 1 && !zone;
  const counts = list.data?.meta.counts;
  const filtered = Boolean(q || tab !== 'all');

  const columns: Column<Row>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (r, ctx) => (
        <div className="min-w-48">
          <button
            type="button"
            {...ctx.activatorProps}
            className={cn(ctx.activatorProps.className, 'font-semibold')}
          >
            {r.name}
          </button>
          <p className="text-xs text-muted">
            {'ownerName' in r && r.ownerName ? `${r.ownerName} · ` : ''}
            {'kind' in r && r.kind === 'SHOP' ? 'Shop · ' : ''}
            {r.source === 'APP' ? 'Joined from the app' : 'Added by an admin'}
          </p>
        </div>
      ),
    },
    ...(showZone
      ? [
          {
            id: 'zone',
            header: 'Zone',
            cell: (r: Row) =>
              r.zone ? (
                <Badge tone="neutral">{r.zone.code}</Badge>
              ) : (
                <Badge tone="warning">No zone yet</Badge>
              ),
          },
        ]
      : []),
    { id: 'area', header: 'Area', cell: (r) => r.area ?? '—' },
    {
      id: 'tags',
      header: module === 'restaurants' ? 'Cuisines' : 'Specialities',
      cell: (r) => {
        const tags = 'cuisineTags' in r ? r.cuisineTags : r.specialityTags;
        return tags.length ? tags.join(', ') : '—';
      },
    },
    {
      id: 'phone',
      header: 'Phone',
      cell: (r) => <span className="tabular-nums">{r.phone ?? '—'}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={VENDOR_STATUS_TONE[r.status]} dot>
            {VENDOR_STATUS_LABEL[r.status]}
          </Badge>
          <Badge tone={VERIFICATION_TONE[r.verificationStatus]}>
            {VERIFICATION_LABEL[r.verificationStatus]}
          </Badge>
        </div>
      ),
    },
    {
      id: 'created',
      header: 'Added',
      cell: (r) => (
        <time dateTime={r.createdAt} className="text-xs text-muted">
          {relativeTime(r.createdAt)}
        </time>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={meta.title}
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Service Management' },
          { label: meta.title },
        ]}
        description={
          zone
            ? `${meta.title} in ${zone.name}.`
            : role === 'SUPER_ADMIN'
              ? `Every ${meta.noun} in every zone.`
              : `${meta.title} in your zones.`
        }
        actions={
          canAdd ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-4" /> Add {meta.noun}
            </Button>
          ) : undefined
        }
      />

      <div role="tablist" aria-label={`${meta.title} by status`} className="flex flex-wrap gap-2">
        {VENDOR_TABS.map((t) => {
          const selected = t.id === tab;
          const n = counts?.[t.count];
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => url.patch({ tab: t.id === 'all' ? null : t.id, page: null })}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-primary',
                selected
                  ? 'border-primary bg-primary-soft font-semibold text-primary-strong'
                  : 'border-line bg-surface hover:bg-surface-muted',
              )}
            >
              {t.label}
              <span className="tabular-nums text-xs text-muted">{n ?? '—'}</span>
            </button>
          );
        })}
      </div>

      <div
        role="search"
        aria-label={`Find ${meta.plural}`}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-medium">
          Search
          <input
            type="search"
            className={inputClass()}
            placeholder="Name, phone or area"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Sort
          <select
            className={inputClass('min-w-44')}
            value={sort}
            onChange={(e) =>
              url.patch({
                sort: e.target.value === '-createdAt' ? null : e.target.value,
                page: null,
              })
            }
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              url.patch({ q: null, tab: null, page: null });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <Card>
        <DataTable
          caption={meta.title}
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(r) => r.id}
          onActivate={(r) => router.push(`${base}/${r.id}`)}
          activateLabel={(r) => `Open ${r.name}`}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what={meta.title} onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<Store aria-hidden className="size-5" />}
              title={filtered ? 'Nothing matches' : `No ${meta.plural} yet`}
            >
              {filtered
                ? 'Try another search or tab.'
                : canAdd
                  ? `Add the first ${meta.noun}, or wait for sign-ups from the vendor app.`
                  : `${meta.title} appear here when they join your zones.`}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={[meta.noun, meta.plural]}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>

      <VendorFormDialog
        module={module}
        role={role}
        open={creating}
        zones={zones}
        onClose={() => {
          setCreating(false);
          if (url.params.get('new')) url.patch({ new: null });
        }}
        onSaved={(id) => router.push(`${base}/${id}`)}
      />
    </div>
  );
}
