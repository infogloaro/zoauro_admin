'use client';

import {
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_KINDS,
  type NotificationAudience,
  type NotificationKind,
} from '@zoauro/shared';
import { Bell, Plus } from 'lucide-react';
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
import { CardError, EmptyState } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { useZoneOptions } from '../platform-settings/api';
import { useNotificationList, useNotificationTabCounts, type NotificationFilters } from './api';
import {
  AUDIENCE_LABEL,
  CHANNEL_LABEL,
  KIND_LABEL,
  NOTIFICATION_TABS,
  STATUS_LABEL,
  STATUS_TONE,
  notificationTabFromParam,
} from './labels';
import { NotificationComposer } from './NotificationComposer';

// Notifications (M17; D94, D99, D134–D137) for both roles: history with status tabs and real counts, search, kind and
// audience filters, 25 a page, URL state, zone switcher; "New notification" for members with notifications:add. A Super
// Admin sees the promotions waiting for approval first in their own tab.

type Row = NonNullable<ReturnType<typeof useNotificationList>['data']>['data'][number];

export function NotificationsPage({
  role,
  myZones = [],
  canAdd,
}: {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  myZones?: ScopeZone[];
  canAdd: boolean;
}) {
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
  const waiting = role === 'SUPER_ADMIN' && zoneCode !== null && !allZones.data;
  const tab = notificationTabFromParam(url.params.get('tab'));
  const q = url.params.get('q') ?? '';
  const k = url.params.get('kind');
  const kind = (NOTIFICATION_KINDS as readonly string[]).includes(k ?? '')
    ? (k as NotificationKind)
    : undefined;
  const a = url.params.get('audience');
  const audience = (NOTIFICATION_AUDIENCES as readonly string[]).includes(a ?? '')
    ? (a as NotificationAudience)
    : undefined;
  const page = pageFromParam(url.params.get('page'));
  const [search, setSearch] = useState(q);
  const [composing, setComposing] = useState(url.params.get('new') === '1');

  const filters: NotificationFilters = {
    page,
    tab,
    ...(q ? { q } : {}),
    ...(zone ? { zoneId: zone.id } : {}),
    ...(kind ? { kind } : {}),
    ...(audience ? { audience } : {}),
  };
  const list = useNotificationList(filters, !waiting);
  const counts = useNotificationTabCounts(filters, !waiting);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  const base = role === 'SUPER_ADMIN' ? '/super-admin/notifications' : '/zone/notifications';
  const filtered = Boolean(q || kind || audience || tab !== 'all');

  const columns: Column<Row>[] = [
    {
      id: 'title',
      header: 'Notification',
      cell: (r, ctx) => (
        <div className="min-w-56">
          <RowActivator ctx={ctx} className="font-semibold">
            {r.title}
          </RowActivator>
          <p className="line-clamp-1 text-xs text-muted">{r.body}</p>
        </div>
      ),
    },
    {
      id: 'kind',
      header: 'Kind',
      cell: (r) => (
        <Badge tone={r.kind === 'PROMOTION' ? 'brand' : 'neutral'}>{KIND_LABEL[r.kind]}</Badge>
      ),
    },
    {
      id: 'to',
      header: 'To',
      cell: (r) => (
        <div className="text-xs">
          <p>{AUDIENCE_LABEL[r.audience]}</p>
          <p className="text-muted">
            {r.zones.length === 0 ? 'Every zone' : r.zones.map((z) => z.code).join(', ')}
          </p>
        </div>
      ),
    },
    {
      id: 'channels',
      header: 'Channels',
      cell: (r) => (
        <span className="text-xs">{r.channels.map((c) => CHANNEL_LABEL[c]).join(', ')}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <Badge tone={STATUS_TONE[r.status]} dot>
          {STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    {
      id: 'when',
      header: 'When',
      cell: (r) => {
        const at = r.sentAt ?? r.scheduledAt ?? r.createdAt;
        return (
          <div className="text-xs text-muted">
            <time dateTime={at}>
              {r.sentAt
                ? `Sent ${relativeTime(at)}`
                : r.scheduledAt
                  ? `For ${new Date(at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}`
                  : relativeTime(at)}
            </time>
            {r.requestedBy ? <p>by {r.requestedBy.name}</p> : null}
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Support & Engagement' },
          { label: 'Notifications' },
        ]}
        description={
          role === 'SUPER_ADMIN'
            ? 'Messages and promotions to customers, vendors and partners. Approve Zonal Admins’ promotions here.'
            : 'Messages and promotions to your zones. Promotions go out after a Super Admin approves them.'
        }
        actions={
          canAdd ? (
            <Button onClick={() => setComposing(true)}>
              <Plus aria-hidden className="size-4" /> New notification
            </Button>
          ) : undefined
        }
      />

      <div role="tablist" aria-label="Notifications by status" className="flex flex-wrap gap-2">
        {NOTIFICATION_TABS.map((t, i) => {
          const selected = t.id === tab;
          const n = counts[i]?.data;
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
              <span className="text-xs tabular-nums text-muted">
                {n === undefined ? '—' : n.toLocaleString('en-IN')}
              </span>
            </button>
          );
        })}
      </div>

      <div role="search" aria-label="Find notifications" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-medium">
          Search
          <input
            type="search"
            className={inputClass()}
            placeholder="Title or message"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Kind
          <select
            className={inputClass('min-w-36')}
            value={kind ?? ''}
            onChange={(e) => url.patch({ kind: e.target.value || null, page: null })}
          >
            <option value="">Any</option>
            {NOTIFICATION_KINDS.map((x) => (
              <option key={x} value={x}>
                {KIND_LABEL[x]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Audience
          <select
            className={inputClass('min-w-40')}
            value={audience ?? ''}
            onChange={(e) => url.patch({ audience: e.target.value || null, page: null })}
          >
            <option value="">Any</option>
            {NOTIFICATION_AUDIENCES.map((x) => (
              <option key={x} value={x}>
                {AUDIENCE_LABEL[x]}
              </option>
            ))}
          </select>
        </label>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              url.patch({ q: null, tab: null, kind: null, audience: null, page: null });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <Card>
        <DataTable
          caption="Notifications"
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(r) => r.id}
          onActivate={(r) => router.push(`${base}/${r.id}`)}
          rowHref={(r) => `${base}/${r.id}`}
          activateLabel={(r) => `Open ${r.title}`}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what="Notifications" onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<Bell aria-hidden className="size-5" />}
              title={filtered ? 'Nothing matches' : 'No notifications yet'}
            >
              {filtered
                ? 'Try another tab or search.'
                : canAdd
                  ? 'Send the first message or promotion.'
                  : 'Notifications sent to your zones appear here.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['notification', 'notifications']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>

      {composing ? (
        <NotificationComposer
          role={role}
          zones={zones}
          onClose={() => {
            setComposing(false);
            if (url.params.get('new')) url.patch({ new: null });
          }}
          onSaved={(id) => router.push(`${base}/${id}`)}
        />
      ) : null}
    </div>
  );
}
