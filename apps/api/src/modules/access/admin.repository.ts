import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  AccessChangeListQuery,
  AccessChangeType,
  AccessOverride,
  AssignmentLimits,
  MemberStatus,
  PermissionAction,
  ProfileDefaults,
  ProfilePermission,
  ZonalAdminListQuery,
} from '@zoauro/shared';
import { cursorFetchSize, isPermissionModule, PERMISSION_ACTIONS } from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import type { AccessAssignment, AuthContext, OverrideAction } from '../../lib/authz';
import { auditTx } from '../../lib/db';
import { AppError } from '../../lib/errors';

// M03 Access Control data (doc 08: users, access_profiles, profile_permissions, admin_zone_assignments,
// assignment_overrides, access_changes, sessions, outbox). The only M03 file that imports Prisma. Everything here is
// Super Admin data: admins:* and access:* are never grantable, so every method refuses anyone else, whatever the
// route checked before (defence in depth, like the zones repository).

const OVERRIDE_ACTION: Record<PermissionAction, OverrideAction> = {
  view: 'VIEW',
  add: 'ADD',
  edit: 'EDIT',
  delete: 'DELETE',
  status: 'STATUS',
};
const PERMISSION_ACTION: Record<OverrideAction, PermissionAction> = {
  VIEW: 'view',
  ADD: 'add',
  EDIT: 'edit',
  DELETE: 'delete',
  STATUS: 'status',
};
const FLAG_COLUMN: Record<
  PermissionAction,
  'canView' | 'canAdd' | 'canEdit' | 'canDelete' | 'canStatus'
> = {
  view: 'canView',
  add: 'canAdd',
  edit: 'canEdit',
  delete: 'canDelete',
  status: 'canStatus',
};

/** `%`, `_` and `\` are literal in the search text. */
const escapeLike = (q: string): string => q.replace(/[\\%_]/g, (c) => `\\${c}`);

const zoneChip = { id: true, name: true, code: true, colorHex: true, status: true } as const;

const memberSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  mfaEnabled: true,
  mustChangePassword: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  assignments: {
    where: { revokedAt: null, zone: { deletedAt: null } },
    orderBy: { assignedAt: 'asc' },
    select: { zone: { select: zoneChip }, profile: { select: { id: true, name: true } } },
  },
} as const satisfies Prisma.UserSelect;
type MemberRow = Prisma.UserGetPayload<{ select: typeof memberSelect }>;

export interface MemberRecord {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: MemberStatus;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  zones: {
    zoneId: string;
    name: string;
    code: string;
    colorHex: string;
    status: 'ACTIVE' | 'INACTIVE' | 'UPCOMING';
    profileId: string;
    profileName: string;
  }[];
}

const toMember = (u: MemberRow): MemberRecord => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  // any value other than ACTIVE behaves as suspended (sign-in refuses it)
  status: u.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED',
  mfaEnabled: u.mfaEnabled,
  mustChangePassword: u.mustChangePassword,
  lockedUntil: u.lockedUntil,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
  zones: u.assignments.map((a) => ({
    zoneId: a.zone.id,
    name: a.zone.name,
    code: a.zone.code,
    colorHex: a.zone.colorHex,
    status: a.zone.status,
    profileId: a.profile.id,
    profileName: a.profile.name,
  })),
});

const assignmentSelect = {
  id: true,
  zoneId: true,
  profileId: true,
  perRefundLimit: true,
  dailyRefundLimit: true,
  canReveal: true,
  canExport: true,
  note: true,
  assignedAt: true,
  zone: { select: zoneChip },
  assigner: { select: { id: true, name: true } },
  profile: {
    select: {
      id: true,
      name: true,
      deletedAt: true,
      defaultPerRefundLimit: true,
      defaultDailyRefundLimit: true,
      defaultCanReveal: true,
      defaultCanExport: true,
      permissions: {
        select: {
          module: true,
          canView: true,
          canAdd: true,
          canEdit: true,
          canDelete: true,
          canStatus: true,
        },
      },
    },
  },
  overrides: { select: { module: true, action: true, effect: true } },
} as const satisfies Prisma.AdminZoneAssignmentSelect;
type AssignmentRow = Prisma.AdminZoneAssignmentGetPayload<{ select: typeof assignmentSelect }>;

