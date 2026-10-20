'use client';

import { DataTable, type Column } from '../../../components/shared/DataTable';
import { Badge } from '../../../components/ui/badge';
import { formatTimestamp } from '../format';
import { ErrorState, LoadMore } from './ActivityLogTable';
import type { SignInFilters } from './filters';
import { useSignIns } from './useSystemLogs';

type SignIn = NonNullable<ReturnType<typeof useSignIns>['data']>['pages'][number]['data'][number];

const utc = (iso: string): string =>
  `${new Date(iso).toISOString().replace('T', ' ').slice(0, 19)} UTC`;

/** Sign-in attempts of all admins (login_history). Not clickable: a row has no detail beyond its columns. */
export function SignInsTable({
  filters,
  timeZone,
  narrowed,
  onReset,
}: {
  filters: SignInFilters;
  timeZone: string;
  narrowed: boolean;
  onReset: () => void;
}) {
  const query = useSignIns(filters);
  const rows = query.data?.pages.flatMap((p) => p.data) ?? [];

  const columns: Column<SignIn>[] = [
    {
      id: 'time',
      header: 'Time',
      className: 'whitespace-nowrap',
      cell: (r) => (
        // nothing here is interactive, so no tooltip: the UTC time is the title (mouse) and hidden text (screen readers)
        <time dateTime={r.createdAt} title={utc(r.createdAt)}>
          {formatTimestamp(r.createdAt, timeZone)}
          <span className="sr-only"> ({utc(r.createdAt)})</span>
        </time>
      ),
    },
    { id: 'email', header: 'Account', cell: (r) => r.emailAttempted },
    {
      id: 'result',
      header: 'Result',
      cell: (r) =>
        r.success ? <Badge tone="success">Successful</Badge> : <Badge tone="danger">Failed</Badge>,
    },
    { id: 'reason', header: 'Reason', cell: (r) => r.reason ?? '—' },
    { id: 'ip', header: 'IP address', cell: (r) => r.ip ?? '—' },
    {
      id: 'device',
      header: 'Device',
      cell: (r) => <span className="line-clamp-2 break-words">{r.userAgent ?? '—'}</span>,
    },
  ];

  return (
    <DataTable
      caption="Sign-in history"
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      status={query.isPending ? 'loading' : query.isError && !query.data ? 'error' : 'ready'}
      busy={query.isPlaceholderData}
      error={
        <ErrorState
          title="Could not load the sign-in history."
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      }
      empty={
        <div className="flex flex-col items-center gap-3 text-sm">
          <p>{narrowed ? 'No sign-ins match these filters.' : 'No sign-ins in this period.'}</p>
          {narrowed ? (
            <button
              type="button"
              onClick={onReset}
              className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              Reset filters
            </button>
          ) : null}
        </div>
      }
      footer={
        <LoadMore
          hasNext={query.hasNextPage}
          fetching={query.isFetchingNextPage}
          failed={query.isFetchNextPageError}
          onLoad={() => void query.fetchNextPage()}
        />
      }
    />
  );
}
