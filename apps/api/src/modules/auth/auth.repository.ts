import type { Prisma, PrismaClient } from '@prisma/client';
import type { Role } from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import type { SessionPersistence, SessionRecord } from '../../lib/auth/session-store';
import { auditTx } from '../../lib/db';

// Only file in the auth module that imports Prisma. These queries run before any AuthContext exists (login,
// password reset) or on the caller's own account, and touch no zone-owned table, so there is no zone filter here.

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  status: string;
  roleName: Role;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
}

const userSelect = {
  id: true,
  name: true,
  email: true,
  passwordHash: true,
  status: true,
  mustChangePassword: true,
  mfaEnabled: true,
  failedAttempts: true,
  lockedUntil: true,
  role: { select: { name: true } },
} as const;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const toAuthUser = (u: UserRow): AuthUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  passwordHash: u.passwordHash,
  status: u.status,
  roleName: u.role.name,
  mustChangePassword: u.mustChangePassword,
  mfaEnabled: u.mfaEnabled,
  failedAttempts: u.failedAttempts,
  lockedUntil: u.lockedUntil,
});

export interface LoginHistoryEntry {
  id: string;
  userId: string | null;
  emailAttempted: string;
  success: boolean;
  ip: string | null;
  userAgent: string | null;
  reason: string;
  createdAt: Date;
}

export interface NewSession {
  id: string;
  userId: string;
  tokenHash: string;
  ip: string | null;
  userAgent: string | null;
  expiresAt: Date;
  lastSeenAt: Date;
  /** 'PASSWORD_CHANGE' while the first-login password change is pending (doc 52 section 3) */
  restricted?: 'PASSWORD_CHANGE' | null;
  /** "remember me" (D79) */
  remember: boolean;
  /** the second step that opened this session (doc 52 section 3), null when none applied */
  mfaVerifiedAt?: Date | null;
  mfaMethod?: string | null;
}

/** A session that is not revoked and not past its absolute expiry (idle expiry is judged by the caller). */
export interface OpenSession {
  id: string;
  tokenHash: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  remember: boolean;
}

export class AuthRepository implements SessionPersistence {
  constructor(private readonly db: Prisma.TransactionClient) {}

