import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SECURITY_POLICY,
  SECURITY_POLICY_BOUNDS,
  backupCodeSchema,
  loginHistoryReasonSchema,
  memberMfaResetSchema,
  mfaChallengeSchema,
  mfaPolicySchema,
  mfaVerifySchema,
  otpCodeSchema,
  passwordPolicySchema,
  reauthStepUpSchema,
  securityPolicySchema,
  LOGIN_STATUSES,
  loginResponseSchema,
  loginSchema,
} from './index';

const policy = DEFAULT_SECURITY_POLICY;
const mfaWith = (patch: Record<string, unknown>) => ({ ...policy.mfa, ...patch });

describe('security policy defaults (doc 52 section 5)', () => {
  it('the documented defaults are valid', () => {
    expect(securityPolicySchema.safeParse(policy).success).toBe(true);
  });
});

describe('security policy bounds: just inside passes, just outside fails', () => {
  const mfaFields = [
    'otpTtlSeconds',
    'otpMaxAttempts',
    'resendCooldownSeconds',
    'sendsPerHour',
    'sendsPerDay',
  ] as const;

  it.each(mfaFields)('mfa.%s', (field) => {
    const { min, max } = SECURITY_POLICY_BOUNDS[field];
    const ok = (v: number) => mfaPolicySchema.safeParse(mfaWith({ [field]: v })).success;
    expect(ok(min), `${field}=${min}`).toBe(true);
    expect(ok(max), `${field}=${max}`).toBe(true);
    expect(ok(min - 1), `${field}=${min - 1}`).toBe(false);
    expect(ok(max + 1), `${field}=${max + 1}`).toBe(false);
  });

  it('the exact numbers of doc 52 section 2.2', () => {
    expect(SECURITY_POLICY_BOUNDS).toMatchObject({
      otpTtlSeconds: { min: 120, max: 600 },
      otpMaxAttempts: { min: 3, max: 10 },
      resendCooldownSeconds: { min: 15, max: 120 },
      sendsPerHour: { min: 1, max: 20 },
      sendsPerDay: { min: 1, max: 50 },
    });
  });

  it('password.minLength: floor 12 cannot be lowered', () => {
    const ok = (minLength: number) =>
      passwordPolicySchema.safeParse({ ...policy.password, minLength }).success;
    expect(ok(12)).toBe(true);
    expect(ok(11)).toBe(false);
    expect(ok(128)).toBe(true);
    expect(ok(129)).toBe(false);
  });

  it('rejects fractions', () => {
    expect(mfaPolicySchema.safeParse(mfaWith({ otpTtlSeconds: 300.5 })).success).toBe(false);
  });
});

describe('security policy role rules', () => {
  it('SUPER_ADMIN always requires 2-step; ZONAL_ADMIN may be switched off', () => {
    const req = (SUPER_ADMIN: boolean, ZONAL_ADMIN: boolean) =>
      mfaPolicySchema.safeParse(mfaWith({ required: { SUPER_ADMIN, ZONAL_ADMIN } })).success;
    expect(req(true, false)).toBe(true);
    expect(req(false, true)).toBe(false);
  });

  it('SUPER_ADMIN must always allow AUTHENTICATOR', () => {
    const allow = (SUPER_ADMIN: string[]) =>
      mfaPolicySchema.safeParse(mfaWith({ allowed: { SUPER_ADMIN, ZONAL_ADMIN: ['EMAIL_OTP'] } }))
        .success;
    expect(allow(['AUTHENTICATOR'])).toBe(true);
    expect(allow(['AUTHENTICATOR', 'EMAIL_OTP'])).toBe(true);
    expect(allow(['EMAIL_OTP'])).toBe(false);
  });

  it('SMS_OTP may be allowed only with smsEnabled', () => {
    const allowed = { SUPER_ADMIN: ['AUTHENTICATOR'], ZONAL_ADMIN: ['EMAIL_OTP', 'SMS_OTP'] };
    expect(mfaPolicySchema.safeParse(mfaWith({ allowed, smsEnabled: false })).success).toBe(false);
    expect(mfaPolicySchema.safeParse(mfaWith({ allowed, smsEnabled: true })).success).toBe(true);
    const saSms = { SUPER_ADMIN: ['AUTHENTICATOR', 'SMS_OTP'], ZONAL_ADMIN: ['EMAIL_OTP'] };
    expect(mfaPolicySchema.safeParse(mfaWith({ allowed: saSms })).success).toBe(false);
  });

  it('method lists are non-empty, known and without repeats', () => {
    const allow = (ZONAL_ADMIN: string[]) =>
      mfaPolicySchema.safeParse(
        mfaWith({ allowed: { SUPER_ADMIN: ['AUTHENTICATOR'], ZONAL_ADMIN } }),
      ).success;
    expect(allow([])).toBe(false);
    expect(allow(['EMAIL_OTP', 'EMAIL_OTP'])).toBe(false);
    expect(allow(['PASSKEY'])).toBe(false);
  });
});

