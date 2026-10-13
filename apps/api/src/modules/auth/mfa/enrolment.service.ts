import {
  BACKUP_CODE_COUNT,
  normaliseIndianMobile,
  phoneHint,
  type MfaOverview,
  type MfaType,
} from '@zoauro/shared';
import { noteAuditNoop, record, runWithAuditContext, uuidv7 } from '../../../lib/audit';
import type { AuditActor } from '../../../lib/audit';
import type { AuthSession, SessionStore } from '../../../lib/auth/session-store';
import { AppError } from '../../../lib/errors';
import type { AuthMailer } from '../auth.mails';
import type { AuthDatabase, AuthTx, AuthUser } from '../auth.repository';
import { generateBackupCodes, hashBackupCode } from './backup-codes';
import type { OtpHasher } from './otp-hash';
import type { OtpService, SentChallenge } from './otp.service';
import type { PendingLogin, PendingLoginStore } from './pending';
import { isMfaRequired, usableMethodsFor, type MfaPolicyReader } from './policy';
import { mfaSecretAad, type SecretBox } from './secret-box';
import type { SmsCircuitBreaker, SmsProvider } from './sms';
import { newTotpSecret, totpUri, verifyTotp } from './totp';

// Enrolment and management of 2-step methods (doc 52 sections 2.3, 2.4, 8). Reached with a full session, or during
// sign-in with the pending cookie in stage ENROL. The first step for a pending login is always the mailbox proof
// (ENROL_PROOF): anyone holding only a temporary password could otherwise enrol their own authenticator and own the
// account. A signed-in user adding an authenticator or SMS re-authenticates (PASSWORD) instead.

export type MfaActor =
  | { kind: 'session'; user: AuthUser; session: AuthSession }
  | { kind: 'pending'; user: AuthUser; token: string; pending: PendingLogin };

const WRONG_CODE = () =>
  new AppError('VALIDATION_ERROR', 'That code didn’t work. Check it and try again.', [
    { field: 'code', issue: 'incorrect' },
  ]);
const notAllowed = () => new AppError('CONFLICT', 'Your 2-step policy does not allow this method');

export class EnrolmentService {
  constructor(
    private readonly deps: {
      db: AuthDatabase;
      sessions: SessionStore;
      pending: PendingLoginStore;
      policy: MfaPolicyReader;
      secretBox: SecretBox;
      hasher: OtpHasher;
      otp: OtpService;
      sms: SmsProvider;
      breaker: SmsCircuitBreaker;
      mailer: AuthMailer;
      clock: () => Date;
      issuer: string;
    },
  ) {}

  // ---- reading ---------------------------------------------------------------------------------------------------

  /** GET /me/mfa: hints only, never a secret (TC-AUTH-24, TC-AUTH-30). */
  async overview(actor: MfaActor): Promise<MfaOverview> {
    const { user } = actor;
    const policy = await this.deps.policy.read();
    const smsAvailable = await this.smsAvailable(policy.smsEnabled);
    const all = await this.deps.db.repo.listActiveMfaMethods(user.id);
    const started = await this.deps.db.repo.findActiveMfaMethod(user.id, 'AUTHENTICATOR');
    return {
      methods: all.map((m) => ({
        type: m.type,
        hint: this.hint(m.type, user),
        primary: m.isPrimary,
      })),
      authenticatorPending: started !== null && started.verifiedAt === null,
      backupCodesRemaining: await this.deps.db.repo.countUnusedBackupCodes(user.id),
      policy: {
        allowed: usableMethodsFor(policy, user.roleName, smsAvailable),
        required: isMfaRequired(policy, user.roleName),
        smsAvailable,
      },
      ...(actor.kind === 'pending' ? { mailboxProved: actor.pending.mailboxProved } : {}),
    };
  }

  // ---- email: the mailbox proof, and email OTP as a method ------------------------------------------------------

  /**
   * POST /me/mfa/email/start. During sign-in: the mailbox proof (ENROL_PROOF), for every role. Signed in: adding email
   * OTP (ENROL_EMAIL), only where the policy allows it. The code goes to the account address only.
   */
  async emailStart(actor: MfaActor, meta: { ip: string | null }): Promise<SentChallenge> {
    const policy = await this.deps.policy.read();
    if (actor.kind === 'session' && !policy.allowed[actor.user.roleName].includes('EMAIL_OTP'))
      throw notAllowed();
    const purpose = actor.kind === 'pending' ? 'ENROL_PROOF' : 'ENROL_EMAIL';
    const to = this.deps.otp.destination(actor.user, 'EMAIL_OTP');
    if (!to) throw notAllowed();
    return this.deps.otp.send(actor.user, purpose, 'EMAIL_OTP', policy, meta, to);
  }