  // ---- users ---------------------------------------------------------------------------------------------------

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    const u = await this.db.user.findFirst({
      where: { email, deletedAt: null },
      select: userSelect,
    });
    return u ? toAuthUser(u) : null;
  }

  async findUserById(id: string): Promise<AuthUser | null> {
    const u = await this.db.user.findFirst({ where: { id, deletedAt: null }, select: userSelect });
    return u ? toAuthUser(u) : null;
  }

  /**
   * Name, code, colour and status of zones the caller is assigned to, for /me. The ids come from the caller's own
   * AuthContext (active assignments), so no further zone filter applies. Soft-deleted zones are left out.
   */
  async findZonesForDisplay(zoneIds: readonly string[]) {
    if (zoneIds.length === 0) return [];
    return this.db.zone.findMany({
      where: { id: { in: [...zoneIds] }, deletedAt: null },
      select: { id: true, name: true, code: true, colorHex: true, status: true },
    });
  }

  async countActiveZoneAssignments(userId: string): Promise<number> {
    return this.db.adminZoneAssignment.count({ where: { userId, revokedAt: null } });
  }

  /** Atomic increment; returns the new counter. */
  async incrementFailedAttempts(userId: string): Promise<number> {
    const u = await this.db.user.update({
      where: { id: userId },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });
    return u.failedAttempts;
  }

  /**
   * Locks only an account that is not locked now (no lock, or one that has run out); true when this call locked it.
   * One conditional UPDATE: a concurrent transaction that locked first makes this one match no row.
   */
  async lockUserIfNotLocked(userId: string, until: Date, now: Date): Promise<boolean> {
    const r = await this.db.user.updateMany({
      where: { id: userId, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
      data: { lockedUntil: until },
    });
    return r.count === 1;
  }

  /** Clears an expired lock only if it is still the lock we saw; true when this call cleared it. */
  async clearExpiredLock(userId: string, expectedLockedUntil: Date): Promise<boolean> {
    const r = await this.db.user.updateMany({
      where: { id: userId, lockedUntil: expectedLockedUntil },
      data: { lockedUntil: null, failedAttempts: 0 },
    });
    return r.count === 1;
  }

  async recordSuccessfulLogin(userId: string, at: Date): Promise<void> {
    await this.db.user.update({
      where: { id: userId },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: at },
    });
  }

  async setPassword(userId: string, passwordHash: string, at: Date): Promise<void> {
    await this.db.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: at,
        mustChangePassword: false,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
  }

  // ---- login history -------------------------------------------------------------------------------------------

  async addLoginHistory(e: LoginHistoryEntry): Promise<void> {
    await this.db.loginHistory.create({ data: e });
  }

  // ---- sessions ------------------------------------------------------------------------------------------------

  async createSession(s: NewSession): Promise<void> {
    await this.db.session.create({ data: s });
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const s = await this.db.session.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        lastSeenAt: true,
        revokedAt: true,
        createdAt: true,
        remember: true,
        user: {
          select: {
            name: true,
            status: true,
            deletedAt: true,
            mustChangePassword: true,
            role: { select: { name: true } },
          },
        },
      },
    });
    if (!s) return null;
    return {
      id: s.id,
      userId: s.userId,
      expiresAt: s.expiresAt,
      // lastSeenAt is nullable in the schema; a session that was never touched counts from its creation
      lastSeenAt: s.lastSeenAt ?? s.createdAt,
      revokedAt: s.revokedAt,
      remember: s.remember,
      user: {
        name: s.user.name,
        roleName: s.user.role.name,
        mustChangePassword: s.user.mustChangePassword,
        active: s.user.deletedAt === null && s.user.status === 'ACTIVE',
      },
    };
  }

  async touchSession(sessionId: string, at: Date): Promise<void> {
    await this.db.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { lastSeenAt: at },
    });
  }

  async revokeSession(sessionId: string, at: Date): Promise<boolean> {
    const r = await this.db.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: at },
    });
    return r.count === 1;
  }

  /** Revokes every open session of the user; returns what was revoked so the cache can be cleared and each one audited. */
  async revokeAllSessions(userId: string, at: Date): Promise<{ id: string; tokenHash: string }[]> {
    const open = await this.db.session.findMany({
      where: { userId, revokedAt: null },
      select: { id: true, tokenHash: true },
    });
    if (open.length > 0) {
      await this.db.session.updateMany({
        where: { id: { in: open.map((s) => s.id) }, revokedAt: null },
        data: { revokedAt: at },
      });
    }
    return open;
  }

  /** Open sessions of the user, newest first. */
  async listOpenSessions(userId: string, now: Date): Promise<OpenSession[]> {
    const rows = await this.db.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        tokenHash: true,
        ip: true,
        userAgent: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        remember: true,
      },
    });
    return rows.map((r) => ({ ...r, lastSeenAt: r.lastSeenAt ?? r.createdAt }));
  }

  /** Revokes the listed sessions of this user that are still open; returns the ones this call revoked. */
  async revokeSessions(
    userId: string,
    sessionIds: readonly string[],
    at: Date,
  ): Promise<{ id: string; tokenHash: string }[]> {
    if (sessionIds.length === 0) return [];
    const open = await this.db.session.findMany({
      where: { userId, id: { in: [...sessionIds] }, revokedAt: null },
      select: { id: true, tokenHash: true },
    });
    if (open.length > 0) {
      await this.db.session.updateMany({
        where: { id: { in: open.map((s) => s.id) }, revokedAt: null },
        data: { revokedAt: at },
      });
    }
    return open;
  }

  /** Revokes every open session of the user except `keepSessionId`; returns what was revoked. */
  async revokeOtherSessions(
    userId: string,
    keepSessionId: string,
    at: Date,
  ): Promise<{ id: string; tokenHash: string }[]> {
    const open = await this.db.session.findMany({
      where: { userId, revokedAt: null, id: { not: keepSessionId } },
      select: { id: true, tokenHash: true },
    });
    if (open.length > 0) {
      await this.db.session.updateMany({
        where: { id: { in: open.map((s) => s.id) }, revokedAt: null },
        data: { revokedAt: at },
      });
    }
    return open;
  }

  /** sessions.restricted (doc 52 section 3): set while the first-login password change is pending. */
  async setSessionRestriction(
    sessionId: string,
    restricted: 'PASSWORD_CHANGE' | null,
  ): Promise<void> {
    await this.db.session.updateMany({ where: { id: sessionId }, data: { restricted } });
  }

  // ---- 2-step (doc 52 section 3) ----------------------------------------------------------------------------------

  /** A setting's stored JSON, or null (the policy reader applies the defaults). */
  async getSettingValue(key: string): Promise<unknown> {
    const row = await this.db.setting.findUnique({ where: { key }, select: { valueJson: true } });
    return row?.valueJson ?? null;
  }

  /** Confirmed, not removed methods of the user (a half-finished enrolment is never offered, TC-AUTH-23). */
  async listActiveMfaMethods(userId: string) {
    return this.db.userMfaMethod.findMany({
      where: { userId, verifiedAt: { not: null }, disabledAt: null },
      select: {
        id: true,
        type: true,
        secretEncrypted: true,
        lastUsedStep: true,
        isPrimary: true,
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * TOTP replay guard (doc 52 section 2.2): records the accepted step only if it is higher than the stored one. False
   * when a concurrent login already used this step or a later one, i.e. the code must be refused.
   */
  async advanceTotpStep(methodId: string, step: number): Promise<boolean> {
    const r = await this.db.userMfaMethod.updateMany({
      where: {
        id: methodId,
        disabledAt: null,
        OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }],
      },
      data: { lastUsedStep: BigInt(step) },
    });
    return r.count === 1;
  }

  async listUnusedBackupCodes(userId: string) {
    return this.db.mfaBackupCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, codeHash: true },
    });
  }

  /** Single use: true only for the call that marked it used. */
  async useBackupCode(codeId: string, at: Date): Promise<boolean> {
    const r = await this.db.mfaBackupCode.updateMany({
      where: { id: codeId, usedAt: null },
      data: { usedAt: at },
    });
    return r.count === 1;
  }

  async countUnusedBackupCodes(userId: string): Promise<number> {
    return this.db.mfaBackupCode.count({ where: { userId, usedAt: null } });
  }

  // ---- password reset tokens -----------------------------------------------------------------------------------

  async invalidateOpenResetTokens(userId: string, at: Date): Promise<void> {
    await this.db.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: at },
    });
  }

  async createResetToken(t: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.passwordResetToken.create({ data: t });
  }

  /** Single use: marks the token used only if it is unused and unexpired, and returns its owner. Null otherwise. */
  async consumeResetToken(tokenHash: string, now: Date): Promise<string | null> {
    const claimed = await this.db.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return null;
    const t = await this.db.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    return t?.userId ?? null;
  }
}

/** The audit service writes through the same transaction as the change (doc 50 section 2.1). */
export interface AuthTx {
  repo: AuthRepository;
  audit: AuditTx;
}

export class AuthDatabase {
  readonly repo: AuthRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new AuthRepository(prisma);
  }

  transaction<T>(fn: (tx: AuthTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) =>
      fn({ repo: new AuthRepository(tx), audit: auditTx(tx) }),
    );
  }
}