/** An active assignment with everything the editor, the preview and the resolver need. */
export interface AssignmentRecord {
  id: string;
  zone: {
    id: string;
    name: string;
    code: string;
    colorHex: string;
    status: 'ACTIVE' | 'INACTIVE' | 'UPCOMING';
  };
  profile: { id: string; name: string };
  overrides: AccessOverride[];
  limits: AssignmentLimits;
  note: string | null;
  assignedAt: Date;
  assignedBy: { id: string; name: string };
  /** the same shape the request-time resolver uses (lib/authz) */
  resolverInput: AccessAssignment;
}

function toAssignment(a: AssignmentRow): AssignmentRecord {
  const overrides: AccessOverride[] = [];
  for (const o of a.overrides) {
    if (!isPermissionModule(o.module)) continue;
    overrides.push({ module: o.module, action: PERMISSION_ACTION[o.action], effect: o.effect });
  }
  overrides.sort((x, y) => `${x.module}:${x.action}`.localeCompare(`${y.module}:${y.action}`));
  return {
    id: a.id,
    zone: a.zone,
    profile: { id: a.profile.id, name: a.profile.name },
    overrides,
    limits: {
      perRefund: a.perRefundLimit,
      dailyRefund: a.dailyRefundLimit,
      canReveal: a.canReveal,
      canExport: a.canExport,
    },
    note: a.note,
    assignedAt: a.assignedAt,
    assignedBy: a.assigner,
    resolverInput: {
      zoneId: a.zoneId,
      perRefundLimit: a.perRefundLimit,
      dailyRefundLimit: a.dailyRefundLimit,
      canReveal: a.canReveal,
      canExport: a.canExport,
      profile: {
        deleted: a.profile.deletedAt !== null,
        defaultPerRefundLimit: a.profile.defaultPerRefundLimit,
        defaultDailyRefundLimit: a.profile.defaultDailyRefundLimit,
        defaultCanReveal: a.profile.defaultCanReveal,
        defaultCanExport: a.profile.defaultCanExport,
        permissions: a.profile.permissions,
      },
      overrides: a.overrides,
    },
  };
}

const profileSelect = {
  id: true,
  name: true,
  description: true,
  isSeed: true,
  defaultPerRefundLimit: true,
  defaultDailyRefundLimit: true,
  defaultCanReveal: true,
  defaultCanExport: true,
  updatedAt: true,
  permissions: {
    select: {
      module: true,
      canView: true,
      canAdd: true,
      canEdit: true,
      canDelete: true,
      canStatus: true,
    },
  },
} as const satisfies Prisma.AccessProfileSelect;
type ProfileRow = Prisma.AccessProfileGetPayload<{ select: typeof profileSelect }>;

export interface ProfileRecord {
  id: string;
  name: string;
  description: string | null;
  isSeed: boolean;
  defaults: ProfileDefaults;
  permissions: ProfilePermission[];
  updatedAt: Date;
}

function toProfile(p: ProfileRow): ProfileRecord {
  const permissions: ProfilePermission[] = [];
  for (const row of p.permissions) {
    if (!isPermissionModule(row.module)) continue;
    const actions = PERMISSION_ACTIONS.filter((a) => row[FLAG_COLUMN[a]]);
    if (actions.length > 0) permissions.push({ module: row.module, actions });
  }
  permissions.sort((a, b) => a.module.localeCompare(b.module));
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    isSeed: p.isSeed,
    defaults: {
      perRefund: p.defaultPerRefundLimit,
      dailyRefund: p.defaultDailyRefundLimit,
      canReveal: p.defaultCanReveal,
      canExport: p.defaultCanExport,
    },
    permissions,
    updatedAt: p.updatedAt,
  };
}

export interface AccessChangeInsert {
  id: string;
  memberId: string;
  zoneId: string | null;
  changeType: AccessChangeType;
  before: unknown;
  after: unknown;
}

export interface AccessChangeRecord {
  id: string;
  createdAt: Date;
  changeType: AccessChangeType;
  actor: { id: string; name: string };
  member: { id: string; name: string };
  zone: { id: string; name: string | null } | null;
  before: unknown;
  after: unknown;
}

export interface TeamMemberRecord {
  userId: string;
  name: string;
  email: string;
  status: MemberStatus;
  assignment: AssignmentRecord;
}

const json = (v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  v === undefined || v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue);

