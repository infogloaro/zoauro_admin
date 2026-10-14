import { z } from 'zod';
import { emailSchema, newPasswordSchema, permissionKeySchema } from '../auth';
import {
  cursorMetaSchema,
  DEFAULT_CURSOR_LIMIT,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  pageMetaSchema,
} from '../pagination';
import { normaliseIndianMobile } from '../phone';
import { PERMISSION_ACTIONS, PERMISSION_MODULES } from '../permissions';
import { ZONE_STATUSES } from '../zones/schemas';

// M03 Access Control contract (doc 09 "Zonal admins and access", doc 04, doc 14 section 4, doc 36, owner decisions
// D102–D108). Shared with the screens and the OpenAPI document. Every route is Super Admin only: admins:* and access:*
// are never grantable to a Zonal Admin.

const iso = z.iso.datetime();
const count = z.number().int().min(0);
const id = z.uuid();

// ---- limits (D106) ------------------------------------------------------------------------------------------------

/** D106: at most INR 1,00,000 per refund and per day, in integer paise. Empty (null) = the profile default. */
export const ACCESS_LIMIT_MAX_PAISE = 1_00_000 * 100;
const limitPaise = z.number().int().min(0).max(ACCESS_LIMIT_MAX_PAISE);

/** Limits and flags as stored on an assignment: null = use the profile default (doc 08). */
export const assignmentLimitsSchema = z.object({
  perRefund: limitPaise.nullable(),
  dailyRefund: limitPaise.nullable(),
  canReveal: z.boolean().nullable(),
  canExport: z.boolean().nullable(),
});
export type AssignmentLimits = z.infer<typeof assignmentLimitsSchema>;

/** A profile's default limits and flags. An empty refund limit means INR 0: every refund needs approval (D106). */
export const profileDefaultsSchema = z.object({
  perRefund: limitPaise.nullable(),
  dailyRefund: limitPaise.nullable(),
  canReveal: z.boolean(),
  canExport: z.boolean(),
});
export type ProfileDefaults = z.infer<typeof profileDefaultsSchema>;

/** What applies after the profile defaults are filled in (the resolver's ZoneLimits, paise). */
export const effectiveLimitsSchema = z.object({
  perRefund: count,
  dailyRefund: count,
  canReveal: z.boolean(),
  canExport: z.boolean(),
});

// ---- permission matrix ----------------------------------------------------------------------------------------------

export const permissionModuleSchema = z.enum(PERMISSION_MODULES);
export const permissionActionSchema = z.enum(PERMISSION_ACTIONS);

/**
 * One module row of a profile's matrix (View/Add/Edit/Delete/Status, D105). A module that is absent grants nothing.
 * Saving anything a Zonal Admin can never hold is refused with 422 listing every offender (TC-AC-6, D108).
 */
export const profilePermissionSchema = z.object({
  module: permissionModuleSchema,
  actions: z
    .array(permissionActionSchema)
    .max(PERMISSION_ACTIONS.length)
    .refine((a) => new Set(a).size === a.length, 'must not repeat an action'),
});
export type ProfilePermission = z.infer<typeof profilePermissionSchema>;

const permissionMatrix = z
  .array(profilePermissionSchema)
  .max(PERMISSION_MODULES.length)
  .refine(
    (rows) => new Set(rows.map((r) => r.module)).size === rows.length,
    'must not repeat a module',
  );

export const OVERRIDE_EFFECTS = ['GRANT', 'DENY'] as const;
export type OverrideEffect = (typeof OVERRIDE_EFFECTS)[number];

/** A per-assignment exception to the profile: GRANT adds an action, DENY removes it; deny wins (doc 04). */
export const accessOverrideSchema = z.object({
  module: permissionModuleSchema,
  action: permissionActionSchema,
  effect: z.enum(OVERRIDE_EFFECTS),
});
export type AccessOverride = z.infer<typeof accessOverrideSchema>;

// ---- members (GET/POST /zonal-admins, GET/PATCH/DELETE /zonal-admins/{id}) -----------------------------------------

