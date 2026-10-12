// Authentication numbers (doc 14 section 2). Editable in Settings > Security later (D37); constants until the
// settings module exists. Injected into the services so tests can use their own values.

export interface AuthConfig {
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
  maxFailedAttempts: number;
  lockDurationMs: number;
  resetTokenTtlMs: number;
  /** "recent re-authentication ... within 10 min" (doc 14 section 4) */
  reauthWindowMs: number;
  /** DB last_seen_at is written at most this often per session */
  lastSeenWriteIntervalMs: number;
  loginLimitPerIp: { limit: number; windowSec: number };
  loginLimitPerEmail: { limit: number; windowSec: number };
  forgotLimitPerIp: { limit: number; windowSec: number };
  forgotLimitPerEmail: { limit: number; windowSec: number };
}

const MIN = 60 * 1000;

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  idleTimeoutMs: 30 * MIN,
  absoluteTimeoutMs: 12 * 60 * MIN,
  maxFailedAttempts: 5,
  lockDurationMs: 30 * MIN,
  resetTokenTtlMs: 30 * MIN,
  reauthWindowMs: 10 * MIN,
  lastSeenWriteIntervalMs: MIN,
  loginLimitPerIp: { limit: 30, windowSec: 60 },
  loginLimitPerEmail: { limit: 10, windowSec: 60 },
  forgotLimitPerIp: { limit: 10, windowSec: 60 },
  forgotLimitPerEmail: { limit: 3, windowSec: 15 * 60 },
};

/** Session cookie name (doc 52 section 2.6). */
export const SESSION_COOKIE = 'zo_sid';
/** Pre-session CSRF cookie (double submit) for POSTs made before a session exists: login, password reset, 2-step. */
export const PRE_SESSION_CSRF_COOKIE = 'zo_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export type Clock = () => Date;
