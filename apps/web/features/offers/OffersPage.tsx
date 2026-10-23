'use client';

import {
  OFFER_FUNDING,
  OFFER_SCOPES,
  OFFER_TYPES,
  type Offer,
  type OfferFunding,
  type OfferScope,
  type OfferType,
} from '@zoauro/shared';
import { BadgePercent, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DataTable, RowActivator, type Column } from '../../components/shared/DataTable';
import { ExportButton } from '../../components/shared/ExportButton';
import { PageHeader } from '../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { useApiClient } from '../../lib/api-client';
import { useUrlState } from '../../lib/url-state';
import { cn } from '../../lib/utils';
import { zoneIdFromParam } from '../../lib/zone-scope';
import { CardError, EmptyState } from '../dashboard/parts';
import { offerListQuery, useOfferList, type OfferFilters } from './api';
import {
  FUNDING_LABEL,
  OFFER_STATUS_LABEL,
  OFFER_STATUS_TONE,
  OFFER_TABS,
  SCOPE_LABEL,
  TYPE_LABEL,
  dayTime,
  fundingText,
  offerTabFromParam,
  offersPath,
  usesText,
  valueText,
} from './labels';
import { OfferFormDialog } from './OfferDialogs';
import type { OfferPageProps } from './offer-page-props';

// Offers & Coupons (D182, doc 60 §10.6). Super Admin: every offer, by status, and every-zone offers of their own. A
// Zonal Admin with offers:view: the offers of their zones and every-zone offers; with offers:add, new zone or vendor
// offers that a Super Admin approves. Tabs (with counts), search, scope, type, funding and sort are in the URL; a Zonal
// Admin's zone switcher (?zone=) narrows the list.

const SORTS = [
  { id: '-createdAt', label: 'Newest first' },
  { id: 'validFrom', label: 'Starting soonest' },
  { id: 'validTo', label: 'Ending soonest' },
  { id: '-usedCount', label: 'Most used' },
  { id: 'title', label: 'Title' },
] as const;