/** D102: members are ACTIVE or SUSPENDED; suspending ends every session. Deleted members are gone from the lists. */
export const MEMBER_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const MEMBER_NAME_MAX = 120;
const memberName = z.string().trim().min(1).max(MEMBER_NAME_MAX);
/** An Indian mobile number in any common form; stored and returned as E.164 (+91…). */
export const memberPhoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const e164 = normaliseIndianMobile(v);
    if (!e164) {
      ctx.addIssue({ code: 'custom', message: 'must be an Indian mobile number' });
      return z.NEVER;
    }
    return e164;
  });

export const zonalAdminIdParamsSchema = z.object({ id });

/** GET /zonal-admins: page list, newest first by default; `zoneId` = members with an active assignment there. */
export const zonalAdminListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  /** name or email contains (case-insensitive) */
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(MEMBER_STATUSES).optional(),
  zoneId: id.optional(),
  sort: z
    .enum(['name', '-name', 'createdAt', '-createdAt', 'lastLoginAt', '-lastLoginAt'])
    .default('-createdAt'),
});
export type ZonalAdminListQuery = z.infer<typeof zonalAdminListQuerySchema>;

/** A zone of a member, as chips in the list and on the detail page. */
export const memberZoneSchema = z.object({
  zoneId: id,
  name: z.string(),
  code: z.string(),
  colorHex: z.string(),
  status: z.enum(ZONE_STATUSES),
  profileId: id,
  profileName: z.string(),
});
export type MemberZone = z.infer<typeof memberZoneSchema>;

export const zonalAdminSchema = z.object({
  id,
  name: z.string(),
  /** in full: staff account identifiers, shown to Super Admins only (D26 masks customer and partner contacts) */
  email: z.string(),
  phone: z.string().nullable(),
  status: z.enum(MEMBER_STATUSES),
  mfaEnabled: z.boolean(),
  mustChangePassword: z.boolean(),
  /** locked by failed sign-ins until this time (doc 52); null when not locked */
  lockedUntil: iso.nullable(),
  lastLoginAt: iso.nullable(),
  createdAt: iso,
  updatedAt: iso,
  zones: z.array(memberZoneSchema),
});
export type ZonalAdmin = z.infer<typeof zonalAdminSchema>;

export const zonalAdminListResponseSchema = z.object({
  data: z.array(zonalAdminSchema),
  meta: pageMetaSchema,
});

export const zonalAdminDetailSchema = zonalAdminSchema.extend({
  /** sessions that are open right now */
  activeSessions: count,
});
export type ZonalAdminDetail = z.infer<typeof zonalAdminDetailSchema>;

/**
 * POST /zonal-admins (D103): the account with a temporary password the Super Admin types; the member must change it at
 * the first sign-in and enrols 2-step then. No password is ever emailed. Zones are given on the access screen.
 */
export const createZonalAdminSchema = z
  .object({
    name: memberName,
    email: emailSchema,
    phone: memberPhoneSchema.optional(),
    temporaryPassword: newPasswordSchema,
    status: z.enum(MEMBER_STATUSES).default('ACTIVE'),
  })
  .strict();
export type CreateZonalAdminInput = z.infer<typeof createZonalAdminSchema>;

/**
 * PATCH /zonal-admins/{id}: any of name, phone (null clears it), email, status. Changing the email needs a STRONG
 * re-authentication (D107); SUSPENDED ends every session (D102). At least one field.
 */
