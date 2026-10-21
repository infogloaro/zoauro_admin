'use client';

import {
  PLAN_VENDOR_TYPES,
  VENDOR_PLAN_SUBSCRIPTION_STATUSES,
  type PlanVendorType,
  type VendorPlanSubscription,
} from '@zoauro/shared';
import { Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DataTable, RowActivator, type Column } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { useUrlState } from '../../lib/url-state';
import { formatPaise } from '../audit/format';
import { CardError, CardSkeleton, DetailError, EmptyState } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { usePlan, usePlanSubscriptions, type SubscriptionFilters } from './api';
import {
  CYCLE_LABEL,
  PLAN_STATUS_LABEL,
  PLAN_STATUS_TONE,
  SUBSCRIPTION_STATUS_LABEL,
  SUBSCRIPTION_STATUS_TONE,
  VENDOR_TYPE_LABEL,
  VENDOR_TYPE_ONE,
  canCancel,
  featureText,
  planActions,
  plansPath,
  priceText,
} from './labels';
import {
  CancelSubscriptionDialog,
  PlanFormDialog,
  PlanStatusDialog,
  SubscribeDialog,
} from './PlanDialogs';
import type { PlanPageProps } from './plan-page-props';

// One vendor plan (D188): price, cycle, trial, who it is for, zones and what it includes; a Super Admin edits it,
// activates or retires it, puts vendors on it and cancels a vendor's plan. The vendors on it (status, type and name in
// the URL) are those of the member's plans:view zones; each opens the vendor's page.

