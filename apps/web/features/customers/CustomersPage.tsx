'use client';

import { CUSTOMER_SOURCES } from '@zoauro/shared';
import { Plus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DataTable, RowActivator, type Column } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { useUrlState } from '../../lib/url-state';
import { cn } from '../../lib/utils';
import { selectedZone, type ScopeZone } from '../../lib/zone-scope';
import { formatPaise } from '../audit/format';
import { CardError, EmptyState } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { useZoneOptions } from '../platform-settings/api';
import { useCustomerList, type CustomerListFilters } from './api';
import { CustomerFormDialog } from './CustomerDialogs';
import type { CustomerPageProps } from './customer-page-props';
import {
  CUSTOMER_SORTS,
  CUSTOMER_STATUS_LABEL,
  CUSTOMER_STATUS_TONE,
  CUSTOMER_TABS,
  customerSortFromParam,
  customersPath,
  customerTabFromParam,
  SOURCE_LABEL,
  sourceFromParam,
  sourceLabel,
} from './labels';

// Customers (M09, doc 20; B1 confirmed 2026-10-20): tabs with counts, search (name, phone or email), source filter,
// sort and 25 rows a page, all in the URL; the zone switcher's ?zone narrows to one zone. Customers are shared across
// zones (D14, D158): the Zones column lists where each has an address or an order within the member's scope, and the
// order figures count only those zones (D25). Contacts are masked (D26).

type Row = NonNullable<ReturnType<typeof useCustomerList>['data']>['data'][number];

export function CustomersPage({ role, myZones, addZones, can }: CustomerPageProps) {
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

  const tab = customerTabFromParam(url.params.get('tab'));
  const tabDef = CUSTOMER_TABS.find((t) => t.id === tab) ?? CUSTOMER_TABS[0];
  const q = url.params.get('q') ?? '';
  const source = sourceFromParam(url.params.get('source'));
  const sort = customerSortFromParam(url.params.get('sort'));
  const page = pageFromParam(url.params.get('page'));
  const [search, setSearch] = useState(q);
  const [creating, setCreating] = useState(url.params.get('new') === '1');
  const base = customersPath(role);

  const filters: CustomerListFilters = {
    page,
    sort,
    ...(q ? { q } : {}),
    ...(zone ? { zoneId: zone.id } : {}),
    ...(tabDef.status ? { status: tabDef.status } : {}),
    ...(source ? { source } : {}),
  };
  const list = useCustomerList(filters, !waitingForZone);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  const showZones = role === 'SUPER_ADMIN' ? !zone : zones.length > 1 && !zone;
  const counts = list.data?.meta.counts;
  const filtered = Boolean(q || tab !== 'all' || source);

  const columns: Column<Row>[] = [
    {
      id: 'name',
      header: 'Customer',
      cell: (r, ctx) => (
        <div className="min-w-44">
          <RowActivator ctx={ctx} className="font-semibold">
            {r.name}
          </RowActivator>
          <p className="text-xs text-muted">{sourceLabel(r.source)}</p>
        </div>
      ),
    },
    {
      id: 'contact',
      header: 'Contact',
      cell: (r) => (
        <div className="text-sm tabular-nums">
          <p>{r.phone}</p>
          {r.email ? <p className="text-xs text-muted">{r.email}</p> : null}
        </div>
      ),
    },
    ...(showZones
      ? [
          {
            id: 'zones',
            header: 'Zones',
            cell: (r: Row) =>
              r.zones.length ? (
                <div className="flex flex-wrap gap-1">
                  {r.zones.map((z) => (
                    <Badge key={z.id} tone="neutral">
                      {z.code}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-muted">—</span>
              ),
          },
        ]
      : []),
    {
      id: 'orders',
      header: 'Orders',
      cell: (r) => (
        <div className="text-sm">
          <p className="tabular-nums">
            {r.orderCount} · {formatPaise(r.totalSpentPaise)}
          </p>
          <p className="text-xs text-muted">
            {r.lastOrderAt ? `Last ${relativeTime(r.lastOrderAt)}` : 'No orders yet'}
          </p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <Badge tone={CUSTOMER_STATUS_TONE[r.status]} dot>
          {CUSTOMER_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    {
      id: 'joined',
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
        title="Customers"
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Customers' },
        ]}
        description={
          zone
            ? `Customers with an address or an order in ${zone.name}.`
            : role === 'SUPER_ADMIN'
              ? 'Every customer. Customers are shared across zones.'
              : 'Customers with an address or an order in your zones; order figures count your zones only.'
        }
        actions={
          can.add ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-4" /> Add customer
            </Button>
          ) : undefined
        }
      />

      <div role="tablist" aria-label="Customers by status" className="flex flex-wrap gap-2">
        {CUSTOMER_TABS.map((t) => {
          const selected = t.id === tab;
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
              <span className="tabular-nums text-xs text-muted">{counts?.[t.count] ?? '—'}</span>
            </button>
          );
        })}
      </div>

      <div role="search" aria-label="Find customers" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-medium">
          Search
          <input
            type="search"
            className={inputClass()}
            placeholder="Name, mobile number or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Source
          <select
            className={inputClass('min-w-40')}
            value={source ?? ''}
            onChange={(e) => url.patch({ source: e.target.value || null, page: null })}
          >
            <option value="">Any source</option>
            {CUSTOMER_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Sort
          <select
            className={inputClass('min-w-40')}
            value={sort}
            onChange={(e) =>
              url.patch({
                sort: e.target.value === '-createdAt' ? null : e.target.value,
                page: null,
              })
            }
          >
            {CUSTOMER_SORTS.map((s) => (
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
              url.patch({ q: null, tab: null, source: null, page: null });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <Card>
        <DataTable
          caption="Customers"
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(r) => r.id}
          onActivate={(r) => router.push(`${base}/${r.id}`)}
          rowHref={(r) => `${base}/${r.id}`}
          activateLabel={(r) => `Open ${r.name}`}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what="Customers" onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<Users aria-hidden className="size-5" />}
              title={filtered ? 'Nothing matches' : 'No customers yet'}
            >
              {filtered
                ? 'Try another search, tab or source.'
                : 'Customers appear here when they sign up in the app or order in your zones.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['customer', 'customers']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>

      <CustomerFormDialog
        open={creating}
        zones={role === 'SUPER_ADMIN' ? zones : addZones}
        onClose={() => {
          setCreating(false);
          if (url.params.get('new')) url.patch({ new: null });
        }}
        onSaved={(id) => router.push(`${base}/${id}`)}
      />
    </div>
  );
}
