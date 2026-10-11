import { z } from 'zod';
import { ROLES } from './enums';

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
const newPassword = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

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

export const reauthSchema = z.object({ password: z.string().min(1).max(PASSWORD_MAX_LENGTH) });
export type ReauthInput = z.infer<typeof reauthSchema>;
