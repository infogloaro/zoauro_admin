'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OnboardingAgeLevel, OnboardingItem, OnboardingStage } from '@zoauro/shared';
import { ClipboardList } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DataTable, RowActivator, type Column } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import {
  Pagination,
  pageFromParam,
  DEFAULT_LIST_PAGE_SIZE,
} from '../../components/shared/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { FormAlert } from '../../components/ui/field';
import { inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { useUrlState } from '../../lib/url-state';
import { cn } from '../../lib/utils';
import { selectedZone, type ScopeZone } from '../../lib/zone-scope';
import { retryTransient } from '../audit/useAuditLogs';
import { useClaimsFor } from '../claims/api';
import { ClaimBadge } from '../claims/ClaimBadge';
import { CardError, EmptyState } from '../dashboard/parts';
import { useZoneOptions } from '../platform-settings/api';
import {
  AGE_LABEL,
  AGE_TONE,
  STAGE_LABEL,
  STAGE_TONE,
  TYPE_LABEL,
  TYPE_TABS,
  ageText,
  pickAge,
  pickStage,
  recordHref,
  typeTabFromParam,
} from './labels';
import { MoreInfoDialog } from './MoreInfoDialog';
import type { OnboardingPageProps } from './onboarding-page-props';
import { onboardingProblem, startReview } from './record-actions';

// Vendor Onboarding (D170; owner's A2 + A3; demo act 4): one queue for restaurants, shops, Home Food and hotels. Type
// tabs and stage and age filters with counts, search, the zone switcher, oldest in stage first, 25 a page, all in the
// URL. "Start review" claims the record (D174) and opens it; "Ask for more info" sends a message to the vendor app and
// the row waits for the vendor; the decision is made on the record's page (Verify / Reject).

const STAGES: readonly OnboardingStage[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'MORE_INFO_REQUIRED',
  'DECIDED',
];
const AGES: readonly OnboardingAgeLevel[] = ['OK', 'WARN', 'LATE'];

export function OnboardingPage({ role, myZones, canAct }: OnboardingPageProps) {
  const client = useApiClient();
  const qc = useQueryClient();
  const router = useRouter();
  const url = useUrlState();
  const { toast } = useToast();
  const superAdmin = role === 'SUPER_ADMIN';
  const allZones = useZoneOptions(superAdmin);
  const zones: ScopeZone[] = superAdmin
    ? (allZones.data?.data ?? []).map((z) => ({
        id: z.id,
        name: z.name,
        code: z.code,
        colorHex: z.colorHex,
      }))
    : myZones;
  const zoneCode = url.params.get('zone');
  const zone = selectedZone(zoneCode, zones);
  const waiting = superAdmin && zoneCode !== null && !allZones.data;
  const tab = typeTabFromParam(url.params.get('type'), superAdmin);
  const type = TYPE_TABS.find((t) => t.id === tab)?.type;
  const stage = pickStage(url.params.get('stage'));
  const age = pickAge(url.params.get('age'));
  const q = url.params.get('q') ?? '';
  const page = pageFromParam(url.params.get('page'));
  const [search, setSearch] = useState(q);
  const [asking, setAsking] = useState<OnboardingItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  const filters = {
    page,
    pageSize: DEFAULT_LIST_PAGE_SIZE,
    ...(q ? { q } : {}),
    ...(zone ? { zoneId: [zone.id] } : {}),
    ...(type ? { type } : {}),
    ...(stage ? { stage } : {}),
    ...(age ? { age } : {}),
  };
  const list = useQuery({
    queryKey: ['onboarding', filters],
    enabled: !waiting,
    queryFn: ({ signal }) => client.get('/onboarding', { query: filters, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: retryTransient,
  });
  const counts = list.data?.meta.counts;

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  const review = async (r: OnboardingItem) => {
    setAlert(null);
    setBusyId(r.id);
    try {
      await startReview(client, r.module, r.id);
      toast({ title: `You are reviewing ${r.name}` });
      await qc.invalidateQueries({ queryKey: ['onboarding'] });
      router.push(recordHref(role, r.module, r.id));
    } catch (err) {
      setAlert(onboardingProblem(err));
    } finally {
      setBusyId(null);
    }
  };

  const showZone = superAdmin ? !zone : zones.length > 1 && !zone;
  const filtered = Boolean(q || stage || age || tab !== 'all');

  // who is reviewing each applicant (D174 claims): one lookup per record type, all at once
  const rows = list.data?.data ?? [];
  const idsOf = (m: OnboardingItem['module']) =>
    rows.filter((r) => r.module === m).map((r) => r.id);
  const claims = {
    restaurants: useClaimsFor('RESTAURANT', idsOf('restaurants')),
    homemakers: useClaimsFor('HOMEMAKER', idsOf('homemakers')),
    hotels: useClaimsFor('HOTEL', idsOf('hotels')),
  };

  const columns: Column<OnboardingItem>[] = [
    {
      id: 'name',
      header: 'Applicant',
      cell: (r, ctx) => (
        <div className="min-w-44">
          <RowActivator ctx={ctx} className="font-semibold">
            {r.name}
          </RowActivator>
          <p className="text-xs text-muted">
            {TYPE_LABEL[r.type]}
            {r.area ? ` · ${r.area}` : ''}
          </p>
          <ClaimBadge claim={claims[r.module].data?.get(r.id)} />
        </div>
      ),
    },
    ...(showZone
      ? [
          {
            id: 'zone',
            header: 'Zone',
            cell: (r: OnboardingItem) =>
              r.zone ? (
                <Badge tone="neutral">{r.zone.code}</Badge>
              ) : (
                <Badge tone="warning">No zone yet</Badge>
              ),
          },
        ]
      : []),
    {
      id: 'stage',
      header: 'Stage',
      cell: (r) => (
        <div className="flex max-w-64 min-w-0 flex-col items-start gap-1">
          <Badge tone={STAGE_TONE[r.stage]} dot>
            {STAGE_LABEL[r.stage]}
          </Badge>
          {r.stage === 'MORE_INFO_REQUIRED' && r.moreInfoMessage ? (
            // stays in the Stage cell (owner, 2026-10-22): two lines at most, the whole message on hover
            <span
              className="line-clamp-2 w-full text-xs break-words text-muted"
              title={r.moreInfoMessage}
            >
              Asked: “{r.moreInfoMessage}”
            </span>
          ) : null}
          {r.stage === 'DECIDED' ? (
            <span className="text-xs text-muted">
              {r.verificationStatus === 'VERIFIED'
                ? 'Verified'
                : r.verificationStatus === 'REJECTED'
                  ? 'Rejected'
                  : ''}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'age',
      header: 'In this stage',
      cell: (r) => (
        <Badge tone={AGE_TONE[r.ageLevel]}>
          {ageText(r.ageHours)}
          <span className="sr-only">, {AGE_LABEL[r.ageLevel].toLowerCase()}</span>
        </Badge>
      ),
    },
    ...(canAct
      ? [
          {
            id: 'actions',
            header: 'Actions',
            cell: (r: OnboardingItem) =>
              r.stage === 'DECIDED' ? (
                <span className="text-xs text-muted">Done</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {r.stage !== 'UNDER_REVIEW' ? (
                    <Button
                      size="sm"
                      disabled={busyId === r.id}
                      aria-label={`Start reviewing ${r.name}`}
                      onClick={() => void review(r)}
                    >
                      Start review
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Open ${r.name} to decide`}
                      onClick={() => router.push(recordHref(role, r.module, r.id))}
                    >
                      Decide
                    </Button>
                  )}
                  {r.stage === 'UNDER_REVIEW' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Ask ${r.name} for more information`}
                      onClick={() => setAsking(r)}
                    >
                      Ask for more info
                    </Button>
                  ) : null}
                </div>
              ),
          },
        ]
      : []),
  ];

  const chip = (selected: boolean) =>
    cn(
      'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-primary',
      selected
        ? 'border-primary bg-primary-soft font-semibold text-primary-strong'
        : 'border-line bg-surface hover:bg-surface-muted',
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Vendor Onboarding"
        crumbs={[
          { label: 'Dashboard', href: superAdmin ? '/super-admin/dashboard' : '/zone/dashboard' },
          { label: 'Requests & Approvals' },
          { label: 'Vendor Onboarding' },
        ]}
        description="Every restaurant, shop, Home Food and hotel application, oldest first. Start a review to take it (others see who is on it), ask the vendor for more information, then verify or reject on its page."
      />

      <div role="tablist" aria-label="Applicant type" className="flex flex-wrap gap-2">
        {TYPE_TABS.filter((t) => superAdmin || !t.sa).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            onClick={() => url.patch({ type: t.id === 'all' ? null : t.id, page: null })}
            className={chip(t.id === tab)}
          >
            {t.label}
            {t.type ? (
              <span className="tabular-nums text-xs text-muted">{counts?.type[t.type] ?? '—'}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <div role="group" aria-label="Stage" className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={!stage}
            onClick={() => url.patch({ stage: null, page: null })}
            className={chip(!stage)}
          >
            Open
          </button>
          {STAGES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={stage === s}
              onClick={() => url.patch({ stage: s, page: null })}
              className={chip(stage === s)}
            >
              {STAGE_LABEL[s]}
              <span className="tabular-nums text-xs text-muted">{counts?.stage[s] ?? '—'}</span>
            </button>
          ))}
        </div>
        <div role="group" aria-label="Waiting time" className="flex flex-wrap gap-2">
          {AGES.map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={age === a}
              onClick={() => url.patch({ age: age === a ? null : a, page: null })}
              className={chip(age === a)}
            >
              <span
                aria-hidden
                className={cn(
                  'size-2 rounded-full',
                  a === 'OK' ? 'bg-neutral-400' : a === 'WARN' ? 'bg-amber-500' : 'bg-red-500',
                )}
              />
              {AGE_LABEL[a]}
              <span className="tabular-nums text-xs text-muted">{counts?.age[a] ?? '—'}</span>
            </button>
          ))}
        </div>
      </div>

      <div role="search" aria-label="Find applicants" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-medium">
          Search
          <input
            type="search"
            className={inputClass()}
            placeholder="Name, phone or area"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              url.patch({ q: null, type: null, stage: null, age: null, page: null });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {alert ? <FormAlert>{alert}</FormAlert> : null}

      <Card>
        <DataTable
          caption="Vendor onboarding queue"
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(r) => r.id}
          onActivate={(r) => router.push(recordHref(role, r.module, r.id))}
          rowHref={(r) => recordHref(role, r.module, r.id)}
          activateLabel={(r) => `Open ${r.name}`}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what="The onboarding queue" onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<ClipboardList aria-hidden className="size-5" />}
              title={filtered ? 'Nothing matches' : 'Nothing waiting'}
            >
              {filtered
                ? 'Try another type, stage or search.'
                : 'New applications from the vendor app appear here.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['application', 'applications']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>

      {asking ? <MoreInfoDialog record={asking} onClose={() => setAsking(null)} /> : null}
    </div>
  );
}
