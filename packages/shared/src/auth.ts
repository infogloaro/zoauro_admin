import { z } from 'zod';
import { ROLES } from './enums';
import { isCommonPassword } from './password-policy';

// Request schemas for the auth endpoints (doc 09, doc 14). Shared with the login form and OpenAPI.

/** Doc 14 section 2: minimum 12 characters (configurable in Settings later). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email())
  .refine((v) => v.length <= 254, 'too long');
/** Doc 14 section 2 + the local denylist (password-policy.ts); used by reset and change. */
const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .refine((p) => !isCommonPassword(p), 'is too common; choose another password');

/** `tab` is the login card tab (doc 14 section 3). The server compares it with the account's role. */
export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  tab: z.enum(ROLES),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** POST /auth/change-password (doc 52 section 8): also the forced first-login change. */
export const changePasswordSchema = z
  .object({
    current: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    new: newPassword,
  })
  .refine((v) => v.new !== v.current, {
    path: ['new'],
    message: 'must differ from the current password',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const reauthSchema = z.object({ password: z.string().min(1).max(PASSWORD_MAX_LENGTH) });
export type ReauthInput = z.infer<typeof reauthSchema>;

// ---- responses (what the API returns; used by the OpenAPI document and the typed client) ------------------------------

export const userSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const loginResponseSchema = z.object({
  user: userSummarySchema,
  mustChangePassword: z.boolean(),
  /** send as X-CSRF-Token on every state-changing request */
  csrfToken: z.string(),
  /** where the UI goes next: /super-admin/dashboard, /zone/dashboard or /zone/no-zones */
  redirectTo: z.string(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const meResponseSchema = z.object({
  user: userSummarySchema,
  mustChangePassword: z.boolean(),
  csrfToken: z.string(),
  /** stub until the access module: Super Admin is global, a Zonal Admin has no resolved zones yet */
  permissions: z.union([
    z.object({ global: z.literal(true) }),
    z.object({ global: z.literal(false), zones: z.array(z.object({ zoneId: z.uuid() }).loose()) }),
  ]),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** GET /auth/csrf: the same value is set as the zo_csrf cookie; send it as X-CSRF-Token before a session exists. */
export const csrfTokenResponseSchema = z.object({ token: z.string() });
export type CsrfTokenResponse = z.infer<typeof csrfTokenResponseSchema>;

export const messageResponseSchema = z.object({ message: z.string() });
export type MessageResponse = z.infer<typeof messageResponseSchema>;

export const reauthResponseSchema = z.object({ reauthenticatedUntil: z.iso.datetime() });
export type ReauthResponse = z.infer<typeof reauthResponseSchema>;
