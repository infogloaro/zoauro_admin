'use client';

import { PLAN_VENDOR_TYPES, type VendorPlan } from '@zoauro/shared';
import { Package, Plus } from 'lucide-react';
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
import { CardError, EmptyState } from '../dashboard/parts';
import { usePlanList, type PlanFilters } from './api';
import {
  PLAN_STATUS_LABEL,
  PLAN_STATUS_TONE,
  PLAN_TABS,
  VENDOR_TYPE_LABEL,
  featureText,
  planTabFromParam,
  plansPath,
  priceText,
} from './labels';
import { PlanFormDialog } from './PlanDialogs';
import type { PlanPageProps } from './plan-page-props';

// Vendor plans (D188, doc 60 §10.4): the plans ZOAURO sells to restaurants, Home Food kitchens and hotels. A Super
// Admin sees every plan by status and creates new ones (as drafts); a Zonal Admin with plans:view sees the active
// plans and how many vendors of their zones are on each. Search, vendor type and sort are in the URL.

const SORTS = [
  { id: 'sortOrder', label: 'Catalogue order' },
  { id: 'name', label: 'Name' },
  { id: 'pricePaise', label: 'Price, low to high' },
  { id: '-pricePaise', label: 'Price, high to low' },
  { id: '-createdAt', label: 'Newest first' },
] as const;

export function PlansPage({ role }: PlanPageProps) {
  const router = useRouter();
  const url = useUrlState();
  const superAdmin = role === 'SUPER_ADMIN';
  const tab = superAdmin ? planTabFromParam(url.params.get('status')) : 'all';
  const q = url.params.get('q') ?? '';
  const vendorType = PLAN_VENDOR_TYPES.find((t) => t === url.params.get('type'));
  const sort = SORTS.find((s) => s.id === url.params.get('sort'))?.id ?? 'sortOrder';
  const page = pageFromParam(url.params.get('page'));
  const [search, setSearch] = useState(q);
  const [creating, setCreating] = useState(false);
  const base = plansPath(role);

  const filters: PlanFilters = {
    page,
    sort,
    ...(q ? { q } : {}),
    ...(tab !== 'all' ? { status: tab } : {}),
    ...(vendorType ? { vendorType } : {}),
  };
  const list = usePlanList(filters);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  const filtered = Boolean(q || vendorType);

  const columns: Column<VendorPlan>[] = [
    {
      id: 'plan',
      header: 'Plan',
      cell: (p, ctx) => (
        <div className="min-w-44">
          <RowActivator ctx={ctx} className="font-semibold">
            {p.name}
          </RowActivator>
          <p className="font-mono text-xs text-muted">{p.code}</p>
        </div>
      ),
    },
    {
      id: 'price',
      header: 'Price',
      cell: (p) => (
        <div className="text-sm">
          <p className="font-semibold tabular-nums">{priceText(p.pricePaise, p.cycle)}</p>
          {p.trialDays > 0 ? (
            <p className="text-xs text-muted">{p.trialDays}-day free trial</p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'for',
      header: 'For',
      cell: (p) => (
        <p className="text-sm">{p.vendorTypes.map((t) => VENDOR_TYPE_LABEL[t]).join(', ')}</p>
      ),
    },
    {
      id: 'includes',
      header: 'Includes',
      cell: (p) =>
        p.features.length === 0 ? (
          <span className="text-sm text-muted">Listing only</span>
        ) : (
          <ul className="flex max-w-64 flex-col text-xs text-muted">
            {p.features.map((f) => (
              <li key={f.feature}>{featureText(f)}</li>
            ))}
          </ul>
        ),
    },
    {
      id: 'zones',
      header: 'Zones',
      cell: (p) =>
        p.zones.length === 0 ? (
          <span className="text-sm text-muted">Every zone</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {p.zones.map((z) => (
              <Badge key={z.id} tone="neutral">
                {z.code}
              </Badge>
            ))}
          </span>
        ),
    },
    {
      id: 'vendors',
      header: superAdmin ? 'Vendors on it' : 'Your vendors on it',
      cell: (p) => <span className="font-semibold tabular-nums">{p.subscriberCount}</span>,
    },
    ...(superAdmin
      ? [
          {
            id: 'status',
            header: 'Status',
            cell: (p: VendorPlan) => (
              <Badge tone={PLAN_STATUS_TONE[p.status]} dot>
                {PLAN_STATUS_LABEL[p.status]}
              </Badge>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Vendor plans"
        crumbs={[
          { label: 'Dashboard', href: superAdmin ? '/super-admin/dashboard' : '/zone/dashboard' },
          { label: 'Vendor plans' },
        ]}
        description={
          superAdmin
            ? 'The plans ZOAURO offers restaurants, Home Food kitchens and hotels, and the vendors on each.'
            : 'The plans on offer and how many vendors of your zones are on each. Plans are set by a Super Admin.'
        }
        actions={
          superAdmin ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-4" /> New plan
            </Button>
          ) : undefined
        }
      />

      {superAdmin ? (
        <div role="tablist" aria-label="Plans by status" className="flex flex-wrap gap-2">
          {PLAN_TABS.map((t) => (
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
            </button>
          ))}
        </div>
      ) : null}

      <div role="search" aria-label="Find plans" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-sm font-medium">
          Search
          <input
            type="search"
            className={inputClass()}
            placeholder="Plan name or code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          For
          <select
            className={inputClass('min-w-40')}
            value={vendorType ?? ''}
            onChange={(e) => url.patch({ type: e.target.value || null, page: null })}
          >
            <option value="">Any vendor</option>
            {PLAN_VENDOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {VENDOR_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Sort
          <select
            className={inputClass('min-w-44')}
            value={sort}
            onChange={(e) =>
              url.patch({
                sort: e.target.value === 'sortOrder' ? null : e.target.value,
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
              url.patch({ q: null, type: null, page: null });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <Card>
        <DataTable
          caption="Vendor plans"
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(p) => p.id}
          onActivate={(p) => router.push(`${base}/${p.id}`)}
          rowHref={(p) => `${base}/${p.id}`}
          activateLabel={(p) => `Open the plan ${p.name}`}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what="Vendor plans" onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<Package aria-hidden className="size-5" />}
              title={filtered || tab !== 'all' ? 'Nothing matches' : 'No plans yet'}
              action={
                superAdmin && !filtered && tab === 'all' ? (
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <Plus aria-hidden className="size-4" /> Create the first plan
                  </Button>
                ) : undefined
              }
            >
              {filtered || tab !== 'all'
                ? 'Try other filters.'
                : superAdmin
                  ? 'Plans you create start as drafts and go live when you activate them.'
                  : 'No plan is on offer yet.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['plan', 'plans']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>

      {creating ? (
        <PlanFormDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`${base}/${id}`)}
        />
      ) : null}
    </div>
  );
}
