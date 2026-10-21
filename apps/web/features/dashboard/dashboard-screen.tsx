'use client';

import Link from 'next/link';
import {
  Activity,
  BadgeCheck,
  CalendarDays,
  Clock3,
  Minus,
  Receipt,
  ShieldOff,
  ShoppingCart,
  Store,
  TrendingUp,
  Undo2,
  UserPlus,
  Users,
  Wallet,
  Percent,
} from 'lucide-react';
import type { DashboardSummary } from '@zoauro/shared';
import { PageHeader } from '../../components/shared/page-header';
import { StatCard } from '../../components/shared/stat-card';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/shared/states';
import { Card, CardContent, CardTitle } from '../../components/ui/card';
import { ApiError } from '../../lib/api';
import { useMe } from '../auth/api';
import { useDashboardSummary, useNewRegistrations } from './api';

/**
 * M16 Super Admin dashboard (doc 18 §2 route /super-admin/dashboard,
 * doc 20 row 10, docs 39/36). The six order/revenue KPIs and the five
 * charts need the M11 `orders` table and real payment records — the
 * current `payments` table is a Phase 2C placeholder — so those tiles
 * render honest "—" placeholders instead of invented numbers. The
 * platform-health card is DB-derived only (D34).
 */

const ORDERS_CAPTION = 'Requires Orders data (M11)';
const FINANCE_CAPTION = 'Requires financial records (M11/M12)';

export interface DashboardKpi {
  label: string;
  value: string;
  caption: string;
  Icon: typeof Users;
}

function realKpi(
  label: string,
  value: number | undefined,
  caption: string,
  Icon: DashboardKpi['Icon'],
  isPending: boolean,
): DashboardKpi {
  return {
    label,
    value: isPending ? '0' : String(value ?? 0),
    caption: isPending ? 'Loading…' : caption,
    Icon,
  };
}

function unavailableKpi(label: string, caption: string, Icon: DashboardKpi['Icon']): DashboardKpi {
  return { label, value: '—', caption, Icon };
}

/** Doc 20 row 10: two rows of six, in Figma order. */
export function dashboardKpis(
  summary: DashboardSummary | undefined,
  isPending: boolean,
): DashboardKpi[] {
  return [
    unavailableKpi('Total Orders', ORDERS_CAPTION, ShoppingCart),
    realKpi('Total Customers', summary?.customers, 'Registered customers', Users, isPending),
    realKpi('Total Restaurants', summary?.restaurants, 'All restaurants', Store, isPending),
    realKpi(
      'Active Restaurants',
      summary?.activeRestaurants,
      'Status Active',
      BadgeCheck,
      isPending,
    ),
    realKpi(
      'Pending Verification',
      summary?.pendingVerification,
      'Vendors and partners awaiting review',
      Clock3,
      isPending,
    ),
    realKpi(
      'Suspended',
      summary?.suspended,
      'Vendors and partners suspended',
      ShieldOff,
      isPending,
    ),
    unavailableKpi('Total Revenue', FINANCE_CAPTION, TrendingUp),
    unavailableKpi('Platform Commission', FINANCE_CAPTION, Percent),
    unavailableKpi('Restaurant Payouts', FINANCE_CAPTION, Wallet),
    unavailableKpi('Total Refunds', FINANCE_CAPTION, Undo2),
    unavailableKpi('Avg Order Value', FINANCE_CAPTION, Receipt),
    unavailableKpi('Cancellation Rate', FINANCE_CAPTION, Minus),
  ];
}

export function registrationsListState(input: {
  isPending: boolean;
  isError: boolean;
  total: number;
}): 'loading' | 'error' | 'empty' | 'ready' {
  if (input.isPending) return 'loading';
  if (input.isError) return 'error';
  return input.total > 0 ? 'ready' : 'empty';
}

