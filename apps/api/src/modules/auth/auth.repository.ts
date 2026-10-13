import type { Prisma, Role, User } from '@prisma/client';
import { prisma } from '../../lib/db';

export type UserWithRole = User & { role: Role };

export type SessionWithUser = Prisma.SessionGetPayload<{
  include: { user: { include: { role: true } } };
}>;

export async function findUserByEmailWithRole(email: string): Promise<UserWithRole | null> {
  return prisma.user.findFirst({
    where: { email, deletedAt: null },
    include: { role: true },
  });
}

export async function findUserByIdWithRole(id: string): Promise<UserWithRole | null> {
  return prisma.user.findFirst({
    where: { id, deletedAt: null },
    include: { role: true },
  });
}

export async function findActiveSessionByTokenHash(
  tokenHash: string,
): Promise<SessionWithUser | null> {
  return prisma.session.findFirst({
    where: { tokenHash, revokedAt: null },
    include: { user: { include: { role: true } } },
  });
}

export async function createSession(data: {
  userId: string;
  tokenHash: string;
  csrfToken: string;
  ip: string | null;
  userAgent: string | null;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  reauthenticatedAt?: Date;
}): Promise<{ id: string }> {
  return prisma.session.create({
    data: {
      userId: data.userId,
      tokenHash: data.tokenHash,
      csrfToken: data.csrfToken,
      ip: data.ip,
      userAgent: data.userAgent,
      expiresAt: data.expiresAt,
      absoluteExpiresAt: data.absoluteExpiresAt,
      // Doc 14 §4: a completed password login IS a password proof within
      // 10 min, so it opens the re-auth window for high-risk actions.
      ...(data.reauthenticatedAt ? { reauthenticatedAt: data.reauthenticatedAt } : {}),
    },
    select: { id: true },
  });
}

export async function touchSession(id: string, expiresAt: Date): Promise<void> {
  await prisma.session.update({ where: { id }, data: { expiresAt, lastSeenAt: new Date() } });
}

export async function revokeSession(id: string): Promise<void> {
  await prisma.session.update({ where: { id }, data: { revokedAt: new Date() } });
}

/** Keeps at most `max` active sessions per member (doc 14 §2, default 3). */
export async function revokeOldestSessionsOverLimit(userId: string, max: number): Promise<void> {
  const active = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const excess = active.length + 1 - max;
  if (excess <= 0) return;
  const ids = active.slice(0, excess).map((s) => s.id);
  await prisma.session.updateMany({ where: { id: { in: ids } }, data: { revokedAt: new Date() } });
}

export async function setReauthenticatedAt(sessionId: string, at: Date): Promise<void> {
  await prisma.session.update({ where: { id: sessionId }, data: { reauthenticatedAt: at } });
}

export async function recordLoginHistory(data: {
  userId: string | null;
  emailAttempted: string;
  success: boolean;
  ip: string | null;
  userAgent: string | null;
  reason?: string;
}): Promise<void> {
  await prisma.loginHistory.create({
    data: {
      userId: data.userId,
      emailAttempted: data.emailAttempted,
      success: data.success,
      ip: data.ip,
      userAgent: data.userAgent,
      reason: data.reason,
    },
  });
}

export async function recordLoginFailure(
  userId: string,
  failedAttempts: number,
  lockedUntil: Date | null,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedAttempts, lockedUntil },
  });
}

export async function recordLoginSuccess(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
}
