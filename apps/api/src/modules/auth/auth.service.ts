import type { LoginInput, Me } from '@zoauro/shared';
import { type AuthContext } from '../../lib/auth-context';
import { generateToken, sha256 } from '../../lib/cookies';
import { errors } from '../../lib/errors';
import { rateLimit } from '../../lib/rate-limit';
import { verifyPassword } from '../../lib/passwords';
import {
  createSession,
  findUserByEmailWithRole,
  findUserByIdWithRole,
  recordLoginFailure,
  recordLoginHistory,
  recordLoginSuccess,
  revokeOldestSessionsOverLimit,
  revokeSession,
  setReauthenticatedAt,
  type UserWithRole,
} from './auth.repository';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 30 * 60 * 1000; // doc 14 §2 / D37
export const MAX_SESSIONS_PER_USER = 3;
export const LOGIN_RATE_LIMIT = { limit: 5, windowMs: 60_000 }; // doc 09 rate limits

const INVALID_CREDENTIALS = 'Invalid email or password';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface LoginResult {
  token: string;
  csrfToken: string;
  maxAgeSeconds: number;
  user: Me;
  mustChangePassword: boolean;
}

function toMe(user: UserWithRole): Me {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role.name,
    isSuperAdmin: user.role.name === 'SUPER_ADMIN',
    zones: [],
  };
}

function genericInvalidCredentials(): Error {
  return errors.unauthenticated(INVALID_CREDENTIALS);
}

export async function login(input: LoginInput, meta: RequestMeta): Promise<LoginResult> {
  if (
    meta.ip &&
    !rateLimit(`login:ip:${meta.ip}`, LOGIN_RATE_LIMIT.limit, LOGIN_RATE_LIMIT.windowMs).allowed
  ) {
    throw errors.rateLimited('Too many login attempts, please try again in a minute');
  }
  const email = input.email.toLowerCase();
  if (
    !rateLimit(`login:account:${email}`, LOGIN_RATE_LIMIT.limit, LOGIN_RATE_LIMIT.windowMs).allowed
  ) {
    throw errors.rateLimited('Too many login attempts, please try again in a minute');
  }

  const user = await findUserByEmailWithRole(email);
  if (!user || user.status !== 'ACTIVE') {
    await recordLoginHistory({
      userId: user?.id ?? null,
      emailAttempted: email,
      success: false,
      ip: meta.ip,
      userAgent: meta.userAgent,
      reason: 'unknown_or_inactive',
    });
    throw genericInvalidCredentials();
  }

  // Login card tab is a UI selector; a mismatch answers with the same generic error (doc 14 §3).
  if (user.role.name !== input.role) {
    await recordLoginHistory({
      userId: user.id,
      emailAttempted: email,
      success: false,
      ip: meta.ip,
      userAgent: meta.userAgent,
      reason: 'role_tab_mismatch',
    });
    throw genericInvalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw errors.rateLimited(
      `Account temporarily locked after too many failed attempts. Try again in ${minutes} minute(s).`,
    );
  }

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    const failedAttempts = user.failedAttempts + 1;
    const lockedUntil =
      failedAttempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_DURATION_MS) : null;
    await recordLoginFailure(user.id, failedAttempts, lockedUntil);
    await recordLoginHistory({
      userId: user.id,
      emailAttempted: email,
      success: false,
      ip: meta.ip,
      userAgent: meta.userAgent,
      reason: 'bad_password',
    });
    throw genericInvalidCredentials();
  }

  await recordLoginSuccess(user.id);
  await revokeOldestSessionsOverLimit(user.id, MAX_SESSIONS_PER_USER);

  const token = generateToken();
  const csrfToken = generateToken();
  const maxAgeSeconds = input.rememberMe ? 7 * 24 * 60 * 60 : 12 * 60 * 60; // doc 14 §2
  await createSession({
    userId: user.id,
    tokenHash: sha256(token),
    csrfToken,
    ip: meta.ip,
    userAgent: meta.userAgent,
    expiresAt: new Date(Date.now() + maxAgeSeconds * 1000),
    absoluteExpiresAt: new Date(Date.now() + maxAgeSeconds * 1000),
    reauthenticatedAt: new Date(),
  });
  await recordLoginHistory({
    userId: user.id,
    emailAttempted: email,
    success: true,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return {
    token,
    csrfToken,
    maxAgeSeconds,
    user: toMe(user),
    mustChangePassword: user.mustChangePassword,
  };
}

export async function logout(sessionId: string): Promise<void> {
  await revokeSession(sessionId);
}

export async function me(auth: AuthContext): Promise<Me> {
  const user = await findUserByIdWithRole(auth.userId);
  if (!user || user.status !== 'ACTIVE') {
    throw errors.unauthenticated('Account is no longer active');
  }
  return toMe(user);
}

/** Confirms the member's password for a high-risk action (doc 14 §4). */
export async function reauth(
  auth: AuthContext,
  password: string,
  meta: RequestMeta,
): Promise<void> {
  if (
    meta.ip &&
    !rateLimit(`reauth:ip:${meta.ip}`, LOGIN_RATE_LIMIT.limit, LOGIN_RATE_LIMIT.windowMs).allowed
  ) {
    throw errors.rateLimited('Too many attempts, please try again in a minute');
  }
  if (
    !rateLimit(`reauth:user:${auth.userId}`, LOGIN_RATE_LIMIT.limit, LOGIN_RATE_LIMIT.windowMs)
      .allowed
  ) {
    throw errors.rateLimited('Too many attempts, please try again in a minute');
  }
  const user = await findUserByIdWithRole(auth.userId);
  if (!user || user.status !== 'ACTIVE' || !(await verifyPassword(user.passwordHash, password))) {
    throw errors.unauthenticated(INVALID_CREDENTIALS);
  }
  await setReauthenticatedAt(auth.sessionId, new Date());
}