export function OffersPage({ role, viewZones, addZones, canExport = false }: OfferPageProps) {
  const client = useApiClient();
  const router = useRouter();
  const url = useUrlState();
  const superAdmin = role === 'SUPER_ADMIN';
  const tab = offerTabFromParam(url.params.get('status'));
  const q = url.params.get('q') ?? '';
  const scope = OFFER_SCOPES.find((s) => s === url.params.get('scope'));
  const type = OFFER_TYPES.find((t) => t === url.params.get('type'));
  const fundedBy = OFFER_FUNDING.find((f) => f === url.params.get('funding'));
  const sort = SORTS.find((s) => s.id === url.params.get('sort'))?.id ?? '-createdAt';
  const page = pageFromParam(url.params.get('page'));
  const zoneId = superAdmin ? null : zoneIdFromParam(url.params.get('zone'), viewZones);
  const [search, setSearch] = useState(q);
  const [creating, setCreating] = useState(false);
  const base = offersPath(role);
  const canCreate = superAdmin || addZones.length > 0;

  const filters: OfferFilters = {
    page,
    sort,
    ...(q ? { q } : {}),
    ...(tab !== 'all' ? { status: tab } : {}),
    ...(scope ? { scope } : {}),
    ...(type ? { type } : {}),
    ...(fundedBy ? { fundedBy } : {}),
    ...(zoneId ? { zoneIds: [zoneId] } : {}),
  };
  const list = useOfferList(filters);
  const counts = list.data?.meta.counts;

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  const filtered = Boolean(q || scope || type || fundedBy);
  const showZones = superAdmin || viewZones.length > 1;

  const columns: Column<Offer>[] = [
    {
      id: 'offer',
      header: 'Offer',
      cell: (o, ctx) => (
        <div className="min-w-48">
          <RowActivator ctx={ctx} className="font-semibold">
            {o.title}
          </RowActivator>
          <p className="text-xs text-muted">
            {o.code ? <span className="font-mono">{o.code}</span> : 'Applied automatically'}
          </p>
        </div>
      ),
    },
    {
      id: 'value',
      header: 'Discount',
      cell: (o) => (
        <div className="text-sm">
          <p className="font-semibold">{valueText(o)}</p>
          {o.minOrderPaise > 0 ? (
            <p className="text-xs text-muted">
              Orders from ₹{(o.minOrderPaise / 100).toLocaleString('en-IN')}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'where',
      header: 'Where',
      cell: (o) =>
        o.scope === 'PLATFORM' ? (
          <span className="text-sm text-muted">Every zone</span>
        ) : (
          <div className="flex flex-col gap-1">
            {o.vendor ? <span className="text-sm">{o.vendor.name}</span> : null}
            {showZones || o.zones.length > 1 ? (
              <span className="flex flex-wrap gap-1">
                {o.zones.map((z) => (
                  <Badge key={z.id} tone="neutral">
                    {z.code}
                  </Badge>
                ))}
              </span>
            ) : null}
          </div>
        ),
    },
    {
      id: 'paid',
      header: 'Paid by',
      cell: (o) => <span className="text-sm">{fundingText(o)}</span>,
    },
    {
      id: 'when',
      header: 'Runs',
      cell: (o) => (
        <div className="text-xs text-muted">
          <p>From {dayTime(o.validFrom)}</p>
          <p>To {dayTime(o.validTo)}</p>
        </div>
      ),
    },
    {
      id: 'uses',
      header: 'Used',
      cell: (o) => <span className="text-sm tabular-nums">{usesText(o)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (o) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={OFFER_STATUS_TONE[o.status]} dot>
            {OFFER_STATUS_LABEL[o.status]}
          </Badge>
          {o.approvalOverdue ? <Badge tone="danger">Waiting over a day</Badge> : null}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Offers & Coupons"
        crumbs={[
          { label: 'Dashboard', href: superAdmin ? '/super-admin/dashboard' : '/zone/dashboard' },
          { label: 'Offers & Coupons' },
        ]}
        description={
          superAdmin
            ? 'Discounts for every zone, a zone or one vendor, with or without a code. Offers from Zonal Admins wait for your approval.'
            : 'The offers of your zones and the ones that run everywhere. Offers you create are approved by a Super Admin.'
        }
        actions={
          canCreate || canExport ? (
            <div className="flex flex-wrap items-start gap-2">
              {canExport ? (
                <ExportButton
                  start={() => client.get('/offers/export', { query: offerListQuery(filters) })}
                />
              ) : null}
              {canCreate ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus aria-hidden className="size-4" /> New offer
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />

      <div role="tablist" aria-label="Offers by status" className="flex flex-wrap gap-2">
        {OFFER_TABS.map((t) => {
          const n =
            t.id === 'all'
              ? counts
                ? Object.values(counts).reduce((a, b) => a + b, 0)
                : undefined
              : counts?.[t.id];
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              onClick={() => url.patch({ status: t.id === 'all' ? null : t.id, page: null })}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-primary',
                t.id === tab
                  ? 'border-primary bg-primary-soft font-semibold text-primary-strong'
                  : 'border-line bg-surface hover:bg-surface-muted',
              )}
            >
              {t.label}
              {n !== undefined ? <span className="ml-1.5 tabular-nums text-muted">{n}</span> : null}
            </button>
          );
        })}
      </div>

      <div role="search" aria-label="Find offers" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-sm font-medium">
          Search
          <input
            type="search"
            className={inputClass()}
            placeholder="Title or code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <Select
          label="Where"
          value={scope}
          options={OFFER_SCOPES.map((s) => [s, SCOPE_LABEL[s]] as const)}
          any="Anywhere"
          onChange={(v) => url.patch({ scope: v, page: null })}
        />
        <Select
          label="Kind"
          value={type}
          options={OFFER_TYPES.map((t) => [t, TYPE_LABEL[t]] as const)}
          any="Any kind"
          onChange={(v) => url.patch({ type: v, page: null })}
        />
        <Select
          label="Paid by"
          value={fundedBy}
          options={OFFER_FUNDING.map((f) => [f, FUNDING_LABEL[f]] as const)}
          any="Anyone"
          onChange={(v) => url.patch({ funding: v, page: null })}
        />
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
              <option key={s.id} value={s.id}>
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
              url.patch({ q: null, scope: null, type: null, funding: null, page: null });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <Card>
        <DataTable
          caption="Offers"
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(o) => o.id}
          onActivate={(o) => router.push(`${base}/${o.id}`)}
          rowHref={(o) => `${base}/${o.id}`}
          activateLabel={(o) => `Open the offer ${o.title}`}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what="Offers" onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<BadgePercent aria-hidden className="size-5" />}
              title={filtered || tab !== 'all' ? 'Nothing matches' : 'No offers yet'}
              action={
                canCreate && !filtered && tab === 'all' ? (
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <Plus aria-hidden className="size-4" /> Create the first offer
                  </Button>
                ) : undefined
              }
            >
              {filtered || tab !== 'all'
                ? 'Try other filters.'
                : 'Offers start as drafts. Send one for approval when it is ready.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['offer', 'offers']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>

      {creating ? (
        <OfferFormDialog
          role={role}
          addZones={addZones}
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`${base}/${id}`)}
        />
      ) : null}
    </div>
  );
}

function Select<T extends OfferScope | OfferType | OfferFunding>({
  label,
  value,
  options,
  any,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: readonly (readonly [T, string])[];
  any: string;
  onChange: (v: string | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <select
        className={inputClass('min-w-40')}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{any}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
