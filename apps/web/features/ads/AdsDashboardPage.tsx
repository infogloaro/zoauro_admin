'use client';

import {
  BadgeIndianRupee,
  CalendarClock,
  CirclePause,
  Clock,
  FileQuestion,
  Hotel,
  LayoutGrid,
  Megaphone,
  Percent,
  Radio,
  Receipt,
  Wallet,
} from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { Badge } from '../../components/ui/badge';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { formatPaise } from '../audit/format';
import { CardError, CardSkeleton, EmptyState } from '../dashboard/parts';
import type { AdsPageProps } from './ads-page-props';
import { AdsTabs, adsBase, useAdsZone } from './AdsTabs';
import { useAdsDashboard } from './api';
import { VENDOR_LABEL } from './labels';

// Advertising dashboard (D179, D182, D201; demo scope): what is waiting and running, today's occupancy, and the ad
// revenue (flat fees billed, ranking commission from delivered orders, the total, what the next vendor payouts will
// deduct and what hotels are billed) for the picked zone or every zone in view. Money needs payments:view in the zone
// (Super Admin always); without it the API sends null and the cards say so. Refreshes every 15 s (D200).

export function AdsDashboardPage(props: AdsPageProps) {
  const { role } = props;
  const scope = useAdsZone(props);
  const d = useAdsDashboard(scope.zone?.id ?? null, !scope.waiting);
  const base = adsBase(role);
  const zoneQs = scope.zone ? `&zone=${encodeURIComponent(scope.zone.code)}` : '';
  const data = d.data;
  const c = data?.counts;
  const money = data?.money;
  const loading = !data;
  const nothing = c && Object.values(c).every((n) => n === 0) && data.occupancyToday.capacity === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Advertising"
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Advertising' },
        ]}
        description={`Ad slots, vendor requests and campaigns${scope.zone ? ` in ${scope.zone.name}` : ''}, with the ad revenue they bring in.`}
      />
      <AdsTabs role={role} />

      {d.isError ? (
        <CardError
          what="The advertising figures"
          onRetry={() => void d.refetch()}
          error={d.error}
        />
      ) : nothing ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Megaphone aria-hidden className="size-5" />}
              title="No campaigns yet"
            >
              Ad slots, vendor requests and campaigns appear here once vendors start advertising.
            </EmptyState>
          </CardBody>
        </Card>
      ) : (
        <>
          <section aria-labelledby="ads-activity" className="flex flex-col gap-3">
            <h2 id="ads-activity" className="text-lg font-semibold">
              Activity
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Requests waiting"
                value={c?.requestsSubmitted ?? null}
                hint="Vendors waiting for a quote"
                icon={FileQuestion}
                tone="warning"
                href={`${base}/requests?status=SUBMITTED${zoneQs}`}
                loading={loading}
              />
              <StatCard
                label="Quotes with vendors"
                value={c?.requestsQuoted ?? null}
                hint="Waiting for the vendor to accept"
                icon={Clock}
                tone="info"
                href={`${base}/requests?status=QUOTED${zoneQs}`}
                loading={loading}
              />
              <StatCard
                label="Live campaigns"
                value={c?.campaignsLive ?? null}
                hint={
                  c
                    ? `${c.campaignsScheduled} scheduled · ${c.campaignsEnded30d} ended in 30 days`
                    : undefined
                }
                icon={Radio}
                tone="success"
                href={`${base}/campaigns?status=LIVE${zoneQs}`}
                loading={loading}
              />
              <StatCard
                label="Paused campaigns"
                value={c?.campaignsPaused ?? null}
                hint="Paused days are not billed"
                icon={CirclePause}
                tone="warning"
                href={`${base}/campaigns?status=PAUSED${zoneQs}`}
                loading={loading}
              />
              <StatCard
                label="Active slots"
                value={c?.slotsActive ?? null}
                icon={LayoutGrid}
                tone="neutral"
                href={`${base}/slots${scope.zone ? `?zone=${encodeURIComponent(scope.zone.code)}` : ''}`}
                loading={loading}
              />
              <StatCard
                label="Booked today"
                value={
                  data ? `${data.occupancyToday.booked} of ${data.occupancyToday.capacity}` : null
                }
                hint="Campaign places taken across the slots"
                icon={CalendarClock}
                tone="info"
                loading={loading}
              />
            </div>
          </section>

          <section aria-labelledby="ads-money" className="flex flex-col gap-3">
            <div>
              <h2 id="ads-money" className="text-lg font-semibold">
                Ad revenue
              </h2>
              <p className="text-sm text-muted">
                Gross, before GST, over each campaign’s live days. Shown here until the payout run
                deducts it.
              </p>
            </div>
            {loading ? (
              <CardSkeleton rows={2} />
            ) : money === null || money === undefined ? (
              <Card>
                <CardBody>
                  <p className="text-sm text-muted">
                    Needs payments view: ad revenue is shown only in zones where you may view
                    payments.
                  </p>
                </CardBody>
              </Card>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                  <StatCard
                    label="Flat ad fees billed"
                    value={formatPaise(money.flatBilledPaise)}
                    hint="Per day live"
                    icon={Receipt}
                    tone="neutral"
                  />
                  <StatCard
                    label="Ranking commission"
                    value={formatPaise(money.commissionEarnedPaise)}
                    hint="From delivered orders"
                    icon={Percent}
                    tone="info"
                  />
                  <StatCard
                    label="Total ad revenue"
                    value={formatPaise(money.totalEarnedPaise)}
                    icon={BadgeIndianRupee}
                    tone="success"
                  />
                  <StatCard
                    label="Due from next vendor payouts"
                    value={formatPaise(money.dueFromPayoutsPaise)}
                    hint="Restaurants and Home Food"
                    icon={Wallet}
                    tone="warning"
                  />
                  <StatCard
                    label="Billed to hotels"
                    value={formatPaise(money.billedToHotelsPaise)}
                    hint="Hotels have no payout to deduct from"
                    icon={Hotel}
                    tone="neutral"
                  />
                </div>
                <Card aria-labelledby="ads-top-vendors">
                  <CardHeader
                    id="ads-top-vendors"
                    title="Top vendors by ad revenue"
                    subtitle="The five that brought in the most"
                  />
                  <CardBody>
                    {money.topVendors.length === 0 ? (
                      <p className="text-sm text-muted">No ad revenue yet.</p>
                    ) : (
                      <ol className="flex flex-col divide-y divide-line">
                        {money.topVendors.slice(0, 5).map((v, i) => (
                          <li
                            key={`${v.vendor.id}-${v.zone.id}`}
                            className="flex items-center gap-3 py-2.5 text-sm"
                          >
                            <span className="w-5 text-muted tabular-nums">{i + 1}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium" title={v.vendor.name}>
                                {v.vendor.name}
                              </span>
                              <span className="block text-xs text-muted">
                                {VENDOR_LABEL[v.vendor.type]} · {v.campaigns} campaign
                                {v.campaigns === 1 ? '' : 's'}
                              </span>
                            </span>
                            {scope.showZone ? <Badge tone="neutral">{v.zone.code}</Badge> : null}
                            <span className="font-semibold tabular-nums">
                              {formatPaise(v.earnedPaise)}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </CardBody>
                </Card>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
