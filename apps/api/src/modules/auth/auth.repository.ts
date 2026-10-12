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

  async lockUser(userId: string, until: Date): Promise<void> {
    await this.db.user.update({ where: { id: userId }, data: { lockedUntil: until } });
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

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await this.db.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false, failedAttempts: 0, lockedUntil: null },
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
