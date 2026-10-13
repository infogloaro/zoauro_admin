'use client';

import { Suspense, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../../../components/shared/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip';
import { useUrlState } from '../../../lib/url-state';
import { AuditDetailDrawer } from '../AuditDetailDrawer';
import { DEFAULT_TIME_ZONE } from '../format';
import { ActivityLogTable } from './ActivityLogTable';
import {
  hasActivityNarrowing,
  hasSignInNarrowing,
  readActivityFilters,
  readSignInFilters,
  readTab,
  type LogsTab,
} from './filters';
import { ActivityFilterBar, SignInFilterBar } from './LogsFilters';
import { SignInsTable } from './SignInsTable';

// Settings > System Logs (doc 50 section 9.1). Super Admin only: the route's server component decides who gets here, and
// the API refuses everyone else regardless. Every filter lives in the URL.

/** Pages that belong to other modules. Until they exist the link is shown disabled, with the reason in a tooltip. */
const RELATED_LINKS = [
  {
    label: 'Access change history',
    href: '/super-admin/access/history',
    available: false,
    reason: 'Available once the Access Control screens are built.',
  },
  {
    label: 'Integration events',
    href: '/super-admin/settings/integrations',
    available: false,
    reason: 'Available once the Integration Hub is built.',
  },
] as const;

function RelatedLinks() {
  return (
    <nav aria-label="Related logs" className="flex flex-wrap gap-4 text-sm">
      {RELATED_LINKS.map((l) =>
        l.available ? (
          <a
            key={l.href}
            href={l.href}
            className="font-medium text-primary-strong underline-offset-2 hover:underline"
          >
            {l.label}
          </a>
        ) : (
          <Tooltip key={l.href}>
            <TooltipTrigger asChild>
              <span
                role="link"
                aria-disabled="true"
                tabIndex={0}
                className="cursor-not-allowed text-neutral-500 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {l.label}
              </span>
            </TooltipTrigger>
            <TooltipContent>{l.reason}</TooltipContent>
          </Tooltip>
        ),
      )}
    </nav>
  );
}

function SystemLogs({ timeZone }: { timeZone: string }) {
  const { params, patch, replace } = useUrlState();
  const query = params.toString(); // filters are recomputed only when the URL really changes
  const tab = readTab(params);
  const now = useMemo(() => new Date(), []);
  const activity = useMemo(
    () => readActivityFilters(new URLSearchParams(query), now),
    [query, now],
  );
  const signIns = useMemo(() => readSignInFilters(new URLSearchParams(query), now), [query, now]);

  const [openId, setOpenId] = useState<string | null>(null);
  const lastOpened = useRef<string | null>(null);
  const region = useRef<HTMLDivElement>(null);

  const switchTab = (next: string) => {
    // the date range follows the user across tabs; every other filter belongs to its tab
    const keep: Record<string, string> = { tab: next };
    for (const k of ['from', 'to'] as const) if (params.has(k)) keep[k] = params.get(k) ?? '';
    if (next === 'activity') delete keep['tab'];
    replace(keep);
  };
  const reset = (t: LogsTab) => replace(t === 'signins' ? { tab: 'signins' } : {});
  const open = (id: string) => {
    lastOpened.current = id;
    setOpenId(id);
  };

  return (
    // inside the shell, whose <main> already wraps the page: one main landmark (P17)
    <div className="flex flex-col gap-4" ref={region}>
      <PageHeader
        title="System Logs"
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Administration' },
          { label: 'Audit & Logs' },
        ]}
        description={
          <span className="flex flex-col gap-2">
            Who did what, when and where: every change and every sign-in, with filters you can
            share.
            <RelatedLinks />
          </span>
        }
      />

      <Tabs value={tab} onValueChange={switchTab}>
        <TabsList aria-label="Log type">
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="signins">Sign-ins</TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="flex flex-col gap-4">
          <ActivityFilterBar filters={activity} patch={patch} onReset={() => reset('activity')} />
          <ActivityLogTable
            filters={activity}
            timeZone={timeZone}
            narrowed={hasActivityNarrowing(activity, now)}
            onOpen={open}
            onReset={() => reset('activity')}
          />
        </TabsContent>

        <TabsContent value="signins" className="flex flex-col gap-4">
          <SignInFilterBar filters={signIns} patch={patch} onReset={() => reset('signins')} />
          <SignInsTable
            filters={signIns}
            timeZone={timeZone}
            narrowed={hasSignInNarrowing(signIns, now)}
            onReset={() => reset('signins')}
          />
        </TabsContent>
      </Tabs>

      <AuditDetailDrawer
        id={openId}
        timeZone={timeZone}
        onClose={() => setOpenId(null)}
        onCloseAutoFocus={(event) => {
          // back to the row's button that opened the drawer
          event.preventDefault();
          region.current
            ?.querySelector<HTMLElement>(`[data-row-activate="${lastOpened.current ?? ''}"]`)
            ?.focus();
        }}
        shortcuts={{
          onMoreFromActor: (e) => {
            setOpenId(null);
            patch({ actor: e.actor.id, actorName: e.actor.name });
          },
          onMoreForRecord: (e) => {
            setOpenId(null);
            patch({ entityType: e.entity.type, entityId: e.entity.id });
          },
        }}
      />
    </div>
  );
}

export function SystemLogsPage({ timeZone = DEFAULT_TIME_ZONE }: { timeZone?: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      {/* useSearchParams needs a Suspense boundary in the App Router */}
      <Suspense
        fallback={
          <p role="status" className="p-6 text-sm">
            Loading…
          </p>
        }
      >
        <SystemLogs timeZone={timeZone} />
      </Suspense>
    </TooltipProvider>
  );
}
