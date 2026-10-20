import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, userSummarySchema } from './auth';
import { ROLES } from './enums';

// 2-step verification contracts (doc 52 sections 2, 3, 5 and 8). Shared with the forms and the OpenAPI document.
// The login request is loginSchema in auth.ts; everything 2-step specific is here.

// ---- enums ------------------------------------------------------------------------------------------------------------

/** Database enum MfaType (doc 52 section 3). */
export const MFA_TYPES = ['AUTHENTICATOR', 'EMAIL_OTP', 'SMS_OTP'] as const;
export type MfaType = (typeof MFA_TYPES)[number];

/** Database enum MfaPurpose (doc 52 section 3). */
export const MFA_PURPOSES = ['LOGIN', 'ENROL_PROOF', 'ENROL_EMAIL', 'ENROL_SMS', 'REAUTH'] as const;
export type MfaPurpose = (typeof MFA_PURPOSES)[number];

/** What passed the second step: sessions.mfa_method and login_history.mfa_method (text columns). */
export const MFA_METHODS_USED = [...MFA_TYPES, 'BACKUP_CODE'] as const;
export type MfaMethodUsed = (typeof MFA_METHODS_USED)[number];

/** OTP methods a code can be sent for (mfa_challenges.method). */
export const OTP_MFA_TYPES = ['EMAIL_OTP', 'SMS_OTP'] as const;

export const LOGIN_STATUSES = ['OK', 'MFA_REQUIRED', 'ENROLMENT_REQUIRED'] as const;
export type LoginStatus = (typeof LOGIN_STATUSES)[number];

/** sessions.reauth_level (doc 52 section 2.4): PASSWORD 10 min, STRONG 5 min and single action. */
export const REAUTH_LEVELS = ['PASSWORD', 'STRONG'] as const;
export type ReauthLevel = (typeof REAUTH_LEVELS)[number];

/** sessions.restricted: only change-password, /me and logout work (doc 52 section 2.1). */
export const SESSION_RESTRICTIONS = ['PASSWORD_CHANGE'] as const;
export type SessionRestriction = (typeof SESSION_RESTRICTIONS)[number];

/**
 * login_history.reason (text column). Doc 52 section 3 lists BAD_PASSWORD … OK; the current auth service also writes
 * LOGIN (success, before doc 52), LOGOUT, UNKNOWN_USER and MFA_UNSUPPORTED (2-step not built yet), which stay valid for
 * existing rows.
 */
export const LOGIN_HISTORY_REASONS = [
  'BAD_PASSWORD',
  'WRONG_TAB',
  'LOCKED',
  'INACTIVE',
  'MFA_FAILED',
  'MFA_EXPIRED',
  'MFA_LOCKOUT',
  'OK',
  'LOGIN',
  'LOGOUT',
  'UNKNOWN_USER',
  'MFA_UNSUPPORTED',
] as const;
export const loginHistoryReasonSchema = z.enum(LOGIN_HISTORY_REASONS);
export type LoginHistoryReason = (typeof LOGIN_HISTORY_REASONS)[number];

// ---- codes ------------------------------------------------------------------------------------------------------------

/** TOTP and OTP codes: 6 digits (doc 52 section 2.2). Spaces typed by the user are ignored. */
export const otpCodeSchema = z
  .string()
  .transform((v) => v.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'must be 6 digits'));

/** Backup codes: 10 Crockford base32 characters shown as XXXXX-XXXXX; case, spaces and the hyphen are ignored. */
export const backupCodeSchema = z
  .string()
  .max(32)
  .transform((v) => v.replace(/[\s-]/g, '').toUpperCase())
  .pipe(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{10}$/, 'must be a 10-character backup code'));

export const BACKUP_CODE_COUNT = 10;

// ---- login (POST /auth/login) -----------------------------------------------------------------------------------------

// The request is loginSchema (auth.ts; it carries `remember`).

/**
 * Signed in: the session cookie is set. Returned by /auth/login when no second step applies, and by /auth/mfa/verify
 * and /auth/mfa/enrol/complete (doc 52 section 8: {status:'OK', redirect}); user, mustChangePassword and csrfToken are
 * the existing login fields, so a client needs no extra /me call.
 */