export const updateZonalAdminSchema = z
  .object({
    name: memberName.optional(),
    phone: memberPhoneSchema.nullable().optional(),
    email: emailSchema.optional(),
    status: z.enum(MEMBER_STATUSES).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'nothing to change');
export type UpdateZonalAdminInput = z.infer<typeof updateZonalAdminSchema>;

/** POST /zonal-admins/{id}/reset-password (D103): a new temporary password; every session ends; the email has no password. */
export const resetZonalAdminPasswordSchema = z
  .object({ temporaryPassword: newPasswordSchema })
  .strict();
export type ResetZonalAdminPasswordInput = z.infer<typeof resetZonalAdminPasswordSchema>;

export const revokedSessionsResponseSchema = z.object({ sessionsRevoked: count });

// ---- a member's access (GET/PUT /zonal-admins/{id}/access) ----------------------------------------------------------

export const ASSIGNMENT_NOTE_MAX = 500;

export const memberAssignmentSchema = z.object({
  assignmentId: id,
  zone: z.object({
    id,
    name: z.string(),
    code: z.string(),
    colorHex: z.string(),
    status: z.enum(ZONE_STATUSES),
  }),
  profile: z.object({ id, name: z.string() }),
  overrides: z.array(accessOverrideSchema),
  /** as stored (null = profile default) */
  limits: assignmentLimitsSchema,
  /** after the profile defaults are filled in */
  effectiveLimits: effectiveLimitsSchema,
  /** the effective permissions in this zone (profile + grants − denies) */
  permissions: z.array(permissionKeySchema),
  note: z.string().nullable(),
  assignedAt: iso,
  assignedBy: z.object({ id, name: z.string() }),
});
export type MemberAssignment = z.infer<typeof memberAssignmentSchema>;

export const memberAccessSchema = z.object({
  memberId: id,
  /** opaque; send it back with PUT to refuse a save over someone else's change (409 STALE_VERSION) */
  version: z.string(),
  assignments: z.array(memberAssignmentSchema),
});
export type MemberAccess = z.infer<typeof memberAccessSchema>;

export const assignmentInputSchema = z.object({
  zoneId: id,
  profileId: id,
  overrides: z
    .array(accessOverrideSchema)
    .max(PERMISSION_MODULES.length * PERMISSION_ACTIONS.length)
    .default([])
    .refine(
      (o) => new Set(o.map((x) => `${x.module}:${x.action}`)).size === o.length,
      'one override per module action',
    ),
  limits: assignmentLimitsSchema.default({
    perRefund: null,
    dailyRefund: null,
    canReveal: null,
    canExport: null,
  }),
  note: z.string().trim().max(ASSIGNMENT_NOTE_MAX).nullable().optional(),
});
export type AssignmentInput = z.infer<typeof assignmentInputSchema>;

/**
 * PUT /zonal-admins/{id}/access (PASSWORD re-auth, D107): the member's complete set of zones. Existing assignments are
 * updated in place (daily refund usage kept), zones left out are ended, overrides are replaced (D104). Zones must be
 * ACTIVE or UPCOMING (D108). An empty list ends every assignment (the member keeps the session: no-zones page, D102).
 */
export const putMemberAccessSchema = z
  .object({
    assignments: z
      .array(assignmentInputSchema)
      .max(200)
      .refine((a) => new Set(a.map((x) => x.zoneId)).size === a.length, 'one assignment per zone'),
    version: z.string().max(100).optional(),
  })
  .strict();
export type PutMemberAccessInput = z.infer<typeof putMemberAccessSchema>;

/** GET /zonal-admins/{id}/access/preview?zoneId= */
export const accessPreviewQuerySchema = z.object({ zoneId: id });

/**
 * The effective access of one member in one zone (D108, TC-AC-11), computed by the same resolver every request uses.
 * `matrix` explains each cell: from the profile, an override, and whether a Zonal Admin may ever hold it.
 */
export const accessPreviewSchema = z.object({
  memberId: id,
  zoneId: id,
  /** false: the member has no active assignment in this zone (everything below is empty) */
  assigned: z.boolean(),
  permissions: z.array(permissionKeySchema),
  limits: effectiveLimitsSchema,
  matrix: z.array(
    z.object({
      module: permissionModuleSchema,
      action: permissionActionSchema,
      grantable: z.boolean(),
      fromProfile: z.boolean(),
      override: z.enum(OVERRIDE_EFFECTS).nullable(),
      effective: z.boolean(),
    }),
  ),
  /** modules the member can open (view permission): what their sidebar and dashboard tiles show */
  visibleModules: z.array(permissionModuleSchema),
});
export type AccessPreview = z.infer<typeof accessPreviewSchema>;

// ---- zone team (GET /zones/{id}/team is in zones/responses.ts; POST/DELETE /zones/{id}/team/{userId}) --------------

export const zoneTeamParamsSchema = z.object({ id, userId: id });

/** POST /zones/{id}/team/{userId} (PASSWORD re-auth): adds the member to the zone with a profile. */
export const addTeamMemberSchema = z
  .object({
    profileId: id,
    limits: assignmentLimitsSchema.optional(),
    note: z.string().trim().max(ASSIGNMENT_NOTE_MAX).nullable().optional(),
  })
  .strict();
export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;

// ---- access change history (GET /access-changes) -------------------------------------------------------------------

export const ACCESS_CHANGE_TYPES = [
  'PROFILE_SET',
  'OVERRIDE_SET',
  'LIMIT_SET',
  'ZONE_ADDED',
  'ZONE_REMOVED',
  'PROFILE_EDITED',
] as const;
export type AccessChangeType = (typeof ACCESS_CHANGE_TYPES)[number];

/** Filters member, zone, actor, type and date, newest first, cursor = the last id (like /audit-logs). */
export const accessChangeListQuerySchema = z
  .object({
    memberId: id.optional(),
    zoneId: id.optional(),
    actorId: id.optional(),
    changeType: z.enum(ACCESS_CHANGE_TYPES).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_CURSOR_LIMIT),
    after: id.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'from must be before to',
    path: ['from'],
  });