const VENDOR_PAGE: Record<PlanVendorType, string> = {
  RESTAURANT: 'restaurants',
  HOMEMAKER: 'homemakers',
  HOTEL: 'hotels',
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

export function PlanDetailPage({ id, role, myZones }: PlanPageProps & { id: string }) {
  const url = useUrlState();
  const superAdmin = role === 'SUPER_ADMIN';
  const plan = usePlan(id);
  const listPath = plansPath(role);
  const root = superAdmin ? '/super-admin' : '/zone';
  const status = VENDOR_PLAN_SUBSCRIPTION_STATUSES.find((s) => s === url.params.get('status'));
  const vendorType = PLAN_VENDOR_TYPES.find((t) => t === url.params.get('type'));
  const q = url.params.get('q') ?? '';
  const page = pageFromParam(url.params.get('page'));
  const [search, setSearch] = useState(q);
  const [dialog, setDialog] = useState<
    | { kind: 'edit' }
    | { kind: 'status'; to: 'ACTIVE' | 'RETIRED' }
    | { kind: 'subscribe' }
    | { kind: 'cancel'; sub: VendorPlanSubscription }
    | null
  >(null);

  const filters: SubscriptionFilters = {
    page,
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(vendorType ? { vendorType } : {}),
  };
  const subs = usePlanSubscriptions(id, filters);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  if (plan.isError)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Vendor plan"
          crumbs={[{ label: 'Vendor plans', href: listPath }, { label: 'Not found' }]}
        />
        <DetailError
          error={plan.error}
          what="Vendor plan"
          backHref={listPath}
          backLabel="Back to Vendor plans"
          onRetry={() => void plan.refetch()}
        />
      </div>
    );
  if (!plan.data) return <CardSkeleton rows={6} />;
  const p = plan.data;
  const can = planActions(p.status, superAdmin);
  const showZone = superAdmin || myZones.length > 1;
  const filtered = Boolean(q || status || vendorType);

  const facts: [string, React.ReactNode][] = [
    [
      'Code',
      <span key="c" className="font-mono">
        {p.code}
      </span>,
    ],
    ['Price', priceText(p.pricePaise, p.cycle)],
    ['Billing cycle', CYCLE_LABEL[p.cycle]],
    ['Free trial', p.trialDays > 0 ? `${p.trialDays} days` : 'None'],
    ['For', p.vendorTypes.map((t) => VENDOR_TYPE_LABEL[t]).join(', ')],
    [
      'Zones',
      p.zones.length === 0 ? 'Every zone' : p.zones.map((z) => `${z.name} (${z.code})`).join(', '),
    ],
    ['Changed', relativeTime(p.updatedAt)],
  ];

  const columns: Column<VendorPlanSubscription>[] = [
    {
      id: 'vendor',
      header: 'Vendor',
      cell: (s, ctx) => (
        <div className="min-w-44">
          <RowActivator ctx={ctx} className="font-semibold">
            {s.vendor.name}
          </RowActivator>
          <p className="text-xs text-muted">{VENDOR_TYPE_ONE[s.vendor.type]}</p>
        </div>
      ),
    },
    ...(showZone
      ? [
          {
            id: 'zone',
            header: 'Zone',
            cell: (s: VendorPlanSubscription) => <Badge tone="neutral">{s.zone.code}</Badge>,
          },
        ]
      : []),
    {
      id: 'status',
      header: 'Status',
      cell: (s) => (
        <Badge tone={SUBSCRIPTION_STATUS_TONE[s.status]} dot>
          {SUBSCRIPTION_STATUS_LABEL[s.status]}
        </Badge>
      ),
    },
    {
      id: 'price',
      header: 'Price when joined',
      cell: (s) => <span className="tabular-nums">{formatPaise(s.pricePaise)}</span>,
    },
    {
      id: 'period',
      header: 'Period',
      cell: (s) => (
        <span className="text-xs text-muted">
          {day(s.startedAt)}
          {s.endsAt ? ` to ${day(s.endsAt)}` : ''}
        </span>
      ),
    },
    ...(superAdmin
      ? [
          {
            id: 'actions',
            header: '',
            cell: (s: VendorPlanSubscription) =>
              canCancel(s.status, superAdmin) ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setDialog({ kind: 'cancel', sub: s })}
                  aria-label={`Cancel ${s.vendor.name}'s plan`}
                >
                  Cancel plan
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={p.name}
        crumbs={[
          { label: 'Dashboard', href: `${root}/dashboard` },
          { label: 'Vendor plans', href: listPath },
          { label: p.name },
        ]}
        description={p.description ?? `${priceText(p.pricePaise, p.cycle)} · ${p.code}`}
        actions={
          <>
            {can.edit ? (
              <Button variant="secondary" onClick={() => setDialog({ kind: 'edit' })}>
                Edit plan
              </Button>
            ) : null}
            {can.activate ? (
              <Button onClick={() => setDialog({ kind: 'status', to: 'ACTIVE' })}>Activate</Button>
            ) : null}
            {can.retire ? (
              <Button
                variant="secondary"
                onClick={() => setDialog({ kind: 'status', to: 'RETIRED' })}
              >
                Retire
              </Button>
            ) : null}
            {can.subscribe ? (
              <Button onClick={() => setDialog({ kind: 'subscribe' })}>Put a vendor on it</Button>
            ) : null}
          </>
        }
      />
      {superAdmin ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={PLAN_STATUS_TONE[p.status]} dot>
            {PLAN_STATUS_LABEL[p.status]}
          </Badge>
          {p.status === 'DRAFT' ? (
            <span className="text-sm text-muted">Activate it to put vendors on it.</span>
          ) : null}
          {p.status === 'RETIRED' ? (
            <span className="text-sm text-muted">No vendor can join; those on it keep it.</span>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card aria-labelledby="plan-details" className="lg:col-span-2">
          <CardHeader id="plan-details" title="Details" />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="text-sm">{v}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
        <Card aria-labelledby="plan-includes">
          <CardHeader
            id="plan-includes"
            title="Included"
            subtitle={`${p.subscriberCount} on it now`}
          />
          <CardBody>
            {p.features.length === 0 ? (
              <p className="text-sm text-muted">The listing only, no extras.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {p.features.map((f) => (
                  <li key={f.feature}>{featureText(f)}</li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <section aria-labelledby="plan-vendors" className="flex flex-col gap-4">
        <h2 id="plan-vendors" className="text-lg font-semibold">
          Vendors on this plan
        </h2>
        <div
          role="search"
          aria-label="Find vendors on this plan"
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-sm font-medium">
            Search
            <input
              type="search"
              className={inputClass()}
              placeholder="Vendor name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Status
            <select
              className={inputClass('min-w-36')}
              value={status ?? ''}
              onChange={(e) => url.patch({ status: e.target.value || null, page: null })}
            >
              <option value="">Any</option>
              {VENDOR_PLAN_SUBSCRIPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SUBSCRIPTION_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Type
            <select
              className={inputClass('min-w-36')}
              value={vendorType ?? ''}
              onChange={(e) => url.patch({ type: e.target.value || null, page: null })}
            >
              <option value="">Any</option>
              {p.vendorTypes.map((t) => (
                <option key={t} value={t}>
                  {VENDOR_TYPE_ONE[t]}
                </option>
              ))}
            </select>
          </label>
          {filtered ? (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch('');
                url.patch({ q: null, status: null, type: null, page: null });
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
        <Card>
          <DataTable
            caption="Vendors on this plan"
            columns={columns}
            rows={subs.data?.data ?? []}
            getRowId={(s) => s.id}
            rowHref={(s) => `${root}/${VENDOR_PAGE[s.vendor.type]}/${s.vendor.id}`}
            activateLabel={(s) => `Open ${s.vendor.name}`}
            status={subs.isError ? 'error' : subs.data ? 'ready' : 'loading'}
            busy={subs.isFetching && subs.isPlaceholderData}
            error={
              <CardError what="The vendors on this plan" onRetry={() => void subs.refetch()} />
            }
            empty={
              <EmptyState
                icon={<Store aria-hidden className="size-5" />}
                title={filtered ? 'Nothing matches' : 'No vendor on this plan yet'}
              >
                {filtered
                  ? 'Try other filters.'
                  : can.subscribe
                    ? 'Put a vendor on it with the button above.'
                    : superAdmin
                      ? 'Vendors can be put on it once it is active.'
                      : 'Vendors of your zones on this plan appear here.'}
              </EmptyState>
            }
          />
          {subs.data && subs.data.meta.total > 0 ? (
            <Pagination
              page={page}
              total={subs.data.meta.total}
              noun={['vendor', 'vendors']}
              onPage={(n) => url.patch({ page: n > 1 ? String(n) : null })}
            />
          ) : null}
        </Card>
      </section>

      {dialog?.kind === 'edit' ? <PlanFormDialog plan={p} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'status' ? (
        <PlanStatusDialog plan={p} to={dialog.to} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'subscribe' ? (
        <SubscribeDialog plan={p} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'cancel' ? (
        <CancelSubscriptionDialog sub={dialog.sub} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
