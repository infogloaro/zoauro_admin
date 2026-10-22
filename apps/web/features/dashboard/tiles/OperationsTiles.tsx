'use client';

import { DASHBOARD_RANGES, type DashboardRange } from '@zoauro/shared';
import { Bike, ChefHat, ShoppingBag, Store, UserPlus, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { StatCard } from '../../../components/shared/StatCard';
import { Badge } from '../../../components/ui/badge';
import { Card, CardBody, CardHeader } from '../../../components/ui/card';
import { useUrlState } from '../../../lib/url-state';
import { cn } from '../../../lib/utils';
import { ORDER_STATUS_LABEL } from '../../orders/labels';
import { CardError, CardSkeleton } from '../parts';
import { relativeTime } from '../time';
import { barShare, RANGE_LABEL, rangeFromParam, useDashboardTiles } from './api';
import { OrdersChart } from './OrdersChart';

// Operations on both dashboards (M16, 6a08d1d; demo priority 1): a range filter (?range=, default the last 7 days),
// headline counts, orders over time, orders by status, by zone (or by area for a single zone), the top restaurants and
// categories by delivered orders, and new sign-ups. Each tile counts only what the member may view; a tile they cannot
// see anywhere is hidden, never shown as zero, and no tile is labelled while loading (only the API's answer says which
// tiles the member may see: a "Delivery partners" placeholder must not flash for a menu desk). Money tiles wait for
// the ledger (SA-6.7).

/** 0.05 → "5%", 0.025 → "2.5%" (one decimal at most). */
export const pct = (n: number) => `${parseFloat((n * 100).toFixed(1))}%`;

/** One measure per row, a single hue (magnitude), the value as text beside the bar. */
export function BarList({
  rows,
  label,
}: {
  rows: { key: string; label: ReactNode; value: number; hint?: ReactNode }[];
  label: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <ul aria-label={label} className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li
          key={r.key}
          className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm"
        >
          <span className="truncate">{r.label}</span>
          <span aria-hidden className="h-2 overflow-hidden rounded-full bg-surface-muted">
            <span
              className="block h-full rounded-full"
              style={{ width: `${barShare(r.value, max)}%`, backgroundColor: '#2a78d6' }}
            />
          </span>
          <span className="text-right font-semibold tabular-nums">
            {r.value.toLocaleString('en-IN')}
            {r.hint ? <span className="ml-1 text-xs font-normal text-muted">{r.hint}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Tile({
  id,
  title,
  subtitle,
  className,
  state,
  onRetry,
  empty,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  className?: string;
  state: 'loading' | 'error' | 'empty' | 'ready';
  onRetry: () => void;
  empty: string;
  children: ReactNode;
}) {
  if (state === 'loading')
    return (
      <Card className={className}>
        <CardBody>
          <CardSkeleton rows={4} />
        </CardBody>
      </Card>
    );
  return (
    <Card aria-labelledby={id} className={className}>
      <CardHeader id={id} title={title} subtitle={subtitle} />
      <CardBody>
        {state === 'error' ? (
          <CardError what={title} onRetry={onRetry} />
        ) : state === 'empty' ? (
          <p className="text-sm text-muted">{empty}</p>
        ) : (
          children
        )}
      </CardBody>
    </Card>
  );
}

type Q<T> = { data: T | undefined; isError: boolean; refetch: () => unknown };
/** The tile's state: error, loading, hidden (null), empty, or ready. */
function stateOf<T>(
  q: Q<{ data: T[] | null } & object>,
): 'loading' | 'error' | 'hidden' | 'empty' | 'ready' {
  if (q.isError) return 'error';
  if (!q.data) return 'loading';
  if (q.data.data === null) return 'hidden';
  return q.data.data.length === 0 ? 'empty' : 'ready';
}

export function OperationsTiles({
  userRole,
  zoneId = null,
  enabled = true,
}: {
  userRole: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  /** the zone picked in the top bar (null: all the member's zones) */
  zoneId?: string | null;
  /** false while the picked zone's code is being resolved, so no all-zones request goes out first */
  enabled?: boolean;
}) {
  const url = useUrlState();
  const range = rangeFromParam(url.params.get('range'));
  const t = useDashboardTiles(range, zoneId, enabled);
  const base = userRole === 'SUPER_ADMIN' ? '/super-admin' : '/zone';
  const s = t.summary.data;
  const period = RANGE_LABEL[range].toLowerCase();

  const overview = stateOf(t.overview);
  const status = stateOf(t.status);
  const zones = stateOf(t.zones);
  const vendors = stateOf(t.vendors);
  const categories = stateOf(t.categories);
  const reg = t.registrations.data;

  return (
    <section aria-labelledby="operations" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="operations" className="text-lg font-semibold">
          Operations
        </h2>
        <div
          role="radiogroup"
          aria-label="Period"
          className="flex flex-wrap gap-1 rounded-input border border-line bg-surface p-1"
        >
          {DASHBOARD_RANGES.map((r: DashboardRange) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={r === range}
              onClick={() => url.patch({ range: r === '7d' ? null : r })}
              className={cn(
                'rounded-md px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-primary',
                r === range
                  ? 'bg-primary-soft font-semibold text-primary-strong'
                  : 'text-muted hover:bg-surface-muted',
              )}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {t.summary.isError ? (
        <CardError what="The headline figures" onRetry={() => void t.summary.refetch()} />
      ) : !s ? (
        <div
          aria-busy="true"
          aria-label="Headline figures: loading"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-card"
            >
              <span className="size-11 shrink-0 animate-pulse rounded-xl bg-neutral-100" />
              <span className="flex flex-1 flex-col gap-2">
                <span className="h-3 w-24 animate-pulse rounded bg-neutral-100" />
                <span className="h-6 w-16 animate-pulse rounded bg-neutral-200" />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {s.orders ? (
            <StatCard
              label={`Orders, ${period}`}
              value={s.orders.total}
              hint={`${s.orders.delivered.toLocaleString('en-IN')} delivered · ${pct(s.orders.cancellationRate)} cancelled`}
              icon={ShoppingBag}
              href={`${base}/orders`}
            />
          ) : null}
          {s.restaurants ? (
            <StatCard
              label="Restaurants"
              value={s.restaurants.total}
              hint={`${s.restaurants.active} active · ${s.restaurants.pendingVerification} to verify`}
              icon={Store}
              tone="info"
              href={`${base}/restaurants`}
            />
          ) : null}
          {s.homemakers ? (
            <StatCard
              label="Home Food"
              value={s.homemakers.total}
              hint={`${s.homemakers.active} active · ${s.homemakers.pendingVerification} to verify`}
              icon={ChefHat}
              tone="success"
              href={`${base}/homemakers`}
            />
          ) : null}
          {s.deliveryPartners ? (
            <StatCard
              label="Delivery partners"
              value={s.deliveryPartners.total}
              hint={`${s.deliveryPartners.onDuty} on duty · ${s.deliveryPartners.pendingVerification} to verify`}
              icon={Bike}
              tone="warning"
              href={`${base}/delivery-partners`}
            />
          ) : null}
          {s.customers !== null ? (
            <StatCard
              label="Customers"
              value={s.customers}
              hint="All time, in scope"
              icon={Users}
              tone="neutral"
              href={`${base}/customers`}
            />
          ) : null}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        {overview !== 'hidden' ? (
          <Tile
            id="orders-over-time"
            title="Orders over time"
            subtitle={`${RANGE_LABEL[range]} · ${t.overview.data?.bucket === 'hour' ? 'by hour' : 'by day'}`}
            className="xl:col-span-2"
            state={overview === 'empty' ? 'empty' : overview}
            onRetry={() => void t.overview.refetch()}
            empty="No orders in this period."
          >
            <OrdersChart
              data={t.overview.data?.data ?? []}
              bucket={t.overview.data?.bucket ?? 'day'}
            />
          </Tile>
        ) : null}
        {status !== 'hidden' ? (
          <Tile
            id="orders-by-status"
            title="Orders by status"
            subtitle={RANGE_LABEL[range]}
            state={status}
            onRetry={() => void t.status.refetch()}
            empty="No orders in this period."
          >
            <BarList
              label="Orders by status"
              rows={(t.status.data?.data ?? [])
                .filter((r) => r.count > 0)
                .sort((a, b) => b.count - a.count)
                .map((r) => ({
                  key: r.status,
                  label: ORDER_STATUS_LABEL[r.status],
                  value: r.count,
                }))}
            />
          </Tile>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {zones !== 'hidden' ? (
          <Tile
            id="orders-by-zone"
            title={t.zones.data?.by === 'area' ? 'Orders by area' : 'Orders by zone'}
            subtitle={RANGE_LABEL[range]}
            state={zones}
            onRetry={() => void t.zones.refetch()}
            empty="No orders in this period."
          >
            <BarList
              label={t.zones.data?.by === 'area' ? 'Orders by area' : 'Orders by zone'}
              rows={(t.zones.data?.data ?? []).map((r) => ({
                key: r.key,
                label: r.label,
                value: r.orders,
              }))}
            />
          </Tile>
        ) : null}
        {vendors !== 'hidden' ? (
          <Tile
            id="top-vendors"
            title="Top restaurants and kitchens"
            subtitle={`Delivered orders, ${period}`}
            state={vendors}
            onRetry={() => void t.vendors.refetch()}
            empty="No delivered orders in this period."
          >
            <BarList
              label="Top restaurants and kitchens"
              rows={(t.vendors.data?.data ?? []).map((v) => ({
                key: v.id,
                label: (
                  <a
                    href={`${base}/${v.vendorType === 'RESTAURANT' ? 'restaurants' : 'homemakers'}/${v.id}`}
                    className="hover:underline"
                  >
                    {v.name}
                  </a>
                ),
                value: v.deliveredOrders,
                hint: v.zone && userRole === 'SUPER_ADMIN' ? v.zone.code : undefined,
              }))}
            />
          </Tile>
        ) : null}
        {categories !== 'hidden' ? (
          <Tile
            id="top-categories"
            title="Top categories"
            subtitle={`Items in delivered orders, ${period}`}
            state={categories}
            onRetry={() => void t.categories.refetch()}
            empty="No delivered orders in this period."
          >
            <BarList
              label="Top categories"
              rows={(t.categories.data?.data ?? []).map((c) => ({
                key: c.id,
                label: c.name,
                value: c.quantity,
              }))}
            />
          </Tile>
        ) : null}
      </div>

      {reg && (reg.customers || reg.vendors || reg.deliveryPartners) ? (
        <Card aria-labelledby="new-signups">
          <CardHeader id="new-signups" title="New sign-ups" subtitle={RANGE_LABEL[range]} />
          <CardBody className="grid gap-6 md:grid-cols-3">
            {(
              [
                ['Customers', reg.customers, (id: string) => `${base}/customers/${id}`],
                ['Vendors', reg.vendors, null],
                [
                  'Delivery partners',
                  reg.deliveryPartners,
                  (id: string) => `${base}/delivery-partners/${id}`,
                ],
              ] as const
            ).map(([title, group, href]) =>
              group ? (
                <div key={title}>
                  <p className="flex items-baseline justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <UserPlus aria-hidden className="size-4 text-muted" /> {title}
                    </span>
                    <span className="text-2xl font-semibold tabular-nums">{group.count}</span>
                  </p>
                  {group.latest.length === 0 ? (
                    <p className="mt-2 text-xs text-muted">None in this period.</p>
                  ) : (
                    <ul className="mt-2 flex flex-col divide-y divide-line text-sm">
                      {group.latest.map((e) => (
                        <li key={e.id} className="flex items-center justify-between gap-2 py-1.5">
                          {'vendorType' in e ? (
                            <a
                              href={`${base}/${e.vendorType === 'RESTAURANT' ? 'restaurants' : 'homemakers'}/${e.id}`}
                              className="truncate hover:underline"
                            >
                              {e.name}{' '}
                              <Badge tone="neutral">
                                {e.vendorType === 'RESTAURANT' ? 'Restaurant' : 'Home Food'}
                              </Badge>
                            </a>
                          ) : href ? (
                            <a href={href(e.id)} className="truncate hover:underline">
                              {e.name}
                            </a>
                          ) : (
                            <span className="truncate">{e.name}</span>
                          )}
                          <time dateTime={e.createdAt} className="shrink-0 text-xs text-muted">
                            {relativeTime(e.createdAt)}
                          </time>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null,
            )}
          </CardBody>
        </Card>
      ) : null}
    </section>
  );
}
