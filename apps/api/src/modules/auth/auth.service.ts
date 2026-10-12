import type {
  ForgotPasswordInput,
  LoginInput,
  ReauthInput,
  ResetPasswordInput,
  Role,
} from '@zoauro/shared';
import { noteAuditNoop, record, recordMany, runWithAuditContext, uuidv7 } from '../../lib/audit';
import type { AuditActor, AuditEntry } from '../../lib/audit';
import type { AuthConfig, Clock } from '../../lib/auth/config';
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
import type { AuthDatabase, AuthTx, AuthUser } from './auth.repository';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | undefined;
}

/** Delivery of the reset link. The real SMTP/SES sender arrives with the notifications module; the token is never logged. */
export interface PasswordResetMailer {
  sendPasswordReset(message: {
    to: string;
    name: string;
    token: string;
    expiresAt: Date;
  }): Promise<void>;
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
  /** Stub until the access module (SA-1.7+): Super Admin is global, a Zonal Admin has no resolved zones yet. */
  permissions: { global: true } | { global: false; zones: [] };
}

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

const userEntity = (u: AuthUser) => ({ type: 'user', id: u.id, label: u.email });

export class AuthService {
  constructor(
    private readonly deps: {
      db: AuthDatabase;
      sessions: SessionStore;
      limiter: RateLimiter;
      mailer: PasswordResetMailer;
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
    const expiresAt = new Date(now.getTime() + this.config.absoluteTimeoutMs);

    const redirectTo = await this.asUser(user, meta, () =>
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
        });
        await tx.repo.addLoginHistory(
          this.historyEntry(user.id, user.email, true, 'LOGIN', meta, now),
        );
        if (user.roleName === 'SUPER_ADMIN') return '/super-admin/dashboard';
        return (await tx.repo.countActiveZoneAssignments(user.id)) > 0
          ? '/zone/dashboard'
          : '/zone/no-zones';
      }),
    );

    await this.deps.sessions.cacheNew(tokenHash, {
      sessionId,
      userId: user.id,
      name: user.name,
      role: user.roleName,
      mustChangePassword: user.mustChangePassword,
      expiresAt,
    });

    return {
      sessionToken,
      cookieMaxAgeSec: Math.floor(this.config.absoluteTimeoutMs / 1000),
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
    if (!user || !COUNTED_FAILURES.has(reason)) {
      await this.deps.db.repo.addLoginHistory(
        this.historyEntry(user?.id ?? null, email, false, reason, meta, now),
      );
      return;
    }
    await this.asUser(user, meta, () =>
      this.deps.db.transaction(async (tx) => {
        await this.releaseExpiredLock(tx, user, now);
        await this.countFailureAndMaybeLock(tx, user, now);
        await tx.repo.addLoginHistory(this.historyEntry(user.id, email, false, reason, meta, now));
      }),
    );
  }

  /** Increments the counter; at the limit, locks the account and writes user.locked in the same transaction. */
  private async countFailureAndMaybeLock(tx: AuthTx, user: AuthUser, now: Date): Promise<void> {
    const attempts = await tx.repo.incrementFailedAttempts(user.id);
    if (attempts < this.config.maxFailedAttempts) return;
    const until = new Date(now.getTime() + this.config.lockDurationMs);
    await tx.repo.lockUser(user.id, until);
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
        this.historyEntry(session.userId, user?.email ?? '', true, 'LOGOUT', meta, now),
      );
    });
    await this.deps.sessions.evict(session.tokenHash);
  }

  async me(session: AuthSession): Promise<MeResult> {
    const user = await this.deps.db.repo.findUserById(session.userId);
    if (!user || user.status !== 'ACTIVE')
      throw new AppError('UNAUTHENTICATED', 'Authentication required');
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.roleName },
      mustChangePassword: user.mustChangePassword,
      csrfToken: session.csrfToken,
      permissions:
        user.roleName === 'SUPER_ADMIN' ? { global: true } : { global: false, zones: [] },
    };
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
    await this.asUser(user, meta, () =>
      this.deps.db.transaction(async (tx) => {
        await this.countFailureAndMaybeLock(tx, user, now);
        await record(tx.audit, {
          module: 'auth',
          action: 'reauth.failed',
          entity: userEntity(user),
          note: 'Wrong password on re-authentication',
        });
      }),
    );
    throw new AppError('UNAUTHENTICATED', 'Incorrect password');
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
    this.deps.mailer
      .sendPasswordReset({ to: user.email, name: user.name, token, expiresAt })
      .catch(() => console.error(`password reset mail failed requestId=${meta.requestId ?? '-'}`));
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
        await tx.repo.setPassword(user.id, passwordHash);
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
            entity: { type: 'session', id: s.id, label: user.email },
            note: 'All sessions revoked by password reset',
          });
        }
        await recordMany(tx.audit, entries);
        return sessions.map((s) => s.tokenHash);
      });
    });

    if (revoked === null) {
      throw new AppError('VALIDATION_ERROR', 'This reset link is invalid or has expired');
    }
    await this.deps.sessions.evictMany(revoked);
  }
}
