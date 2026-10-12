import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  MeZone,
  SessionListItem,
  LoginInput,
  ReauthInput,
  ResetPasswordInput,
  Role,
} from '@zoauro/shared';
import { noteAuditNoop, record, recordMany, runWithAuditContext, uuidv7 } from '../../lib/audit';
import type { AuditActor, AuditEntry } from '../../lib/audit';
import type { Audit } from '../../lib/audit/audit.service';
import type { AuthConfig, Clock } from '../../lib/auth/config';
import type { AuthContext, ZoneLimits } from '../../lib/authz';
import {
  getDummyHash,
  hashPassword,
  randomToken,
  sha256Hex,
  verifyPassword,
} from '../../lib/auth/crypto';
import type { AuthSession, SessionStore } from '../../lib/auth/session-store';
import { AppError } from '../../lib/errors';
import type { RateLimiter } from '../../lib/rate-limiter';
import type { AuthMailer } from './auth.mails';
import type { AuthDatabase, AuthTx, AuthUser } from './auth.repository';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | undefined;
}

/** Mail is sent in the background: the response never waits for, or reveals, delivery. Bodies are never logged. */
function notify(send: Promise<void>, what: string, requestId: string | undefined): void {
  send.catch((err: unknown) =>
    console.error(
      `${what} mail failed (${err instanceof Error ? err.name : 'unknown'}) requestId=${requestId ?? '-'}`,
    ),
  );
}

export interface LoginResult {
  sessionToken: string;
  cookieMaxAgeSec: number;
  csrfToken: string;
  redirectTo: string;
  mustChangePassword: boolean;
  user: { id: string; name: string; email: string; role: Role };
}

export interface MeResult {
  user: { id: string; name: string; email: string; role: Role };
  mustChangePassword: boolean;
  csrfToken: string;
  permissions: { global: true } | { global: false; zones: MeZone[] };
  mfa: { enabled: boolean; required: boolean; enrolmentNeeded: boolean };
}

/** A zone assignment without limits of its own: nothing may be refunded, revealed or exported without approval. */
const NO_LIMITS: ZoneLimits = { perRefund: 0, dailyRefund: 0, canReveal: false, canExport: false };

const GENERIC_LOGIN_ERROR = 'Invalid email or password';
const UA_MAX = 300;
/** Failures that count toward the lockout. A locked, inactive or unknown account does not. */
const COUNTED_FAILURES = new Set(['BAD_PASSWORD', 'WRONG_TAB']);

const actorFor = (u: AuthUser): AuditActor => ({
  type: 'USER',
  id: u.id,
  name: u.name,
  role: u.roleName,
});

// Audit labels name the person, never their email (P3.3): the id is already in entity_id.
const userEntity = (u: AuthUser) => ({ type: 'user', id: u.id, label: u.name });
/** session.revoked: entity_id is the session, so the label carries the owner's name and user id. */
const sessionEntity = (sessionId: string, u: AuthUser) => ({
  type: 'session',
  id: sessionId,
  label: `${u.name} (${u.id})`,
});

const EMAIL_MAX = 254;
/**
 * login_history.email_attempted (P3.3): the account's address in lower case when the typed address belongs to a user;
 * otherwise only a mask (first character, then `***@***`), so a password typed into the email field is never stored.
 */
export function emailForHistory(matched: { email: string } | null, typed: string): string {
  if (matched) return matched.email.toLowerCase().slice(0, EMAIL_MAX);
  return typed.length === 0 ? '' : `${typed.slice(0, 1)}***@***`;
}

export class AuthService {
  constructor(
    private readonly deps: {
      db: AuthDatabase;
      sessions: SessionStore;
      limiter: RateLimiter;
      /** DENIED rows (doc 50 §4.3): own transaction, rate limited, never throws */
      audit: Pick<Audit, 'recordDenied'>;
      mailer: AuthMailer;
      config: AuthConfig;
      clock: Clock;
    },
  ) {}

  private get config(): AuthConfig {
    return this.deps.config;
  }

  /** Runs `fn` with `user` as the audit actor (also for flows without a signed-in user: lockout, forgot/reset). */
  private asUser<T>(user: AuthUser, meta: RequestMeta, fn: () => Promise<T>): Promise<T> {
    return runWithAuditContext(
      {
        actor: actorFor(user),
        ip: meta.ip ?? undefined,
        userAgent: meta.userAgent ?? undefined,
        requestId: meta.requestId,
      },
      fn,
    );
  }