  /**
   * POST /me/mfa/email/confirm. Proves the mailbox (pending) and, where the role may use it, enrols email OTP. Returns the
   * backup codes when this is the user's first confirmed method.
   */
  async emailConfirm(
    actor: MfaActor,
    code: string,
    meta: AuditMeta,
  ): Promise<{ backupCodes?: string[] }> {
    const { user } = actor;
    const purpose = actor.kind === 'pending' ? 'ENROL_PROOF' : 'ENROL_EMAIL';
    const step = await this.deps.otp.check(user, purpose, 'EMAIL_OTP', code);
    if (!step) throw WRONG_CODE();
    const policy = await this.deps.policy.read();
    const allowsEmail = policy.allowed[user.roleName].includes('EMAIL_OTP');
    const existing = await this.deps.db.repo.findActiveMfaMethod(user.id, 'EMAIL_OTP');

    const result = await this.inTransaction(user, meta, async (tx) => {
      if (!(await step.consume(tx))) throw WRONG_CODE();
      if (!allowsEmail || existing) {
        noteAuditNoop(); // the mailbox is proven; no method changes
        return {};
      }
      return this.addConfirmedMethod(tx, user, 'EMAIL_OTP');
    });
    if (actor.kind === 'pending') {
      await this.deps.pending.update(actor.token, { ...actor.pending, mailboxProved: true });
    }
    if (allowsEmail && !existing) this.notify(user, 'METHOD_ADDED', 'EMAIL_OTP');
    return result;
  }

  // ---- authenticator --------------------------------------------------------------------------------------------

  /**
   * POST /me/mfa/authenticator/start: a fresh secret, shown once (base32 + otpauth URI), stored sealed; replaces any
   * unconfirmed one. Pending: only after the mailbox proof (TC-AUTH-22). Signed in: needs PASSWORD re-authentication.
   */
  async authenticatorStart(actor: MfaActor): Promise<{ secretBase32: string; otpauthUri: string }> {
    this.requireEnrolmentGate(actor);
    const { user } = actor;
    const policy = await this.deps.policy.read();
    if (!policy.allowed[user.roleName].includes('AUTHENTICATOR')) throw notAllowed();
    const current = await this.deps.db.repo.findActiveMfaMethod(user.id, 'AUTHENTICATOR');
    if (current?.verifiedAt) {
      throw new AppError(
        'CONFLICT',
        'An authenticator is already set up. Remove it first to replace it.',
      );
    }
    const secret = newTotpSecret();
    await this.deps.db.repo.upsertUnconfirmedAuthenticator(
      user.id,
      uuidv7(),
      this.deps.secretBox.seal(secret, mfaSecretAad(user.id)),
    );
    return {
      secretBase32: secret,
      otpauthUri: totpUri({ issuer: this.deps.issuer, account: user.email, secret }),
    };
  }

  /** POST /me/mfa/authenticator/confirm: one valid code makes it active (a half-finished one never locks anyone out). */
  async authenticatorConfirm(
    actor: MfaActor,
    code: string,
    meta: AuditMeta,
  ): Promise<{ backupCodes?: string[] }> {
    const { user } = actor;
    const row = await this.deps.db.repo.findActiveMfaMethod(user.id, 'AUTHENTICATOR');
    if (!row || row.verifiedAt || !row.secretEncrypted) {
      throw new AppError('CONFLICT', 'Start the authenticator set-up first');
    }
    let secret: string;
    try {
      secret = this.deps.secretBox.open(row.secretEncrypted, mfaSecretAad(user.id));
    } catch {
      throw new AppError('CONFLICT', 'Start the authenticator set-up again');
    }
    const r = await verifyTotp({ secret, code, now: this.deps.clock(), lastUsedStep: null });
    if (!r.ok) throw WRONG_CODE();
    const result = await this.inTransaction(user, meta, async (tx) => {
      if (!(await tx.repo.confirmMfaMethod(row.id, this.deps.clock(), r.step))) {
        throw new AppError('CONFLICT', 'Start the authenticator set-up again');
      }
      return this.afterMethodConfirmed(tx, user, 'AUTHENTICATOR');
    });
    this.notify(user, 'METHOD_ADDED', 'AUTHENTICATOR');
    return result;
  }

