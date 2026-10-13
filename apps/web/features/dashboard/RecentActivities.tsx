'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { AUDIT_MODULES, type AuditListResponse, type AuditModule } from '@zoauro/shared';
import { Activity, CircleAlert, Clock, Filter, ScrollText, ShieldAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button, buttonClass } from '../../components/ui/button';
import { Card, CardBody } from '../../components/ui/card';
import { useApiClient } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import { AuditDetailDrawer } from '../audit/AuditDetailDrawer';
import { retryTransient } from '../audit/useAuditLogs';
import { useAuditCatalogue } from '../audit/logs/useSystemLogs';
import { CardError, CardSkeleton, EmptyState } from './parts';
import { relativeTime } from './time';

// Recent Activities (Overview, owner's prototype): the organisation-wide audit trail as a readable timeline grouped by
// day, newest first, with quick filters (module, denied only, sensitive only) and the detail drawer. The full search,
// actor, zone and date filters stay on System Logs, which this page links to.

type Outcome = 'ALL' | 'DENIED' | 'HIGH';

const MODULE_LABEL: Record<string, string> = {
  auth: 'Sign-in & security',
  zones: 'Zones',
  admins: 'Admins',
  access: 'Access',
  settings: 'Settings',
  audit: 'Audit',
  system: 'System',
};

function dayLabel(iso: string, now: Date = new Date()): string {
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d); // yyyy-mm-dd
  const day = fmt(new Date(iso));
  if (day === fmt(now)) return 'Today';
  if (day === fmt(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

export function RecentActivities() {
  const client = useApiClient();
  const catalogue = useAuditCatalogue();
  const [module, setModule] = useState<AuditModule | null>(null);
  const [outcome, setOutcome] = useState<Outcome>('ALL');
  const [openId, setOpenId] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['audit', 'list', 'global', { feed: true, module, outcome }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }): Promise<AuditListResponse> =>
      client.get('/audit-logs', {
        query: {
          limit: 30,
          ...(module ? { module } : {}),
          ...(outcome === 'DENIED' ? { outcome: 'DENIED' as const } : {}),
          ...(outcome === 'HIGH' ? { sensitivity: 'HIGH' as const } : {}),
          ...(pageParam ? { after: pageParam } : {}),
        },
        signal,
      }) as Promise<AuditListResponse>,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    staleTime: 15_000,
    retry: retryTransient,
  });

  const entries = query.data?.pages.flatMap((p) => p.data) ?? [];
  const days: [string, typeof entries][] = [];
  for (const e of entries) {
    const label = dayLabel(e.createdAt);
    const last = days[days.length - 1];
    if (last && last[0] === label) last[1].push(e);
    else days.push([label, [e]]);
  }
  const modules = catalogue.data?.modules ?? [];

  return (
    <div>
      <PageHeader
        title="Recent Activities"
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Recent Activities' },
        ]}
        description="Organisation-wide audit trail: approvals, account and access changes, zone updates and sign-in security."
        actions={
          <a href="/super-admin/settings/logs" className={buttonClass('secondary')}>
            <ScrollText aria-hidden className="size-4" /> Open System Logs
          </a>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-4">
          <Filter aria-hidden className="size-4 text-muted" />
          <span className="mr-1 text-sm font-medium text-muted">Show</span>
          <div role="group" aria-label="Outcome" className="flex flex-wrap gap-1.5">
            {(
              [
                ['ALL', 'Everything'],
                ['DENIED', 'Denied attempts'],
                ['HIGH', 'Sensitive'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={outcome === value}
                onClick={() => setOutcome(value)}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm',
                  outcome === value
                    ? 'border-primary bg-primary-soft font-medium text-primary-strong'
                    : 'border-line hover:bg-surface-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <span aria-hidden className="mx-2 hidden h-5 w-px bg-line sm:block" />
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Module</span>
            <select
              value={module ?? ''}
              onChange={(e) => setModule(AUDIT_MODULES.find((m) => m === e.target.value) ?? null)}
              className="h-9 rounded-input border border-line bg-surface px-2 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">All modules</option>
              {modules.map((m) => (
                <option key={m} value={m}>
                  {MODULE_LABEL[m] ?? m.charAt(0).toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <CardBody>
          {query.isError ? (
            <CardError what="The activity feed" onRetry={() => void query.refetch()} />
          ) : query.isPending ? (
            <CardSkeleton rows={6} />
          ) : entries.length === 0 ? (
            <EmptyState
              icon={<Activity aria-hidden className="size-5" />}
              title="No activity matches"
            >
              {outcome !== 'ALL' || module
                ? 'Try another filter.'
                : 'Every change made in the panel will be listed here.'}
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-8">
              {days.map(([label, items]) => (
                <section key={label} aria-label={label}>
                  <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">
                    {label}
                  </h2>
                  <ol className="flex flex-col divide-y divide-line rounded-input border border-line">
                    {items.map((e) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={(ev) => {
                            opener.current = ev.currentTarget;
                            setOpenId(e.id);
                          }}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'flex size-9 shrink-0 items-center justify-center rounded-full',
                              e.outcome === 'DENIED'
                                ? 'bg-danger-soft text-danger'
                                : e.sensitivity === 'HIGH'
                                  ? 'bg-warning-soft text-warning'
                                  : 'bg-primary-soft text-primary-strong',
                            )}
                          >
                            {e.outcome === 'DENIED' ? (
                              <CircleAlert className="size-4" />
                            ) : e.sensitivity === 'HIGH' ? (
                              <ShieldAlert className="size-4" />
                            ) : (
                              <Activity className="size-4" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                              {e.actionLabel}
                              {e.outcome === 'DENIED' ? <Badge tone="danger">Denied</Badge> : null}
                              {e.sensitivity === 'HIGH' ? (
                                <Badge tone="warning">Sensitive</Badge>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted">
                              {e.entity.label ?? e.entity.type} · {e.actor.name}
                              {e.zone?.name ? ` · ${e.zone.name}` : ''}
                              {e.changedFields.length > 0
                                ? ` · changed ${e.changedFields.length} field${e.changedFields.length > 1 ? 's' : ''}`
                                : ''}
                            </span>
                          </span>
                          <time
                            dateTime={e.createdAt}
                            title={new Date(e.createdAt).toLocaleString('en-IN', {
                              timeZone: 'Asia/Kolkata',
                            })}
                            className="flex shrink-0 items-center gap-1 text-xs text-muted"
                          >
                            <Clock aria-hidden className="size-3" />
                            {relativeTime(e.createdAt)}
                          </time>
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
              {query.hasNextPage ? (
                <div className="flex justify-center">
                  <Button
                    variant="secondary"
                    disabled={query.isFetchingNextPage}
                    onClick={() => void query.fetchNextPage()}
                  >
                    {query.isFetchingNextPage ? 'Loading…' : 'Load older activity'}
                  </Button>
                </div>
              ) : (
                <p className="text-center text-xs text-muted">That is everything recorded.</p>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <AuditDetailDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          opener.current?.focus();
        }}
      />
    </div>
  );
}