export const loginOkResponseSchema = z.object({
  status: z.literal('OK'),
  /** /super-admin/dashboard, /zone/dashboard or /zone/no-zones */
  redirect: z.string(),
  user: userSummarySchema,
  mustChangePassword: z.boolean(),
  /** send as X-CSRF-Token on every state-changing request of this session */
  csrfToken: z.string(),
});
export type LoginOkResponse = z.infer<typeof loginOkResponseSchema>;

/**
 * POST /auth/login (doc 52 sections 2.1 and 8). MFA_REQUIRED / ENROLMENT_REQUIRED: no session yet, only the pending
 * cookie zo_mfa. Methods are listed only after the password was correct (rule 4).
 */
export const loginResponseSchema = z.discriminatedUnion('status', [
  loginOkResponseSchema,
  z.object({
    status: z.literal('MFA_REQUIRED'),
    methods: z.array(z.object({ type: z.enum(MFA_TYPES), hint: z.string() })),
    preferred: z.enum(MFA_TYPES).optional(),
  }),
  z.object({ status: z.literal('ENROLMENT_REQUIRED') }),
]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

// ---- challenge and verify (POST /auth/mfa/challenge, /auth/mfa/verify) -----------------------------------------------

export const mfaChallengeSchema = z.object({ method: z.enum(OTP_MFA_TYPES) });
export type MfaChallengeInput = z.infer<typeof mfaChallengeSchema>;

export const mfaChallengeResponseSchema = z.object({
  sent: z.boolean(),
  hint: z.string(),
  resendAfterSeconds: z.number().int().min(0),
  expiresInSeconds: z.number().int().min(0),
});
export type MfaChallengeResponse = z.infer<typeof mfaChallengeResponseSchema>;

export const mfaVerifySchema = z.discriminatedUnion('method', [
  z.object({ method: z.enum(MFA_TYPES), code: otpCodeSchema }),
  z.object({ method: z.literal('BACKUP_CODE'), code: backupCodeSchema }),
]);
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

// ---- enrolment (/me/mfa/*) --------------------------------------------------------------------------------------------

/** /me/mfa/email/confirm, /me/mfa/authenticator/confirm, /me/mfa/sms/confirm */
export const mfaConfirmSchema = z.object({ code: otpCodeSchema });
export type MfaConfirmInput = z.infer<typeof mfaConfirmSchema>;

export const authenticatorStartResponseSchema = z.object({
  secretBase32: z.string(),
  otpauthUri: z.string(),
});
export type AuthenticatorStartResponse = z.infer<typeof authenticatorStartResponseSchema>;

/** /me/mfa/{email,authenticator,sms}/confirm: backupCodes only when this is the user's first confirmed method */
export const authenticatorConfirmResponseSchema = z.object({
  backupCodes: z.array(z.string()).length(BACKUP_CODE_COUNT).optional(),
});
export const mfaConfirmResponseSchema = authenticatorConfirmResponseSchema;

/** DELETE /me/mfa/{type} */
export const mfaTypeParamsSchema = z.object({ type: z.enum(MFA_TYPES) });

/** GET /me/mfa (doc 52 section 8): the user's methods (hints only, never a secret) and what the policy allows them. */
export const mfaOverviewSchema = z.object({
  methods: z.array(z.object({ type: z.enum(MFA_TYPES), hint: z.string(), primary: z.boolean() })),
  /** an authenticator was started but not confirmed yet */
  authenticatorPending: z.boolean(),
  backupCodesRemaining: z.number().int().min(0),
  policy: z.object({
    allowed: z.array(z.enum(MFA_TYPES)),
    required: z.boolean(),
    smsAvailable: z.boolean(),
  }),
  /** enrolment during sign-in only: the account mailbox was proven (doc 52 section 2.3) */
  mailboxProved: z.boolean().optional(),
});
export type MfaOverview = z.infer<typeof mfaOverviewSchema>;

/**
 * POST /auth/mfa/enrol/complete (doc 52 section 2.3 step 4). Doc 52 shows an empty body but requires the backup codes to
 * be acknowledged first (TC-AUTH-25): the acknowledgement is this field (doc 32).
 */
export const enrolCompleteSchema = z.object({ backupCodesAcknowledged: z.boolean() }).strict();
export type EnrolCompleteInput = z.infer<typeof enrolCompleteSchema>;

export const mfaPrimarySchema = z.object({ type: z.enum(MFA_TYPES) });
export type MfaPrimaryInput = z.infer<typeof mfaPrimarySchema>;

export const backupCodesResponseSchema = z.object({
  codes: z.array(z.string()).length(BACKUP_CODE_COUNT),
});

// ---- re-authentication (POST /auth/reauth with a level) ---------------------------------------------------------------

/** PASSWORD level: password only. STRONG level: password and a current second-step code (or a backup code). */
export const reauthStepUpSchema = z
  .object({
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    method: z.enum(MFA_METHODS_USED).optional(),
    code: z.string().max(32).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.method === undefined) !== (v.code === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['code'], message: 'method and code go together' });
      return;
    }
    if (v.method === undefined || v.code === undefined) return;
    const check = (v.method === 'BACKUP_CODE' ? backupCodeSchema : otpCodeSchema).safeParse(v.code);
    if (!check.success) ctx.addIssue({ code: 'custom', path: ['code'], message: 'invalid code' });
  });
