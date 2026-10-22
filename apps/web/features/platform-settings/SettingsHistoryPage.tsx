'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { SETTING_GROUPS, SETTINGS, settingDef, type SettingGroup } from '@zoauro/shared';
import { Clock, History, Settings } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Button, buttonClass } from '../../components/ui/button';
import { Card, CardBody } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { useApiClient } from '../../lib/api-client';
import { useUrlState } from '../../lib/url-state';
import { retryTransient } from '../audit/useAuditLogs';
import { CardError, CardSkeleton, EmptyState } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { useSuperAdmins } from '../access/super-admins/api';
import { useZoneOptions } from './api';
import { describeValue } from './fields';
import { readHistoryFilters, toIstBounds } from './history-filters';
import { GROUP_LABEL } from './PlatformSettingsPage';

// Settings History (owner's spec 2.9): every saved, reset or zone-level setting change from the append-only audit trail,
// newest first, with before and after (the API redacts anything secret), scope, who, why and when. Filters live in the
// URL (?group, ?key, ?zone=<CODE>, ?actor, ?from, ?to as India-time days). Read-only: history can never be edited here.

const isGroup = (v: string | null): v is SettingGroup =>
  v !== null && (SETTING_GROUPS as readonly string[]).includes(v);

export function SettingsHistoryPage() {
  const client = useApiClient();
  const url = useUrlState();
  const group = isGroup(url.params.get('group')) ? (url.params.get('group') as SettingGroup) : null;
  const key = url.params.get('key');
  const zoneCode = url.params.get('zone');
  const zones = useZoneOptions();
  const zone = zoneCode ? zones.data?.data.find((z) => z.code === zoneCode) : undefined;
  const waitingForZone = Boolean(zoneCode) && !zones.data;
  const { actorId, from, to } = readHistoryFilters(url.params);
  // who may have changed settings: every Super Admin, plus anyone already seen in the loaded rows
  const admins = useSuperAdmins();
  const query = {
    ...(group ? { group } : {}),
    ...(key && settingDef(key) ? { key } : {}),
    ...(zone ? { zoneId: zone.id } : {}),
    ...(actorId ? { actorId } : {}),
    ...toIstBounds(from, to),
    limit: 25,
  };

  const history = useInfiniteQuery({
    queryKey: ['settings', 'history', query],
    enabled: !waitingForZone,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.get('/settings/history', {
        query: { ...query, ...(pageParam ? { after: pageParam } : {}) },
        signal,
      }),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    staleTime: 15_000,
    retry: retryTransient,
  });
  const rows = history.data?.pages.flatMap((p) => p.data) ?? [];
  const filtered = Boolean(group || key || zoneCode || actorId || from || to);
  const actors = new Map<string, string>();
  for (const a of admins.data?.data ?? []) actors.set(a.id, a.name);
  for (const r of rows) if (r.actor.id) actors.set(r.actor.id, r.actor.name);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings History"
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Platform Settings', href: '/super-admin/settings/platform' },
          { label: 'History' },
        ]}
        description="Every setting change: what changed, for the platform or a zone, who changed it, why and when."
        actions={
          <a href="/super-admin/settings/platform" className={buttonClass('secondary')}>
            <Settings aria-hidden className="size-4" /> Platform Settings
          </a>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Group
          <select
            className={inputClass('min-w-44')}
            value={group ?? ''}
            onChange={(e) => url.patch({ group: e.target.value || null, key: null })}
          >
            <option value="">All groups</option>
            {SETTING_GROUPS.map((g) => (
              <option key={g} value={g}>
                {GROUP_LABEL[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Setting
          <select
            className={inputClass('min-w-56')}
            value={key ?? ''}
            onChange={(e) => url.patch({ key: e.target.value || null })}
          >
            <option value="">All settings</option>
            {SETTINGS.filter((s) => !group || s.group === group).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Zone
          <select
            className={inputClass('min-w-56')}
            value={zoneCode ?? ''}
            onChange={(e) => url.patch({ zone: e.target.value || null })}
          >
            <option value="">Platform and every zone</option>
            {(zones.data?.data ?? []).map((z) => (
              <option key={z.id} value={z.code}>
                {z.name} ({z.code})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Changed by
          <select
            className={inputClass('min-w-48')}
            value={actorId ?? ''}
            onChange={(e) => url.patch({ actor: e.target.value || null })}
          >
            <option value="">Anyone</option>
            {[...actors].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          From
          <input
            type="date"
            className={inputClass()}
            value={from ?? ''}
            max={to ?? undefined}
            onChange={(e) => url.patch({ from: e.target.value || null })}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          To
          <input
            type="date"
            className={inputClass()}
            value={to ?? ''}
            min={from ?? undefined}
            onChange={(e) => url.patch({ to: e.target.value || null })}
          />
        </label>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() =>
              url.patch({ group: null, key: null, zone: null, actor: null, from: null, to: null })
            }
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {history.isError ? (
        <CardError what="Settings history" onRetry={() => void history.refetch()} />
      ) : !history.data ? (
        <CardSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<History aria-hidden className="size-5" />}
              title={
                filtered ? 'No changes match these filters' : 'No setting has been changed yet'
              }
            >
              Until a Super Admin saves a value, every setting follows its decided default.
            </EmptyState>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <ol className="divide-y divide-line" aria-label="Setting changes">
              {rows.map((r) => {
                const def = r.key ? settingDef(r.key) : undefined;
                const before = r.key ? describeValue(r.key, r.before) : [];
                const after = r.key ? describeValue(r.key, r.after) : [];
                const changed = after.filter((row, i) => before[i]?.text !== row.text);
                return (
                  <li key={r.id} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold">
                        {r.actionLabel}: {def?.label ?? r.key ?? 'Settings'}
                        <span className="font-normal text-muted">
                          {' '}
                          · {r.zone ? (r.zone.name ?? 'a deleted zone') : 'Whole platform'}
                        </span>
                      </p>
                      <time
                        dateTime={r.createdAt}
                        title={new Date(r.createdAt).toLocaleString('en-IN', {
                          timeZone: 'Asia/Kolkata',
                        })}
                        className="flex items-center gap-1 text-xs text-muted"
                      >
                        <Clock aria-hidden className="size-3" />
                        {relativeTime(r.createdAt)}
                      </time>
                    </div>
                    <p className="text-xs text-muted">
                      By {r.actor.name}
                      {r.reason ? ` · “${r.reason}”` : ''}
                    </p>
                    {changed.length > 0 ? (
                      <dl className="grid gap-1 text-sm">
                        {changed.map((row) => (
                          <div key={row.label} className="flex flex-wrap gap-x-2">
                            <dt className="text-muted">{row.label}:</dt>
                            <dd>
                              <span className="text-muted line-through">
                                {before.find((b) => b.label === row.label)?.text ?? '—'}
                              </span>{' '}
                              → <span className="font-medium">{row.text}</span>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            {history.hasNextPage ? (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="secondary"
                  onClick={() => void history.fetchNextPage()}
                  disabled={history.isFetchingNextPage}
                >
                  Load older changes
                </Button>
              </div>
            ) : null}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
