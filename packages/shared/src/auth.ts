import { z } from 'zod';
import { ROLES } from './enums';
import { zoneServiceFlagsSchema } from './zones/services';
import { isCommonPassword } from './password-policy';
import {
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  permissionKey,
  type PermissionKey,
} from './permissions';

// Request schemas for the auth endpoints (doc 09, doc 14). Shared with the login form and OpenAPI.

/** Doc 14 section 2: minimum 12 characters (configurable in Settings later). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** An account email: trimmed, lower-cased, at most 254 characters. Also used by member management (M03). */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email())
  .refine((v) => v.length <= 254, 'too long');
const email = emailSchema;
/** Doc 14 section 2 + the local denylist (password-policy.ts); used by reset, change and M03 temporary passwords. */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .refine((p) => !isCommonPassword(p), 'is too common; choose another password');

/** `tab` is the login card tab (doc 14 section 3). The server compares it with the account's role. */
export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  tab: z.enum(ROLES),
  /** "remember me" (D79): absolute 7 days, idle 8 hours instead of 12 hours / 30 minutes */
  remember: z.boolean().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: newPasswordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** POST /auth/change-password (doc 52 section 8): also the forced first-login change. */
export const changePasswordSchema = z
  .object({
    current: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    new: newPasswordSchema,
  })
  .refine((v) => v.new !== v.current, {
    path: ['new'],
    message: 'must differ from the current password',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// POST /auth/reauth takes reauthStepUpSchema and answers reauthLevelResponseSchema (auth-mfa.ts, doc 52 section 2.4).

// ---- responses (what the API returns; used by the OpenAPI document and the typed client) ------------------------------

export const userSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

// The login response (a union over the 2-step status) lives in auth-mfa.ts.

/** Every `module:action` key (doc 04), as an enum for the contract. */
export const PERMISSION_KEYS = PERMISSION_MODULES.flatMap((m) =>
  PERMISSION_ACTIONS.map((a) => permissionKey(m, a)),
) as [PermissionKey, ...PermissionKey[]];
export const permissionKeySchema = z.enum(PERMISSION_KEYS);

/** Per member per zone (doc 04, D20); refund limits in integer paise. */
export const zoneLimitsSchema = z.object({
  perRefund: z.number().int().min(0),
  dailyRefund: z.number().int().min(0),
  canReveal: z.boolean(),
  canExport: z.boolean(),
});

/** One assigned zone of a Zonal Admin in /me (doc 09): what the member may do there, computed per request. */
export const meZoneSchema = z.object({
  zoneId: z.uuid(),
  name: z.string(),
  code: z.string(),
  colorHex: z.string(),
  status: z.enum(['UPCOMING', 'ACTIVE', 'INACTIVE']),
  /** profile + GRANT overrides − DENY overrides (deny wins), sorted */
  permissions: z.array(permissionKeySchema),
  limits: zoneLimitsSchema,
  /**
   * D92: services running in the zone; the screens hide a switched-off service there. Always sent by the API; optional
   * in the type only so that older clients and fixtures keep compiling (additive change, doc 32).
   */
  services: zoneServiceFlagsSchema.optional(),
});
export type MeZone = z.infer<typeof meZoneSchema>;

export const meResponseSchema = z.object({
  user: userSummarySchema,
  mustChangePassword: z.boolean(),
  csrfToken: z.string(),
  /**
   * Super Admin: global. Zonal Admin: every active assignment with its permissions and limits (doc 09, doc 14 section 4),
   * resolved from the access tables on each request, never from the session. The UI may hide things with it; the server
   * checks every request anyway.
   */
  permissions: z.union([
    z.object({ global: z.literal(true) }),
    z.object({ global: z.literal(false), zones: z.array(meZoneSchema) }),
  ]),
  /** 2-step state (doc 52 section 8); placeholders until P8 builds the second step */
  /**
   * The zone switcher preference (D116): [] = all my zones, or one zone; a zone the member is no longer in is dropped.
   * Optional in the type (additive); always sent by the API.
   */
  zoneScope: z.array(z.uuid()).max(1).optional(),
  mfa: z.object({
    enabled: z.boolean(),
    required: z.boolean(),
    enrolmentNeeded: z.boolean(),
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** GET /me/sessions (doc 52 section 8): the caller's live sessions; `current` marks the one making the request. */
export const sessionListItemSchema = z.object({
  id: z.uuid(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  remember: z.boolean(),
  current: z.boolean(),
});
export type SessionListItem = z.infer<typeof sessionListItemSchema>;
export const sessionListResponseSchema = z.object({ data: z.array(sessionListItemSchema) });
export const sessionIdParamsSchema = z.object({ id: z.uuid() });
export const revokeOtherSessionsResponseSchema = z.object({ revoked: z.number().int().min(0) });

/** GET /auth/csrf: the same value is set as the zo_csrf cookie; send it as X-CSRF-Token before a session exists. */
export const csrfTokenResponseSchema = z.object({ token: z.string() });
export type CsrfTokenResponse = z.infer<typeof csrfTokenResponseSchema>;

export const messageResponseSchema = z.object({ message: z.string() });
export type MessageResponse = z.infer<typeof messageResponseSchema>;
