import { createHash } from 'node:crypto';
import {
  buildCursorPage,
  isGrantable,
  isOverrideGrantable,
  NO_GRANT_SWITCHES,
  type GrantSwitches,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  permissionKey,
  type AccessChangeListQuery,
  type AccessChangeType,
  type AccessOverride,
  type AccessPreview,
  type AccessProfileDetail,
  type AccessProfilePermissions,
  type AccessProfileSummary,
  type AddTeamMemberInput,
  type AssignmentInput,
  type AssignmentLimits,
  type AuditActionKey,
  type CreateAccessProfileInput,
  type CreateZonalAdminInput,
  type MemberAccess,
  type MemberAssignment,
  type ProfilePermission,
  type PutAccessProfilePermissionsInput,
  type PutMemberAccessInput,
  type UpdateAccessProfileInput,
  type UpdateZonalAdminInput,
  type ZonalAdmin,
  type ZonalAdminDetail,
  type ZonalAdminListQuery,
  type AccessRequest,
  type AccessRequestListQuery,
  type ApproveAccessRequestInput,
  type CreateAccessRequestInput,
  type RejectAccessRequestInput,
  type myAccessRequestsResponseSchema,
  GRANTABLE_ACTIONS,
} from '@zoauro/shared';
import type { z } from 'zod';
import { noteAuditNoop, record, uuidv7 } from '../../lib/audit';
import { hashPassword } from '../../lib/auth/crypto';
import {
  resolveAccess,
  type AccessService,
  type AuthContext,
  type RefundCapsReader,
} from '../../lib/authz';
import { AppError } from '../../lib/errors';
import { memberScopeEvent } from './access.events';
import type { AccessMailer } from './access.mails';
import type {
  AccessAdminDatabase,
  AccessAdminTx,
  AccessChangeInsert,
  AssignmentRecord,
  MemberRecord,
  ProfileRecord,
} from './admin.repository';

// M03 Access Control rules (doc 04, doc 09, doc 14 section 4, doc 36, owner decisions D102–D108). Every write is one
// transaction holding the change, its audit row(s), its access_changes rows and its outbox event; after the commit the
// member's cached access is cleared (changes apply on the next request, D107), sessions are evicted where they ended,
// and the member is emailed (TC-AC-13). Rules live here; the repository only reads and writes.

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const NO_LIMITS: AssignmentLimits = {
  perRefund: null,
  dailyRefund: null,
  canReveal: null,
  canExport: null,
};
const ASSIGNABLE_ZONE = new Set(['ACTIVE', 'UPCOMING']);

/** Mail is sent in the background; the response never waits for or reveals delivery. Bodies are never logged. */
function notify(send: Promise<void>, what: string): void {
  send.catch((err: unknown) =>
    console.error(`${what} mail failed (${err instanceof Error ? err.name : 'unknown'})`),
  );
}

const memberEntity = (m: { id: string; name: string }, zoneId?: string | null) => ({
  type: 'user',
  id: m.id,
  label: m.name,
  ...(zoneId ? { zoneId } : {}),
});
const profileEntity = (p: { id: string; name: string }) => ({
  type: 'access_profile',
  id: p.id,
  label: p.name,
});

const sameOverrides = (a: readonly AccessOverride[], b: readonly AccessOverride[]): boolean => {
  const key = (o: AccessOverride) => `${o.module}:${o.action}:${o.effect}`;
  const x = a.map(key).sort();
  const y = b.map(key).sort();
  return x.length === y.length && x.every((k, i) => k === y[i]);
};
const sameLimits = (a: AssignmentLimits, b: AssignmentLimits): boolean =>
  a.perRefund === b.perRefund &&
  a.dailyRefund === b.dailyRefund &&
  a.canReveal === b.canReveal &&
  a.canExport === b.canExport;

const sortedMatrix = (p: readonly ProfilePermission[]): ProfilePermission[] =>
  p
    .filter((r) => r.actions.length > 0)
    .map((r) => ({
      module: r.module,
      actions: PERMISSION_ACTIONS.filter((a) => r.actions.includes(a)),
    }))
    .sort((a, b) => a.module.localeCompare(b.module));

/**
 * TC-AC-6, D108: anything a Zonal Admin can never hold is refused, every offender listed. `overrideSwitches`: the grants
 * are a member's overrides, which may also hold what an on Control Panel switch opens (D155); profiles never may.
 */
function assertGrantable(
  grants: { field: string; module: string; action: string }[],
  overrideSwitches?: GrantSwitches,
): void {
  const offenders = grants.filter((g) => {
    if (
      !(PERMISSION_MODULES as readonly string[]).includes(g.module) ||
      !(PERMISSION_ACTIONS as readonly string[]).includes(g.action)
    )
      return true;
    const module = g.module as (typeof PERMISSION_MODULES)[number];
    const action = g.action as (typeof PERMISSION_ACTIONS)[number];
    return overrideSwitches
      ? !isOverrideGrantable(module, action, overrideSwitches)
      : !isGrantable(module, action);
  });
  if (offenders.length > 0)
    throw new AppError(
      'VALIDATION_ERROR',
      'A Zonal Admin can never be given: ' +
        offenders.map((o) => `${o.module}:${o.action}`).join(', '),
      offenders.map((o) => ({ field: o.field, issue: 'NOT_GRANTABLE' })),
    );
}

/** Opaque version of a member's access: any change to an assignment changes it (STALE_VERSION on PUT). */
function versionOf(assignments: readonly AssignmentRecord[]): string {
  const canonical = [...assignments]
    .sort((a, b) => a.zone.id.localeCompare(b.zone.id))
    .map((a) => [a.id, a.profile.id, a.limits, a.overrides, a.note]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('base64url').slice(0, 22);
}

function toAssignmentDto(
  a: AssignmentRecord,
  switches: GrantSwitches = NO_GRANT_SWITCHES,
): MemberAssignment {
  const resolved = resolveAccess([a.resolverInput], switches);
  const limits = resolved.limits[a.zone.id] ?? {
    perRefund: 0,
    dailyRefund: 0,
    canReveal: false,
    canExport: false,
  };
  return {
    assignmentId: a.id,
    zone: a.zone,
    profile: a.profile,
    overrides: a.overrides,
    limits: a.limits,
    effectiveLimits: limits,
    permissions: resolved.permissions[a.zone.id] ?? [],
    note: a.note,
    assignedAt: a.assignedAt.toISOString(),
    assignedBy: a.assignedBy,
  };
}

/** What an access change row keeps of an assignment. */
const assignmentView = (a: {
  profileId: string;
  profileName: string;
  overrides: readonly AccessOverride[];
  limits: AssignmentLimits;
}) => ({
  profile: { id: a.profileId, name: a.profileName },
  overrides: a.overrides,
  limits: a.limits,
});

function toMemberDto(m: MemberRecord): ZonalAdmin {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    phone: m.phone,
    status: m.status,
    mfaEnabled: m.mfaEnabled,
    mustChangePassword: m.mustChangePassword,
    lockedUntil: m.lockedUntil && m.lockedUntil > new Date() ? m.lockedUntil.toISOString() : null,
    lastLoginAt: m.lastLoginAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    zones: m.zones,
  };
}