  // ---- SMS (off until a provider exists, doc 52 section 6) ------------------------------------------------------

  /** POST /me/mfa/sms/start: only to the number on the member record (D72); 409 SMS_NOT_AVAILABLE / PHONE_MISSING. */
  async smsStart(actor: MfaActor, meta: { ip: string | null }): Promise<SentChallenge> {
    this.requireEnrolmentGate(actor);
    const { user } = actor;
    const policy = await this.deps.policy.read();
    const usable = usableMethodsFor(
      policy,
      user.roleName,
      await this.smsAvailable(policy.smsEnabled),
    );
    if (!usable.includes('SMS_OTP')) {
      throw new AppError('SMS_NOT_AVAILABLE', 'SMS codes are not available right now');
    }
    const e164 = user.phone ? normaliseIndianMobile(user.phone) : null;
    if (!e164) throw new AppError('PHONE_MISSING', 'There is no mobile number on your account');
    return this.deps.otp.send(user, 'ENROL_SMS', 'SMS_OTP', policy, meta, {
      to: e164,
      hint: phoneHint(e164),
    });
  }

  async smsConfirm(
    actor: MfaActor,
    code: string,
    meta: AuditMeta,
  ): Promise<{ backupCodes?: string[] }> {
    const { user } = actor;
    const step = await this.deps.otp.check(user, 'ENROL_SMS', 'SMS_OTP', code);
    if (!step) throw WRONG_CODE();
    const existing = await this.deps.db.repo.findActiveMfaMethod(user.id, 'SMS_OTP');
    const result = await this.inTransaction(user, meta, async (tx) => {
      if (!(await step.consume(tx))) throw WRONG_CODE();
      await tx.repo.setPhoneVerified(user.id, this.deps.clock());
      if (existing) {
        noteAuditNoop();
        return {};
      }
      return this.addConfirmedMethod(tx, user, 'SMS_OTP');
    });
    if (!existing) this.notify(user, 'METHOD_ADDED', 'SMS_OTP');
    return result;
  }

  // ---- management (signed in) -----------------------------------------------------------------------------------

  /** PUT /me/mfa/primary: the method offered first at sign-in. */
  async setPrimary(user: AuthUser, type: MfaType): Promise<void> {
    const row = await this.deps.db.repo.findActiveMfaMethod(user.id, type);
    if (!row?.verifiedAt) throw new AppError('NOT_FOUND', 'Not found');
    await this.deps.db.repo.setPrimaryMfaMethod(user.id, type);
  }

  /**
   * DELETE /me/mfa/{type} (STRONG, route guard). 409 LAST_METHOD_REQUIRED when the policy requires 2-step for the role
   * and no other usable method would remain.
   */
  async removeMethod(user: AuthUser, type: MfaType, meta: AuditMeta): Promise<void> {
    const row = await this.deps.db.repo.findActiveMfaMethod(user.id, type);
    if (!row) throw new AppError('NOT_FOUND', 'Not found');
    const policy = await this.deps.policy.read();
    if (row.verifiedAt && isMfaRequired(policy, user.roleName)) {
      const usable = usableMethodsFor(
        policy,
        user.roleName,
        await this.smsAvailable(policy.smsEnabled),
      );
      const others = (await this.deps.db.repo.listActiveMfaMethods(user.id)).filter(
        (m) => m.type !== type && usable.includes(m.type),
      );
      if (others.length === 0) {
        throw new AppError(
          'LAST_METHOD_REQUIRED',
          'Your 2-step policy requires at least one method',
        );
      }
    }
    await this.inTransaction(user, meta, async (tx) => {
      await tx.repo.disableMfaMethod(row.id, this.deps.clock());
      if (row.isPrimary) await tx.repo.setPrimaryMfaMethod(user.id, null);
      await tx.repo.syncMfaEnabled(user.id);
      await record(tx.audit, {
        module: 'auth',
        action: 'user.two_factor_disabled',
        entity: userEntity(user),
        before: { method: type },
        after: { method: null },
      });
    });
    this.notify(user, 'METHOD_REMOVED', type);
  }

  /** POST /me/mfa/backup-codes/regenerate (STRONG, route guard): the old codes stop working. */
  async regenerateBackupCodes(user: AuthUser, meta: AuditMeta): Promise<string[]> {
    if ((await this.deps.db.repo.listActiveMfaMethods(user.id)).length === 0) {
      throw new AppError('CONFLICT', 'Set up a 2-step method first');
    }
    const codes = await this.inTransaction(user, meta, (tx) => this.issueBackupCodes(tx, user));
    this.notify(user, 'BACKUP_CODES_REGENERATED');
    return codes;
  }