export type ReauthStepUpInput = z.infer<typeof reauthStepUpSchema>;

export const reauthLevelResponseSchema = z.object({
  level: z.enum(REAUTH_LEVELS),
  validUntil: z.iso.datetime(),
});
export type ReauthLevelResponse = z.infer<typeof reauthLevelResponseSchema>;

// ---- member 2-step reset (POST /members/{id}/mfa/reset) ---------------------------------------------------------------

export const MFA_RESET_REASON_MAX = 500;
export const memberIdParamsSchema = z.object({ id: z.uuid() });
export const memberMfaResetSchema = z.object({
  reason: z.string().trim().min(1, 'is required').max(MFA_RESET_REASON_MAX),
});
export type MemberMfaResetInput = z.infer<typeof memberMfaResetSchema>;
export const mfaResetResponseSchema = z.object({
  methodsRemoved: z.number().int().min(0),
  sessionsRevoked: z.number().int().min(0),
});

// ---- security policy (settings keys security.*, doc 52 section 5) ----------------------------------------------------

/** Floors and ceilings: doc 52 section 2.2 (OTP engine) and section 5 (password floor). */
export const SECURITY_POLICY_BOUNDS = {
  passwordMinLength: { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH },
  otpTtlSeconds: { min: 120, max: 600 },
  otpMaxAttempts: { min: 3, max: 10 },
  resendCooldownSeconds: { min: 15, max: 120 },
  sendsPerHour: { min: 1, max: 20 },
  sendsPerDay: { min: 1, max: 50 },
} as const;

const B = SECURITY_POLICY_BOUNDS;
const bounded = (b: { min: number; max: number }) => z.number().int().min(b.min).max(b.max);
const positiveInt = z.number().int().positive();

export const passwordPolicySchema = z.object({
  minLength: bounded(B.passwordMinLength),
  denylist: z.boolean(),
  maxAgeDays: positiveInt.nullable(),
});

/** D37. Doc 52 gives defaults only (5 attempts, 30 minutes), no bounds. */
export const lockoutPolicySchema = z.object({
  maxAttempts: positiveInt,
  lockMinutes: positiveInt,
});

/** Defaults in doc 52 section 2.6; no bounds given there. */
export const sessionPolicySchema = z.object({
  idleMinutes: positiveInt,
  absoluteHours: positiveInt,
  rememberDays: positiveInt,
  rememberIdleHours: positiveInt,
  maxSessions: positiveInt,
});

const methodList = z
  .array(z.enum(MFA_TYPES))
  .min(1)
  .refine((l) => new Set(l).size === l.length, 'must not repeat a method');