export interface AccessAdminDeps {
  db: AccessAdminDatabase;
  /** request-time access resolver and its cache (lib/authz): cleared after every change */
  access: Pick<AccessService, 'invalidateUsers'>;
  /** drops revoked sessions from the session cache (auth module) */
  evictSessions: (tokenHashes: string[]) => Promise<void>;
  mailer: AccessMailer;
  clock: () => Date;
  /** D110: zone refund caps (settings refunds.limits); absent = no cap check (the read-only team port) */
  refundCaps?: RefundCapsReader;
  /** D155: Control Panel switches (settings access.commissionEditGrantable); absent or unreadable = all off */
  grantSwitches?: () => Promise<GrantSwitches>;
}

interface CapCheck {
  field: string;
  zoneId: string;
  perRefund: number;
  daily: number;
}

interface AfterCommit {
  invalidate: string[];
  evict: string[];
  mails: (() => void)[];
}

export class AccessAdminService {
  constructor(private readonly deps: AccessAdminDeps) {}

  /** D155: fail closed. */
  private async switches(): Promise<GrantSwitches> {
    if (!this.deps.grantSwitches) return NO_GRANT_SWITCHES;
    try {
      return await this.deps.grantSwitches();
    } catch {
      return NO_GRANT_SWITCHES;
    }
  }

  /** One transaction; then cache, sessions and mail, which never undo a committed change. */
  private async write<T>(fn: (tx: AccessAdminTx, after: AfterCommit) => Promise<T>): Promise<T> {
    const after: AfterCommit = { invalidate: [], evict: [], mails: [] };
    const result = await this.deps.db.transaction((tx) => fn(tx, after));
    try {
      await this.deps.access.invalidateUsers([...new Set(after.invalidate)]);
    } catch (err) {
      // the cache lives at most 60 s (doc 14 section 4); class name only (doc 13)
      console.error(
        `access cache invalidation failed ${err instanceof Error ? err.name : 'unknown'}`,
      );
    }
    if (after.evict.length > 0)
      await this.deps
        .evictSessions(after.evict)
        .catch((err: unknown) =>
          console.error(`session eviction failed ${err instanceof Error ? err.name : 'unknown'}`),
        );
    for (const send of after.mails) send();
    return result;
  }

  /**
   * D110: a member's own refund limits (the assignment's value, else the profile default) can never be saved above the
   * zone caps. 422 with one detail per field over its cap.
   */
  private async assertWithinCaps(checks: readonly CapCheck[]): Promise<void> {
    if (!this.deps.refundCaps || checks.length === 0) return;
    const caps = await this.deps.refundCaps([...new Set(checks.map((c) => c.zoneId))]);
    const details: { field: string; issue: string }[] = [];
    for (const c of checks) {
      const cap = caps.get(c.zoneId);
      if (!cap) continue;
      if (c.perRefund > cap.perRefundPaise)
        details.push({ field: `${c.field}.perRefund`, issue: 'ABOVE_ZONE_CAP' });
      if (c.daily > cap.perDayPaise)
        details.push({ field: `${c.field}.dailyRefund`, issue: 'ABOVE_ZONE_CAP' });
    }
    if (details.length > 0)
      throw new AppError(
        'VALIDATION_ERROR',
        'A refund limit is above the zone cap (Settings > Refund limits)',
        details,
        undefined,
        { caps: Object.fromEntries(caps) },
      );
  }

  private async member(tx: AccessAdminTx, ctx: AuthContext, id: string): Promise<MemberRecord> {
    const m = await tx.repo.lockMember(ctx, id);
    if (!m) throw notFound();
    return m;
  }

  private async revokeAll(
    tx: AccessAdminTx,
    ctx: AuthContext,
    m: MemberRecord,
    after: AfterCommit,
  ): Promise<number> {
    const revoked = await tx.repo.revokeSessions(ctx, m.id, this.deps.clock());
    after.evict.push(...revoked.map((s) => s.tokenHash));
    return revoked.length;
  }

  // ---- members --------------------------------------------------------------------------------------------------

  async listMembers(ctx: AuthContext, q: ZonalAdminListQuery) {
    const { rows, total } = await this.deps.db.repo.listMembers(ctx, q);
    return { data: rows.map(toMemberDto), meta: { page: q.page, pageSize: q.pageSize, total } };
  }

  async getMember(ctx: AuthContext, id: string): Promise<ZonalAdminDetail> {
    const m = await this.deps.db.repo.findMember(ctx, id);
    if (!m) throw notFound();
    return {
      ...toMemberDto(m),
      activeSessions: await this.deps.db.repo.countOpenSessions(ctx, id, this.deps.clock()),
    };
  }

