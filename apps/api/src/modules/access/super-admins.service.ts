import type {
  CreateSuperAdminInput,
  SuperAdmin,
  SuperAdminListResponse,
  SuperAdminStatusInput,
} from '@zoauro/shared';
import { noteAuditNoop, record, uuidv7 } from '../../lib/audit';
import { hashPassword } from '../../lib/auth/crypto';
import type { AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { AccessMailer } from './access.mails';
import type { AccessAdminDatabase, AccessAdminTx, SuperAdminRecord } from './admin.repository';

// Super Admins (D148, refines D75; the member rules of D102/D103). A Super Admin creates another with a temporary
// password it types (changed at the first sign-in, never emailed); STRONG re-authentication on every write (route);
// every write is one transaction with its audit row. Suspend and delete never target the caller and never leave the
// platform without an active Super Admin (serialised by an advisory lock).

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const conflict = (issue: 'LAST_SUPER_ADMIN' | 'SELF', message: string) =>
  new AppError('CONFLICT', message, [{ field: 'id', issue }]);

function notify(send: Promise<void> | undefined, what: string): void {
  send?.catch((err: unknown) =>
    console.error(`${what} mail failed (${err instanceof Error ? err.name : 'unknown'})`),
  );
}

const entity = (m: { id: string; name: string }) => ({ type: 'user', id: m.id, label: m.name });

export class SuperAdminsService {
  constructor(
    private readonly deps: {
      db: AccessAdminDatabase;
      /** drops revoked sessions from the session cache (auth module) */
      evictSessions: (tokenHashes: string[]) => Promise<void>;
      mailer: AccessMailer;
      clock: () => Date;
    },
  ) {}

  private dto(ctx: AuthContext, r: SuperAdminRecord): SuperAdmin {
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      status: r.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED',
      mfaEnabled: r.mfaEnabled,
      mustChangePassword: r.mustChangePassword,
      lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      isSelf: r.id === ctx.userId,
    };
  }

  async list(ctx: AuthContext): Promise<SuperAdminListResponse> {
    const rows = await this.deps.db.repo.listSuperAdmins(ctx);
    return {
      data: rows.map((r) => this.dto(ctx, r)),
      meta: { activeCount: rows.filter((r) => r.status === 'ACTIVE').length },
    };
  }

  /** POST /super-admins: ACTIVE at once; the new Super Admin enrols 2-step at the first sign-in (SUPER_ADMIN: required). */
  async create(ctx: AuthContext, input: CreateSuperAdminInput): Promise<SuperAdmin> {
    const passwordHash = await hashPassword(input.temporaryPassword);
    const id = uuidv7();
    const others = await this.deps.db.transaction(async (tx) => {
      if (await tx.repo.emailTaken(ctx, input.email))
        throw new AppError('CONFLICT', 'Another account already uses this email', [
          { field: 'email', issue: 'EMAIL_TAKEN' },
        ]);
      await tx.repo.insertMember(ctx, {
        id,
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        passwordHash,
        roleId: await tx.repo.superRoleId(ctx),
        status: 'ACTIVE',
      });
      await record(tx.audit, {
        module: 'admins',
        action: 'member.created',
        entity: entity({ id, name: input.name }),
        after: {
          role: 'SUPER_ADMIN',
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          status: 'ACTIVE',
        },
        note: input.reason,
      });
      return tx.repo.activeSuperAdmins();
    });
    // D103: no password in any email; the new Super Admin hears it from the creator. Every other Super Admin is told.
    notify(
      this.deps.mailer.sendSuperAdminCreated?.({ to: input.email, name: input.name }),
      'super admin created',
    );
    for (const o of others)
      if (o.email.toLowerCase() !== input.email.toLowerCase())
        notify(
          this.deps.mailer.sendSuperAdminAdded?.({ to: o.email, name: o.name, added: input.name }),
          'super admin added',
        );
    const created = await this.deps.db.repo.findSuperAdmin(ctx, id);
    if (!created) throw notFound();
    return this.dto(ctx, created);
  }

  /** A suspend or delete must leave another active Super Admin, and never targets the caller. */
  private async guard(tx: AccessAdminTx, ctx: AuthContext, target: SuperAdminRecord) {
    if (target.id === ctx.userId)
      throw conflict('SELF', 'You cannot suspend or delete your own Super Admin account');
    if (target.status === 'ACTIVE' && (await tx.repo.countActiveSuperAdmins(ctx)) <= 1)
      throw conflict('LAST_SUPER_ADMIN', 'The last active Super Admin cannot be removed');
  }

  private async locked(tx: AccessAdminTx, ctx: AuthContext, id: string) {
    await tx.repo.lockSuperAdmins(ctx);
    const target = await tx.repo.findSuperAdmin(ctx, id);
    if (!target) throw notFound();
    return target;
  }

  /** PATCH /super-admins/{id}/status: SUSPENDED ends every session (D102); ACTIVE reactivates. */
  async setStatus(ctx: AuthContext, id: string, input: SuperAdminStatusInput): Promise<SuperAdmin> {
    const evict = await this.deps.db.transaction(async (tx) => {
      const target = await this.locked(tx, ctx, id);
      const current = target.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED';
      if (current === input.status) {
        noteAuditNoop();
        return [];
      }
      if (input.status === 'SUSPENDED') await this.guard(tx, ctx, target);
      await tx.repo.updateMember(ctx, id, { status: input.status });
      const revoked =
        input.status === 'SUSPENDED'
          ? await tx.repo.revokeSessions(ctx, id, this.deps.clock())
          : [];
      await record(tx.audit, {
        module: 'admins',
        action: input.status === 'SUSPENDED' ? 'member.suspended' : 'member.reactivated',
        entity: entity(target),
        before: { role: 'SUPER_ADMIN', status: current },
        after: {
          role: 'SUPER_ADMIN',
          status: input.status,
          ...(input.status === 'SUSPENDED' ? { sessionsRevoked: revoked.length } : {}),
        },
        note: input.reason,
      });
      return revoked.map((s) => s.tokenHash);
    });
    await this.evict(evict);
    const after = await this.deps.db.repo.findSuperAdmin(ctx, id);
    if (!after) throw notFound();
    return this.dto(ctx, after);
  }

  /** DELETE /super-admins/{id}: soft delete; every session ends. */
  async remove(ctx: AuthContext, id: string, reason: string): Promise<void> {
    const evict = await this.deps.db.transaction(async (tx) => {
      const target = await this.locked(tx, ctx, id);
      await this.guard(tx, ctx, target);
      const now = this.deps.clock();
      const revoked = await tx.repo.revokeSessions(ctx, id, now);
      await tx.repo.updateMember(ctx, id, { deletedAt: now });
      await record(tx.audit, {
        module: 'admins',
        action: 'member.deleted',
        entity: entity(target),
        before: {
          role: 'SUPER_ADMIN',
          name: target.name,
          email: target.email,
          status: target.status,
        },
        after: { deleted: true, sessionsRevoked: revoked.length },
        note: reason,
      });
      return revoked.map((s) => s.tokenHash);
    });
    await this.evict(evict);
  }

  private async evict(tokenHashes: string[]): Promise<void> {
    if (tokenHashes.length === 0) return;
    await this.deps
      .evictSessions(tokenHashes)
      .catch((err: unknown) =>
        console.error(`session eviction failed ${err instanceof Error ? err.name : 'unknown'}`),
      );
  }
}
