import {
  PASSWORD_MIN_LENGTH,
  ROLES,
  type MfaPolicy,
  type SecurityPolicy,
  type SecurityStatus,
} from '@zoauro/shared';
import { noteAuditNoop, record } from '../../../lib/audit';
import type { AuthConfig } from '../../../lib/auth/config';
import type { SessionStore } from '../../../lib/auth/session-store';
import { AppError } from '../../../lib/errors';
import type { AuthDatabase } from '../auth.repository';
import { MFA_POLICY_SETTING_KEY, usableMethodsFor, type MfaPolicyReader } from './policy';
import {
  smsEnablementProblem,
  type SmsCircuitBreaker,
  type SmsProvider,
  type SmsProviderName,
} from './sms';

// Settings > Security (doc 52 sections 5 and 8): read the policy, change the 2-step part (Super Admin, STRONG, audited,
// effective at once in this process and within 60 s elsewhere), the status card, and resuming SMS after the breaker.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export class SecurityPolicyService {
  constructor(
    private readonly deps: {
      db: AuthDatabase;
      sessions: SessionStore;
      policy: MfaPolicyReader & { invalidate?: () => void };
      sms: SmsProvider;
      breaker: SmsCircuitBreaker;
      smsSettings: { provider: SmsProviderName; dltTemplateIdOtp?: string | undefined };
      config: AuthConfig;
      clock: () => Date;
    },
  ) {}

  /** GET /settings/security: the 2-step policy as stored (or the doc 52 defaults); the rest as it is in effect. */
  async read(): Promise<SecurityPolicy> {
    const c = this.deps.config;
    return {
      password: { minLength: PASSWORD_MIN_LENGTH, denylist: true, maxAgeDays: null },
      lockout: {
        maxAttempts: c.maxFailedAttempts,
        lockMinutes: Math.round(c.lockDurationMs / MIN),
      },
      session: {
        idleMinutes: Math.round(c.idleTimeoutMs / MIN),
        absoluteHours: Math.round(c.absoluteTimeoutMs / HOUR),
        rememberDays: Math.round(c.rememberAbsoluteTimeoutMs / DAY),
        rememberIdleHours: Math.round(c.rememberIdleTimeoutMs / HOUR),
        maxSessions: c.maxSessions,
      },
      mfa: await this.deps.policy.read(),
    };
  }

  /**
   * PUT /settings/security (STRONG re-auth by route guard). The shared schema already enforced the floors and ceilings,
   * SUPER_ADMIN required + AUTHENTICATOR (TC-AUTH-28). Here: SMS only with a real provider (doc 52 section 5); audit with
   * before/after; then every member whose remaining usable methods no longer satisfy a required policy loses the
   * sessions they have now (doc 52 section 5 "enforcement when the policy tightens", TC-AUTH-29).
   */
  async update(mfa: MfaPolicy, actorUserId: string): Promise<SecurityPolicy> {
    if (mfa.smsEnabled) {
      const problem = smsEnablementProblem({
        SMS_PROVIDER: this.deps.smsSettings.provider,
        SMS_DLT_TEMPLATE_ID_OTP: this.deps.smsSettings.dltTemplateIdOtp,
      });
      if (problem) {
        throw new AppError('VALIDATION_ERROR', problem, [
          { field: 'mfa.smsEnabled', issue: 'no_real_provider' },
        ]);
      }
    }
    const before = await this.deps.policy.read();
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.upsertSetting(MFA_POLICY_SETTING_KEY, mfa, 'security', actorUserId);
      await record(tx.audit, {
        module: 'settings',
        action: 'settings.2fa_policy_changed',
        entity: { type: 'setting', label: MFA_POLICY_SETTING_KEY },
        before,
        after: mfa,
      });
    });
    this.deps.policy.invalidate?.();
    await this.enforce(mfa);
    return this.read();
  }

  /** GET /settings/security/status: the Security Status card. */
  async status(): Promise<SecurityStatus> {
    const repo = this.deps.db.repo;
    const byRole = await repo.countMembersByRoleAndMfa();
    const activeSuperAdmins = await repo.countActiveSuperAdmins();
    const policy = await this.deps.policy.read();
    return {
      members: ROLES.map((role) => ({
        role,
        enrolled: byRole
          .filter((r) => r.role === role && r.mfaEnabled)
          .reduce((n, r) => n + r.count, 0),
        notEnrolled: byRole
          .filter((r) => r.role === role && !r.mfaEnabled)
          .reduce((n, r) => n + r.count, 0),
      })),
      methods: await repo.countConfirmedMethodsByType(),
      activeSuperAdmins,
      superAdminWarning: activeSuperAdmins < 2,
      sms: {
        provider: this.deps.sms.name,
        enabled: policy.smsEnabled,
        paused: await this.deps.breaker.isPaused(),
      },
      failedSecondStepsLast24h: await repo.countSecondStepFailuresSince(
        new Date(this.deps.clock().getTime() - DAY),
      ),
    };
  }

  /** POST /settings/security/sms/resume (STRONG): ends a breaker pause; audited sms.resumed. Not paused: nothing to do. */
  async resumeSms(): Promise<void> {
    if (!(await this.deps.breaker.isPaused())) {
      noteAuditNoop();
      return;
    }
    await this.deps.breaker.resume();
    await this.deps.db.transaction((tx) =>
      record(tx.audit, {
        module: 'auth',
        action: 'sms.resumed',
        entity: { type: 'setting', label: 'SMS one-time codes' },
        note: 'SMS resumed by a Super Admin after the hourly cap paused it',
      }),
    );
  }

  private async enforce(mfa: MfaPolicy): Promise<void> {
    const now = this.deps.clock();
    const smsReady =
      mfa.smsEnabled && this.deps.sms.canSend && !(await this.deps.breaker.isPaused());
    for (const role of ROLES) {
      if (!mfa.required[role]) continue;
      const usable = usableMethodsFor(mfa, role, smsReady);
      for (const user of await this.deps.db.repo.listUsersWithOpenSessions(role, now)) {
        const methods = await this.deps.db.repo.listActiveMfaMethods(user.id);
        if (methods.some((m) => usable.includes(m.type))) continue;
        const revoked = await this.deps.db.transaction(async (tx) => {
          const sessions = await tx.repo.revokeAllSessions(user.id, now);
          for (const s of sessions) {
            await record(tx.audit, {
              module: 'auth',
              action: 'session.revoked',
              entity: { type: 'session', id: s.id, label: `${user.name} (${user.id})` },
              note: 'The 2-step policy now requires a method this account does not have',
            });
          }
          return sessions;
        });
        await this.deps.sessions.evictMany(revoked.map((s) => s.tokenHash));
      }
    }
  }
}
