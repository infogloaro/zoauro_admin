'use client';

import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  type TicketCategory,
  type TicketPriority,
} from '@zoauro/shared';
import { Headset, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DataTable, type Column } from '../../components/shared/DataTable';
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
import { selectedZone, type ScopeZone } from '../../lib/zone-scope';
import { CardError, EmptyState } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { useZoneOptions } from '../platform-settings/api';
import { ticketQuery, useTicketList, type TicketFilters } from './api';
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  QUEUE_TABS,
  queueTabFromParam,
  slaState,
  supportPath,
  TICKET_SORTS,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  ticketSortFromParam,
} from './labels';
import { NewTicketDialog } from './NewTicketDialog';
import type { SupportPageProps } from './support-page-props';

// Support desk queue (D93, D139–D141, D175; demo act 10): queue tabs, search by ticket number or subject, priority,
// category, "assigned to me" / "unassigned" and "overdue" filters, sort, 25 a page, all in the URL; the zone switcher's
// ?zone narrows to one zone. Each row shows its SLA state (due, paused, overdue). Open a ticket on a customer's behalf;
// export the list as CSV with the same filters.

type Row = NonNullable<ReturnType<typeof useTicketList>['data']>['data'][number];

const pick = <T extends string>(all: readonly T[], raw: string | null): T | undefined =>
  all.find((v) => v === raw);

export function SupportPage({ role, myZones, can }: SupportPageProps) {
  const router = useRouter();
  const url = useUrlState();
  const client = useApiClient();
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
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  const tab = queueTabFromParam(url.params.get('tab'));
  const tabDef = QUEUE_TABS.find((t) => t.id === tab) ?? QUEUE_TABS[0];
  const q = url.params.get('q') ?? '';
  const priority = pick<TicketPriority>(TICKET_PRIORITIES, url.params.get('priority'));
  const category = pick<TicketCategory>(TICKET_CATEGORIES, url.params.get('category'));
  const assigned = pick(['me', 'none'] as const, url.params.get('assigned'));
  const breached = url.params.get('overdue') === '1';
  const sort = ticketSortFromParam(url.params.get('sort'));
  const page = pageFromParam(url.params.get('page'));
  const [search, setSearch] = useState(q);
  const [creating, setCreating] = useState(false);
  const base = supportPath(role);

  const filters: TicketFilters = {
    page,
    sort,
    ...(q ? { q } : {}),
    ...(zone ? { zoneId: zone.id } : {}),
    ...(tabDef.statuses.length ? { status: tabDef.statuses } : {}),
    ...(priority ? { priority } : {}),
    ...(category ? { category } : {}),
    ...(assigned ? { assigned } : {}),
    ...(breached ? { breached } : {}),
  };
  const list = useTicketList(filters, !waitingForZone);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  const showZone = role === 'SUPER_ADMIN' ? !zone : zones.length > 1 && !zone;
  const filtered = Boolean(q || priority || category || assigned || breached || tab !== 'active');

  const columns: Column<Row>[] = [
    {
      id: 'ticket',
      header: 'Ticket',
      cell: (r, ctx) => (
        <div className="min-w-56">
          <button
            type="button"
            {...ctx.activatorProps}
            className={cn(ctx.activatorProps.className, 'font-semibold')}
          >
            {r.subject}
          </button>
          <p className="text-xs text-muted">
            {r.ticketNo} · {CATEGORY_LABEL[r.category]} · {relativeTime(r.createdAt)}
          </p>
        </div>
      ),
    },
    {
      id: 'customer',
      header: 'Customer',
      cell: (r) => (
        <div className="text-sm">
          <p>{r.customerName}</p>
          <p className="text-xs text-muted tabular-nums">{r.customerPhoneMasked}</p>
        </div>
      ),
    },
    ...(showZone
      ? [
          {
            id: 'zone',
            header: 'Zone',
            cell: (r: Row) => <Badge tone="neutral">{zoneById.get(r.zoneId)?.code ?? '—'}</Badge>,
          },
        ]
      : []),
    {
      id: 'priority',
      header: 'Priority',
      cell: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => {
        const sla = slaState(r);
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge tone={TICKET_STATUS_TONE[r.status]} dot>
              {TICKET_STATUS_LABEL[r.status]}
            </Badge>
            <Badge tone={sla.tone}>{sla.label}</Badge>
          </div>
        );
      },
    },
    {
      id: 'assignee',
      header: 'Assigned to',
      cell: (r) => (r.assignee ? r.assignee.name : <span className="text-muted">Nobody yet</span>),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Support Tickets"
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Support Tickets' },
        ]}
        description={
          zone
            ? `Tickets in ${zone.name}.`
            : role === 'SUPER_ADMIN'
              ? 'Every ticket in every zone, with its service-time deadline.'
              : 'Tickets in your zones, with their service-time deadlines.'
        }
        actions={
          <div className="flex flex-wrap items-start gap-2">
            {can.export ? (
              <ExportButton
                start={() =>
                  client.get('/support/tickets/export', {
                    query: ticketQuery({ ...filters, page: 1 }),
                  })
                }
              />
            ) : null}
            {can.edit ? (
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden className="size-4" /> Open a ticket
              </Button>
            ) : null}
          </div>
        }
      />

      <div role="tablist" aria-label="Ticket queues" className="flex flex-wrap gap-2">
        {QUEUE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            onClick={() => url.patch({ tab: t.id === 'active' ? null : t.id, page: null })}
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

      <div role="search" aria-label="Find tickets" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-sm font-medium">
          Search
          <input
            type="search"
            className={inputClass()}
            placeholder="Ticket number or subject"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Priority
          <select
            className={inputClass('min-w-32')}
            value={priority ?? ''}
            onChange={(e) => url.patch({ priority: e.target.value || null, page: null })}
          >
            <option value="">Any</option>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Category
          <select
            className={inputClass('min-w-40')}
            value={category ?? ''}
            onChange={(e) => url.patch({ category: e.target.value || null, page: null })}
          >
            <option value="">Any</option>
            {TICKET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Assigned
          <select
            className={inputClass('min-w-36')}
            value={assigned ?? ''}
            onChange={(e) => url.patch({ assigned: e.target.value || null, page: null })}
          >
            <option value="">Anyone</option>
            <option value="me">To me</option>
            <option value="none">Nobody yet</option>
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
            {TICKET_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-10 items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={breached}
            onChange={(e) => url.patch({ overdue: e.target.checked ? '1' : null, page: null })}
          />
          Overdue only
        </label>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              url.patch({
                q: null,
                tab: null,
                priority: null,
                category: null,
                assigned: null,
                overdue: null,
                page: null,
              });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <Card>
        <DataTable
          caption="Support tickets"
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(r) => r.id}
          onActivate={(r) => router.push(`${base}/${r.id}`)}
          activateLabel={(r) => `Open ticket ${r.ticketNo}`}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what="Support tickets" onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<Headset aria-hidden className="size-5" />}
              title={filtered ? 'Nothing matches' : 'No open tickets'}
            >
              {filtered
                ? 'Try another queue or filter.'
                : 'Every ticket is handled. New ones appear here with their deadline.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['ticket', 'tickets']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>

      <NewTicketDialog
        open={creating}
        zones={zones}
        onClose={() => setCreating(false)}
        onCreated={(id) => router.push(`${base}/${id}`)}
      />
    </div>
  );
}