export class AccessAdminRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  private superAdminOnly(ctx: AuthContext): void {
    if (!ctx.isSuperAdmin) throw new AppError('FORBIDDEN', 'You do not have permission to do this');
  }

  // ---- members --------------------------------------------------------------------------------------------------

  private readonly zonalMember = (id?: string): Prisma.UserWhereInput => ({
    ...(id ? { id } : {}),
    deletedAt: null,
    role: { name: 'ZONAL_ADMIN' },
  });

  async listMembers(
    ctx: AuthContext,
    q: ZonalAdminListQuery,
  ): Promise<{ rows: MemberRecord[]; total: number }> {
    this.superAdminOnly(ctx);
    const and: Prisma.UserWhereInput[] = [this.zonalMember()];
    if (q.q) {
      const like = escapeLike(q.q);
      and.push({
        OR: [
          { name: { contains: like, mode: 'insensitive' } },
          { email: { contains: like, mode: 'insensitive' } },
        ],
      });
    }
    if (q.status === 'ACTIVE') and.push({ status: 'ACTIVE' });
    if (q.status === 'SUSPENDED') and.push({ NOT: { status: 'ACTIVE' } });
    if (q.zoneId) and.push({ assignments: { some: { zoneId: q.zoneId, revokedAt: null } } });
    const where: Prisma.UserWhereInput = { AND: and };
    const field = q.sort.replace(/^-/, '') as 'name' | 'createdAt' | 'lastLoginAt';
    const direction = q.sort.startsWith('-') ? 'desc' : 'asc';
    // `nulls` is accepted only on a nullable column: never signed in sorts last either way
    const order: Prisma.UserOrderByWithRelationInput =
      field === 'lastLoginAt'
        ? { lastLoginAt: { sort: direction, nulls: 'last' } }
        : { [field]: direction };
    const [rows, total] = await Promise.all([
      this.db.user.findMany({
        where,
        select: memberSelect,
        orderBy: [order, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.user.count({ where }),
    ]);
    return { rows: rows.map(toMember), total };
  }

  async findMember(ctx: AuthContext, id: string): Promise<MemberRecord | null> {
    this.superAdminOnly(ctx);
    const row = await this.db.user.findFirst({ where: this.zonalMember(id), select: memberSelect });
    return row ? toMember(row) : null;
  }

  /** Locks the member row for the rest of the transaction: concurrent edits of one member run one after the other. */
  async lockMember(ctx: AuthContext, id: string): Promise<MemberRecord | null> {
    this.superAdminOnly(ctx);
    await this.db.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
    return this.findMember(ctx, id);
  }

  async countOpenSessions(ctx: AuthContext, userId: string, now: Date): Promise<number> {
    this.superAdminOnly(ctx);
    return this.db.session.count({ where: { userId, revokedAt: null, expiresAt: { gt: now } } });
  }

  /** Any live account (either role) with this email; emails are stored lower-cased. */
  async emailTaken(ctx: AuthContext, email: string, exceptId?: string): Promise<boolean> {
    this.superAdminOnly(ctx);
    const row = await this.db.user.findFirst({
      where: {
        deletedAt: null,
        email: { equals: email, mode: 'insensitive' },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    return row !== null;
  }

  async zonalRoleId(ctx: AuthContext): Promise<string> {
    this.superAdminOnly(ctx);
    const role = await this.db.role.findUnique({
      where: { name: 'ZONAL_ADMIN' },
      select: { id: true },
    });
    if (!role) throw new AppError('INTERNAL', 'The ZONAL_ADMIN role is missing: run db:seed');
    return role.id;
  }

  async insertMember(
    ctx: AuthContext,
    m: {
      id: string;
      name: string;
      email: string;
      phone: string | null;
      passwordHash: string;
      roleId: string;
      status: MemberStatus;
    },
  ): Promise<void> {
    this.superAdminOnly(ctx);
    await this.db.user.create({
      data: {
        ...m,
        mustChangePassword: true,
        mfaEnabled: false,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
    });
  }

  async updateMember(
    ctx: AuthContext,
    id: string,
    changes: Partial<{
      name: string;
      email: string;
      phone: string | null;
      status: MemberStatus;
      passwordHash: string;
      mustChangePassword: boolean;
      passwordChangedAt: Date;
      deletedAt: Date;
      phoneVerifiedAt: null;
    }>,
  ): Promise<void> {
    this.superAdminOnly(ctx);
    await this.db.user.update({ where: { id }, data: { ...changes, updatedBy: ctx.userId } });
  }

  /** Revokes every open session of the user; returns the token hashes to drop from the session cache. */
  async revokeSessions(
    ctx: AuthContext,
    userId: string,
    at: Date,
  ): Promise<{ id: string; tokenHash: string }[]> {
    this.superAdminOnly(ctx);
    const open = await this.db.session.findMany({
      where: { userId, revokedAt: null },
      select: { id: true, tokenHash: true },
    });
    if (open.length > 0)
      await this.db.session.updateMany({
        where: { id: { in: open.map((s) => s.id) }, revokedAt: null },
        data: { revokedAt: at },
      });
    return open;
  }

  /**
   * Disables the user's 2-step methods of these types (an email or phone change: the new address must be proven again,
   * doc 52 sections 2.3 and 2.5). Keeps a primary among what remains and mfa_enabled in step. Returns the types removed.
   */
  async disableMfaMethods(
    ctx: AuthContext,
    userId: string,
    types: readonly ('EMAIL_OTP' | 'SMS_OTP')[],
    at: Date,
  ): Promise<string[]> {
    this.superAdminOnly(ctx);
    const hit = await this.db.userMfaMethod.findMany({
      where: { userId, type: { in: [...types] }, disabledAt: null },
      select: { id: true, type: true },
    });
    if (hit.length === 0) return [];
    await this.db.userMfaMethod.updateMany({
      where: { id: { in: hit.map((h) => h.id) } },
      data: { disabledAt: at, isPrimary: false },
    });
    const remaining = await this.db.userMfaMethod.findMany({
      where: { userId, disabledAt: null, verifiedAt: { not: null } },
      select: { id: true, isPrimary: true },
      orderBy: { createdAt: 'asc' },
    });
    const first = remaining[0];
    if (first && !remaining.some((r) => r.isPrimary))
      await this.db.userMfaMethod.update({ where: { id: first.id }, data: { isPrimary: true } });
    await this.db.user.update({
      where: { id: userId },
      data: { mfaEnabled: remaining.length > 0 },
    });
    return [...new Set(hit.map((h) => h.type))];
  }

  // ---- assignments ----------------------------------------------------------------------------------------------

  async activeAssignments(ctx: AuthContext, userId: string): Promise<AssignmentRecord[]> {
    this.superAdminOnly(ctx);
    const rows = await this.db.adminZoneAssignment.findMany({
      where: { userId, revokedAt: null, zone: { deletedAt: null } },
      select: assignmentSelect,
      orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toAssignment);
  }

  async zonesByIds(
    ctx: AuthContext,
    ids: readonly string[],
  ): Promise<
    Map<string, { id: string; name: string; status: 'ACTIVE' | 'INACTIVE' | 'UPCOMING' }>
  > {
    this.superAdminOnly(ctx);
    if (ids.length === 0) return new Map();
    const rows = await this.db.zone.findMany({
      where: { id: { in: [...ids] }, deletedAt: null },
      select: { id: true, name: true, status: true },
    });
    return new Map(rows.map((z) => [z.id, z]));
  }

  async profilesByIds(
    ctx: AuthContext,
    ids: readonly string[],
  ): Promise<
    Map<
      string,
      {
        id: string;
        name: string;
        defaultPerRefundLimit: number | null;
        defaultDailyRefundLimit: number | null;
      }
    >
  > {
    this.superAdminOnly(ctx);
    if (ids.length === 0) return new Map();
    const rows = await this.db.accessProfile.findMany({
      where: { id: { in: [...ids] }, deletedAt: null },
      select: { id: true, name: true, defaultPerRefundLimit: true, defaultDailyRefundLimit: true },
    });
    return new Map(rows.map((p) => [p.id, p]));
  }

  async insertAssignment(
    ctx: AuthContext,
    a: {
      id: string;
      userId: string;
      zoneId: string;
      profileId: string;
      limits: AssignmentLimits;
      note: string | null;
      at: Date;
    },
  ): Promise<void> {
    this.superAdminOnly(ctx);
    await this.db.adminZoneAssignment.create({
      data: {
        id: a.id,
        userId: a.userId,
        zoneId: a.zoneId,
        profileId: a.profileId,
        perRefundLimit: a.limits.perRefund,
        dailyRefundLimit: a.limits.dailyRefund,
        canReveal: a.limits.canReveal,
        canExport: a.limits.canExport,
        note: a.note,
        assignedBy: ctx.userId,
        assignedAt: a.at,
      },
    });
  }

  /** In place (D104): the row, and with it the daily refund usage, survives a profile or limit change. */
  async updateAssignment(
    ctx: AuthContext,
    id: string,
    a: { profileId: string; limits: AssignmentLimits; note: string | null },
  ): Promise<void> {
    this.superAdminOnly(ctx);
    await this.db.adminZoneAssignment.update({
      where: { id },
      data: {
        profileId: a.profileId,
        perRefundLimit: a.limits.perRefund,
        dailyRefundLimit: a.limits.dailyRefund,
        canReveal: a.limits.canReveal,
        canExport: a.limits.canExport,
        note: a.note,
      },
    });
  }

  async revokeAssignments(ctx: AuthContext, ids: readonly string[], at: Date): Promise<void> {
    this.superAdminOnly(ctx);
    if (ids.length === 0) return;
    await this.db.adminZoneAssignment.updateMany({
      where: { id: { in: [...ids] }, revokedAt: null },
      data: { revokedAt: at, revokedBy: ctx.userId },
    });
  }

  async replaceOverrides(
    ctx: AuthContext,
    assignmentId: string,
    overrides: readonly AccessOverride[],
  ): Promise<void> {
    this.superAdminOnly(ctx);
    await this.db.assignmentOverride.deleteMany({ where: { assignmentId } });
    if (overrides.length > 0)
      await this.db.assignmentOverride.createMany({
        data: overrides.map((o) => ({
          assignmentId,
          module: o.module,
          action: OVERRIDE_ACTION[o.action],
          effect: o.effect,
        })),
      });
  }

  // ---- zone team ------------------------------------------------------------------------------------------------

  async zoneExists(
    ctx: AuthContext,
    zoneId: string,
  ): Promise<{ id: string; name: string; status: 'ACTIVE' | 'INACTIVE' | 'UPCOMING' } | null> {
    this.superAdminOnly(ctx);
    return this.db.zone.findFirst({
      where: { id: zoneId, deletedAt: null },
      select: { id: true, name: true, status: true },
    });
  }

  async team(ctx: AuthContext, zoneId: string): Promise<TeamMemberRecord[]> {
    this.superAdminOnly(ctx);
    const rows = await this.db.adminZoneAssignment.findMany({
      where: { zoneId, revokedAt: null, user: { deletedAt: null } },
      select: {
        ...assignmentSelect,
        user: { select: { id: true, name: true, email: true, status: true } },
      },
      orderBy: [{ user: { name: 'asc' } }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      userId: r.user.id,
      name: r.user.name,
      email: r.user.email,
      status: r.user.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED',
      assignment: toAssignment(r),
    }));
  }

  /** Total and the first three members (by name) per zone, in one query for the whole list. */
  async teamSummaries(
    ctx: AuthContext,
    zoneIds: readonly string[],
  ): Promise<Map<string, { total: number; top: { userId: string; name: string }[] }>> {
    const out = new Map<string, { total: number; top: { userId: string; name: string }[] }>();
    if (!ctx.isSuperAdmin || zoneIds.length === 0) return out;
    const rows = await this.db.adminZoneAssignment.findMany({
      where: { zoneId: { in: [...zoneIds] }, revokedAt: null, user: { deletedAt: null } },
      select: { zoneId: true, user: { select: { id: true, name: true } } },
      orderBy: [{ user: { name: 'asc' } }, { id: 'asc' }],
    });
    for (const r of rows) {
      const entry = out.get(r.zoneId) ?? { total: 0, top: [] };
      entry.total += 1;
      if (entry.top.length < 3) entry.top.push({ userId: r.user.id, name: r.user.name });
      out.set(r.zoneId, entry);
    }
    return out;
  }

  // ---- profiles -------------------------------------------------------------------------------------------------

  async listProfiles(ctx: AuthContext): Promise<ProfileRecord[]> {
    this.superAdminOnly(ctx);
    const rows = await this.db.accessProfile.findMany({
      where: { deletedAt: null },
      select: profileSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toProfile);
  }

  async findProfile(ctx: AuthContext, id: string): Promise<ProfileRecord | null> {
    this.superAdminOnly(ctx);
    const row = await this.db.accessProfile.findFirst({
      where: { id, deletedAt: null },
      select: profileSelect,
    });
    return row ? toProfile(row) : null;
  }

  /** Locks the profile row: a matrix save and a delete never interleave, nor two saves. */
  async lockProfile(ctx: AuthContext, id: string): Promise<ProfileRecord | null> {
    this.superAdminOnly(ctx);
    await this.db.$queryRaw`SELECT id FROM access_profiles WHERE id = ${id}::uuid FOR UPDATE`;
    return this.findProfile(ctx, id);
  }

  /** Serialises name checks of profile creates and renames (unique ignoring case, D108; the index is case-sensitive). */
  async lockProfileNames(ctx: AuthContext): Promise<void> {
    this.superAdminOnly(ctx);
    await this.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('access_profiles.name'))`;
  }

  async profileNameTaken(ctx: AuthContext, name: string, exceptId?: string): Promise<boolean> {
    this.superAdminOnly(ctx);
    const row = await this.db.accessProfile.findFirst({
      where: {
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    return row !== null;
  }

  /** Active assignments using each profile: distinct members and rows. */
  async profileUsage(
    ctx: AuthContext,
    profileIds: readonly string[],
  ): Promise<Map<string, { members: number; assignments: number }>> {
    this.superAdminOnly(ctx);
    const out = new Map<string, { members: number; assignments: number }>();
    if (profileIds.length === 0) return out;
    const rows = await this.db.adminZoneAssignment.findMany({
      where: { profileId: { in: [...profileIds] }, revokedAt: null, user: { deletedAt: null } },
      select: { profileId: true, userId: true },
    });
    const members = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = members.get(r.profileId) ?? new Set<string>();
      set.add(r.userId);
      members.set(r.profileId, set);
      const e = out.get(r.profileId) ?? { members: 0, assignments: 0 };
      e.assignments += 1;
      out.set(r.profileId, e);
    }
    for (const [id, set] of members) {
      const e = out.get(id);
      if (e) e.members = set.size;
    }
    return out;
  }

  /** Active assignments using the profile: who is affected by a matrix change (one PROFILE_EDITED row each). */
  async assignmentsUsingProfile(
    ctx: AuthContext,
    profileId: string,
  ): Promise<
    {
      assignmentId: string;
      userId: string;
      zoneId: string;
      perRefundLimit: number | null;
      dailyRefundLimit: number | null;
    }[]
  > {
    this.superAdminOnly(ctx);
    const rows = await this.db.adminZoneAssignment.findMany({
      where: { profileId, revokedAt: null, user: { deletedAt: null } },
      select: {
        id: true,
        userId: true,
        zoneId: true,
        perRefundLimit: true,
        dailyRefundLimit: true,
      },
      orderBy: [{ userId: 'asc' }, { zoneId: 'asc' }],
    });
    return rows.map((r) => ({
      assignmentId: r.id,
      userId: r.userId,
      zoneId: r.zoneId,
      perRefundLimit: r.perRefundLimit,
      dailyRefundLimit: r.dailyRefundLimit,
    }));
  }

  async insertProfile(
    ctx: AuthContext,
    p: { id: string; name: string; description: string | null; defaults: ProfileDefaults },
  ): Promise<void> {
    this.superAdminOnly(ctx);
    await this.db.accessProfile.create({
      data: {
        id: p.id,
        name: p.name,
        description: p.description,
        ...this.defaultColumns(p.defaults),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
    });
  }

  private defaultColumns(d: ProfileDefaults) {
    return {
      defaultPerRefundLimit: d.perRefund,
      defaultDailyRefundLimit: d.dailyRefund,
      defaultCanReveal: d.canReveal,
      defaultCanExport: d.canExport,
    };
  }

  async updateProfile(
    ctx: AuthContext,
    id: string,
    changes: Partial<{
      name: string;
      description: string | null;
      defaults: ProfileDefaults;
      deletedAt: Date;
    }>,
  ): Promise<void> {
    this.superAdminOnly(ctx);
    const { defaults, ...rest } = changes;
    await this.db.accessProfile.update({
      where: { id },
      data: { ...rest, ...(defaults ? this.defaultColumns(defaults) : {}), updatedBy: ctx.userId },
    });
  }

  async replaceProfilePermissions(
    ctx: AuthContext,
    profileId: string,
    permissions: readonly ProfilePermission[],
  ): Promise<void> {
    this.superAdminOnly(ctx);
    await this.db.profilePermission.deleteMany({ where: { profileId } });
    const rows = permissions
      .filter((p) => p.actions.length > 0)
      .map((p) => ({
        profileId,
        module: p.module,
        canView: p.actions.includes('view'),
        canAdd: p.actions.includes('add'),
        canEdit: p.actions.includes('edit'),
        canDelete: p.actions.includes('delete'),
        canStatus: p.actions.includes('status'),
      }));
    if (rows.length > 0) await this.db.profilePermission.createMany({ data: rows });
  }

  // ---- access requests (R13, D115) and the zone scope preference (D116) -------------------------------------------

  private readonly requestSelect = {
    id: true,
    kind: true,
    status: true,
    module: true,
    action: true,
    reason: true,
    decidedAt: true,
    decisionReason: true,
    version: true,
    createdAt: true,
    requester: { select: { id: true, name: true, email: true } },
    decider: { select: { id: true, name: true } },
    zone: { select: { id: true, name: true, code: true, colorHex: true, status: true } },
  } as const satisfies Prisma.AccessRequestSelect;

  private toRequest(
    r: Prisma.AccessRequestGetPayload<{ select: AccessAdminRepository['requestSelect'] }>,
  ) {
    return {
      ...r,
      action: r.action ? PERMISSION_ACTION[r.action] : null,
      module: r.module && isPermissionModule(r.module) ? r.module : null,
    };
  }

  /** A Zonal Admin's own requests (requester = the caller), newest first. */
  async myRequests(ctx: AuthContext) {
    const rows = await this.db.accessRequest.findMany({
      where: { requesterId: ctx.userId },
      select: this.requestSelect,
      orderBy: { id: 'desc' },
      take: 100,
    });
    return rows.map((r) => this.toRequest(r));
  }

  /** ACTIVE or UPCOMING zones the caller has no active assignment in (what a Zonal Admin may ask for, D115). */
  async requestableZones(ctx: AuthContext) {
    return this.db.zone.findMany({
      where: {
        deletedAt: null,
        status: { in: ['ACTIVE', 'UPCOMING'] },
        assignments: { none: { userId: ctx.userId, revokedAt: null } },
      },
      select: { id: true, name: true, code: true, status: true },
      orderBy: { name: 'asc' },
    });
  }

  async insertRequest(
    ctx: AuthContext,
    r: {
      id: string;
      kind: 'ZONE' | 'PERMISSION';
      zoneId: string;
      module: string | null;
      action: PermissionAction | null;
      reason: string;
    },
  ): Promise<void> {
    // the caller files a request for themselves only; one open request per zone and permission (unique index)
    try {
      await this.db.accessRequest.create({
        data: {
          id: r.id,
          requesterId: ctx.userId,
          kind: r.kind,
          zoneId: r.zoneId,
          module: r.module,
          action: r.action ? OVERRIDE_ACTION[r.action] : null,
          reason: r.reason,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw new AppError('CONFLICT', 'You already have an open request for this');
      throw err;
    }
  }

  /** One request with a row lock; own requests for a Zonal Admin, any for a Super Admin. */
  async lockRequest(ctx: AuthContext, id: string) {
    await this.db.$queryRaw`SELECT id FROM access_requests WHERE id = ${id}::uuid FOR UPDATE`;
    return this.findRequest(ctx, id);
  }

  async findRequest(ctx: AuthContext, id: string) {
    const r = await this.db.accessRequest.findFirst({
      where: { id, ...(ctx.isSuperAdmin ? {} : { requesterId: ctx.userId }) },
      select: this.requestSelect,
    });
    return r ? this.toRequest(r) : null;
  }

  async listRequests(
    ctx: AuthContext,
    q: {
      status?: string | undefined;
      zoneId?: string | undefined;
      requesterId?: string | undefined;
      limit: number;
      after?: string | undefined;
    },
  ) {
    this.superAdminOnly(ctx);
    const rows = await this.db.accessRequest.findMany({
      where: {
        ...(q.status ? { status: q.status as 'PENDING' } : {}),
        ...(q.zoneId ? { zoneId: q.zoneId } : {}),
        ...(q.requesterId ? { requesterId: q.requesterId } : {}),
        ...(q.after ? { id: { lt: q.after } } : {}),
      },
      select: this.requestSelect,
      orderBy: { id: 'desc' },
      take: cursorFetchSize(q.limit),
    });
    return rows.map((r) => this.toRequest(r));
  }

  async countPendingRequests(ctx: AuthContext): Promise<number> {
    this.superAdminOnly(ctx);
    return this.db.accessRequest.count({ where: { status: 'PENDING' } });
  }

  /** Moves a request out of PENDING; the caller checked status and version under the row lock. */
  async decideRequest(
    ctx: AuthContext,
    id: string,
    d: {
      status: 'APPROVED' | 'REJECTED' | 'CANCELLED';
      reason: string | null;
      at: Date;
      byRequester: boolean;
    },
  ): Promise<void> {
    if (!d.byRequester) this.superAdminOnly(ctx);
    await this.db.accessRequest.update({
      where: { id },
      data: {
        status: d.status,
        decidedBy: d.byRequester ? null : ctx.userId,
        decidedAt: d.at,
        decisionReason: d.reason,
        version: { increment: 1 },
      },
    });
  }

  /** Active Super Admins (new-request emails go to them). */
  async activeSuperAdmins(): Promise<{ email: string; name: string }[]> {
    return this.db.user.findMany({
      where: { deletedAt: null, status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } },
      select: { email: true, name: true },
    });
  }

  /** user_preferences.last_zone_scope: one zone or null = all (D116, doc 59 §4). The caller's own row only. */
  async setZoneScope(ctx: AuthContext, zoneId: string | null): Promise<void> {
    await this.db.userPreference.upsert({
      where: { userId: ctx.userId },
      create: { userId: ctx.userId, lastZoneScope: zoneId },
      update: { lastZoneScope: zoneId },
    });
  }

  async zoneLive(id: string): Promise<boolean> {
    return (await this.db.zone.count({ where: { id, deletedAt: null } })) > 0;
  }

  // ---- history and events ---------------------------------------------------------------------------------------

  async insertAccessChanges(
    ctx: AuthContext,
    rows: readonly AccessChangeInsert[],
    at: Date,
  ): Promise<void> {
    this.superAdminOnly(ctx);
    if (rows.length === 0) return;
    await this.db.accessChange.createMany({
      data: rows.map((r) => ({
        id: r.id,
        actorId: ctx.userId,
        memberId: r.memberId,
        zoneId: r.zoneId,
        changeType: r.changeType,
        beforeJson: json(r.before),
        afterJson: json(r.after),
        createdAt: at,
      })),
    });
  }

  async listAccessChanges(
    ctx: AuthContext,
    q: AccessChangeListQuery,
  ): Promise<AccessChangeRecord[]> {
    this.superAdminOnly(ctx);
    const where: Prisma.AccessChangeWhereInput = {
      ...(q.memberId ? { memberId: q.memberId } : {}),
      ...(q.zoneId ? { zoneId: q.zoneId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.changeType ? { changeType: q.changeType } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
      // ids are UUID v7: newest first is id descending
      ...(q.after ? { id: { lt: q.after } } : {}),
    };
    const rows = await this.db.accessChange.findMany({
      where,
      orderBy: { id: 'desc' },
      take: cursorFetchSize(q.limit),
    });
    const userIds = [...new Set(rows.flatMap((r) => [r.actorId, r.memberId]))];
    const zoneIds = [...new Set(rows.map((r) => r.zoneId).filter((z): z is string => z !== null))];
    const [users, zones] = await Promise.all([
      this.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
      this.db.zone.findMany({ where: { id: { in: zoneIds } }, select: { id: true, name: true } }),
    ]);
    const userName = new Map(users.map((u) => [u.id, u.name]));
    const zoneName = new Map(zones.map((z) => [z.id, z.name]));
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      changeType: r.changeType,
      actor: { id: r.actorId, name: userName.get(r.actorId) ?? 'Unknown' },
      member: { id: r.memberId, name: userName.get(r.memberId) ?? 'Unknown' },
      zone: r.zoneId ? { id: r.zoneId, name: zoneName.get(r.zoneId) ?? null } : null,
      before: r.beforeJson,
      after: r.afterJson,
    }));
  }

  async insertOutbox(
    ctx: AuthContext,
    rows: readonly { id: string; eventType: string; payload: Record<string, unknown> }[],
  ): Promise<void> {
    this.superAdminOnly(ctx);
    if (rows.length === 0) return;
    await this.db.outbox.createMany({
      data: rows.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        zoneId: null,
        payloadJson: r.payload as Prisma.InputJsonValue,
      })),
    });
  }
}

export interface AccessAdminTx {
  repo: AccessAdminRepository;
  audit: AuditTx;
}

export class AccessAdminDatabase {
  readonly repo: AccessAdminRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new AccessAdminRepository(prisma);
  }

  transaction<T>(fn: (tx: AccessAdminTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new AccessAdminRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 15_000 },
    );
  }
}
