import type { PrismaClient } from './db';
import { record, runAsSystem, uuidv7 } from '../../src/lib/audit';
import { hashPassword } from '../../src/lib/auth/crypto';
import { auditTx } from '../../src/lib/db';
import { createSecretBox, mfaSecretAad } from '../../src/modules/auth/mfa/secret-box';
import type { DemoAccount } from './client';

// What the demo cannot do through the API, done directly as SYSTEM "demo seed" (coordinator-approved):
//  - the PRIMARY Super Admin (nobody exists yet to create it);
//  - each demo account's known password, an authenticator the seed can answer and an email 2-step method for people
//    (codes in Mailpit), with the first-login password change skipped;
//  - Control Panel area grants for the non-primary Super Admin (D178: no grant route is mounted yet).

const NOTE = 'demo seed';

export async function ensurePrimarySuperAdmin(db: PrismaClient, a: DemoAccount): Promise<string> {
  const existing = await db.user.findFirst({
    where: { email: { equals: a.email, mode: 'insensitive' }, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;
  const role = await db.role.findFirstOrThrow({
    where: { name: 'SUPER_ADMIN' },
    select: { id: true },
  });
  const id = uuidv7();
  await runAsSystem(NOTE, () =>
    db.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id,
          name: a.name,
          email: a.email,
          passwordHash: await hashPassword(a.password),
          roleId: role.id,
          status: 'ACTIVE',
          isPrimary: true,
        },
      });
      await record(auditTx(tx), {
        module: 'admins',
        action: 'member.created',
        entity: { type: 'user', id, label: a.name },
        after: { role: 'SUPER_ADMIN', status: 'ACTIVE', isPrimary: true },
        note: NOTE,
      });
    }),
  );
  return id;
}

/** Known password, no forced change, an authenticator the seed answers and an email method for people. */
export async function prepareAccount(
  db: PrismaClient,
  userId: string,
  a: DemoAccount,
  encryption: { current: string; previous?: string },
): Promise<void> {
  const box = createSecretBox(encryption);
  const hash = await hashPassword(a.password);
  await runAsSystem(NOTE, () =>
    db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash: hash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          mfaEnabled: true,
          failedAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.userMfaMethod.deleteMany({ where: { userId } });
      await tx.userMfaMethod.createMany({
        data: [
          {
            id: uuidv7(),
            userId,
            type: 'EMAIL_OTP',
            verifiedAt: new Date(),
            isPrimary: true,
          },
          {
            id: uuidv7(),
            userId,
            type: 'AUTHENTICATOR',
            secretEncrypted: box.seal(a.totpSecret, mfaSecretAad(userId)),
            verifiedAt: new Date(),
            isPrimary: false,
          },
        ],
      });
      await record(auditTx(tx), {
        module: 'admins',
        action: 'member.password_reset',
        entity: { type: 'user', id: userId, label: a.name },
        after: {
          passwordChanged: true,
          mustChangePassword: false,
          twoStep: ['EMAIL_OTP', 'AUTHENTICATOR'],
        },
        note: NOTE,
      });
    }),
  );
}

/** D178: Control Panel areas for a non-primary Super Admin (direct rows; no grant route is mounted yet). */
export async function grantAreas(
  db: PrismaClient,
  granteeId: string,
  grantedBy: string,
  keys: readonly string[],
): Promise<void> {
  for (const key of keys) {
    const live = await db.controlGrant.findFirst({
      where: { granteeId, key, revokedAt: null },
      select: { id: true },
    });
    if (live) continue;
    await db.controlGrant.create({
      data: {
        id: uuidv7(),
        granteeId,
        key,
        grantedBy,
        reason: 'Demo: delegated Control Panel area',
      },
    });
  }
}

export async function userIdByEmail(db: PrismaClient, email: string): Promise<string | null> {
  const u = await db.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null },
    select: { id: true },
  });
  return u?.id ?? null;
}