export type AccessChangeListQuery = z.infer<typeof accessChangeListQuerySchema>;

export const accessChangeSchema = z.object({
  id,
  createdAt: iso,
  changeType: z.enum(ACCESS_CHANGE_TYPES),
  actor: z.object({ id, name: z.string() }),
  member: z.object({ id, name: z.string() }),
  /** null for a change without a zone; name null when the zone no longer exists */
  zone: z.object({ id, name: z.string().nullable() }).nullable(),
  before: z.unknown(),
  after: z.unknown(),
});
export type AccessChangeRow = z.infer<typeof accessChangeSchema>;

export const accessChangeListResponseSchema = z.object({
  data: z.array(accessChangeSchema),
  meta: cursorMetaSchema,
});

// ---- access profiles (GET/POST /access-profiles, GET/PATCH/DELETE /access-profiles/{id}, …/permissions) ------------

export const PROFILE_NAME_MAX = 80;
export const PROFILE_DESCRIPTION_MAX = 500;

export const accessProfileIdParamsSchema = z.object({ id });

export const accessProfileSummarySchema = z.object({
  id,
  name: z.string(),
  description: z.string().nullable(),
  /** created by the seed (doc 04: editable and deletable like any other) */
  isSeed: z.boolean(),
  defaults: profileDefaultsSchema,
  /** members with an active assignment using this profile, and in how many zones */
  membersCount: count,
  assignmentsCount: count,
  updatedAt: iso,
});
export type AccessProfileSummary = z.infer<typeof accessProfileSummarySchema>;

export const accessProfileListResponseSchema = z.object({
  data: z.array(accessProfileSummarySchema),
});

export const accessProfileDetailSchema = accessProfileSummarySchema.extend({
  permissions: z.array(profilePermissionSchema),
});
export type AccessProfileDetail = z.infer<typeof accessProfileDetailSchema>;

/** POST /access-profiles (PASSWORD re-auth). Names are unique ignoring case (D108). */
export const createAccessProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(PROFILE_NAME_MAX),
    description: z.string().trim().max(PROFILE_DESCRIPTION_MAX).nullable().optional(),
    defaults: profileDefaultsSchema.default({
      perRefund: null,
      dailyRefund: null,
      canReveal: false,
      canExport: false,
    }),
    permissions: permissionMatrix.default([]),
  })
  .strict();
export type CreateAccessProfileInput = z.infer<typeof createAccessProfileSchema>;

/** PATCH /access-profiles/{id} (PASSWORD re-auth): name and description. */
export const updateAccessProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(PROFILE_NAME_MAX).optional(),
    description: z.string().trim().max(PROFILE_DESCRIPTION_MAX).nullable().optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.description !== undefined, 'nothing to change');
export type UpdateAccessProfileInput = z.infer<typeof updateAccessProfileSchema>;

/** GET /access-profiles/{id}/permissions */
export const accessProfilePermissionsSchema = z.object({
  profileId: id,
  permissions: z.array(profilePermissionSchema),
  defaults: profileDefaultsSchema,
});
export type AccessProfilePermissions = z.infer<typeof accessProfilePermissionsSchema>;

/**
 * PUT /access-profiles/{id}/permissions (PASSWORD re-auth): the whole matrix and the default limits. Every member using
 * the profile gets one PROFILE_EDITED row and their cached access cleared (D104, D107).
 */
export const putAccessProfilePermissionsSchema = z
  .object({ permissions: permissionMatrix, defaults: profileDefaultsSchema })
  .strict();
export type PutAccessProfilePermissionsInput = z.infer<typeof putAccessProfilePermissionsSchema>;
