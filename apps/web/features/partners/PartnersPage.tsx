'use client';

import { Bike, Plus } from 'lucide-react';
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
import { usePartnerList, type PartnerListFilters } from './api';
import {
  PARTNER_SORTS,
  PARTNER_STATUS_LABEL,
  PARTNER_STATUS_TONE,
  PARTNER_TABS,
  PARTNER_VERIFICATION_LABEL,
  PARTNER_VERIFICATION_TONE,
  loadText,
  partnerSortFromParam,
  partnerTabFromParam,
} from './labels';
import { PartnerFormDialog } from './PartnerFormDialog';

// Delivery Partners list (approved list items 1–3, 12) and the Delivery Partner Requests queue (R12, mode "requests":
// verification PENDING; a Super Admin can also see app sign-ups without a zone). Tabs with counts from the API, search,
// online filter, sort, 25 a page, all in the URL; the zone switcher's ?zone narrows to one zone; masked contacts.

type Row = NonNullable<ReturnType<typeof usePartnerList>['data']>['data'][number];

export function PartnersPage({
  role,
  myZones = [],
  canAdd,
  mode = 'all',
}: {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  myZones?: ScopeZone[];
  canAdd: boolean;
  mode?: 'all' | 'requests';
}) {
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
  const waiting = role === 'SUPER_ADMIN' && zoneCode !== null && !allZones.data;

  const requests = mode === 'requests';
  const tab = requests ? 'pending' : partnerTabFromParam(url.params.get('tab'));
  const tabDef = PARTNER_TABS.find((t) => t.id === tab) ?? PARTNER_TABS[0];
  const unassigned = requests && role === 'SUPER_ADMIN' && url.params.get('unzoned') === '1';
  const q = url.params.get('q') ?? '';
  const online = url.params.get('online');
  const sort = partnerSortFromParam(url.params.get('sort'));
  const page = pageFromParam(url.params.get('page'));
  const [search, setSearch] = useState(q);
  const [creating, setCreating] = useState(url.params.get('new') === '1');

  const filters: PartnerListFilters = {
    page,
    sort,
    ...(q ? { q } : {}),
    ...(zone && !unassigned ? { zoneId: zone.id } : {}),
    ...(unassigned ? { unassigned: true } : tabDef.filter),
    ...(online === 'true' ? { online: true } : online === 'false' ? { online: false } : {}),
  };
  const list = usePartnerList(filters, !waiting);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  const base =
    role === 'SUPER_ADMIN' ? '/super-admin/delivery-partners' : '/zone/delivery-partners';
  const showZone = !zone && (role === 'SUPER_ADMIN' || zones.length > 1);
  const counts = list.data?.meta.counts;
  const filtered = Boolean(q || online || (!requests && tab !== 'all'));
  const title = requests ? 'Delivery Partner Requests' : 'Delivery Partners';

  const columns: Column<Row>[] = [
    {
      id: 'name',
      header: 'Partner',
      cell: (r, ctx) => (
        <div className="min-w-44">
          <button
            type="button"
            {...ctx.activatorProps}
            className={cn(ctx.activatorProps.className, 'font-semibold')}
          >
            {r.name}
          </button>
          <p className="text-xs text-muted">
            {[r.vehicleType, r.vehicleNo].filter(Boolean).join(' · ') || 'No vehicle yet'}
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
      id: 'phone',
      header: 'Phone',
      cell: (r) => <span className="tabular-nums">{r.phone ?? '—'}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={PARTNER_STATUS_TONE[r.status]} dot>
            {PARTNER_STATUS_LABEL[r.status]}
          </Badge>
          <Badge tone={PARTNER_VERIFICATION_TONE[r.verificationStatus]}>
            {PARTNER_VERIFICATION_LABEL[r.verificationStatus]}
          </Badge>
        </div>
      ),
    },
    {
      id: 'duty',
      header: 'Now',
      cell: (r) => (
        <div className="flex flex-col items-start gap-1 text-xs">
          <Badge tone={r.assignable ? 'success' : 'neutral'} dot>
            {r.assignable ? 'On duty' : r.isOnline ? 'Online' : 'Offline'}
          </Badge>
          <span className="tabular-nums text-muted">
            {loadText(r.currentOrders, r.maxConcurrentOrders)}
          </span>
        </div>
      ),
    },
    {
      id: 'created',
      header: 'Joined',
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
        title={title}
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: requests ? 'Requests & Approvals' : 'Delivery' },
          { label: title },
        ]}
        description={
          requests
            ? 'Partners waiting for their documents to be checked. Verify, or reject with what is missing.'
            : zone
              ? `Delivery partners in ${zone.name}.`
              : role === 'SUPER_ADMIN'
                ? 'Every delivery partner in every zone.'
                : 'Delivery partners in your zones.'
        }
        actions={
          canAdd && !requests ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-4" /> Add partner
            </Button>
          ) : undefined
        }
      />

      {requests ? (
        role === 'SUPER_ADMIN' ? (
          <div role="tablist" aria-label="Requests" className="flex flex-wrap gap-2">
            {[
              { id: false, label: 'Waiting for verification' },
              { id: true, label: 'No zone yet (app sign-ups)' },
            ].map((t) => (
              <button
                key={String(t.id)}
                type="button"
                role="tab"
                aria-selected={unassigned === t.id}
                onClick={() => url.patch({ unzoned: t.id ? '1' : null, page: null })}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-primary',
                  unassigned === t.id
                    ? 'border-primary bg-primary-soft font-semibold text-primary-strong'
                    : 'border-line bg-surface hover:bg-surface-muted',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : null
      ) : (
        <div
          role="tablist"
          aria-label="Delivery partners by status"
          className="flex flex-wrap gap-2"
        >
          {PARTNER_TABS.map((t) => {
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
                <span className="text-xs tabular-nums text-muted">{n ?? '—'}</span>
              </button>
            );
          })}
        </div>
      )}

      <div
        role="search"
        aria-label="Find delivery partners"
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-medium">
          Search
          <input
            type="search"
            className={inputClass()}
            placeholder="Name, phone, vehicle number or area"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {!requests ? (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Online
            <select
              className={inputClass('min-w-36')}
              value={online ?? ''}
              onChange={(e) => url.patch({ online: e.target.value || null, page: null })}
            >
              <option value="">Any</option>
              <option value="true">Online</option>
              <option value="false">Offline</option>
            </select>
          </label>
        ) : null}
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
            {PARTNER_SORTS.map((s) => (
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
              url.patch({ q: null, tab: null, online: null, page: null });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <Card>
        <DataTable
          caption={title}
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(r) => r.id}
          onActivate={(r) => router.push(`${base}/${r.id}`)}
          activateLabel={(r) => `Open ${r.name}`}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what={title} onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<Bike aria-hidden className="size-5" />}
              title={
                requests
                  ? 'No requests waiting'
                  : filtered
                    ? 'Nothing matches'
                    : 'No delivery partners yet'
              }
            >
              {requests
                ? 'Partners who sign up in the partner app appear here for verification.'
                : filtered
                  ? 'Try another search or tab.'
                  : 'Add a partner, or wait for sign-ups from the partner app.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['partner', 'partners']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>

      <PartnerFormDialog
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
