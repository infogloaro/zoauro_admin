'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, FileDown, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { isApiError, TRY_AGAIN } from '../../features/auth/errors';
import { useApiClient } from '../../lib/api-client';
import { Button } from '../ui/button';

// List exports (D149): start a CSV export of what the list shows (same filters, same zone scope; contacts masked), then
// follow the job (GET /exports/{id}) until its signed download link is ready (valid 24 h). The API enforces the
// <module>:export permission and, for a Zonal Admin, the zone's export switch; at most 3 exports in progress.

const POLL_MS = 2_000;

export function ExportButton({
  start,
  label = 'Export CSV',
}: {
  /** starts the export with the list's current filters; resolves to the job */
  start: () => Promise<{ id: string }>;
  label?: string;
}) {
  const client = useApiClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const job = useQuery({
    queryKey: ['exports', jobId],
    enabled: jobId !== null,
    queryFn: ({ signal }) => client.get('/exports/{id}', { params: { id: jobId ?? '' }, signal }),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'QUEUED' || s === 'RUNNING' || s === undefined ? POLL_MS : false;
    },
  });
  const status = job.data?.status;

  if (jobId && status === 'READY' && job.data?.downloadUrl)
    return (
      <span className="flex items-center gap-2 text-sm">
        <a
          href={job.data.downloadUrl}
          className="inline-flex items-center gap-1.5 font-medium text-primary-strong hover:underline"
        >
          <Download aria-hidden className="size-4" /> Download CSV (
          {job.data.rowCount.toLocaleString('en-IN')} rows)
        </a>
        <button
          type="button"
          className="text-xs text-muted hover:underline"
          onClick={() => setJobId(null)}
        >
          New export
        </button>
      </span>
    );

  const working =
    starting ||
    (jobId !== null && (status === undefined || status === 'QUEUED' || status === 'RUNNING'));
  const failed = jobId !== null && (status === 'FAILED' || status === 'EXPIRED' || job.isError);

  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        disabled={working}
        onClick={async () => {
          setError(null);
          setStarting(true);
          try {
            const j = await start();
            setJobId(j.id);
          } catch (err) {
            setError(
              isApiError(err, 'FORBIDDEN')
                ? 'Exports are not allowed for you here.'
                : isApiError(err)
                  ? err.message || TRY_AGAIN
                  : TRY_AGAIN,
            );
          } finally {
            setStarting(false);
          }
        }}
      >
        {working ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <FileDown aria-hidden className="size-4" />
        )}
        {working ? 'Preparing…' : label}
      </Button>
      {error || failed ? (
        <span role="alert" className="text-xs text-danger">
          {error ?? 'The export failed. Try again.'}
        </span>
      ) : null}
    </span>
  );
}
