// Authentication numbers (doc 14 section 2). Editable in Settings > Security later (D37); constants until the
// settings module exists. Injected into the services so tests can use their own values.

export interface AuthConfig {
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
  /** "remember me" (D79, doc 52 section 2.6): absolute 7 days, idle 8 hours */
  rememberAbsoluteTimeoutMs: number;
  rememberIdleTimeoutMs: number;
  /** at most this many active sessions per user; the oldest is revoked on the next login (doc 14 section 2) */
  maxSessions: number;
  maxFailedAttempts: number;
  lockDurationMs: number;
  resetTokenTtlMs: number;
  /** "recent re-authentication ... within 10 min" (doc 14 section 4) */
  reauthWindowMs: number;
  /** STRONG re-authentication (doc 52 section 2.4, D74): 5 minutes and a single action */
  strongReauthWindowMs: number;
  /** DB last_seen_at is written at most this often per session */
  lastSeenWriteIntervalMs: number;
  loginLimitPerIp: { limit: number; windowSec: number };
  loginLimitPerEmail: { limit: number; windowSec: number };
  forgotLimitPerIp: { limit: number; windowSec: number };
  forgotLimitPerEmail: { limit: number; windowSec: number };
  /** doc 52 section 8: /auth/mfa/verify 30 per 15 minutes per IP (the pending login itself ends at the lockout) */
  mfaVerifyLimitPerIp: { limit: number; windowSec: number };
}

const MIN = 60 * 1000;

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  idleTimeoutMs: 30 * MIN,
  absoluteTimeoutMs: 12 * 60 * MIN,
  rememberAbsoluteTimeoutMs: 7 * 24 * 60 * MIN,
  rememberIdleTimeoutMs: 8 * 60 * MIN,
  maxSessions: 3,
  maxFailedAttempts: 5,
  lockDurationMs: 30 * MIN,
  resetTokenTtlMs: 30 * MIN,
  reauthWindowMs: 10 * MIN,
  strongReauthWindowMs: 5 * MIN,
  lastSeenWriteIntervalMs: MIN,
  loginLimitPerIp: { limit: 30, windowSec: 60 },
  loginLimitPerEmail: { limit: 10, windowSec: 60 },
  forgotLimitPerIp: { limit: 10, windowSec: 60 },
  forgotLimitPerEmail: { limit: 3, windowSec: 15 * 60 },
  mfaVerifyLimitPerIp: { limit: 30, windowSec: 15 * 60 },
};

/** Session cookie name (doc 52 section 2.6). */
export const SESSION_COOKIE = 'zo_sid';
/** Pre-session CSRF cookie (double submit) for POSTs made before a session exists: login, password reset, 2-step. */
export const PRE_SESSION_CSRF_COOKIE = 'zo_csrf';
export const CSRF_HEADER = 'x-csrf-token';
/** Pending login between password and second step (doc 52 section 2.1): not a session. */
export const PENDING_LOGIN_COOKIE = 'zo_mfa';

export type Clock = () => Date;