export const mfaPolicySchema = z
  .object({
    required: z.object({
      /** SUPER_ADMIN cannot be set false */
      SUPER_ADMIN: z.literal(true),
      ZONAL_ADMIN: z.boolean(),
    }),
    allowed: z.object({ SUPER_ADMIN: methodList, ZONAL_ADMIN: methodList }),
    /** server side also requires a real SMS provider and DLT template before this may be true (doc 52 section 5) */
    smsEnabled: z.boolean(),
    otpTtlSeconds: bounded(B.otpTtlSeconds),
    otpMaxAttempts: bounded(B.otpMaxAttempts),
    resendCooldownSeconds: bounded(B.resendCooldownSeconds),
    sendsPerHour: bounded(B.sendsPerHour),
    sendsPerDay: bounded(B.sendsPerDay),
    smsHourlyGlobalCap: positiveInt,
  })
  .superRefine((p, ctx) => {
    if (!p.allowed.SUPER_ADMIN.includes('AUTHENTICATOR')) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowed', 'SUPER_ADMIN'],
        message: 'must include AUTHENTICATOR',
      });
    }
    if (!p.smsEnabled) {
      for (const role of ROLES) {
        if (p.allowed[role].includes('SMS_OTP')) {
          ctx.addIssue({
            code: 'custom',
            path: ['allowed', role],
            message: 'SMS_OTP needs smsEnabled',
          });
        }
      }
    }
  });
export type MfaPolicy = z.infer<typeof mfaPolicySchema>;

export const securityPolicySchema = z.object({
  password: passwordPolicySchema,
  lockout: lockoutPolicySchema,
  session: sessionPolicySchema,
  mfa: mfaPolicySchema,
});
export type SecurityPolicy = z.infer<typeof securityPolicySchema>;

/**
 * PUT /settings/security: the 2-step part only (audit settings.2fa_policy_changed). Password, lockout and session values
 * are shown by GET as they are in effect; editing them waits until the auth code reads them from settings (doc 32).
 */
export const securityPolicyUpdateSchema = z.object({ mfa: mfaPolicySchema }).strict();
export type SecurityPolicyUpdate = z.infer<typeof securityPolicyUpdateSchema>;

/** GET /settings/security/status (doc 52 section 8): the Security Status card. */
export const securityStatusSchema = z.object({
  members: z.array(
    z.object({ role: z.enum(ROLES), enrolled: z.number().int(), notEnrolled: z.number().int() }),
  ),
  methods: z.array(z.object({ type: z.enum(MFA_TYPES), count: z.number().int() })),
  /** doc 52 section 2.5 (D75): warn when fewer than 2 active Super Admins exist */
  activeSuperAdmins: z.number().int(),
  superAdminWarning: z.boolean(),
  sms: z.object({
    provider: z.enum(['none', 'console', 'msg91']),
    enabled: z.boolean(),
    paused: z.boolean(),
  }),
  failedSecondStepsLast24h: z.number().int(),
});
export type SecurityStatus = z.infer<typeof securityStatusSchema>;

/** The defaults of doc 52 section 5. */
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  password: { minLength: 12, denylist: true, maxAgeDays: null },
  lockout: { maxAttempts: 5, lockMinutes: 30 },
  session: {
    idleMinutes: 30,
    absoluteHours: 12,
    rememberDays: 7,
    rememberIdleHours: 8,
    maxSessions: 3,
  },
  mfa: {
    required: { SUPER_ADMIN: true, ZONAL_ADMIN: true },
    // D66 (owner 2026-10-14): every admin picks any one allowed method; SMS joins once smsEnabled is switched on
    allowed: {
      SUPER_ADMIN: ['AUTHENTICATOR', 'EMAIL_OTP'],
      ZONAL_ADMIN: ['AUTHENTICATOR', 'EMAIL_OTP'],
    },
    smsEnabled: false,
    otpTtlSeconds: 300,
    otpMaxAttempts: 5,
    resendCooldownSeconds: 30,
    sendsPerHour: 5,
    sendsPerDay: 10,
    smsHourlyGlobalCap: 200,
  },
};
