import { z } from 'zod';
import { ROLES } from './enums';

/** Login payload (doc 14 §2-3: email + password; tab is a UI selector the server verifies). */
export const loginSchema = z.object({
  email: z.email('Enter a valid email').max(254),
  password: z.string().min(1, 'Password is required').max(200),
  role: z.enum(ROLES, { error: 'Choose an account type' }),
  rememberMe: z.boolean().default(false),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Re-auth for high-risk actions (doc 14 §4: password or TOTP within 10 min). */
export const reauthSchema = z.object({
  password: z.string().min(1, 'Password is required').max(200),
});

export type ReauthInput = z.infer<typeof reauthSchema>;

/** Session user shape returned by GET /me (doc 09). */
export const meSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  isSuperAdmin: z.boolean(),
  zones: z.array(z.never()).default([]),
});

export type Me = z.infer<typeof meSchema>;
