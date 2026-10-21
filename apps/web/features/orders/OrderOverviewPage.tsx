'use client';

import { useQuery } from '@tanstack/react-query';
import type { OrderStatus } from '@zoauro/shared';
import { AlarmClock, CalendarClock, ListOrdered, PackageX } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { Badge } from '../../components/ui/badge';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { useApiClient } from '../../lib/api-client';
import { useUrlState } from '../../lib/url-state';
import { cn } from '../../lib/utils';
import { formatPaise } from '../audit/format';
import { retryTransient } from '../audit/useAuditLogs';
import { CardError, CardSkeleton } from '../dashboard/parts';
import { BarList } from '../dashboard/tiles/OperationsTiles';
import { ORDER_STATUS_LABEL } from './labels';

// Order overview (D179 section 3, D182; demo act 6): what needs attention now (open and delayed orders per status
// against the Control Panel's stage targets, ready orders nobody took, pre-orders due within 2 hours) and how the
// period went (cancellations and their top reasons, average accept / prepare / deliver minutes, payment mix, and the
// money only for members who may view payments). Every number links to the filtered orders list.

const RANGES = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
] as const;
type Range = (typeof RANGES)[number]['value'];
const LIVE: readonly OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'ASSIGNED',
  'OUT_FOR_DELIVERY',
];
const SLA_KEY: Partial<Record<OrderStatus, string>> = {
  PLACED: 'acceptMinutes',
  ACCEPTED: 'prepareMinutes',
  PREPARING: 'prepareMinutes',
  READY: 'readyToAssignMinutes',
  ASSIGNED: 'assignedToPickupMinutes',
  OUT_FOR_DELIVERY: 'outForDeliveryMinutes',
};
const TAB_OF: Partial<Record<OrderStatus, string>> = {
  PLACED: 'new',
  ACCEPTED: 'kitchen',
  PREPARING: 'kitchen',
  READY: 'ready',
  ASSIGNED: 'delivery',
  OUT_FOR_DELIVERY: 'delivery',
};

const minutes = (m: number | null) => (m === null ? '—' : `${Math.round(m)} min`);