export function greetingFor(name: string, now: Date = new Date()): string {
  const hour = now.getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${name}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

interface RegistrationItem {
  id: string;
  name: string;
  createdAt: string;
}

function RegistrationCard({
  title,
  href,
  items,
  state,
  error,
  onRetry,
}: {
  title: string;
  href: string;
  items: RegistrationItem[];
  state: 'loading' | 'error' | 'empty' | 'ready';
  error?: Error | null;
  onRetry: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <CardTitle className="text-[15px] font-semibold text-slate-900">{title}</CardTitle>
          <Link href={href} className="text-[13px] font-medium text-primary hover:underline">
            View all
          </Link>
        </div>
        {state === 'loading' && <TableSkeleton rows={3} />}
        {state === 'error' && (
          <ErrorState
            message={error?.message || `Could not load ${title.toLowerCase()}.`}
            requestId={error instanceof ApiError ? error.requestId : undefined}
            onRetry={onRetry}
          />
        )}
        {state === 'empty' && <EmptyState message={`No recent ${title.toLowerCase()} yet.`} />}
        {state === 'ready' && (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="truncate text-sm text-slate-800">{item.name}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {formatDate(item.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardScreen() {
  const { data: user } = useMe();
  const summary = useDashboardSummary();
  const registrations = useNewRegistrations(5);

  const retry = () => {
    void summary.refetch();
    void registrations.refetch();
  };

  const kpis = dashboardKpis(summary.data, summary.isPending);
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const regData = registrations.data?.data;
  const registrationTotal =
    (regData?.customers.length ?? 0) +
    (regData?.restaurants.length ?? 0) +
    (regData?.deliveryPartners.length ?? 0);
  const registrationState = registrationsListState({
    isPending: registrations.isPending,
    isError: registrations.isError,
    total: registrationTotal,
  });

  const forbidden = summary.error instanceof ApiError && summary.error.status === 403;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title={user ? greetingFor(user.name) : 'Dashboard'}
        subtitle={today}
        actions={
          <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-500">
            <CalendarDays className="size-4" aria-hidden="true" />
            All time
          </span>
        }
      />

      {summary.isError && !forbidden && (
        <div className="mb-6">
          <ErrorState
            message={summary.error?.message || 'Could not load the dashboard summary.'}
            requestId={summary.error instanceof ApiError ? summary.error.requestId : undefined}
            onRetry={retry}
          />
        </div>
      )}
      {forbidden && (
        <div className="mb-6">
          <ErrorState
            message="You don't have permission to view platform dashboards yet (dashboard:view). Zone-scoped dashboards arrive with zone assignments (M03)."
            requestId={summary.error instanceof ApiError ? summary.error.requestId : undefined}
            onRetry={retry}
          />
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {kpis.slice(0, 6).map((kpi) => (
          <StatCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            caption={kpi.caption}
            icon={<kpi.Icon className="size-5" aria-hidden="true" />}
          />
        ))}
      </div>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {kpis.slice(6).map((kpi) => (
          <StatCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            caption={kpi.caption}
            icon={<kpi.Icon className="size-5" aria-hidden="true" />}
          />
        ))}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <CardTitle className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-slate-900">
              <Activity className="size-4 text-orange-500" aria-hidden="true" />
              Platform Health
            </CardTitle>
            <dl className="space-y-3">
              <div className="flex items-center justify-between">
                <dt className="text-[13px] text-slate-500">Pending verifications</dt>
                <dd className="text-lg font-bold text-slate-900" data-testid="health-pending">
                  {summary.isPending
                    ? '0'
                    : (summary.data?.platformHealth.pendingVerifications ?? 0)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[13px] text-slate-500">Active sessions</dt>
                <dd className="text-lg font-bold text-slate-900" data-testid="health-sessions">
                  {summary.isPending ? '0' : (summary.data?.platformHealth.activeSessions ?? 0)}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[12px] text-slate-500">
              Database-derived only (no uptime figure).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <CardTitle className="mb-2 text-[15px] font-semibold text-slate-900">
              Zones without an admin
            </CardTitle>
            <p className="text-[28px] font-bold leading-none text-slate-900">—</p>
            <p className="mt-2 text-[12px] text-slate-500">Requires zone assignments (M03).</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <CardTitle className="mb-2 text-[15px] font-semibold text-slate-900">Charts</CardTitle>
            <p className="text-sm text-slate-600">
              Order Overview, Revenue Overview, Order Status, Top Food Categories and Zone
              Performance arrive with Orders data (M11).
            </p>
            <p className="mt-2 text-[12px] text-slate-500">
              No chart is drawn until its endpoint returns real aggregates.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <UserPlus className="size-4 text-orange-500" aria-hidden="true" />
        <h2 className="text-[17px] font-semibold text-slate-900">New Registrations</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <RegistrationCard
          title="Customers"
          href="/super-admin/customers"
          items={regData?.customers ?? []}
          state={registrationState}
          error={registrations.error}
          onRetry={retry}
        />
        <RegistrationCard
          title="Restaurants"
          href="/super-admin/restaurants"
          items={regData?.restaurants ?? []}
          state={registrationState}
          error={registrations.error}
          onRetry={retry}
        />
        <RegistrationCard
          title="Delivery Partners"
          href="/super-admin/delivery-partners"
          items={regData?.deliveryPartners ?? []}
          state={registrationState}
          error={registrations.error}
          onRetry={retry}
        />
      </div>
    </div>
  );
}