  // ---- internals ------------------------------------------------------------------------------------------------

  /** Pending login: the mailbox must be proven first. Signed in: a PASSWORD re-authentication within 10 minutes. */
  private requireEnrolmentGate(actor: MfaActor): void {
    if (actor.kind === 'pending') {
      if (!actor.pending.mailboxProved) {
        throw new AppError('FORBIDDEN', 'Confirm the code sent to your email address first');
      }
      return;
    }
    if (!this.deps.sessions.hasRecentReauth(actor.session)) {
      throw new AppError('REAUTH_REQUIRED', 'Confirm your password to continue');
    }
  }

  private async addConfirmedMethod(
    tx: AuthTx,
    user: AuthUser,
    type: MfaType,
  ): Promise<{ backupCodes?: string[] }> {
    await tx.repo.createConfirmedMfaMethod(user.id, uuidv7(), type, this.deps.clock());
    return this.afterMethodConfirmed(tx, user, type);
  }

  /** Primary if it is the first, mfa_enabled in step, the audit row, and backup codes with the first method. */
  private async afterMethodConfirmed(
    tx: AuthTx,
    user: AuthUser,
    type: MfaType,
  ): Promise<{ backupCodes?: string[] }> {
    const confirmed = await tx.repo.listActiveMfaMethods(user.id);
    if (!confirmed.some((m) => m.isPrimary)) await tx.repo.setPrimaryMfaMethod(user.id, type);
    await tx.repo.syncMfaEnabled(user.id);
    await record(tx.audit, {
      module: 'auth',
      action: 'user.two_factor_enrolled',
      entity: userEntity(user),
      after: { method: type }, // never the secret
    });
    if (confirmed.length === 1 && (await tx.repo.countUnusedBackupCodes(user.id)) === 0) {
      return { backupCodes: await this.issueBackupCodes(tx, user) };
    }
    return {};
  }

  private async issueBackupCodes(tx: AuthTx, user: AuthUser): Promise<string[]> {
    const codes = generateBackupCodes(BACKUP_CODE_COUNT);
    await tx.repo.replaceBackupCodes(
      user.id,
      uuidv7(),
      codes.map((c) => ({
        id: uuidv7(),
        codeHash: hashBackupCode(this.deps.hasher, c.normalised),
      })),
    );
    await record(tx.audit, {
      module: 'auth',
      action: 'user.backup_codes_generated',
      entity: userEntity(user),
      note: `${codes.length} new backup codes; older codes no longer work`,
    });
    return codes.map((c) => c.display);
  }

  private async smsAvailable(smsEnabled: boolean): Promise<boolean> {
    return smsEnabled && this.deps.sms.canSend && !(await this.deps.breaker.isPaused());
  }

  private hint(type: MfaType, user: AuthUser): string {
    if (type === 'AUTHENTICATOR') return 'Authenticator app';
    if (type === 'EMAIL_OTP') return this.deps.otp.destination(user, 'EMAIL_OTP')?.hint ?? '';
    const e164 = user.phone ? normaliseIndianMobile(user.phone) : null;
    return e164 ? phoneHint(e164) : '';
  }

  private inTransaction<T>(
    user: AuthUser,
    meta: AuditMeta,
    fn: (tx: AuthTx) => Promise<T>,
  ): Promise<T> {
    return runWithAuditContext(
      {
        actor: actorFor(user),
        ip: meta.ip ?? undefined,
        userAgent: meta.userAgent ?? undefined,
        requestId: meta.requestId,
      },
      () => this.deps.db.transaction(fn),
    );
  }

  private notify(
    user: AuthUser,
    change: 'METHOD_ADDED' | 'METHOD_REMOVED' | 'BACKUP_CODES_REGENERATED',
    method?: MfaType,
  ) {
    this.deps.mailer
      .sendMfaChanged({
        to: user.email,
        name: user.name,
        at: this.deps.clock(),
        change,
        ...(method ? { method } : {}),
      })
      .catch((err: unknown) =>
        console.error(`2-step change mail failed (${err instanceof Error ? err.name : 'unknown'})`),
      );
  }
}

export interface AuditMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | undefined;
}

const actorFor = (u: AuthUser): AuditActor => ({
  type: 'USER',
  id: u.id,
  name: u.name,
  role: u.roleName,
});
const userEntity = (u: AuthUser) => ({ type: 'user', id: u.id, label: u.name });
