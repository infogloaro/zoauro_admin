import {
  CONTROL_AREA_KEYS,
  type CreateSuperAdminInput,
  type PutSuperAdminAreasInput,
  type SetSuperAdminPrimaryInput,
  type SuperAdmin,
  type SuperAdminListResponse,
  type SuperAdminStatusInput,
} from '@zoauro/shared';
import { noteAuditNoop, record, uuidv7 } from '../../lib/audit';
import { hashPassword } from '../../lib/auth/crypto';
import type { AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { AccessMailer } from './access.mails';
import type { AccessAdminDatabase, AccessAdminTx, SuperAdminRecord } from './admin.repository';

// Super Admins (D148, D178; the member rules of D102/D103). Only a primary Super Admin writes here (403 PRIMARY_ONLY):
// create (temporary password it types, changed at the first sign-in, never emailed), suspend, delete, the Control Panel
// areas of a non-primary, and promote/demote. STRONG re-authentication on every write (route); one transaction with
// its audit row; the affected Super Admin and the actor are emailed. Never oneself; never the last active Super Admin
// nor the last active primary (serialised by an advisory lock).

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const conflict = (issue: 'LAST_SUPER_ADMIN' | 'LAST_PRIMARY' | 'SELF', message: string) =>
  new AppError('CONFLICT', message, [{ field: 'id', issue }]);
const primaryOnly = () =>
  new AppError('FORBIDDEN', 'Only a primary Super Admin manages Super Admins', [
    { field: 'actor', issue: 'PRIMARY_ONLY' },
  ]);

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
      /** D178: clears the member's cached Control Panel areas (they apply on the next request) */
      onAreasChanged?: (userId: string) => void;
    },
  ) {}

  /** D178: the caller must be an active primary. */
  private async assertPrimary(ctx: AuthContext): Promise<SuperAdminRecord> {
    const me = await this.deps.db.repo.findSuperAdmin(ctx, ctx.userId);
    if (!me || !me.isPrimary || me.status !== 'ACTIVE') throw primaryOnly();
    return me;
  }

  /** The affected Super Admin and the actor hear about every change (D178). */
  private tell(
    target: { email: string; name: string },
    actor: { email: string; name: string },
    change: string,
  ) {
    for (const to of [target, actor])
      notify(
        this.deps.mailer.sendSuperAdminChanged?.({ to: to.email, name: to.name, change }),
        'super admin changed',
      );
  }

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
      isPrimary: r.isPrimary,
      areas: r.isPrimary
        ? [...CONTROL_AREA_KEYS]
        : CONTROL_AREA_KEYS.filter((k) => r.controlGrantsHeld.some((g) => g.key === k)),
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
    await this.assertPrimary(ctx);
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
      if (input.areas.length > 0)
        await tx.repo.replaceGrants(ctx, id, input.areas, input.reason, this.deps.clock());
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
          isPrimary: false,
          areas: input.areas,
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
    if (
      target.isPrimary &&
      target.status === 'ACTIVE' &&
      (await tx.repo.countActivePrimaries(ctx)) <= 1
    )
      throw conflict('LAST_PRIMARY', 'The last primary Super Admin cannot be removed or demoted');
  }

  private async locked(tx: AccessAdminTx, ctx: AuthContext, id: string) {
    await tx.repo.lockSuperAdmins(ctx);
    const target = await tx.repo.findSuperAdmin(ctx, id);
    if (!target) throw notFound();
    return target;
  }

  /** PATCH /super-admins/{id}/status: SUSPENDED ends every session (D102); ACTIVE reactivates. */
  async setStatus(ctx: AuthContext, id: string, input: SuperAdminStatusInput): Promise<SuperAdmin> {
    await this.assertPrimary(ctx);
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
    await this.assertPrimary(ctx);
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

  /** PUT /super-admins/{id}/areas (D178): the complete set of a non-primary's Control Panel areas. */
  async setAreas(
    ctx: AuthContext,
    id: string,
    input: PutSuperAdminAreasInput,
  ): Promise<SuperAdmin> {
    const actor = await this.assertPrimary(ctx);
    const target = await this.deps.db.transaction(async (tx) => {
      const t = await this.locked(tx, ctx, id);
      if (t.isPrimary)
        throw new AppError('VALIDATION_ERROR', 'A primary Super Admin holds every area', [
          { field: 'areas', issue: 'PRIMARY_HOLDS_ALL' },
        ]);
      const { added, removed } = await tx.repo.replaceGrants(
        ctx,
        id,
        input.areas,
        input.reason,
        this.deps.clock(),
      );
      if (added.length === 0 && removed.length === 0) {
        noteAuditNoop();
        return null;
      }
      await record(tx.audit, {
        module: 'admins',
        action: 'member.updated',
        entity: entity(t),
        before: { role: 'SUPER_ADMIN', areas: t.controlGrantsHeld.map((g) => g.key) },
        after: { role: 'SUPER_ADMIN', areas: input.areas, added, removed },
        note: input.reason,
      });
      return t;
    });
    if (target) {
      this.deps.onAreasChanged?.(id);
      this.tell(target, actor, 'Your Control Panel areas were changed');
    }
    const after = await this.deps.db.repo.findSuperAdmin(ctx, id);
    if (!after) throw notFound();
    return this.dto(ctx, after);
  }

  /** POST /super-admins/{id}/primary (D178): promote or demote; the last active primary is never demoted. */
  async setPrimary(
    ctx: AuthContext,
    id: string,
    input: SetSuperAdminPrimaryInput,
  ): Promise<SuperAdmin> {
    const actor = await this.assertPrimary(ctx);
    const target = await this.deps.db.transaction(async (tx) => {
      const t = await this.locked(tx, ctx, id);
      if (t.isPrimary === input.primary) {
        noteAuditNoop();
        return null;
      }
      if (!input.primary && t.status === 'ACTIVE' && (await tx.repo.countActivePrimaries(ctx)) <= 1)
        throw conflict('LAST_PRIMARY', 'The last primary Super Admin cannot be removed or demoted');
      await tx.repo.setPrimary(ctx, id, input.primary);
      await record(tx.audit, {
        module: 'admins',
        action: 'member.updated',
        entity: entity(t),
        before: { role: 'SUPER_ADMIN', isPrimary: t.isPrimary },
        after: { role: 'SUPER_ADMIN', isPrimary: input.primary },
        note: input.reason,
      });
      return t;
    });
    if (target) {
      this.deps.onAreasChanged?.(id);
      this.tell(
        target,
        actor,
        input.primary
          ? 'You are now a primary Super Admin'
          : 'You are no longer a primary Super Admin',
      );
    }
    const after = await this.deps.db.repo.findSuperAdmin(ctx, id);
    if (!after) throw notFound();
    return this.dto(ctx, after);
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