describe('codes', () => {
  it('OTP: 6 digits, spaces ignored', () => {
    expect(otpCodeSchema.parse('123 456')).toBe('123456');
    for (const bad of ['12345', '1234567', '12345a', '']) {
      expect(otpCodeSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('backup code: 10 Crockford base32 characters, case, spaces and hyphen ignored', () => {
    expect(backupCodeSchema.parse('abcde-fghjk')).toBe('ABCDEFGHJK');
    for (const bad of ['ABCDE-FGHJ', 'ABCDE-FGHJKM', 'ABCDE-FGHIK', 'ABCDE-FGHUK']) {
      expect(backupCodeSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('login, challenge and verify', () => {
  it('login takes remember (default false) on top of the existing fields', () => {
    const base = { email: 'A@Example.com', password: 'x', tab: 'ZONAL_ADMIN' };
    expect(loginSchema.parse(base)).toMatchObject({
      email: 'a@example.com',
      remember: false,
    });
    expect(loginSchema.parse({ ...base, remember: true }).remember).toBe(true);
  });

  it('login response: OK with the session fields, MFA_REQUIRED with methods, ENROLMENT_REQUIRED alone', () => {
    const ok = {
      status: 'OK',
      redirect: '/zone/dashboard',
      user: {
        id: '0192f1d2-0000-7000-8000-000000000001',
        name: 'A',
        email: 'a@x.test',
        role: 'ZONAL_ADMIN',
      },
      mustChangePassword: false,
      csrfToken: 't',
    };
    expect(loginResponseSchema.safeParse(ok).success).toBe(true);
    expect(loginResponseSchema.safeParse({ status: 'OK' }).success).toBe(false);
    expect(
      loginResponseSchema.safeParse({
        status: 'MFA_REQUIRED',
        methods: [{ type: 'AUTHENTICATOR', hint: 'Authenticator app' }],
        preferred: 'AUTHENTICATOR',
      }).success,
    ).toBe(true);
    expect(loginResponseSchema.safeParse({ status: 'ENROLMENT_REQUIRED' }).success).toBe(true);
    expect(loginResponseSchema.safeParse({ status: 'LOCKED' }).success).toBe(false);
    expect(LOGIN_STATUSES).toEqual(['OK', 'MFA_REQUIRED', 'ENROLMENT_REQUIRED']);
  });

  it('a code can be sent only for EMAIL_OTP and SMS_OTP', () => {
    expect(mfaChallengeSchema.safeParse({ method: 'EMAIL_OTP' }).success).toBe(true);
    expect(mfaChallengeSchema.safeParse({ method: 'AUTHENTICATOR' }).success).toBe(false);
  });

  it('verify checks the code format against the method', () => {
    expect(mfaVerifySchema.safeParse({ method: 'AUTHENTICATOR', code: '123456' }).success).toBe(
      true,
    );
    expect(mfaVerifySchema.safeParse({ method: 'BACKUP_CODE', code: 'ABCDE-FGHJK' }).success).toBe(
      true,
    );
    expect(mfaVerifySchema.safeParse({ method: 'BACKUP_CODE', code: '123456' }).success).toBe(
      false,
    );
    expect(mfaVerifySchema.safeParse({ method: 'EMAIL_OTP', code: 'ABCDE-FGHJK' }).success).toBe(
      false,
    );
  });
});

describe('re-authentication levels', () => {
  it('PASSWORD: the password alone; STRONG: password plus method and code together', () => {
    expect(reauthStepUpSchema.safeParse({ password: 'x' }).success).toBe(true);
    expect(
      reauthStepUpSchema.safeParse({ password: 'x', method: 'AUTHENTICATOR', code: '123456' })
        .success,
    ).toBe(true);
    expect(reauthStepUpSchema.safeParse({ password: 'x', code: '123456' }).success).toBe(false);
    expect(reauthStepUpSchema.safeParse({ password: 'x', method: 'EMAIL_OTP' }).success).toBe(
      false,
    );
    expect(
      reauthStepUpSchema.safeParse({ password: 'x', method: 'BACKUP_CODE', code: '123456' })
        .success,
    ).toBe(false);
  });
});

describe('member 2-step reset and login history reasons', () => {
  it('a reason is required and bounded', () => {
    expect(memberMfaResetSchema.safeParse({ reason: 'Lost phone' }).success).toBe(true);
    expect(memberMfaResetSchema.safeParse({ reason: '   ' }).success).toBe(false);
    expect(memberMfaResetSchema.safeParse({ reason: 'x'.repeat(500) }).success).toBe(true);
    expect(memberMfaResetSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });

  it('login_history.reason accepts the doc 52 values and every value the service already writes', () => {
    const doc52 = ['BAD_PASSWORD', 'WRONG_TAB', 'LOCKED', 'INACTIVE', 'MFA_FAILED', 'MFA_EXPIRED'];
    const writtenToday = ['LOGIN', 'LOGOUT', 'UNKNOWN_USER', 'MFA_UNSUPPORTED'];
    for (const r of [...doc52, 'MFA_LOCKOUT', 'OK', ...writtenToday]) {
      expect(loginHistoryReasonSchema.safeParse(r).success, r).toBe(true);
    }
    expect(loginHistoryReasonSchema.safeParse('SOMETHING').success).toBe(false);
  });
});
