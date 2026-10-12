import { z } from 'zod';
import { ROLES } from '@zoauro/shared';
export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(1024),
  role: z.enum(ROLES),
  rememberMe: z.boolean().default(false),
});

export const logoutSchema = z.object({});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    newPassword: z.string().min(12).max(128),
    confirmPassword: z.string().min(12).max(128),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