  /** D103: a temporary password the Super Admin typed; changed at the first sign-in; never emailed. */
  async createMember(ctx: AuthContext, input: CreateZonalAdminInput): Promise<ZonalAdminDetail> {
    const passwordHash = await hashPassword(input.temporaryPassword);
    const id = uuidv7();
    await this.write(async (tx) => {
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
        roleId: await tx.repo.zonalRoleId(ctx),
        status: input.status,
      });
      await record(tx.audit, {
        module: 'admins',
        action: 'member.created',
        entity: memberEntity({ id, name: input.name }),
        after: {
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          status: input.status,
        },
      });
    });
    return this.getMember(ctx, id);
  }

  /**
   * D102/D107: name, phone, email, status. Suspending ends every session; an email or phone change also removes the
   * 2-step method that used it (doc 52 sections 2.3 and 2.5: the member proves the new address again).
   */
  async updateMember(
    ctx: AuthContext,
    id: string,
    input: UpdateZonalAdminInput,
  ): Promise<ZonalAdminDetail> {
    await this.write(async (tx, after) => {
      const m = await this.member(tx, ctx, id);
      const changes: Parameters<typeof tx.repo.updateMember>[2] = {};
      const before: Record<string, unknown> = {};
      const next: Record<string, unknown> = {};
      const removedMethods: ('EMAIL_OTP' | 'SMS_OTP')[] = [];

      if (input.name !== undefined && input.name !== m.name) {
        changes.name = input.name;
        before['name'] = m.name;
        next['name'] = input.name;
      }
      if (input.email !== undefined && input.email !== m.email.toLowerCase()) {
        if (await tx.repo.emailTaken(ctx, input.email, id))
          throw new AppError('CONFLICT', 'Another account already uses this email', [
            { field: 'email', issue: 'EMAIL_TAKEN' },
          ]);
        changes.email = input.email;
        before['email'] = m.email;
        next['email'] = input.email;
        removedMethods.push('EMAIL_OTP');
      }
      if (input.phone !== undefined && input.phone !== m.phone) {
        changes.phone = input.phone;
        changes.phoneVerifiedAt = null;
        before['phone'] = m.phone;
        next['phone'] = input.phone;
        removedMethods.push('SMS_OTP');
      }
      const statusChange =
        input.status !== undefined && input.status !== m.status ? input.status : null;
      if (statusChange) changes.status = statusChange;

      if (Object.keys(changes).length === 0) {
        noteAuditNoop();
        return;
      }
      await tx.repo.updateMember(ctx, id, changes);
      if (removedMethods.length > 0) {
        const removed = await tx.repo.disableMfaMethods(ctx, id, removedMethods, this.deps.clock());
        if (removed.length > 0) next['twoStepMethodsRemoved'] = removed;
      }
      if (Object.keys(before).length > 0)
        await record(tx.audit, {
          module: 'admins',
          action: 'member.updated',
          entity: memberEntity({ id, name: input.name ?? m.name }),
          before,
          after: next,
        });
      if (statusChange === 'SUSPENDED') {
        const sessions = await this.revokeAll(tx, ctx, m, after);
        await record(tx.audit, {
          module: 'admins',
          action: 'member.suspended',
          entity: memberEntity({ id, name: input.name ?? m.name }),
          before: { status: m.status },
          after: { status: 'SUSPENDED', sessionsRevoked: sessions },
        });
      } else if (statusChange === 'ACTIVE') {
        await record(tx.audit, {
          module: 'admins',
          action: 'member.reactivated',
          entity: memberEntity({ id, name: input.name ?? m.name }),
          before: { status: m.status },
          after: { status: 'ACTIVE' },
        });
      }
    });
    return this.getMember(ctx, id);
  }

  /** D102: soft delete; every assignment and session ends. Never a Super Admin (404: not a member) nor oneself. */
  async deleteMember(ctx: AuthContext, id: string): Promise<void> {
    if (id === ctx.userId) throw notFound();
    await this.write(async (tx, after) => {
      const m = await this.member(tx, ctx, id);
      const now = this.deps.clock();
      const current = await tx.repo.activeAssignments(ctx, id);
      await tx.repo.revokeAssignments(
        ctx,
        current.map((a) => a.id),
        now,
      );
      await tx.repo.insertAccessChanges(
        ctx,
        current.map((a) => ({
          id: uuidv7(),
          memberId: id,
          zoneId: a.zone.id,
          changeType: 'ZONE_REMOVED',
          before: assignmentView({ ...a, profileId: a.profile.id, profileName: a.profile.name }),
          after: { reason: 'member deleted' },
        })),
        now,
      );
      const sessions = await this.revokeAll(tx, ctx, m, after);
      await tx.repo.updateMember(ctx, id, { deletedAt: now });
      await record(tx.audit, {
        module: 'admins',
        action: 'member.deleted',
        entity: memberEntity(m),
        before: {
          name: m.name,
          email: m.email,
          status: m.status,
          zones: m.zones.map((z) => z.name),
        },
        after: { deleted: true, assignmentsEnded: current.length, sessionsRevoked: sessions },
      });
      if (current.length > 0)
        await tx.repo.insertOutbox(ctx, [
          memberScopeEvent({
            userId: id,
            added: [],
            removed: current.map((a) => a.zone.id),
            changed: [],
            actorId: ctx.userId,
            occurredAt: now,
          }),
        ]);
      after.invalidate.push(id);
    });
  }

  /** D103: new temporary password, forced change, every session ends, an email without the password. */
  async resetPassword(
    ctx: AuthContext,
    id: string,
    temporaryPassword: string,
  ): Promise<{ sessionsRevoked: number }> {
    const passwordHash = await hashPassword(temporaryPassword);
    return this.write(async (tx, after) => {
      const m = await this.member(tx, ctx, id);
      await tx.repo.updateMember(ctx, id, { passwordHash, mustChangePassword: true });
      const sessionsRevoked = await this.revokeAll(tx, ctx, m, after);
      await record(tx.audit, {
        module: 'admins',
        action: 'member.password_reset',
        entity: memberEntity(m),
        after: { mustChangePassword: true, sessionsRevoked },
      });
      after.mails.push(() =>
        notify(
          this.deps.mailer.sendPasswordResetByAdmin({ to: m.email, name: m.name }),
          'admin password reset',
        ),
      );
      return { sessionsRevoked };
    });
  }

  async revokeSessions(ctx: AuthContext, id: string): Promise<{ sessionsRevoked: number }> {
    return this.write(async (tx, after) => {
      const m = await this.member(tx, ctx, id);
      const revoked = await tx.repo.revokeSessions(ctx, id, this.deps.clock());
      after.evict.push(...revoked.map((s) => s.tokenHash));
      if (revoked.length === 0) noteAuditNoop();
      for (const s of revoked)
        await record(tx.audit, {
          module: 'auth',
          action: 'session.revoked',
          entity: { type: 'session', id: s.id, label: m.name },
          note: 'Revoked by a Super Admin',
        });
      return { sessionsRevoked: revoked.length };
    });
  }

  // ---- a member's access ------------------------------------------------------------------------------------------

  async getAccess(ctx: AuthContext, id: string): Promise<MemberAccess> {
    const m = await this.deps.db.repo.findMember(ctx, id);
    if (!m) throw notFound();
    const [assignments, sw] = await Promise.all([
      this.deps.db.repo.activeAssignments(ctx, id),
      this.switches(),
    ]);
    return {
      memberId: id,
      version: versionOf(assignments),
      assignments: assignments.map((a) => toAssignmentDto(a, sw)),
    };
  }

  /**
   * PUT /zonal-admins/{id}/access (D104, D107, D108): the member's complete set of zones. Existing assignments change in
   * place, zones left out end, overrides are replaced. One access_changes row and one audit row per kind of change per
   * zone: ZONE_ADDED, ZONE_REMOVED, PROFILE_SET, OVERRIDE_SET, LIMIT_SET (reveal/export are limits, D104).
   */
  async putAccess(
    ctx: AuthContext,
    id: string,
    input: PutMemberAccessInput,
  ): Promise<MemberAccess> {
    const sw = await this.switches();
    assertGrantable(
      input.assignments.flatMap((a, i) =>
        a.overrides
          .map((o, j) => ({ ...o, field: `assignments.${i}.overrides.${j}` }))
          .filter((o) => o.effect === 'GRANT'),
      ),
      sw,
    );
    await this.write(async (tx, after) => {
      const m = await this.member(tx, ctx, id);
      const current = await tx.repo.activeAssignments(ctx, id);
      if (input.version !== undefined && input.version !== versionOf(current))
        throw new AppError(
          'STALE_VERSION',
          'This access was changed by someone else. Review the newer values and try again',
          [{ field: 'version', issue: 'stale' }],
          undefined,
          {
            current: {
              memberId: id,
              version: versionOf(current),
              assignments: current.map((a) => toAssignmentDto(a, sw)),
            },
          },
        );

      const byZone = new Map(current.map((a) => [a.zone.id, a]));
      const added = input.assignments.filter((a) => !byZone.has(a.zoneId));
      const kept = input.assignments.filter((a) => byZone.has(a.zoneId));
      const removed = current.filter((a) => !input.assignments.some((x) => x.zoneId === a.zone.id));

      const profiles = await tx.repo.profilesByIds(ctx, [
        ...new Set(input.assignments.map((a) => a.profileId)),
      ]);
      const badProfiles = input.assignments
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => !profiles.has(a.profileId));
      if (badProfiles.length > 0)
        throw new AppError(
          'VALIDATION_ERROR',
          'Unknown access profile',
          badProfiles.map(({ i }) => ({
            field: `assignments.${i}.profileId`,
            issue: 'PROFILE_NOT_FOUND',
          })),
        );
      await this.assertWithinCaps(
        input.assignments.map((a, i) => {
          const p = profiles.get(a.profileId);
          return {
            field: `assignments.${i}.limits`,
            zoneId: a.zoneId,
            perRefund: a.limits.perRefund ?? p?.defaultPerRefundLimit ?? 0,
            daily: a.limits.dailyRefund ?? p?.defaultDailyRefundLimit ?? 0,
          };
        }),
      );
      const zones = await tx.repo.zonesByIds(
        ctx,
        added.map((a) => a.zoneId),
      );
      const badZones = input.assignments
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => !byZone.has(a.zoneId))
        .filter(({ a }) => !ASSIGNABLE_ZONE.has(zones.get(a.zoneId)?.status ?? ''));
      if (badZones.length > 0)
        throw new AppError(
          'VALIDATION_ERROR',
          'Members can be added only to ACTIVE or UPCOMING zones',
          badZones.map(({ i }) => ({
            field: `assignments.${i}.zoneId`,
            issue: 'ZONE_NOT_ASSIGNABLE',
          })),
        );

      const now = this.deps.clock();
      const changes: AccessChangeInsert[] = [];
      const audits: { action: AuditActionKey; zoneId: string; before: unknown; after: unknown }[] =
        [];
      const changedZones = new Set<string>();
      const profileName = (pid: string) => profiles.get(pid)?.name ?? '';
      const view = (a: AssignmentInput) =>
        assignmentView({
          profileId: a.profileId,
          profileName: profileName(a.profileId),
          overrides: a.overrides,
          limits: a.limits,
        });

      for (const a of added) {
        const assignmentId = uuidv7();
        await tx.repo.insertAssignment(ctx, {
          id: assignmentId,
          userId: id,
          zoneId: a.zoneId,
          profileId: a.profileId,
          limits: a.limits,
          note: a.note ?? null,
          at: now,
        });
        await tx.repo.replaceOverrides(ctx, assignmentId, a.overrides);
        changes.push({
          id: uuidv7(),
          memberId: id,
          zoneId: a.zoneId,
          changeType: 'ZONE_ADDED',
          before: null,
          after: view(a),
        });
        audits.push({
          action: 'access.zone_added',
          zoneId: a.zoneId,
          before: null,
          after: view(a),
        });
      }

      for (const a of kept) {
        const cur = byZone.get(a.zoneId);
        if (!cur) continue;
        const note = a.note === undefined ? cur.note : a.note;
        const profileChanged = cur.profile.id !== a.profileId;
        const overridesChanged = !sameOverrides(cur.overrides, a.overrides);
        const limitsChanged = !sameLimits(cur.limits, a.limits);
        if (!profileChanged && !overridesChanged && !limitsChanged && note === cur.note) continue;
        await tx.repo.updateAssignment(ctx, cur.id, {
          profileId: a.profileId,
          limits: a.limits,
          note,
        });
        if (overridesChanged) await tx.repo.replaceOverrides(ctx, cur.id, a.overrides);
        const push = (
          type: AccessChangeType,
          action: AuditActionKey,
          before: unknown,
          afterValue: unknown,
        ) => {
          changes.push({
            id: uuidv7(),
            memberId: id,
            zoneId: a.zoneId,
            changeType: type,
            before,
            after: afterValue,
          });
          audits.push({ action, zoneId: a.zoneId, before, after: afterValue });
          changedZones.add(a.zoneId);
        };
        if (profileChanged)
          push('PROFILE_SET', 'access.profile_set', cur.profile, {
            id: a.profileId,
            name: profileName(a.profileId),
          });
        if (overridesChanged)
          push('OVERRIDE_SET', 'access.override_set', cur.overrides, a.overrides);
        if (limitsChanged) push('LIMIT_SET', 'access.limit_set', cur.limits, a.limits);
      }

      await tx.repo.revokeAssignments(
        ctx,
        removed.map((a) => a.id),
        now,
      );
      for (const a of removed) {
        const before = assignmentView({
          ...a,
          profileId: a.profile.id,
          profileName: a.profile.name,
        });
        changes.push({
          id: uuidv7(),
          memberId: id,
          zoneId: a.zone.id,
          changeType: 'ZONE_REMOVED',
          before,
          after: null,
        });
        audits.push({ action: 'access.zone_removed', zoneId: a.zone.id, before, after: null });
      }

      if (audits.length === 0) {
        // nothing but a note (or nothing at all) changed: not an access change
        noteAuditNoop();
        return;
      }
      await tx.repo.insertAccessChanges(ctx, changes, now);
      for (const e of audits)
        await record(tx.audit, {
          module: 'access',
          action: e.action,
          entity: memberEntity(m, e.zoneId),
          before: e.before,
          after: e.after,
        });
      await tx.repo.insertOutbox(ctx, [
        memberScopeEvent({
          userId: id,
          added: added.map((a) => a.zoneId),
          removed: removed.map((a) => a.zone.id),
          changed: [...changedZones],
          actorId: ctx.userId,
          occurredAt: now,
        }),
      ]);
      after.invalidate.push(id);
      const names = new Map<string, string>([
        ...current.map((a): [string, string] => [a.zone.id, a.zone.name]),
        ...[...zones.values()].map((z): [string, string] => [z.id, z.name]),
      ]);
      const nameOf = (z: string) => names.get(z) ?? z;
      after.mails.push(() =>
        notify(
          this.deps.mailer.sendAccessChanged({
            to: m.email,
            name: m.name,
            added: added.map((a) => nameOf(a.zoneId)),
            removed: removed.map((a) => a.zone.name),
            changed: [...changedZones].map(nameOf),
          }),
          'access changed',
        ),
      );
    });
    return this.getAccess(ctx, id);
  }

  /** TC-AC-11: the same resolver every request uses, plus why each cell is what it is. */
  async preview(ctx: AuthContext, id: string, zoneId: string): Promise<AccessPreview> {
    const m = await this.deps.db.repo.findMember(ctx, id);
    if (!m) throw notFound();
    const assignment = (await this.deps.db.repo.activeAssignments(ctx, id)).find(
      (a) => a.zone.id === zoneId,
    );
    if (!assignment) {
      return {
        memberId: id,
        zoneId,
        assigned: false,
        permissions: [],
        limits: { perRefund: 0, dailyRefund: 0, canReveal: false, canExport: false },
        matrix: [],
        visibleModules: [],
      };
    }
    const sw = await this.switches();
    const resolved = resolveAccess([assignment.resolverInput], sw);
    const permissions = resolved.permissions[zoneId] ?? [];
    const effective = new Set<string>(permissions);
    const profile = assignment.resolverInput.profile;
    const matrix = PERMISSION_MODULES.flatMap((module) =>
      PERMISSION_ACTIONS.map((action) => {
        const row = profile.deleted
          ? undefined
          : profile.permissions.find((p) => p.module === module);
        const column = `can${action[0]?.toUpperCase() ?? ''}${action.slice(1)}` as
          'canView' | 'canAdd' | 'canEdit' | 'canDelete' | 'canStatus' | 'canExport';
        const override = assignment.overrides.find(
          (o) => o.module === module && o.action === action,
        );
        return {
          module,
          action,
          grantable: isOverrideGrantable(module, action, sw),
          fromProfile: row?.[column] === true,
          override: override?.effect ?? null,
          effective: effective.has(permissionKey(module, action)),
        };
      }),
    );
    return {
      memberId: id,
      zoneId,
      assigned: true,
      permissions,
      limits: resolved.limits[zoneId] ?? {
        perRefund: 0,
        dailyRefund: 0,
        canReveal: false,
        canExport: false,
      },
      matrix,
      visibleModules: PERMISSION_MODULES.filter((mod) => effective.has(permissionKey(mod, 'view'))),
    };
  }

  // ---- zone team --------------------------------------------------------------------------------------------------

  async addTeamMember(
    ctx: AuthContext,
    zoneId: string,
    userId: string,
    input: AddTeamMemberInput,
  ): Promise<MemberAssignment> {
    await this.write(async (tx, after) => {
      const zone = await tx.repo.zoneExists(ctx, zoneId);
      if (!zone) throw notFound();
      const m = await this.member(tx, ctx, userId);
      if (!ASSIGNABLE_ZONE.has(zone.status))
        throw new AppError(
          'VALIDATION_ERROR',
          'Members can be added only to ACTIVE or UPCOMING zones',
          [{ field: 'zoneId', issue: 'ZONE_NOT_ASSIGNABLE' }],
        );
      const profile = (await tx.repo.profilesByIds(ctx, [input.profileId])).get(input.profileId);
      if (!profile)
        throw new AppError('VALIDATION_ERROR', 'Unknown access profile', [
          { field: 'profileId', issue: 'PROFILE_NOT_FOUND' },
        ]);
      if ((await tx.repo.activeAssignments(ctx, userId)).some((a) => a.zone.id === zoneId))
        throw new AppError('CONFLICT', 'This member is already in the zone');
      const now = this.deps.clock();
      const limits = input.limits ?? NO_LIMITS;
      await this.assertWithinCaps([
        {
          field: 'limits',
          zoneId,
          perRefund: limits.perRefund ?? profile.defaultPerRefundLimit ?? 0,
          daily: limits.dailyRefund ?? profile.defaultDailyRefundLimit ?? 0,
        },
      ]);
      await tx.repo.insertAssignment(ctx, {
        id: uuidv7(),
        userId,
        zoneId,
        profileId: profile.id,
        limits,
        note: input.note ?? null,
        at: now,
      });
      const value = assignmentView({
        profileId: profile.id,
        profileName: profile.name,
        overrides: [],
        limits,
      });
      await tx.repo.insertAccessChanges(
        ctx,
        [
          {
            id: uuidv7(),
            memberId: userId,
            zoneId,
            changeType: 'ZONE_ADDED',
            before: null,
            after: value,
          },
        ],
        now,
      );
      await record(tx.audit, {
        module: 'access',
        action: 'access.zone_added',
        entity: memberEntity(m, zoneId),
        after: value,
      });
      await tx.repo.insertOutbox(ctx, [
        memberScopeEvent({
          userId,
          added: [zoneId],
          removed: [],
          changed: [],
          actorId: ctx.userId,
          occurredAt: now,
        }),
      ]);
      after.invalidate.push(userId);
      after.mails.push(() =>
        notify(
          this.deps.mailer.sendAccessChanged({
            to: m.email,
            name: m.name,
            added: [zone.name],
            removed: [],
            changed: [],
          }),
          'access changed',
        ),
      );
    });
    const added = (await this.deps.db.repo.activeAssignments(ctx, userId)).find(
      (a) => a.zone.id === zoneId,
    );
    if (!added) throw notFound();
    return toAssignmentDto(added, await this.switches());
  }

  async removeTeamMember(ctx: AuthContext, zoneId: string, userId: string): Promise<void> {
    await this.write(async (tx, after) => {
      const zone = await tx.repo.zoneExists(ctx, zoneId);
      if (!zone) throw notFound();
      const m = await this.member(tx, ctx, userId);
      const a = (await tx.repo.activeAssignments(ctx, userId)).find((x) => x.zone.id === zoneId);
      if (!a) throw notFound();
      const now = this.deps.clock();
      await tx.repo.revokeAssignments(ctx, [a.id], now);
      const before = assignmentView({ ...a, profileId: a.profile.id, profileName: a.profile.name });
      await tx.repo.insertAccessChanges(
        ctx,
        [
          {
            id: uuidv7(),
            memberId: userId,
            zoneId,
            changeType: 'ZONE_REMOVED',
            before,
            after: null,
          },
        ],
        now,
      );
      await record(tx.audit, {
        module: 'access',
        action: 'access.zone_removed',
        entity: memberEntity(m, zoneId),
        before,
      });
      await tx.repo.insertOutbox(ctx, [
        memberScopeEvent({
          userId,
          added: [],
          removed: [zoneId],
          changed: [],
          actorId: ctx.userId,
          occurredAt: now,
        }),
      ]);
      after.invalidate.push(userId);
      after.mails.push(() =>
        notify(
          this.deps.mailer.sendAccessChanged({
            to: m.email,
            name: m.name,
            added: [],
            removed: [zone.name],
            changed: [],
          }),
          'access changed',
        ),
      );
    });
  }

  /** GET /zones/{id}/team (the zones module answers 404 for an unknown zone first). */
  async team(ctx: AuthContext, zoneId: string) {
    const [rows, sw] = await Promise.all([this.deps.db.repo.team(ctx, zoneId), this.switches()]);
    return rows.map((r) => {
      const dto = toAssignmentDto(r.assignment, sw);
      return {
        userId: r.userId,
        name: r.name,
        email: r.email,
        status: r.status,
        assignmentId: dto.assignmentId,
        assignedAt: dto.assignedAt,
        profileId: dto.profile.id,
        profileName: dto.profile.name,
        overridesCount: dto.overrides.length,
        limits: {
          perRefundPaise: dto.effectiveLimits.perRefund,
          dailyRefundPaise: dto.effectiveLimits.dailyRefund,
          canReveal: dto.effectiveLimits.canReveal,
          canExport: dto.effectiveLimits.canExport,
        },
      };
    });
  }

  // ---- access requests (R13, doc 59 §5, D115) ---------------------------------------------------------------------

  private requestDto(
    r: NonNullable<Awaited<ReturnType<AccessAdminTx['repo']['findRequest']>>>,
  ): AccessRequest {
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      requester: { id: r.requester.id, name: r.requester.name },
      zone: { id: r.zone.id, name: r.zone.name, code: r.zone.code, colorHex: r.zone.colorHex },
      module: r.module,
      action: r.action,
      reason: r.reason,
      decidedBy: r.decider,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionReason: r.decisionReason,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private static what(r: { kind: string; module: string | null; action: string | null }): string {
    return r.kind === 'ZONE' ? 'access to the zone' : `the permission ${r.module}:${r.action}`;
  }

  /** GET /me/access-requests: my requests and what I may ask for (D115). */
  async myRequests(ctx: AuthContext): Promise<z.infer<typeof myAccessRequestsResponseSchema>> {
    const [rows, zones] = await Promise.all([
      this.deps.db.repo.myRequests(ctx),
      ctx.isSuperAdmin ? Promise.resolve([]) : this.deps.db.repo.requestableZones(ctx),
    ]);
    return {
      data: rows.map((r) => this.requestDto(r)),
      requestable: {
        zones: zones.map((z) => ({ id: z.id, name: z.name, code: z.code, status: z.status })),
        permissions: ctx.isSuperAdmin
          ? []
          : PERMISSION_MODULES.flatMap((module) =>
              GRANTABLE_ACTIONS[module].map((action) => ({ module, action })),
            ),
      },
    };
  }

  /**
   * POST /me/access-requests (D115): a Zonal Admin only (a Super Admin holds everything). A ZONE request names an
   * ACTIVE or UPCOMING zone the member is not in; a PERMISSION request names one of the member's zones and a grantable
   * module action they do not hold yet. One open request per zone and permission.
   */
  async createRequest(ctx: AuthContext, input: CreateAccessRequestInput): Promise<AccessRequest> {
    if (ctx.isSuperAdmin)
      throw new AppError('FORBIDDEN', 'A Super Admin already has every permission');
    const id = uuidv7();
    const out = await this.write(async (tx) => {
      if (input.kind === 'ZONE') {
        const requestable = await tx.repo.requestableZones(ctx);
        if (!requestable.some((z) => z.id === input.zoneId)) {
          throw ctx.assignedZoneIds.includes(input.zoneId)
            ? new AppError('CONFLICT', 'You are already in this zone')
            : new AppError('VALIDATION_ERROR', 'This zone cannot be requested', [
                { field: 'zoneId', issue: 'ZONE_NOT_ASSIGNABLE' },
              ]);
        }
      } else {
        // a zone the member is not in is not theirs to see (doc 36): 404 ZONE_NOT_FOUND
        if (!ctx.assignedZoneIds.includes(input.zoneId))
          throw new AppError('ZONE_NOT_FOUND', 'Zone not found');
        if (!isGrantable(input.module, input.action))
          throw new AppError(
            'VALIDATION_ERROR',
            'A Zonal Admin can never be given this permission',
            [{ field: 'action', issue: 'NOT_GRANTABLE' }],
          );
        if (ctx.permissionsByZone.get(input.zoneId)?.has(permissionKey(input.module, input.action)))
          throw new AppError('CONFLICT', 'You already have this permission in this zone');
      }
      await tx.repo.insertRequest(ctx, {
        id,
        kind: input.kind,
        zoneId: input.zoneId,
        module: input.kind === 'PERMISSION' ? input.module : null,
        action: input.kind === 'PERMISSION' ? input.action : null,
        reason: input.reason,
      });
      const r = await tx.repo.findRequest(ctx, id);
      if (!r) throw notFound();
      await record(tx.audit, {
        module: 'access',
        action: 'access.request_created',
        entity: { type: 'access_request', id, label: r.requester.name, zoneId: input.zoneId },
        after: { kind: r.kind, zone: r.zone.name, module: r.module, action: r.action },
        note: input.reason,
      });
      return { request: this.requestDto(r), superAdmins: await tx.repo.activeSuperAdmins() };
    });
    for (const sa of out.superAdmins)
      notify(
        this.deps.mailer.sendAccessRequestCreated({
          to: sa.email,
          requester: out.request.requester.name,
          zone: out.request.zone.name,
          what: AccessAdminService.what(out.request),
        }),
        'access request created',
      );
    return out.request;
  }

  /** POST /me/access-requests/{id}/cancel: own pending requests only. */
  async cancelRequest(ctx: AuthContext, id: string): Promise<AccessRequest> {
    await this.write(async (tx) => {
      const r = await tx.repo.lockRequest(ctx, id);
      if (!r || r.requester.id !== ctx.userId) throw notFound();
      if (r.status !== 'PENDING')
        throw new AppError('CONFLICT', 'Only an open request can be cancelled');
      await tx.repo.decideRequest(ctx, id, {
        status: 'CANCELLED',
        reason: null,
        at: this.deps.clock(),
        byRequester: true,
      });
      await record(tx.audit, {
        module: 'access',
        action: 'access.request_cancelled',
        entity: { type: 'access_request', id, label: r.requester.name, zoneId: r.zone.id },
      });
    });
    const r = await this.deps.db.repo.findRequest(ctx, id);
    if (!r) throw notFound();
    return this.requestDto(r);
  }

  async listRequests(ctx: AuthContext, q: AccessRequestListQuery) {
    const [rows, pendingCount] = await Promise.all([
      this.deps.db.repo.listRequests(ctx, q),
      this.deps.db.repo.countPendingRequests(ctx),
    ]);
    const page = buildCursorPage(rows, q.limit, (r) => r.id);
    return { data: page.data.map((r) => this.requestDto(r)), meta: { ...page.meta, pendingCount } };
  }

  async getRequest(ctx: AuthContext, id: string): Promise<AccessRequest> {
    if (!ctx.isSuperAdmin) throw new AppError('FORBIDDEN', 'You do not have permission to do this');
    const r = await this.deps.db.repo.findRequest(ctx, id);
    if (!r) throw notFound();
    return this.requestDto(r);
  }

  /** Under the row lock: still open, same version, not the approver's own (D115). */
  private async openRequest(tx: AccessAdminTx, ctx: AuthContext, id: string, version: number) {
    const r = await tx.repo.lockRequest(ctx, id);
    if (!r) throw notFound();
    if (r.status !== 'PENDING') throw new AppError('CONFLICT', 'This request was already decided');
    if (r.version !== version)
      throw new AppError(
        'STALE_VERSION',
        'This request changed. Reload it',
        [{ field: 'version', issue: 'stale' }],
        undefined,
        { current: this.requestDto(r) },
      );
    if (r.requester.id === ctx.userId)
      throw new AppError('FORBIDDEN', 'Nobody approves their own request');
    return r;
  }

  /**
   * POST /access-requests/{id}/approve (PASSWORD re-auth): applied with the access editor's rules, in the same
   * transaction as the decision. ZONE: the member joins the zone with the profile the Super Admin picks (D115), within
   * the zone's refund caps (D110). PERMISSION: a GRANT override on the member's assignment in that zone.
   */
  async approveRequest(
    ctx: AuthContext,
    id: string,
    input: ApproveAccessRequestInput,
  ): Promise<AccessRequest> {
    const decided = await this.write(async (tx, after) => {
      const r = await this.openRequest(tx, ctx, id, input.version);
      const m = await this.member(tx, ctx, r.requester.id);
      const now = this.deps.clock();
      const inZone = (await tx.repo.activeAssignments(ctx, m.id)).find(
        (a) => a.zone.id === r.zone.id,
      );
      if (r.kind === 'ZONE') {
        if (!input.profileId)
          throw new AppError('VALIDATION_ERROR', 'Pick the access profile for the zone', [
            { field: 'profileId', issue: 'required' },
          ]);
        if (inZone) throw new AppError('CONFLICT', 'The member is already in this zone');
        if (!ASSIGNABLE_ZONE.has(r.zone.status))
          throw new AppError(
            'VALIDATION_ERROR',
            'Members can be added only to ACTIVE or UPCOMING zones',
            [{ field: 'zoneId', issue: 'ZONE_NOT_ASSIGNABLE' }],
          );
        const profile = (await tx.repo.profilesByIds(ctx, [input.profileId])).get(input.profileId);
        if (!profile)
          throw new AppError('VALIDATION_ERROR', 'Unknown access profile', [
            { field: 'profileId', issue: 'PROFILE_NOT_FOUND' },
          ]);
        await this.assertWithinCaps([
          {
            field: 'profileId',
            zoneId: r.zone.id,
            perRefund: profile.defaultPerRefundLimit ?? 0,
            daily: profile.defaultDailyRefundLimit ?? 0,
          },
        ]);
        await tx.repo.insertAssignment(ctx, {
          id: uuidv7(),
          userId: m.id,
          zoneId: r.zone.id,
          profileId: profile.id,
          limits: NO_LIMITS,
          note: `Access request: ${r.reason}`.slice(0, 500),
          at: now,
        });
        const value = assignmentView({
          profileId: profile.id,
          profileName: profile.name,
          overrides: [],
          limits: NO_LIMITS,
        });
        await tx.repo.insertAccessChanges(
          ctx,
          [
            {
              id: uuidv7(),
              memberId: m.id,
              zoneId: r.zone.id,
              changeType: 'ZONE_ADDED',
              before: null,
              after: value,
            },
          ],
          now,
        );
        await record(tx.audit, {
          module: 'access',
          action: 'access.zone_added',
          entity: memberEntity(m, r.zone.id),
          after: value,
          note: input.reason,
        });
        await tx.repo.insertOutbox(ctx, [
          memberScopeEvent({
            userId: m.id,
            added: [r.zone.id],
            removed: [],
            changed: [],
            actorId: ctx.userId,
            occurredAt: now,
          }),
        ]);
      } else {
        if (!inZone) throw new AppError('CONFLICT', 'The member is no longer in this zone');
        const module = r.module;
        const action = r.action;
        if (!module || !action || !isGrantable(module, action))
          throw new AppError(
            'VALIDATION_ERROR',
            'A Zonal Admin can never be given this permission',
            [{ field: 'action', issue: 'NOT_GRANTABLE' }],
          );
        const before = inZone.overrides;
        const next: AccessOverride[] = [
          ...before.filter((o) => !(o.module === module && o.action === action)),
          { module, action, effect: 'GRANT' },
        ];
        await tx.repo.replaceOverrides(ctx, inZone.id, next);
        await tx.repo.insertAccessChanges(
          ctx,
          [
            {
              id: uuidv7(),
              memberId: m.id,
              zoneId: r.zone.id,
              changeType: 'OVERRIDE_SET',
              before,
              after: next,
            },
          ],
          now,
        );
        await record(tx.audit, {
          module: 'access',
          action: 'access.override_set',
          entity: memberEntity(m, r.zone.id),
          before,
          after: next,
          note: input.reason,
        });
        await tx.repo.insertOutbox(ctx, [
          memberScopeEvent({
            userId: m.id,
            added: [],
            removed: [],
            changed: [r.zone.id],
            actorId: ctx.userId,
            occurredAt: now,
          }),
        ]);
      }
      await tx.repo.decideRequest(ctx, id, {
        status: 'APPROVED',
        reason: input.reason,
        at: now,
        byRequester: false,
      });
      await record(tx.audit, {
        module: 'access',
        action: 'access.request_approved',
        entity: { type: 'access_request', id, label: m.name, zoneId: r.zone.id },
        after: {
          kind: r.kind,
          module: r.module,
          action: r.action,
          profileId: input.profileId ?? null,
        },
        note: input.reason,
      });
      after.invalidate.push(m.id);
      return { email: m.email, name: m.name, zone: r.zone.name, what: AccessAdminService.what(r) };
    });
    this.notifyDecision(decided, true, input.reason);
    return this.getRequest(ctx, id);
  }

  /** POST /access-requests/{id}/reject */
  async rejectRequest(
    ctx: AuthContext,
    id: string,
    input: RejectAccessRequestInput,
  ): Promise<AccessRequest> {
    const decided = await this.write(async (tx) => {
      const r = await this.openRequest(tx, ctx, id, input.version);
      await tx.repo.decideRequest(ctx, id, {
        status: 'REJECTED',
        reason: input.reason,
        at: this.deps.clock(),
        byRequester: false,
      });
      await record(tx.audit, {
        module: 'access',
        action: 'access.request_rejected',
        entity: { type: 'access_request', id, label: r.requester.name, zoneId: r.zone.id },
        note: input.reason,
      });
      return {
        email: r.requester.email,
        name: r.requester.name,
        zone: r.zone.name,
        what: AccessAdminService.what(r),
      };
    });
    this.notifyDecision(decided, false, input.reason);
    return this.getRequest(ctx, id);
  }

  private notifyDecision(
    d: { email: string; name: string; zone: string; what: string },
    approved: boolean,
    reason: string,
  ): void {
    notify(
      this.deps.mailer.sendAccessRequestDecided({
        to: d.email,
        name: d.name,
        approved,
        zone: d.zone,
        what: d.what,
        reason,
      }),
      'access request decided',
    );
  }

  // ---- zone scope preference (PUT /me/zone-scope, D116) -------------------------------------------------------------

  /**
   * One zone or none (= all my zones). A Zonal Admin may pick only a zone they are in (404 ZONE_NOT_FOUND otherwise,
   * doc 36); a Super Admin any live zone. A view filter, never authorization: the API scopes every request anyway.
   */
  async setZoneScope(ctx: AuthContext, zoneIds: readonly string[]): Promise<{ zoneIds: string[] }> {
    const zoneId = zoneIds[0] ?? null;
    if (zoneId) {
      const allowed = ctx.isSuperAdmin
        ? await this.deps.db.repo.zoneLive(zoneId)
        : ctx.assignedZoneIds.includes(zoneId);
      if (!allowed) throw new AppError('ZONE_NOT_FOUND', 'Zone not found');
    }
    await this.deps.db.repo.setZoneScope(ctx, zoneId);
    return { zoneIds: zoneId ? [zoneId] : [] };
  }

  // ---- history ----------------------------------------------------------------------------------------------------

  async listAccessChanges(ctx: AuthContext, q: AccessChangeListQuery) {
    const rows = await this.deps.db.repo.listAccessChanges(ctx, q);
    const page = buildCursorPage(rows, q.limit, (r) => r.id);
    return {
      data: page.data.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      meta: page.meta,
    };
  }

  // ---- profiles ---------------------------------------------------------------------------------------------------

  private async summaries(
    ctx: AuthContext,
    profiles: ProfileRecord[],
  ): Promise<AccessProfileSummary[]> {
    const usage = await this.deps.db.repo.profileUsage(
      ctx,
      profiles.map((p) => p.id),
    );
    return profiles.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      isSeed: p.isSeed,
      defaults: p.defaults,
      membersCount: usage.get(p.id)?.members ?? 0,
      assignmentsCount: usage.get(p.id)?.assignments ?? 0,
      updatedAt: p.updatedAt.toISOString(),
    }));
  }

  async listProfiles(ctx: AuthContext): Promise<{ data: AccessProfileSummary[] }> {
    return { data: await this.summaries(ctx, await this.deps.db.repo.listProfiles(ctx)) };
  }

  async getProfile(ctx: AuthContext, id: string): Promise<AccessProfileDetail> {
    const p = await this.deps.db.repo.findProfile(ctx, id);
    if (!p) throw notFound();
    const [summary] = await this.summaries(ctx, [p]);
    if (!summary) throw notFound();
    return { ...summary, permissions: p.permissions };
  }

  private matrixGrants(permissions: readonly ProfilePermission[]) {
    return permissions.flatMap((p, i) =>
      p.actions.map((action) => ({ module: p.module, action, field: `permissions.${i}.actions` })),
    );
  }

  private async assertNameFree(
    tx: AccessAdminTx,
    ctx: AuthContext,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    await tx.repo.lockProfileNames(ctx);
    if (await tx.repo.profileNameTaken(ctx, name, exceptId))
      throw new AppError('CONFLICT', 'Another access profile already has this name', [
        { field: 'name', issue: 'PROFILE_NAME_TAKEN' },
      ]);
  }

  async createProfile(
    ctx: AuthContext,
    input: CreateAccessProfileInput,
  ): Promise<AccessProfileDetail> {
    assertGrantable(this.matrixGrants(input.permissions));
    const id = uuidv7();
    await this.write(async (tx) => {
      await this.assertNameFree(tx, ctx, input.name);
      const permissions = sortedMatrix(input.permissions);
      await tx.repo.insertProfile(ctx, {
        id,
        name: input.name,
        description: input.description ?? null,
        defaults: input.defaults,
      });
      await tx.repo.replaceProfilePermissions(ctx, id, permissions);
      await record(tx.audit, {
        module: 'access',
        action: 'access_profile.created',
        entity: profileEntity({ id, name: input.name }),
        after: {
          name: input.name,
          description: input.description ?? null,
          defaults: input.defaults,
          permissions,
        },
      });
    });
    return this.getProfile(ctx, id);
  }

  async updateProfile(
    ctx: AuthContext,
    id: string,
    input: UpdateAccessProfileInput,
  ): Promise<AccessProfileDetail> {
    await this.write(async (tx) => {
      const p = await tx.repo.lockProfile(ctx, id);
      if (!p) throw notFound();
      const before: Record<string, unknown> = {};
      const next: Record<string, unknown> = {};
      if (input.name !== undefined && input.name !== p.name) {
        if (input.name.toLowerCase() !== p.name.toLowerCase())
          await this.assertNameFree(tx, ctx, input.name, id);
        before['name'] = p.name;
        next['name'] = input.name;
      }
      if (input.description !== undefined && input.description !== p.description) {
        before['description'] = p.description;
        next['description'] = input.description;
      }
      if (Object.keys(next).length === 0) {
        noteAuditNoop();
        return;
      }
      await tx.repo.updateProfile(ctx, id, next as { name?: string; description?: string | null });
      await record(tx.audit, {
        module: 'access',
        action: 'access_profile.updated',
        entity: profileEntity({ id, name: (next['name'] as string | undefined) ?? p.name }),
        before,
        after: next,
      });
    });
    return this.getProfile(ctx, id);
  }

  /**
   * D108: refused while any active assignment uses the profile. The stored name gets a suffix so the name can be used
   * again (the name index also covers deleted rows); the audit row keeps the real name.
   */
  async deleteProfile(ctx: AuthContext, id: string): Promise<void> {
    await this.write(async (tx) => {
      const p = await tx.repo.lockProfile(ctx, id);
      if (!p) throw notFound();
      const usage = (await tx.repo.profileUsage(ctx, [id])).get(id);
      if (usage && usage.assignments > 0)
        throw new AppError(
          'CONFLICT',
          `This profile is used by ${usage.members} member(s) in ${usage.assignments} zone(s). Move them to another profile first`,
          undefined,
          undefined,
          { members: usage.members, assignments: usage.assignments },
        );
      await tx.repo.updateProfile(ctx, id, {
        deletedAt: this.deps.clock(),
        name: `${p.name} [deleted ${id.slice(-12)}]`,
      });
      await record(tx.audit, {
        module: 'access',
        action: 'access_profile.deleted',
        entity: profileEntity(p),
        before: {
          name: p.name,
          description: p.description,
          defaults: p.defaults,
          permissions: p.permissions,
        },
      });
    });
  }

  async getProfilePermissions(ctx: AuthContext, id: string): Promise<AccessProfilePermissions> {
    const p = await this.deps.db.repo.findProfile(ctx, id);
    if (!p) throw notFound();
    return { profileId: id, permissions: p.permissions, defaults: p.defaults };
  }

  /**
   * D104/D107: the whole matrix and the defaults. One PROFILE_EDITED access change per affected member (zone null,
   * the member's zones in `after`), one audit row for the profile, caches cleared, members emailed (doc 09).
   */
  async putProfilePermissions(
    ctx: AuthContext,
    id: string,
    input: PutAccessProfilePermissionsInput,
  ): Promise<AccessProfilePermissions> {
    assertGrantable(this.matrixGrants(input.permissions));
    await this.write(async (tx, after) => {
      const p = await tx.repo.lockProfile(ctx, id);
      if (!p) throw notFound();
      const permissions = sortedMatrix(input.permissions);
      const before = { permissions: p.permissions, defaults: p.defaults };
      const next = { permissions, defaults: input.defaults };
      if (JSON.stringify(before) === JSON.stringify(next)) {
        noteAuditNoop();
        return;
      }
      // D110: members who take the profile's default limits must stay within their zones' caps
      const usingDefaults = await tx.repo.assignmentsUsingProfile(ctx, id);
      await this.assertWithinCaps(
        usingDefaults.map((a) => ({
          field: 'defaults',
          zoneId: a.zoneId,
          perRefund: a.perRefundLimit ?? input.defaults.perRefund ?? 0,
          daily: a.dailyRefundLimit ?? input.defaults.dailyRefund ?? 0,
        })),
      );
      await tx.repo.replaceProfilePermissions(ctx, id, permissions);
      await tx.repo.updateProfile(ctx, id, { defaults: input.defaults });
      await record(tx.audit, {
        module: 'access',
        action: 'access_profile.updated',
        entity: profileEntity(p),
        before,
        after: next,
      });

      const affected = await tx.repo.assignmentsUsingProfile(ctx, id);
      const zonesByMember = new Map<string, string[]>();
      for (const a of affected)
        zonesByMember.set(a.userId, [...(zonesByMember.get(a.userId) ?? []), a.zoneId]);
      const now = this.deps.clock();
      await tx.repo.insertAccessChanges(
        ctx,
        [...zonesByMember].map(([memberId, zoneIds]) => ({
          id: uuidv7(),
          memberId,
          zoneId: null,
          changeType: 'PROFILE_EDITED',
          before: { profile: { id, name: p.name }, ...before },
          after: { profile: { id, name: p.name }, zones: zoneIds, ...next },
        })),
        now,
      );
      await tx.repo.insertOutbox(
        ctx,
        [...zonesByMember].map(([userId, zoneIds]) =>
          memberScopeEvent({
            userId,
            added: [],
            removed: [],
            changed: zoneIds,
            actorId: ctx.userId,
            occurredAt: now,
          }),
        ),
      );
      after.invalidate.push(...zonesByMember.keys());
      const zoneNames = await tx.repo.zonesByIds(ctx, [...new Set(affected.map((a) => a.zoneId))]);
      for (const [memberId, zoneIds] of zonesByMember) {
        const m = await tx.repo.findMember(ctx, memberId);
        if (!m) continue;
        after.mails.push(() =>
          notify(
            this.deps.mailer.sendAccessChanged({
              to: m.email,
              name: m.name,
              added: [],
              removed: [],
              changed: zoneIds.map((z) => zoneNames.get(z)?.name ?? z),
            }),
            'access changed',
          ),
        );
      }
    });
    return this.getProfilePermissions(ctx, id);
  }
}
