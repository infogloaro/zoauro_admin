import { ApiError, type ApiClient } from '@zoauro/api-client';
import { DEFAULT_SECURITY_POLICY } from '@zoauro/shared';
import { ensurePreSessionCsrf, setCsrfToken } from '../../lib/csrf';

// Messages of the sign-in screens. Doc 52 section 2.1 rule 3 and 4: one generic text for every sign-in failure (wrong
// password, wrong tab, unknown, locked or inactive account) and one for every failed code. The API never says which.

export const GENERIC_SIGN_IN_ERROR = 'The email or password is not correct.';
export const GENERIC_CODE_ERROR = 'That code didn’t work. Check it and try again.';
export const SIGN_IN_ENDED = 'Your sign-in has ended. Sign in again.';
export const TRY_AGAIN = 'Something went wrong. Try again.';
/** 503 SERVICE_UNAVAILABLE (899e805): a short database hiccup the API tells apart from a failure; retrying works. */
export const BUSY = 'The system is busy. Please try again in a moment.';

const { maxAttempts, lockMinutes } = DEFAULT_SECURITY_POLICY.lockout;
/**
 * Shown after repeated failures (owner's decision, doc 32): the API hides whether an account is locked, so the screen
 * explains the rule instead of an unlock time.
 */
export const LOCK_POLICY_HINT = `After ${maxAttempts} failed attempts the account is locked for ${lockMinutes} minutes.`;

export const isApiError = (err: unknown, code?: string): err is ApiError =>
  err instanceof ApiError && (code === undefined || err.code === code);

/** The text for a failure nothing more specific explains: busy on a 503, otherwise the generic one. */
export const failureText = (err: unknown): string =>
  isApiError(err, 'SERVICE_UNAVAILABLE') ? BUSY : TRY_AGAIN;

export function signInErrorMessage(err: unknown): string {
  if (isApiError(err, 'RATE_LIMITED'))
    return 'Too many attempts from here. Wait a few minutes and try again.';
  if (isApiError(err) && (err.status === 401 || err.status === 403)) return GENERIC_SIGN_IN_ERROR;
  return failureText(err);
}

/**
 * A failed code. The API ends the pending sign-in after too many wrong codes (D77) or when it expired, and says so only
 * in its message ("… Sign in again."), so that is what is checked.
 */
export function codeFailure(err: unknown): 'wrong' | 'ended' | 'rate-limited' | 'other' {
  if (isApiError(err, 'RATE_LIMITED')) return 'rate-limited';
  if (isApiError(err, 'UNAUTHENTICATED'))
    return /sign in again/i.test(err.message) ? 'ended' : 'wrong';
  if (isApiError(err, 'VALIDATION_ERROR')) return 'wrong';
  return 'other';
}

/** Field errors from a 422 envelope, keyed by the first path segment. */
export function fieldErrors(err: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isApiError(err, 'VALIDATION_ERROR')) return out;
  for (const d of err.details) {
    const key = d.field.split('.')[0] ?? d.field;
    out[key] ??= d.issue;
  }
  return out;
}

/**
 * A pre-session POST (login, 2-step, enrolment, forgot/reset password). If the zo_csrf cookie expired while the page was
 * open, the API answers 403; a fresh token is fetched once and the call is repeated.
 */
export async function preSession<T>(client: ApiClient, call: () => Promise<T>): Promise<T> {
  await ensurePreSessionCsrf(client);
  try {
    return await call();
  } catch (err) {
    // only the CSRF refusal; other 403s (for example "confirm your email first") are answers, not retries
    if (!isApiError(err, 'FORBIDDEN') || !/csrf/i.test(err.message)) throw err;
    setCsrfToken(undefined);
    await ensurePreSessionCsrf(client);
    return call();
  }
}
