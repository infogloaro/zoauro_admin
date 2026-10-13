import { AlertTriangle, Inbox, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';

/** Doc 22 §4 states: loading / empty / no results / error+retry. */

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-bg text-muted">
        <Inbox className="size-6" />
      </span>
      <p className="text-sm text-muted">{message}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  message,
  requestId,
  onRetry,
}: {
  message: string;
  requestId?: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 px-4 py-14 text-center"
      role="alert"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-[#fee2e2] text-danger">
        <AlertTriangle className="size-6" />
      </span>
      <p className="text-sm text-text">{message}</p>
      {requestId && <p className="text-xs text-muted">Request ID: {requestId}</p>}
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcw className="size-4" /> Retry
      </Button>
    </div>
  );
}
