import { z } from 'zod';
import { emailSchema, newPasswordSchema } from '../auth';
import { MEMBER_NAME_MAX, MEMBER_STATUSES, memberPhoneSchema } from './schemas';

// Super Admins (D148, refines D75; account rules of D102/D103): a Super Admin creates further Super Admins from the
// Control Panel with a temporary password (changed at the first sign-in, never emailed), STRONG re-authentication,
// audited; suspend and delete never touch oneself nor the last active Super Admin. admins:* is never grantable.

const iso = z.iso.datetime();
const reason = z.string().trim().min(5).max(500);

export const superAdminIdParamsSchema = z.object({ id: z.uuid() });

export const superAdminSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  status: z.enum(MEMBER_STATUSES),
  mfaEnabled: z.boolean(),
  mustChangePassword: z.boolean(),
  lastLoginAt: iso.nullable(),
  createdAt: iso,
  /** the caller: cannot be suspended or deleted from here */
  isSelf: z.boolean(),
});
export type SuperAdmin = z.infer<typeof superAdminSchema>;

/** GET /super-admins: every live Super Admin, name order; activeCount drives the "last Super Admin" locks. */
export const superAdminListResponseSchema = z.object({
  data: z.array(superAdminSchema),
  meta: z.object({ activeCount: z.number().int().min(0) }),
});
export type SuperAdminListResponse = z.infer<typeof superAdminListResponseSchema>;

/** POST /super-admins (STRONG): the temporary password is typed by the creator and never emailed (D103). */
export const createSuperAdminSchema = z
  .object({
    name: z.string().trim().min(1).max(MEMBER_NAME_MAX),
    email: emailSchema,
    phone: memberPhoneSchema.optional(),
    temporaryPassword: newPasswordSchema,
    reason,
  })
  .strict();
export type CreateSuperAdminInput = z.infer<typeof createSuperAdminSchema>;

/** PATCH /super-admins/{id}/status (STRONG): suspend (every session ends) or reactivate. */
export const superAdminStatusSchema = z
  .object({ status: z.enum(MEMBER_STATUSES), reason })
  .strict();
export type SuperAdminStatusInput = z.infer<typeof superAdminStatusSchema>;

/** DELETE /super-admins/{id} (STRONG): soft delete, every session ends. */
export const deleteSuperAdminSchema = z.object({ reason }).strict();
export type DeleteSuperAdminInput = z.infer<typeof deleteSuperAdminSchema>;

/** 409 details: the change would leave no active Super Admin, or targets the caller. */
export const SUPER_ADMIN_ISSUES = ['LAST_SUPER_ADMIN', 'SELF'] as const;