export function OrderOverviewPage({ userRole: role }: { userRole: 'SUPER_ADMIN' | 'ZONAL_ADMIN' }) {
  const client = useApiClient();
  const url = useUrlState();
  const range: Range = RANGES.find((r) => r.value === url.params.get('range'))?.value ?? '24h';
  const ordersPath = role === 'SUPER_ADMIN' ? '/super-admin/orders' : '/zone/orders';
  const o = useQuery({
    queryKey: ['orders', 'overview', range],
    queryFn: ({ signal }) => client.get('/orders/overview', { query: { range }, signal }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: retryTransient,
  });
  const d = o.data;
  const openTotal = d
    ? LIVE.reduce((n, s) => n + (d.open[s as keyof typeof d.open] ?? 0), 0)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Order overview"
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Orders', href: ordersPath },
          { label: 'Overview' },
        ]}
        description="What needs attention now, and how the period went. Stage targets come from the Control Panel."
        actions={
          <div
            role="radiogroup"
            aria-label="Period"
            className="flex gap-1 rounded-input border border-line bg-surface p-1"
          >
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={r.value === range}
                onClick={() => url.patch({ range: r.value === '24h' ? null : r.value })}
                className={cn(
                  'rounded-md px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-primary',
                  r.value === range
                    ? 'bg-primary-soft font-semibold text-primary-strong'
                    : 'text-muted hover:bg-surface-muted',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {o.isError ? (
        <CardError what="The order overview" onRetry={() => void o.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Open orders"
              value={openTotal}
              loading={!d}
              icon={ListOrdered}
              href={ordersPath}
            />
            <StatCard
              label="Delayed"
              value={d?.delayedTotal ?? null}
              loading={!d}
              hint="Past their stage target"
              icon={AlarmClock}
              tone={d && d.delayedTotal > 0 ? 'danger' : 'success'}
              href={`${ordersPath}?delayed=1`}
            />
            <StatCard
              label="Ready, nobody assigned"
              value={d?.readyUnassigned ?? null}
              loading={!d}
              hint={d ? `Longer than ${d.sla.readyToAssignMinutes} min` : undefined}
              icon={PackageX}
              tone={d && d.readyUnassigned > 0 ? 'warning' : 'success'}
              href={`${ordersPath}?tab=ready`}
            />
            <StatCard
              label="Pre-orders due in 2 h"
              value={d?.preordersDueSoon ?? null}
              loading={!d}
              icon={CalendarClock}
              tone="info"
              href={`${ordersPath}?preorders=1`}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card aria-labelledby="ov-stages" className="xl:col-span-2">
              <CardHeader
                id="ov-stages"
                title="Live orders by stage"
                subtitle="Open now, and how many are past the stage target"
              />
              <CardBody>
                {!d ? (
                  <CardSkeleton rows={6} />
                ) : (
                  <table className="w-full text-sm">
                    <caption className="sr-only">Live orders by stage</caption>
                    <thead className="text-left text-xs text-muted">
                      <tr>
                        <th className="py-2 font-medium">Stage</th>
                        <th className="py-2 text-right font-medium">Open</th>
                        <th className="py-2 text-right font-medium">Delayed</th>
                        <th className="py-2 text-right font-medium">Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {LIVE.map((s) => {
                        const open = d.open[s as keyof typeof d.open] ?? 0;
                        const late = d.delayed[s as keyof typeof d.delayed] ?? 0;
                        const key = SLA_KEY[s] as keyof typeof d.sla | undefined;
                        return (
                          <tr key={s} className="border-t border-line">
                            <td className="py-2">
                              <a
                                href={`${ordersPath}?tab=${TAB_OF[s] ?? 'all'}`}
                                className="hover:underline"
                              >
                                {ORDER_STATUS_LABEL[s]}
                              </a>
                            </td>
                            <td className="py-2 text-right tabular-nums">{open}</td>
                            <td className="py-2 text-right">
                              {late > 0 ? (
                                <Badge tone="danger">{late}</Badge>
                              ) : (
                                <span className="text-muted">0</span>
                              )}
                            </td>
                            <td className="py-2 text-right text-xs text-muted">
                              {key ? `${d.sla[key]} min` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </CardBody>
            </Card>

            <Card aria-labelledby="ov-times">
              <CardHeader
                id="ov-times"
                title="Average times"
                subtitle={RANGES.find((r) => r.value === range)?.label}
              />
              <CardBody>
                {!d ? (
                  <CardSkeleton rows={3} />
                ) : (
                  <dl className="flex flex-col gap-3 text-sm">
                    {(
                      [
                        ['Accept', d.avgMinutes.accept, d.sla.acceptMinutes],
                        ['Prepare', d.avgMinutes.prepare, d.sla.prepareMinutes],
                        ['Deliver', d.avgMinutes.deliver, d.sla.outForDeliveryMinutes],
                      ] as const
                    ).map(([label, avg, target]) => (
                      <div key={label} className="flex items-baseline justify-between gap-3">
                        <dt className="text-muted">{label}</dt>
                        <dd className="flex items-baseline gap-2">
                          <span
                            className={cn(
                              'text-xl font-semibold tabular-nums',
                              avg !== null && avg > target && 'text-danger',
                            )}
                          >
                            {minutes(avg)}
                          </span>
                          <span className="text-xs text-muted">target {target} min</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card aria-labelledby="ov-cancel">
              <CardHeader
                id="ov-cancel"
                title="Cancellations"
                subtitle={RANGES.find((r) => r.value === range)?.label}
              />
              <CardBody className="flex flex-col gap-3">
                {!d ? (
                  <CardSkeleton rows={3} />
                ) : (
                  <>
                    <p className="text-sm">
                      <span className="text-2xl font-semibold tabular-nums">
                        {d.cancellations.count}
                      </span>{' '}
                      <span className="text-muted">
                        {d.cancellations.rate === null
                          ? ''
                          : `· ${parseFloat((d.cancellations.rate * 100).toFixed(1))}% of orders`}
                      </span>
                    </p>
                    {d.cancellations.topReasons.length === 0 ? (
                      <p className="text-sm text-muted">No cancellations in this period.</p>
                    ) : (
                      <BarList
                        label="Top cancellation reasons"
                        rows={d.cancellations.topReasons.map((r) => ({
                          key: r.reason,
                          label: r.reason,
                          value: r.count,
                        }))}
                      />
                    )}
                  </>
                )}
              </CardBody>
            </Card>
            <Card aria-labelledby="ov-mix">
              <CardHeader
                id="ov-mix"
                title="Payment mix"
                subtitle={RANGES.find((r) => r.value === range)?.label}
              />
              <CardBody>
                {!d ? (
                  <CardSkeleton rows={3} />
                ) : (
                  <BarList
                    label="Orders by payment method"
                    rows={[
                      { key: 'ONLINE', label: 'Online', value: d.paymentMix.ONLINE },
                      { key: 'COD', label: 'Cash on delivery', value: d.paymentMix.COD },
                      { key: 'WALLET', label: 'Wallet', value: d.paymentMix.WALLET },
                    ]}
                  />
                )}
              </CardBody>
            </Card>
            {d?.money ? (
              <Card aria-labelledby="ov-money">
                <CardHeader id="ov-money" title="Money" subtitle="Delivered orders" />
                <CardBody>
                  <dl className="flex flex-col gap-3 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted">Gross order value</dt>
                      <dd className="font-semibold tabular-nums">{formatPaise(d.money.gmv)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Average order</dt>
                      <dd className="font-semibold tabular-nums">
                        {d.money.aov === null ? '—' : formatPaise(d.money.aov)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Delivered orders</dt>
                      <dd className="font-semibold tabular-nums">
                        {d.money.delivered.toLocaleString('en-IN')}
                      </dd>
                    </div>
                  </dl>
                </CardBody>
              </Card>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