  // ---- login ----------------------------------------------------------------------------------------------------

  async login(input: LoginInput, meta: RequestMeta): Promise<LoginResult> {
    await this.enforceLoginLimits(meta.ip, input.email);

    const user = await this.deps.db.repo.findUserByEmail(input.email);
    // Always verify something, so unknown accounts cost the same time as known ones.
    const passwordOk = await verifyPassword(
      user?.passwordHash ?? (await getDummyHash()),
      input.password,
    );
    const now = this.deps.clock();

    const reason = this.loginFailureReason(user, passwordOk, input.tab, now);
    if (reason !== null) {
      await this.recordLoginFailure(user, input.email, reason, meta, now);
      throw new AppError('UNAUTHENTICATED', GENERIC_LOGIN_ERROR);
    }
    if (!user) throw new AppError('UNAUTHENTICATED', GENERIC_LOGIN_ERROR); // unreachable: reason would be UNKNOWN_USER

    const sessionToken = randomToken(32);
    const tokenHash = sha256Hex(sessionToken);
    const sessionId = uuidv7();
    const remember = input.remember;
    const absoluteMs = remember
      ? this.config.rememberAbsoluteTimeoutMs
      : this.config.absoluteTimeoutMs;
    const expiresAt = new Date(now.getTime() + absoluteMs);

    const { redirectTo, capped } = await this.asUser(user, meta, () =>
      this.deps.db.transaction(async (tx) => {
        await this.releaseExpiredLock(tx, user, now);
        await tx.repo.recordSuccessfulLogin(user.id, now);
        await tx.repo.createSession({
          id: sessionId,
          userId: user.id,
          tokenHash,
          ip: meta.ip,
          userAgent: meta.userAgent?.slice(0, UA_MAX) ?? null,
          expiresAt,
          lastSeenAt: now,
          restricted: user.mustChangePassword ? 'PASSWORD_CHANGE' : null,
          remember,
        });
        const capped = await this.enforceSessionCap(tx, user, now);
        await tx.repo.addLoginHistory(
          this.historyEntry(user.id, emailForHistory(user, input.email), true, 'LOGIN', meta, now),
        );
        if (user.roleName === 'SUPER_ADMIN')
          return { redirectTo: '/super-admin/dashboard', capped };
        const zones = await tx.repo.countActiveZoneAssignments(user.id);
        return { redirectTo: zones > 0 ? '/zone/dashboard' : '/zone/no-zones', capped };
      }),
    );
    await this.deps.sessions.evictMany(capped);

    await this.deps.sessions.cacheNew(tokenHash, {
      sessionId,
      userId: user.id,
      name: user.name,
      role: user.roleName,
      mustChangePassword: user.mustChangePassword,
      expiresAt,
      remember,
    });

    // New-login notice with time, IP and device (doc 14 section 2, doc 52 section 2.7).
    notify(
      this.deps.mailer.sendNewLogin({
        to: user.email,
        name: user.name,
        at: now,
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
      'new login',
      meta.requestId,
    );

    return {
      sessionToken,
      cookieMaxAgeSec: Math.floor(absoluteMs / 1000),
      csrfToken: this.deps.sessions.csrfFor(tokenHash),
      redirectTo,
      mustChangePassword: user.mustChangePassword,
      user: { id: user.id, name: user.name, email: user.email, role: user.roleName },
    };
  }

  private loginFailureReason(
    user: AuthUser | null,
    passwordOk: boolean,
    tab: Role,
    now: Date,
  ): string | null {
    if (!user) return 'UNKNOWN_USER';
    if (user.status !== 'ACTIVE') return 'INACTIVE';
    if (user.lockedUntil && user.lockedUntil > now) return 'LOCKED';
    if (!passwordOk) return 'BAD_PASSWORD';
    if (user.roleName !== tab) return 'WRONG_TAB';
    // 2FA is not built yet (SA-7.2): an account with MFA enabled must not get in on a password alone.
    if (user.mfaEnabled) return 'MFA_UNSUPPORTED';
    return null;
  }

  private async recordLoginFailure(
    user: AuthUser | null,
    email: string,
    reason: string,
    meta: RequestMeta,
    now: Date,
  ): Promise<void> {
    const stored = emailForHistory(user, email);
    if (!user || !COUNTED_FAILURES.has(reason)) {
      await this.deps.db.repo.addLoginHistory(
        this.historyEntry(user?.id ?? null, stored, false, reason, meta, now),
      );
      return;
    }
    await this.asUser(user, meta, () =>
      this.deps.db.transaction(async (tx) => {
        await this.releaseExpiredLock(tx, user, now);
        await this.countFailureAndMaybeLock(tx, user, now);
        await tx.repo.addLoginHistory(this.historyEntry(user.id, stored, false, reason, meta, now));
      }),
    );
  }

  /**
   * Increments the counter; at the limit, locks the account and writes user.locked in the same transaction, but only
   * when this call moves the account into the locked state. Further failures while locked neither extend the lock nor
   * write another user.locked, and of two concurrent failures crossing the limit only one locks.
   */
  private async countFailureAndMaybeLock(tx: AuthTx, user: AuthUser, now: Date): Promise<void> {
    const attempts = await tx.repo.incrementFailedAttempts(user.id);
    if (attempts < this.config.maxFailedAttempts) return;
    const until = new Date(now.getTime() + this.config.lockDurationMs);
    if (!(await tx.repo.lockUserIfNotLocked(user.id, until, now))) return;
    await record(tx.audit, {
      module: 'auth',
      action: 'user.locked',
      entity: userEntity(user),
      note: `Locked for ${Math.round(this.config.lockDurationMs / 60000)} minutes after ${attempts} failed attempts`,
    });
  }

  /** A lock that has run out is cleared on the next attempt, and that is audited as user.unlocked. */
  private async releaseExpiredLock(tx: AuthTx, user: AuthUser, now: Date): Promise<void> {
    if (!user.lockedUntil || user.lockedUntil > now) return;
    if (await tx.repo.clearExpiredLock(user.id, user.lockedUntil)) {
      await record(tx.audit, {
        module: 'auth',
        action: 'user.unlocked',
        entity: userEntity(user),
        note: 'Lock period ended',
      });
    }
  }

  private historyEntry(
    userId: string | null,
    email: string,
    success: boolean,
    reason: string,
    meta: RequestMeta,
    at: Date,
  ) {
    return {
      id: uuidv7(),
      userId,
      emailAttempted: email,
      success,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, UA_MAX) ?? null,
      reason,
      createdAt: at,
    };
  }

  private async enforceLoginLimits(ip: string | null, email: string): Promise<void> {
    const { limiter, config } = this.deps;
    const checks = [
      limiter.hit(
        `login:email:${sha256Hex(email)}`,
        config.loginLimitPerEmail.limit,
        config.loginLimitPerEmail.windowSec,
      ),
    ];
    if (ip)
      checks.push(
        limiter.hit(
          `login:ip:${ip}`,
          config.loginLimitPerIp.limit,
          config.loginLimitPerIp.windowSec,
        ),
      );
    const blocked = (await Promise.all(checks)).find((r) => !r.allowed);
    if (blocked) throw this.rateLimited(blocked.retryAfterSec);
  }

  private rateLimited(retryAfterSec: number): AppError {
    return new AppError('RATE_LIMITED', 'Too many attempts. Try again later.', undefined, {
      'Retry-After': String(Math.max(1, retryAfterSec)),
    });
  }

  // ---- session --------------------------------------------------------------------------------------------------

  /** Login history only (no audit row): the coverage allow-list reason is `logout`. */
  async logout(session: AuthSession, meta: RequestMeta): Promise<void> {
    const now = this.deps.clock();
    const user = await this.deps.db.repo.findUserById(session.userId);
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.revokeSession(session.sessionId, now);
      await tx.repo.addLoginHistory(
        this.historyEntry(session.userId, emailForHistory(user, ''), true, 'LOGOUT', meta, now),
      );
    });
    await this.deps.sessions.evict(session.tokenHash);
  }

  async me(session: AuthSession, ctx: AuthContext): Promise<MeResult> {
    const user = await this.deps.db.repo.findUserById(session.userId);
    if (!user || user.status !== 'ACTIVE')
      throw new AppError('UNAUTHENTICATED', 'Authentication required');
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.roleName },
      mustChangePassword: user.mustChangePassword,
      csrfToken: session.csrfToken,
      permissions: ctx.isSuperAdmin
        ? { global: true }
        : { global: false, zones: await this.meZones(ctx) },
      // placeholders until the second step exists (P8)
      mfa: { enabled: user.mfaEnabled, required: false, enrolmentNeeded: false },
    };
  }

  /** Every active assignment of a Zonal Admin with its permissions and limits from the AuthContext (doc 09, doc 14). */
  private async meZones(ctx: AuthContext): Promise<MeZone[]> {
    const zones = await this.deps.db.repo.findZonesForDisplay(ctx.assignedZoneIds);
    return zones
      .map((z) => ({
        zoneId: z.id,
        name: z.name,
        code: z.code,
        colorHex: z.colorHex,
        status: z.status,
        permissions: [...(ctx.permissionsByZone.get(z.id) ?? [])].sort(),
        limits: ctx.limitsByZone.get(z.id) ?? NO_LIMITS,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---- re-authentication ----------------------------------------------------------------------------------------

  async reauth(
    session: AuthSession,
    input: ReauthInput,
    meta: RequestMeta,
  ): Promise<{ reauthenticatedUntil: Date }> {
    const user = await this.deps.db.repo.findUserById(session.userId);
    if (!user || user.status !== 'ACTIVE')
      throw new AppError('UNAUTHENTICATED', 'Authentication required');

    if (await verifyPassword(user.passwordHash, input.password)) {
      return { reauthenticatedUntil: await this.deps.sessions.markReauth(session.tokenHash) };
    }

    const now = this.deps.clock();
    await this.asUser(user, meta, async () => {
      await this.deps.db.transaction((tx) => this.countFailureAndMaybeLock(tx, user, now));
      // DENIED (doc 50 §4.3 item 3): own transaction after the lockout one, at most one row per user a minute (D62).
      // recordDenied never throws, so a failure to record cannot hide the 401 below.
      await this.deps.audit.recordDenied({
        module: 'auth',
        action: 'reauth.failed',
        entity: userEntity(user),
        note: 'Wrong password on re-authentication',
      });
    });
    throw new AppError('UNAUTHENTICATED', 'Incorrect password');
  }

  // ---- sessions (doc 52 section 2.6, doc 14 section 2) ----------------------------------------------------------

  /** Open sessions that are also within their idle limit: the ones that still work. */
  private async liveSessions(repo: AuthTx['repo'], userId: string, now: Date) {
    const open = await repo.listOpenSessions(userId, now);
    return open.filter(
      (s) => now.getTime() - s.lastSeenAt.getTime() <= this.deps.sessions.idleMsFor(s.remember),
    );
  }

  /**
   * At most `maxSessions` live sessions: the oldest beyond the cap are revoked and audited (TC-AUTH-37). Runs inside
   * the login transaction, after the new session was created; returns the token hashes to drop from the cache.
   */
  private async enforceSessionCap(tx: AuthTx, user: AuthUser, now: Date): Promise<string[]> {
    const live = await this.liveSessions(tx.repo, user.id, now); // newest first
    const excess = live.slice(this.config.maxSessions);
    if (excess.length === 0) return [];
    const revoked = await tx.repo.revokeSessions(
      user.id,
      excess.map((s) => s.id),
      now,
    );
    await recordMany(
      tx.audit,
      revoked.map((s): AuditEntry => ({
        module: 'auth',
        action: 'session.revoked',
        entity: sessionEntity(s.id, user),
        note: `Oldest session revoked: at most ${this.config.maxSessions} active sessions`,
      })),
    );
    return revoked.map((s) => s.tokenHash);
  }

  /** GET /me/sessions */
  async listSessions(session: AuthSession): Promise<SessionListItem[]> {
    const now = this.deps.clock();
    const live = await this.liveSessions(this.deps.db.repo, session.userId, now);
    return live.map((s) => ({
      id: s.id,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      remember: s.remember,
      current: s.id === session.sessionId,
    }));
  }

  /** DELETE /me/sessions/{id}: only the caller's own live session; anything else is 404. Returns true for the current one. */
  async revokeOwnSession(session: AuthSession, sessionId: string, meta: RequestMeta) {
    const now = this.deps.clock();
    const user = await this.deps.db.repo.findUserById(session.userId);
    if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    const live = await this.liveSessions(this.deps.db.repo, user.id, now);
    if (!live.some((s) => s.id === sessionId)) throw new AppError('NOT_FOUND', 'Not found');
    const revoked = await this.revokeAndAudit(user, [sessionId], now, meta, 'Revoked by the user');
    await this.deps.sessions.evictMany(revoked);
    return { current: sessionId === session.sessionId };
  }

  /** POST /me/sessions/revoke-others: every live session but the current one. */
  async revokeOtherOwnSessions(session: AuthSession, meta: RequestMeta): Promise<number> {
    const now = this.deps.clock();
    const user = await this.deps.db.repo.findUserById(session.userId);
    if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    const others = (await this.liveSessions(this.deps.db.repo, user.id, now))
      .map((s) => s.id)
      .filter((id) => id !== session.sessionId);
    if (others.length === 0) {
      noteAuditNoop(); // nothing to revoke: an audited no-op for the coverage guard
      return 0;
    }
    const revoked = await this.revokeAndAudit(
      user,
      others,
      now,
      meta,
      'Revoked by the user (all other sessions)',
    );
    await this.deps.sessions.evictMany(revoked);
    return revoked.length;
  }

  private async revokeAndAudit(
    user: AuthUser,
    sessionIds: string[],
    now: Date,
    meta: RequestMeta,
    note: string,
  ): Promise<string[]> {
    return this.asUser(user, meta, () =>
      this.deps.db.transaction(async (tx) => {
        const revoked = await tx.repo.revokeSessions(user.id, sessionIds, now);
        if (revoked.length === 0) noteAuditNoop(); // revoked meanwhile by another request: nothing changed here
        await recordMany(
          tx.audit,
          revoked.map((s): AuditEntry => ({
            module: 'auth',
            action: 'session.revoked',
            entity: sessionEntity(s.id, user),
            note,
          })),
        );
        return revoked.map((s) => s.tokenHash);
      }),
    );
  }

  // ---- change password ------------------------------------------------------------------------------------------

  /**
   * POST /auth/change-password (doc 52 section 8): also the forced first-login change, which a restricted session may
   * call. A wrong current password counts toward the lockout like a wrong login (doc 32). Success: new hash, the
   * restriction lifted, every OTHER session revoked (doc 56 P6), audit, and a notice to the account address.
   */
  async changePassword(
    session: AuthSession,
    input: ChangePasswordInput,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.deps.db.repo.findUserById(session.userId);
    if (!user || user.status !== 'ACTIVE')
      throw new AppError('UNAUTHENTICATED', 'Authentication required');
    const now = this.deps.clock();
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new AppError('FORBIDDEN', 'The account is locked. Try again later.');
    }

    if (!(await verifyPassword(user.passwordHash, input.current))) {
      await this.asUser(user, meta, () =>
        this.deps.db.transaction((tx) => this.countFailureAndMaybeLock(tx, user, now)),
      );
      throw new AppError('VALIDATION_ERROR', 'The current password is not correct', [
        { field: 'current', issue: 'incorrect' },
      ]);
    }

    const passwordHash = await hashPassword(input.new);
    const revoked = await this.asUser(user, meta, () =>
      this.deps.db.transaction(async (tx) => {
        await tx.repo.setPassword(user.id, passwordHash, now);
        await tx.repo.setSessionRestriction(session.sessionId, null);
        const others = await tx.repo.revokeOtherSessions(user.id, session.sessionId, now);
        await recordMany(tx.audit, [
          {
            module: 'auth',
            action: 'user.password_changed',
            entity: userEntity(user),
            note: user.mustChangePassword ? 'First-login password change' : 'Changed by the user',
          },
          ...others.map((s): AuditEntry => ({
            module: 'auth',
            action: 'session.revoked',
            entity: sessionEntity(s.id, user),
            note: 'Other sessions revoked by a password change',
          })),
        ]);
        return others.map((s) => s.tokenHash);
      }),
    );

    await this.deps.sessions.evictMany(revoked);
    await this.deps.sessions.clearPasswordChange(session.tokenHash);
    notify(
      this.deps.mailer.sendPasswordChanged({
        to: user.email,
        name: user.name,
        at: now,
        ip: meta.ip,
      }),
      'password changed',
      meta.requestId,
    );
  }

  // ---- password reset -------------------------------------------------------------------------------------------

  /** Always resolves the same way for known, unknown and rate-limited emails (only the per-IP limit answers 429). */
  async forgotPassword(input: ForgotPasswordInput, meta: RequestMeta): Promise<void> {
    const { limiter, config } = this.deps;
    if (meta.ip) {
      const ipLimit = await limiter.hit(
        `forgot:ip:${meta.ip}`,
        config.forgotLimitPerIp.limit,
        config.forgotLimitPerIp.windowSec,
      );
      if (!ipLimit.allowed) throw this.rateLimited(ipLimit.retryAfterSec);
    }
    const emailLimit = await limiter.hit(
      `forgot:email:${sha256Hex(input.email)}`,
      config.forgotLimitPerEmail.limit,
      config.forgotLimitPerEmail.windowSec,
    );
    // Nothing changes on these paths, so nothing is recorded; they count as audited no-ops for the coverage guard.
    if (!emailLimit.allowed) {
      noteAuditNoop();
      return;
    }

    const user = await this.deps.db.repo.findUserByEmail(input.email);
    if (!user || user.status !== 'ACTIVE') {
      noteAuditNoop();
      return;
    }

    const now = this.deps.clock();
    const token = randomToken(32);
    const expiresAt = new Date(now.getTime() + this.config.resetTokenTtlMs);

    await this.asUser(user, meta, () =>
      this.deps.db.transaction(async (tx) => {
        await tx.repo.invalidateOpenResetTokens(user.id, now);
        await tx.repo.createResetToken({
          id: uuidv7(),
          userId: user.id,
          tokenHash: sha256Hex(token),
          expiresAt,
        });
        await record(tx.audit, {
          module: 'auth',
          action: 'user.password_reset_requested',
          entity: userEntity(user),
        });
      }),
    );

    // Not awaited: the response must not reveal, by timing, that an account exists.
    notify(
      this.deps.mailer.sendPasswordReset({ to: user.email, name: user.name, token, expiresAt }),
      'password reset',
      meta.requestId,
    );
  }

  async resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
    const now = this.deps.clock();
    const tokenHash = sha256Hex(input.token);
    // Hashed first, so a bad token costs the same as a good one.
    const passwordHash = await hashPassword(input.newPassword);

    const revoked = await this.deps.db.transaction(async (tx) => {
      const userId = await tx.repo.consumeResetToken(tokenHash, now);
      if (!userId) return null;
      const user = await tx.repo.findUserById(userId);
      if (!user || user.status !== 'ACTIVE') return null;

      return this.asUser(user, meta, async () => {
        await tx.repo.setPassword(user.id, passwordHash, now);
        const sessions = await tx.repo.revokeAllSessions(user.id, now);

        const entries: AuditEntry[] = [
          {
            module: 'auth',
            action: 'user.password_changed',
            entity: userEntity(user),
            note: 'Password reset with an emailed link',
          },
        ];
        if (user.lockedUntil && user.lockedUntil > now) {
          entries.push({
            module: 'auth',
            action: 'user.unlocked',
            entity: userEntity(user),
            note: 'Lock cleared by password reset',
          });
        }
        for (const s of sessions) {
          entries.push({
            module: 'auth',
            action: 'session.revoked',
            entity: sessionEntity(s.id, user),
            note: 'All sessions revoked by password reset',
          });
        }
        await recordMany(tx.audit, entries);
        return { user, tokenHashes: sessions.map((s) => s.tokenHash) };
      });
    });

    if (revoked === null) {
      throw new AppError('VALIDATION_ERROR', 'This reset link is invalid or has expired');
    }
    await this.deps.sessions.evictMany(revoked.tokenHashes);
    notify(
      this.deps.mailer.sendPasswordChanged({
        to: revoked.user.email,
        name: revoked.user.name,
        at: now,
        ip: meta.ip,
      }),
      'password changed',
      meta.requestId,
    );
  }
}
