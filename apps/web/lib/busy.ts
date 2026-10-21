import { ApiError } from '@zoauro/api-client';

// 503 SERVICE_UNAVAILABLE (899e805): the API's way of saying "a short database hiccup, try again" rather than a fault.
// The query cache notes when a query last failed that way (app/providers.tsx), so an error panel that is not handed
// the error itself can still say the system is busy instead of "could not be loaded".

const BUSY_WINDOW_MS = 60_000;
let lastBusyAt = 0;

export const isBusyError = (err: unknown): boolean => err instanceof ApiError && err.status === 503;

/** QueryCache onError: remember a 503. */
export function noteQueryFailure(err: unknown, now: number = Date.now()): void {
  if (isBusyError(err)) lastBusyAt = now;
}

/**
 * How long a read waits before its one retry after a 503: the API sends Retry-After: 5 (9d5ad0b); ApiError does not
 * carry response headers yet, so the documented value is used. Other failures keep TanStack's backoff. Writes are
 * never retried (mutations have no retry).
 */
export const BUSY_RETRY_MS = 5_000;
export const queryRetryDelay = (attempt: number, err: unknown): number =>
  isBusyError(err) ? BUSY_RETRY_MS : Math.min(1_000 * 2 ** attempt, 30_000);

/** Did a query fail with 503 within the last minute? */
export const recentlyBusy = (now: number = Date.now()): boolean =>
  lastBusyAt > 0 && now - lastBusyAt < BUSY_WINDOW_MS;
