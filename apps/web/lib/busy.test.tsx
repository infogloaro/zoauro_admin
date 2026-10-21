// @vitest-environment jsdom
import { ApiError } from '@zoauro/api-client';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BUSY, failureText, signInErrorMessage, TRY_AGAIN } from '../features/auth/errors';
import { CardError } from '../features/dashboard/parts';
import { retryTransient } from '../features/audit/useAuditLogs';
import { isBusyError, noteQueryFailure, queryRetryDelay, recentlyBusy } from './busy';

// 503 SERVICE_UNAVAILABLE (899e805, a transient database problem): sign-in and error panels say the system is busy
// rather than "something went wrong" (coordinator, demo).

afterEach(cleanup);

const busy = new ApiError(
  503,
  'SERVICE_UNAVAILABLE',
  'The service is busy. Try again in a few seconds',
);
const boom = new ApiError(500, 'INTERNAL', 'Internal error');

describe('busy (503)', () => {
  it('sign-in and code screens: busy for a 503, the generic text otherwise', () => {
    expect(signInErrorMessage(busy)).toBe(BUSY);
    expect(failureText(busy)).toBe(BUSY);
    expect(failureText(boom)).toBe(TRY_AGAIN);
    expect(signInErrorMessage(new ApiError(401, 'UNAUTHENTICATED', 'No'))).toMatch(/not correct/);
  });

  it('a busy read is retried once, after the API’s Retry-After of 5 s; other failures keep their backoff', () => {
    expect(retryTransient(0, busy)).toBe(true);
    expect(retryTransient(1, busy)).toBe(false);
    expect(retryTransient(1, boom)).toBe(true);
    expect(retryTransient(0, new ApiError(404, 'NOT_FOUND', 'No'))).toBe(false);
    expect(queryRetryDelay(0, busy)).toBe(5_000);
    expect(queryRetryDelay(1, boom)).toBe(2_000);
  });

  it('a 503 is remembered for a minute', () => {
    expect(isBusyError(busy)).toBe(true);
    expect(isBusyError(boom)).toBe(false);
    noteQueryFailure(boom, 1_000);
    expect(recentlyBusy(2_000)).toBe(false);
    noteQueryFailure(busy, 10_000);
    expect(recentlyBusy(20_000)).toBe(true);
    expect(recentlyBusy(80_000)).toBe(false);
  });

  it('an error panel says busy for a 503 it is given, plain otherwise', () => {
    render(<CardError what="Orders" onRetry={() => undefined} error={busy} />);
    expect(screen.getByRole('alert').textContent).toContain('the system is busy');
    cleanup();
    render(<CardError what="Orders" onRetry={() => undefined} error={boom} />);
    expect(screen.getByRole('alert').textContent).toContain('Orders could not be loaded.');
    expect(screen.getByRole('alert').textContent).not.toContain('busy');
  });
});
