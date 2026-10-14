import type {
  ChangePasswordInput,
  EnrolCompleteInput,
  ForgotPasswordInput,
  MeZone,
  MfaChallengeInput,
  MfaMethodUsed,
  MfaPolicy,
  MfaType,
  MfaVerifyInput,
  SessionListItem,
  LoginInput,
  ReauthStepUpInput,
  ResetPasswordInput,
  Role,
} from '@zoauro/shared';
import { zoneServiceFlags } from '@zoauro/shared';
import { noteAuditNoop, record, recordMany, runWithAuditContext, uuidv7 } from '../../lib/audit';
import type { AuditActor, AuditEntry } from '../../lib/audit';
import type { Audit } from '../../lib/audit/audit.service';
import type { AuthConfig, Clock } from '../../lib/auth/config';
import type { AuthContext, ZoneLimits } from '../../lib/authz';
import {
  getDummyHash,
  hashPassword,
  randomToken,
  sha256Hex,
  verifyPassword,
} from '../../lib/auth/crypto';
import type { AuthSession, ReauthLevel, SessionStore } from '../../lib/auth/session-store';
import { AppError } from '../../lib/errors';
import type { RateLimiter } from '../../lib/rate-limiter';
import type { AuthMailer } from './auth.mails';
import { findBackupCode } from './mfa/backup-codes';
import type { OtpHasher } from './mfa/otp-hash';
import type { PendingLogin, PendingLoginStore } from './mfa/pending';
import { isMfaRequired, usableMethodsFor, type MfaPolicyReader } from './mfa/policy';
import { mfaSecretAad, type SecretBox } from './mfa/secret-box';
import { verifyTotp } from './mfa/totp';
import { channelUnavailable, type OtpService, type SentChallenge } from './mfa/otp.service';
import type { SmsCircuitBreaker, SmsProvider } from './mfa/sms';
import type { AuthDatabase, AuthTx, AuthUser } from './auth.repository';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | undefined;
}

/** Mail is sent in the background: the response never waits for, or reveals, delivery. Bodies are never logged. */
function notify(send: Promise<void>, what: string, requestId: string | undefined): void {
  send.catch((err: unknown) =>
    console.error(
      `${what} mail failed (${err instanceof Error ? err.name : 'unknown'}) requestId=${requestId ?? '-'}`,
    ),
  );
}

/** A session just opened: the cookie value and the LoginOk response fields. */
export interface StartedSession {
  sessionToken: string;
  cookieMaxAgeSec: number;
  csrfToken: string;
  redirect: string;
  mustChangePassword: boolean;
  user: { id: string; name: string; email: string; role: Role };
}

/** The password step's outcome (doc 52 section 2.1): a session, or a pending login waiting for the second step. */
export type LoginStepResult =
  | { status: 'OK'; session: StartedSession }
  | {
      status: 'MFA_REQUIRED';
      pendingToken: string;
      methods: { type: MfaType; hint: string }[];
      preferred?: MfaType;
    }
  | { status: 'ENROLMENT_REQUIRED'; pendingToken: string };

/** pendingEnded: the controller clears zo_mfa and the person starts again with the password. */
export type VerifyResult =
  { ok: true; session: StartedSession } | { ok: false; pendingEnded: boolean };

/** An accepted second step; `consume` runs inside the login transaction (single use, replay guard). */
interface SecondStep {
  consume: (tx: AuthTx) => Promise<boolean>;
}

/** The second step was used by a concurrent request between the check and the commit. */
class SecondStepRace extends Error {}

export interface MeResult {
  user: { id: string; name: string; email: string; role: Role };
  mustChangePassword: boolean;
  csrfToken: string;
  permissions: { global: true } | { global: false; zones: MeZone[] };
  mfa: { enabled: boolean; required: boolean; enrolmentNeeded: boolean };
}

/** A zone assignment without limits of its own: nothing may be refunded, revealed or exported without approval. */
const NO_LIMITS: ZoneLimits = { perRefund: 0, dailyRefund: 0, canReveal: false, canExport: false };

const GENERIC_LOGIN_ERROR = 'Invalid email or password';
const UA_MAX = 300;
/** Failures that count toward the lockout. A locked, inactive or unknown account does not. */
const COUNTED_FAILURES = new Set(['BAD_PASSWORD', 'WRONG_TAB']);

const actorFor = (u: AuthUser): AuditActor => ({
  type: 'USER',
  id: u.id,
  name: u.name,
  role: u.roleName,
});

// Audit labels name the person, never their email (P3.3): the id is already in entity_id.
const userEntity = (u: AuthUser) => ({ type: 'user', id: u.id, label: u.name });
/** session.revoked: entity_id is the session, so the label carries the owner's name and user id. */
const sessionEntity = (sessionId: string, u: AuthUser) => ({
  type: 'session',
  id: sessionId,
  label: `${u.name} (${u.id})`,
});

const EMAIL_MAX = 254;
/**
 * login_history.email_attempted (P3.3): the account's address in lower case when the typed address belongs to a user;
 * otherwise only a mask (first character, then `***@***`), so a password typed into the email field is never stored.
 */
export function emailForHistory(matched: { email: string } | null, typed: string): string {
  if (matched) return matched.email.toLowerCase().slice(0, EMAIL_MAX);
  return typed.length === 0 ? '' : `${typed.slice(0, 1)}***@***`;
}

export class AuthService {
  constructor(
    private readonly deps: {
      db: AuthDatabase;
      sessions: SessionStore;
      limiter: RateLimiter;
      /** DENIED rows (doc 50 §4.3): own transaction, rate limited, never throws */
      audit: Pick<Audit, 'recordDenied'>;
      mailer: AuthMailer;
      config: AuthConfig;
      clock: Clock;
      /** 2-step (doc 52): pending logins, the policy, sealed secrets and code hashing */
      mfa: {
        pending: PendingLoginStore;
        policy: MfaPolicyReader;
        secretBox: SecretBox;
        hasher: OtpHasher;
        otp: OtpService;
        sms: SmsProvider;
        breaker: SmsCircuitBreaker;
      };
    },
  ) {}

  private get config(): AuthConfig {
    return this.deps.config;
  }

  /** Runs `fn` with `user` as the audit actor (also for flows without a signed-in user: lockout, forgot/reset). */
  private asUser<T>(user: AuthUser, meta: RequestMeta, fn: () => Promise<T>): Promise<T> {
    return runWithAuditContext(
      {
        actor: actorFor(user),
        ip: meta.ip ?? undefined,
        userAgent: meta.userAgent ?? undefined,
        requestId: meta.requestId,
      },
      fn,
    );
  }

  // ---- login ----------------------------------------------------------------------------------------------------

  async login(input: LoginInput, meta: RequestMeta): Promise<LoginStepResult> {
    await this.enforceLoginLimits(meta.ip, input.email);

    const user = await this.deps.db.repo.findUserByEmail(input.email);
    // Always verify something, so unknown accounts cost the same time as known ones.
    const passwordOk = await verifyPassword(
      user?.passwordHash ?? (await getDummyHash()),
      input.password,
    );
    const now = this.deps.clock();

    const reason = this.loginFailureReason(user, passwordOk, input.tab, now);
    if (reason !== null) {
      await this.recordLoginFailure(user, input.email, reason, meta, now);
      throw new AppError('UNAUTHENTICATED', GENERIC_LOGIN_ERROR);
    }
    if (!user) throw new AppError('UNAUTHENTICATED', GENERIC_LOGIN_ERROR); // unreachable: reason would be UNKNOWN_USER

    // Second step (doc 52 section 2.1 [2]): only now, after the password, are the user's methods looked at or listed.
    const policy = await this.deps.mfa.policy.read();
    const methods = await this.offeredMethods(user, policy);
    const pendingBase = {
      userId: user.id,
      tab: input.tab,
      remember: input.remember,
      ip: meta.ip,
      userAgent: meta.userAgent,
    };
    if (methods.length > 0) {
      const pendingToken = await this.deps.mfa.pending.create({ ...pendingBase, stage: 'VERIFY' });
      return {
        status: 'MFA_REQUIRED',
        pendingToken,
        methods: methods.map((m) => ({ type: m.type, hint: this.methodHint(m.type, user) })),
        ...(methods[0] ? { preferred: methods[0].type } : {}),
      };
    }
    if (isMfaRequired(policy, user.roleName)) {
      const pendingToken = await this.deps.mfa.pending.create({ ...pendingBase, stage: 'ENROL' });
      return { status: 'ENROLMENT_REQUIRED', pendingToken };
    }
    // TC-AUTH-7: no method and the policy does not require one for this role
    return {
      status: 'OK',
      session: await this.startSession(user, meta, now, {
        remember: input.remember,
        typedEmail: input.email,
        mfaMethod: null,
      }),
    };
  }

  /**
   * Opens a session (doc 52 section 2.1 [3]): a new id every time, failed-attempt counter reset, login_history OK with the
   * method used, the 3-session cap, the new-login notice. `inTransaction` runs in the same transaction (TOTP replay
   * guard, backup code): if it returns false nothing is committed and SecondStepRace is thrown.
   */
  private async startSession(
    user: AuthUser,
    meta: RequestMeta,
    now: Date,
    opts: {
      remember: boolean;
      typedEmail: string;
      mfaMethod: MfaMethodUsed | null;
      inTransaction?: (tx: AuthTx) => Promise<boolean>;
    },
  ): Promise<StartedSession> {
    const sessionToken = randomToken(32);
    const tokenHash = sha256Hex(sessionToken);
    const sessionId = uuidv7();
    const absoluteMs = opts.remember
      ? this.config.rememberAbsoluteTimeoutMs
      : this.config.absoluteTimeoutMs;
    const expiresAt = new Date(now.getTime() + absoluteMs);

    const { redirect, capped } = await this.asUser(user, meta, () =>
      this.deps.db.transaction(async (tx) => {
        if (opts.inTransaction && !(await opts.inTransaction(tx))) throw new SecondStepRace();
        await this.releaseExpiredLock(tx, user, now);
        await tx.repo.recordSuccessfulLogin(user.id, now);
        await tx.repo.createSession({
          id: sessionId,
          userId: user.id,
          tokenHash,
          ip: meta.ip,
          userAgent: meta.userAgent?.slice(0, UA_MAX) ?? null,
          expiresAt,
          lastSeenAt: now,
          restricted: user.mustChangePassword ? 'PASSWORD_CHANGE' : null,
          remember: opts.remember,
          mfaVerifiedAt: opts.mfaMethod ? now : null,
          mfaMethod: opts.mfaMethod,
        });
        const capped = await this.enforceSessionCap(tx, user, now);
        await tx.repo.addLoginHistory(
          this.historyEntry(
            user.id,
            emailForHistory(user, opts.typedEmail),
            true,
            'OK',
            meta,
            now,
            opts.mfaMethod,
          ),
        );
        if (user.roleName === 'SUPER_ADMIN') return { redirect: '/super-admin/dashboard', capped };
        const zones = await tx.repo.countActiveZoneAssignments(user.id);
        return { redirect: zones > 0 ? '/zone/dashboard' : '/zone/no-zones', capped };
      }),
    );
    await this.deps.sessions.evictMany(capped);

    await this.deps.sessions.cacheNew(tokenHash, {
      sessionId,
      userId: user.id,
      name: user.name,
      role: user.roleName,
      mustChangePassword: user.mustChangePassword,
      expiresAt,
      remember: opts.remember,
    });

    // New-login notice with time, IP and device (doc 14 section 2, doc 52 section 2.7).
    notify(
      this.deps.mailer.sendNewLogin({
        to: user.email,
        name: user.name,
        at: now,
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
      'new login',
      meta.requestId,
    );

    return {
      sessionToken,
      cookieMaxAgeSec: Math.floor(absoluteMs / 1000),
      csrfToken: this.deps.sessions.csrfFor(tokenHash),
      redirect,
      mustChangePassword: user.mustChangePassword,
      user: { id: user.id, name: user.name, email: user.email, role: user.roleName },
    };
  }

  // ---- second step (doc 52 sections 2.1, 2.2, 2.5) --------------------------------------------------------------

  /**
   * POST /auth/mfa/verify with the pending cookie. One generic answer for a wrong, expired, reused or unknown code and
   * for a method the user may not use or did not enrol (TC-AUTH-21). Every wrong code counts like a wrong password
   * (D77); the 5th locks the account for 30 minutes and ends the pending login.
   */
  async verifyMfa(
    pendingToken: string,
    input: MfaVerifyInput,
    meta: RequestMeta,
  ): Promise<VerifyResult> {
    if (meta.ip) {
      const { limit, windowSec } = this.config.mfaVerifyLimitPerIp;
      const r = await this.deps.limiter.hit(`mfa-verify:ip:${meta.ip}`, limit, windowSec);
      if (!r.allowed) throw this.rateLimited(r.retryAfterSec);
    }
    const pending = await this.deps.mfa.pending.get(pendingToken);
    if (!pending || pending.stage !== 'VERIFY') return { ok: false, pendingEnded: true };
    // a pending login continues only from the browser that entered the password (TC-AUTH-9)
    if (pending.ip !== meta.ip || pending.userAgent !== meta.userAgent) {
      await this.deps.mfa.pending.end(pendingToken);
      return { ok: false, pendingEnded: true };
    }
    const user = await this.deps.db.repo.findUserById(pending.userId);
    const now = this.deps.clock();
    if (!user || user.status !== 'ACTIVE' || (user.lockedUntil && user.lockedUntil > now)) {
      await this.deps.mfa.pending.end(pendingToken);
      return { ok: false, pendingEnded: true };
    }

    const step =
      input.method === 'AUTHENTICATOR'
        ? await this.checkAuthenticator(user, input.code, now)
        : input.method === 'BACKUP_CODE'
          ? await this.checkBackupCode(user, input.code)
          : await this.checkOneTimeCode(user, input.method, input.code);
    if (!step) return this.secondStepFailed(user, pending, pendingToken, input.method, meta, now);

    // single use: the first successful request takes the pending login; any other gets nothing
    if (!(await this.deps.mfa.pending.consume(pendingToken)))
      return { ok: false, pendingEnded: true };
    let session: StartedSession;
    try {
      session = await this.startSession(user, meta, now, {
        remember: pending.remember,
        typedEmail: user.email,
        mfaMethod: input.method,
        inTransaction: step.consume,
      });
    } catch (err) {
      if (!(err instanceof SecondStepRace)) throw err;
      // used by a concurrent request between the check and the commit: a failure like any other
      return this.secondStepFailed(user, pending, pendingToken, input.method, meta, now);
    }
    if (input.method === 'BACKUP_CODE') {
      const remaining = await this.deps.db.repo.countUnusedBackupCodes(user.id);
      notify(
        this.deps.mailer.sendBackupCodeUsed({
          to: user.email,
          name: user.name,
          at: now,
          remaining,
        }),
        'backup code used',
        meta.requestId,
      );
    }
    return { ok: true, session };
  }

  /**
   * POST /auth/mfa/challenge (doc 52 section 8): sends an email or SMS code for the pending login. The method must be
   * allowed for the role, enrolled by the user and deliverable (SMS: switched on, a provider, not paused, a verified
   * number), otherwise 409. Cooldown and caps answer 429 with Retry-After.
   */
  async requestChallenge(
    pendingToken: string,
    input: MfaChallengeInput,
    meta: RequestMeta,
  ): Promise<SentChallenge> {
    const pending = await this.deps.mfa.pending.get(pendingToken);
    if (
      !pending ||
      pending.stage !== 'VERIFY' ||
      pending.ip !== meta.ip ||
      pending.userAgent !== meta.userAgent
    ) {
      throw new AppError('UNAUTHENTICATED', 'Your sign-in has expired. Sign in again.');
    }
    const user = await this.deps.db.repo.findUserById(pending.userId);
    const now = this.deps.clock();
    if (!user || user.status !== 'ACTIVE' || (user.lockedUntil && user.lockedUntil > now)) {
      throw new AppError('UNAUTHENTICATED', 'Your sign-in has expired. Sign in again.');
    }
    const policy = await this.deps.mfa.policy.read();
    const offered = await this.offeredMethods(user, policy);
    const destination = this.deps.mfa.otp.destination(user, input.method);
    if (!offered.some((m) => m.type === input.method) || !destination) throw channelUnavailable();
    return this.deps.mfa.otp.send(user, 'LOGIN', input.method, policy, meta, destination);
  }

  /**
   * POST /auth/mfa/enrol/complete (doc 52 section 2.3 step 4): only with a confirmed method the policy allows and the
   * backup codes acknowledged (TC-AUTH-25: otherwise 409). Then the session starts, as after a second step.
   */
  async completeEnrolment(
    pendingToken: string,
    input: EnrolCompleteInput,
    meta: RequestMeta,
  ): Promise<StartedSession> {
    const pending = await this.deps.mfa.pending.get(pendingToken);
    if (
      !pending ||
      pending.stage !== 'ENROL' ||
      pending.ip !== meta.ip ||
      pending.userAgent !== meta.userAgent
    ) {
      throw new AppError('UNAUTHENTICATED', 'Your sign-in has expired. Sign in again.');
    }
    const user = await this.deps.db.repo.findUserById(pending.userId);
    const now = this.deps.clock();
    if (!user || user.status !== 'ACTIVE' || (user.lockedUntil && user.lockedUntil > now)) {
      await this.deps.mfa.pending.end(pendingToken);
      throw new AppError('UNAUTHENTICATED', 'Your sign-in has expired. Sign in again.');
    }
    const offered = await this.offeredMethods(user, await this.deps.mfa.policy.read());
    const primary = offered.find((m) => m.isPrimary) ?? offered[0];
    if (!primary) throw new AppError('CONFLICT', 'Set up a 2-step method your policy allows first');
    if (input.backupCodesAcknowledged !== true) {
      throw new AppError('CONFLICT', 'Confirm that you have saved your backup codes');
    }
    if (!(await this.deps.mfa.pending.consume(pendingToken))) {
      throw new AppError('UNAUTHENTICATED', 'Your sign-in has expired. Sign in again.');
    }
    return this.startSession(user, meta, now, {
      remember: pending.remember,
      typedEmail: user.email,
      mfaMethod: primary.type,
    });
  }

  /**
   * The user's confirmed methods that can be used right now: allowed for the role by the policy, SMS only while it is
   * switched on, has a provider, is not paused, and the user's number is verified (doc 52 sections 2.2 and 5).
   */
  private async offeredMethods(user: AuthUser, policy: MfaPolicy) {
    const smsReady = this.deps.mfa.sms.canSend && !(await this.deps.mfa.breaker.isPaused());
    const usable = usableMethodsFor(policy, user.roleName, smsReady);
    return (await this.deps.db.repo.listActiveMfaMethods(user.id)).filter(
      (m) =>
        usable.includes(m.type) &&
        (m.type === 'AUTHENTICATOR' || this.deps.mfa.otp.destination(user, m.type) !== null),
    );
  }

  /** Shown next to each method on the 2-step screen; never more than a masked hint (doc 52 section 8). */
  private methodHint(type: MfaType, user: AuthUser): string {
    if (type === 'AUTHENTICATOR') return 'Authenticator app';
    return this.deps.mfa.otp.destination(user, type)?.hint ?? '';
  }

  /** An email or SMS code of the pending login's challenge (doc 52 section 2.2). */
  private async checkOneTimeCode(
    user: AuthUser,
    method: 'EMAIL_OTP' | 'SMS_OTP',
    code: string,
    purpose: 'LOGIN' | 'REAUTH' = 'LOGIN',
  ): Promise<SecondStep | null> {
    const policy = await this.deps.mfa.policy.read();
    if (!(await this.offeredMethods(user, policy)).some((m) => m.type === method)) return null;
    return this.deps.mfa.otp.check(user, purpose, method, code);
  }

  /** An accepted authenticator code, with the replay-guard update to run in the login transaction. */
  private async checkAuthenticator(
    user: AuthUser,
    code: string,
    now: Date,
  ): Promise<SecondStep | null> {
    const policy = await this.deps.mfa.policy.read();
    if (!usableMethodsFor(policy, user.roleName).includes('AUTHENTICATOR')) return null;
    const method = (await this.deps.db.repo.listActiveMfaMethods(user.id)).find(
      (m) => m.type === 'AUTHENTICATOR',
    );
    if (!method?.secretEncrypted) return null;
    let secret: string;
    try {
      secret = this.deps.mfa.secretBox.open(method.secretEncrypted, mfaSecretAad(user.id));
    } catch {
      return null; // a value that does not open is a failed code, never an error page
    }
    const r = await verifyTotp({
      secret,
      code,
      now,
      lastUsedStep: method.lastUsedStep === null ? null : Number(method.lastUsedStep),
    });
    if (!r.ok) return null;
    return { consume: (tx) => tx.repo.advanceTotpStep(method.id, r.step) };
  }

  /** A matching unused backup code, consumed and audited in the login transaction (doc 52 section 2.5). */
  private async checkBackupCode(user: AuthUser, code: string): Promise<SecondStep | null> {
    const unused = await this.deps.db.repo.listUnusedBackupCodes(user.id);
    const match = findBackupCode(this.deps.mfa.hasher, code, unused);
    if (!match) return null;
    return {
      consume: async (tx) => {
        if (!(await tx.repo.useBackupCode(match.id, this.deps.clock()))) return false;
        await record(tx.audit, {
          module: 'auth',
          action: 'user.backup_code_used',
          entity: userEntity(user),
          note: 'Signed in with a backup code',
        });
        return true;
      },
    };
  }

  /**
   * A wrong second step: counts toward the lockout (D77), login_history MFA_FAILED (MFA_LOCKOUT when it locked),
   * user.mfa_challenge_failed as a rate-limited DENIED row. The pending login ends when the account locks, or after as
   * many wrong codes as the lockout allows.
   */
  private async secondStepFailed(
    user: AuthUser,
    pending: PendingLogin,
    pendingToken: string,
    method: MfaMethodUsed,
    meta: RequestMeta,
    now: Date,
  ): Promise<VerifyResult> {
    const locked = await this.asUser(user, meta, () =>
      this.deps.db.transaction(async (tx) => {
        const lockedNow = await this.countFailureAndMaybeLock(tx, user, now, 'second-step');
        await tx.repo.addLoginHistory(
          this.historyEntry(
            user.id,
            user.email.toLowerCase(),
            false,
            lockedNow ? 'MFA_LOCKOUT' : 'MFA_FAILED',
            meta,
            now,
            method,
          ),
        );
        return lockedNow;
      }),
    );
    await this.asUser(user, meta, () =>
      this.deps.audit.recordDenied({
        module: 'auth',
        action: 'user.mfa_challenge_failed',
        entity: userEntity(user),
        note: `Wrong second-step code (${method})`,
      }),
    );
    const attempts = pending.attempts + 1;
    if (locked || attempts >= this.config.maxFailedAttempts) {
      await this.deps.mfa.pending.end(pendingToken);
      return { ok: false, pendingEnded: true };
    }
    await this.deps.mfa.pending.update(pendingToken, { ...pending, attempts });
    return { ok: false, pendingEnded: false };
  }

  private loginFailureReason(
    user: AuthUser | null,
    passwordOk: boolean,
    tab: Role,
    now: Date,
  ): string | null {
    if (!user) return 'UNKNOWN_USER';
    if (user.status !== 'ACTIVE') return 'INACTIVE';
    if (user.lockedUntil && user.lockedUntil > now) return 'LOCKED';
    if (!passwordOk) return 'BAD_PASSWORD';
    if (user.roleName !== tab) return 'WRONG_TAB';
    return null;
  }

  private async recordLoginFailure(
    user: AuthUser | null,
    email: string,
    reason: string,
    meta: RequestMeta,
    now: Date,
  ): Promise<void> {
    const stored = emailForHistory(user, email);
    if (!user || !COUNTED_FAILURES.has(reason)) {
      await this.deps.db.repo.addLoginHistory(
        this.historyEntry(user?.id ?? null, stored, false, reason, meta, now),
      );
      return;
    }
    await this.asUser(user, meta, () =>
      this.deps.db.transaction(async (tx) => {
        await this.releaseExpiredLock(tx, user, now);
        await this.countFailureAndMaybeLock(tx, user, now);
        await tx.repo.addLoginHistory(this.historyEntry(user.id, stored, false, reason, meta, now));
      }),
    );
  }

  /**
   * Increments the counter; at the limit, locks the account and writes user.locked in the same transaction, but only
   * when this call moves the account into the locked state. Further failures while locked neither extend the lock nor
   * write another user.locked, and of two concurrent failures crossing the limit only one locks.
   */
  private async countFailureAndMaybeLock(
    tx: AuthTx,
    user: AuthUser,
    now: Date,
    kind: 'password' | 'second-step' = 'password',
  ): Promise<boolean> {
    const attempts = await tx.repo.incrementFailedAttempts(user.id);
    if (attempts < this.config.maxFailedAttempts) return false;
    const until = new Date(now.getTime() + this.config.lockDurationMs);
    if (!(await tx.repo.lockUserIfNotLocked(user.id, until, now))) return false;
    await record(tx.audit, {
      module: 'auth',
      action: 'user.locked',
      entity: userEntity(user),
      note: `Locked for ${Math.round(this.config.lockDurationMs / 60000)} minutes after ${attempts} failed attempts${kind === 'second-step' ? ' (the last a wrong second-step code)' : ''}`,
    });
    return true;
  }

  /** A lock that has run out is cleared on the next attempt, and that is audited as user.unlocked. */
  private async releaseExpiredLock(tx: AuthTx, user: AuthUser, now: Date): Promise<void> {
    if (!user.lockedUntil || user.lockedUntil > now) return;
    if (await tx.repo.clearExpiredLock(user.id, user.lockedUntil)) {
      await record(tx.audit, {
        module: 'auth',
        action: 'user.unlocked',
        entity: userEntity(user),
        note: 'Lock period ended',
      });
    }
  }

  private historyEntry(
    userId: string | null,
    email: string,
    success: boolean,
    reason: string,
    meta: RequestMeta,
    at: Date,
    mfaMethod: MfaMethodUsed | null = null,
  ) {
    return {
      id: uuidv7(),
      userId,
      emailAttempted: email,
      success,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, UA_MAX) ?? null,
      reason,
      mfaMethod,
      createdAt: at,
    };
  }

  private async enforceLoginLimits(ip: string | null, email: string): Promise<void> {
    const { limiter, config } = this.deps;
    const checks = [
      limiter.hit(
        `login:email:${sha256Hex(email)}`,
        config.loginLimitPerEmail.limit,
        config.loginLimitPerEmail.windowSec,
      ),
    ];
    if (ip)
      checks.push(
        limiter.hit(
          `login:ip:${ip}`,
          config.loginLimitPerIp.limit,
          config.loginLimitPerIp.windowSec,
        ),
      );
    const blocked = (await Promise.all(checks)).find((r) => !r.allowed);
    if (blocked) throw this.rateLimited(blocked.retryAfterSec);
  }

  private rateLimited(retryAfterSec: number): AppError {
    return new AppError('RATE_LIMITED', 'Too many attempts. Try again later.', undefined, {
      'Retry-After': String(Math.max(1, retryAfterSec)),
    });
  }

  // ---- session --------------------------------------------------------------------------------------------------

  /** Login history only (no audit row): the coverage allow-list reason is `logout`. */
  async logout(session: AuthSession, meta: RequestMeta): Promise<void> {
    const now = this.deps.clock();
    const user = await this.deps.db.repo.findUserById(session.userId);
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.revokeSession(session.sessionId, now);
      await tx.repo.addLoginHistory(
        this.historyEntry(session.userId, emailForHistory(user, ''), true, 'LOGOUT', meta, now),
      );
    });
    await this.deps.sessions.evict(session.tokenHash);
  }

  async me(session: AuthSession, ctx: AuthContext): Promise<MeResult> {
    const user = await this.deps.db.repo.findUserById(session.userId);
    if (!user || user.status !== 'ACTIVE')
      throw new AppError('UNAUTHENTICATED', 'Authentication required');
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.roleName },
      mustChangePassword: user.mustChangePassword,
      csrfToken: session.csrfToken,
      permissions: ctx.isSuperAdmin
        ? { global: true }
        : { global: false, zones: await this.meZones(ctx) },
      mfa: await this.mfaState(user),
    };
  }

  /** /me mfa (doc 52 section 8): from the confirmed methods the policy lets this role use, not from users.mfa_enabled. */
  private async mfaState(user: AuthUser) {
    const policy = await this.deps.mfa.policy.read();
    const enabled = (await this.offeredMethods(user, policy)).length > 0;
    const required = isMfaRequired(policy, user.roleName);
    return { enabled, required, enrolmentNeeded: required && !enabled };
  }

  /** Every active assignment of a Zonal Admin with its permissions and limits from the AuthContext (doc 09, doc 14). */
  private async meZones(ctx: AuthContext): Promise<MeZone[]> {
    const zones = await this.deps.db.repo.findZonesForDisplay(ctx.assignedZoneIds);
    return zones
      .map((z) => ({
        zoneId: z.id,
        name: z.name,
        code: z.code,
        colorHex: z.colorHex,
        status: z.status,
        permissions: [...(ctx.permissionsByZone.get(z.id) ?? [])].sort(),
        limits: ctx.limitsByZone.get(z.id) ?? NO_LIMITS,
        services: zoneServiceFlags(z.services),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---- re-authentication ----------------------------------------------------------------------------------------

  /**
   * POST /auth/reauth (doc 52 section 2.4, D74). Password alone: PASSWORD level (10 minutes). Password and a current
   * second-step code (authenticator or backup code): STRONG (5 minutes, one action). A user with no method whose role
   * does not require one gets STRONG from the password, since nothing stronger exists for them. Any failure counts
   * toward the lockout and is a rate-limited DENIED reauth.failed row.
   */
  async reauth(
    session: AuthSession,
    input: ReauthStepUpInput,
    meta: RequestMeta,
  ): Promise<{ level: ReauthLevel; validUntil: Date }> {
    const user = await this.deps.db.repo.findUserById(session.userId);
    if (!user || user.status !== 'ACTIVE')
      throw new AppError('UNAUTHENTICATED', 'Authentication required');
    const now = this.deps.clock();

    if (!(await verifyPassword(user.passwordHash, input.password))) {
      return this.reauthFailed(
        user,
        meta,
        now,
        'Wrong password on re-authentication',
        'Incorrect password',
      );
    }

    const mark = async (level: ReauthLevel) => ({
      level,
      validUntil: await this.deps.sessions.markReauth(session.tokenHash, session.sessionId, level),
    });
    if (input.method === undefined || input.code === undefined) {
      const policy = await this.deps.mfa.policy.read();
      const nothingStronger =
        (await this.offeredMethods(user, policy)).length === 0 &&
        !isMfaRequired(policy, user.roleName);
      return mark(nothingStronger ? 'STRONG' : 'PASSWORD');
    }

    const step =
      input.method === 'AUTHENTICATOR'
        ? await this.checkAuthenticator(user, input.code, now)
        : input.method === 'BACKUP_CODE'
          ? await this.checkBackupCode(user, input.code)
          : await this.checkOneTimeCode(user, input.method, input.code, 'REAUTH');
    const consumed =
      step !== null &&
      (await this.asUser(user, meta, () => this.deps.db.transaction((tx) => step.consume(tx))));
    if (!consumed) {
      return this.reauthFailed(
        user,
        meta,
        now,
        `Wrong second-step code on re-authentication (${input.method})`,
        'That code didn’t work. Check it and try again.',
      );
    }
    return mark('STRONG');
  }

  private async reauthFailed(
    user: AuthUser,
    meta: RequestMeta,
    now: Date,
    note: string,
    message: string,
  ): Promise<never> {
    await this.asUser(user, meta, async () => {
      await this.deps.db.transaction((tx) => this.countFailureAndMaybeLock(tx, user, now));
      // DENIED (doc 50 §4.3 item 3): own transaction after the lockout one, at most one row per user a minute (D62).
      // recordDenied never throws, so a failure to record cannot hide the 401 below.
      await this.deps.audit.recordDenied({
        module: 'auth',
        action: 'reauth.failed',
        entity: userEntity(user),
        note,
      });
    });
    throw new AppError('UNAUTHENTICATED', message);
  }

  // ---- sessions (doc 52 section 2.6, doc 14 section 2) ----------------------------------------------------------

  /** Open sessions that are also within their idle limit: the ones that still work. */
  private async liveSessions(repo: AuthTx['repo'], userId: string, now: Date) {
    const open = await repo.listOpenSessions(userId, now);
    return open.filter(
      (s) => now.getTime() - s.lastSeenAt.getTime() <= this.deps.sessions.idleMsFor(s.remember),
    );
  }

  /**
   * At most `maxSessions` live sessions: the oldest beyond the cap are revoked and audited (TC-AUTH-37). Runs inside
   * the login transaction, after the new session was created; returns the token hashes to drop from the cache.
   */
  private async enforceSessionCap(tx: AuthTx, user: AuthUser, now: Date): Promise<string[]> {
    const live = await this.liveSessions(tx.repo, user.id, now); // newest first
    const excess = live.slice(this.config.maxSessions);
    if (excess.length === 0) return [];
    const revoked = await tx.repo.revokeSessions(
      user.id,
      excess.map((s) => s.id),
      now,
    );
    await recordMany(
      tx.audit,
      revoked.map((s): AuditEntry => ({
        module: 'auth',
        action: 'session.revoked',
        entity: sessionEntity(s.id, user),
        note: `Oldest session revoked: at most ${this.config.maxSessions} active sessions`,
      })),
    );
    return revoked.map((s) => s.tokenHash);
  }

  /** GET /me/sessions */
  async listSessions(session: AuthSession): Promise<SessionListItem[]> {
    const now = this.deps.clock();
    const live = await this.liveSessions(this.deps.db.repo, session.userId, now);
    return live.map((s) => ({
      id: s.id,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      remember: s.remember,
      current: s.id === session.sessionId,
    }));
  }

  /** DELETE /me/sessions/{id}: only the caller's own live session; anything else is 404. Returns true for the current one. */
  async revokeOwnSession(session: AuthSession, sessionId: string, meta: RequestMeta) {
    const now = this.deps.clock();
    const user = await this.deps.db.repo.findUserById(session.userId);
    if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    const live = await this.liveSessions(this.deps.db.repo, user.id, now);
    if (!live.some((s) => s.id === sessionId)) throw new AppError('NOT_FOUND', 'Not found');
    const revoked = await this.revokeAndAudit(user, [sessionId], now, meta, 'Revoked by the user');
    await this.deps.sessions.evictMany(revoked);
    return { current: sessionId === session.sessionId };
  }

  /** POST /me/sessions/revoke-others: every live session but the current one. */
  async revokeOtherOwnSessions(session: AuthSession, meta: RequestMeta): Promise<number> {
    const now = this.deps.clock();
    const user = await this.deps.db.repo.findUserById(session.userId);
    if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    const others = (await this.liveSessions(this.deps.db.repo, user.id, now))
      .map((s) => s.id)
      .filter((id) => id !== session.sessionId);
    if (others.length === 0) {
      noteAuditNoop(); // nothing to revoke: an audited no-op for the coverage guard
      return 0;
    }
    const revoked = await this.revokeAndAudit(
      user,
      others,
      now,
      meta,
      'Revoked by the user (all other sessions)',
    );
    await this.deps.sessions.evictMany(revoked);
    return revoked.length;
  }

  private async revokeAndAudit(
    user: AuthUser,
    sessionIds: string[],
    now: Date,
    meta: RequestMeta,
    note: string,
  ): Promise<string[]> {
    return this.asUser(user, meta, () =>
      this.deps.db.transaction(async (tx) => {
        const revoked = await tx.repo.revokeSessions(user.id, sessionIds, now);
        if (revoked.length === 0) noteAuditNoop(); // revoked meanwhile by another request: nothing changed here
        await recordMany(
          tx.audit,
          revoked.map((s): AuditEntry => ({
            module: 'auth',
            action: 'session.revoked',
            entity: sessionEntity(s.id, user),
            note,
          })),
        );
        return revoked.map((s) => s.tokenHash);
      }),
    );
  }

  // ---- change password ------------------------------------------------------------------------------------------

  /**
   * POST /auth/change-password (doc 52 section 8): also the forced first-login change, which a restricted session may
   * call. A wrong current password counts toward the lockout like a wrong login (doc 32). Success: new hash, the
   * restriction lifted, every OTHER session revoked (doc 56 P6), audit, and a notice to the account address.
   */
  async changePassword(
    session: AuthSession,
    input: ChangePasswordInput,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.deps.db.repo.findUserById(session.userId);
    if (!user || user.status !== 'ACTIVE')
      throw new AppError('UNAUTHENTICATED', 'Authentication required');
    const now = this.deps.clock();
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new AppError('FORBIDDEN', 'The account is locked. Try again later.');
    }

    if (!(await verifyPassword(user.passwordHash, input.current))) {
      await this.asUser(user, meta, () =>
        this.deps.db.transaction((tx) => this.countFailureAndMaybeLock(tx, user, now)),
      );
      throw new AppError('VALIDATION_ERROR', 'The current password is not correct', [
        { field: 'current', issue: 'incorrect' },
      ]);
    }

    const passwordHash = await hashPassword(input.new);
    const revoked = await this.asUser(user, meta, () =>
      this.deps.db.transaction(async (tx) => {
        await tx.repo.setPassword(user.id, passwordHash, now);
        await tx.repo.setSessionRestriction(session.sessionId, null);
        const others = await tx.repo.revokeOtherSessions(user.id, session.sessionId, now);
        await recordMany(tx.audit, [
          {
            module: 'auth',
            action: 'user.password_changed',
            entity: userEntity(user),
            note: user.mustChangePassword ? 'First-login password change' : 'Changed by the user',
          },
          ...others.map((s): AuditEntry => ({
            module: 'auth',
            action: 'session.revoked',
            entity: sessionEntity(s.id, user),
            note: 'Other sessions revoked by a password change',
          })),
        ]);
        return others.map((s) => s.tokenHash);
      }),
    );

    await this.deps.sessions.evictMany(revoked);
    await this.deps.sessions.clearPasswordChange(session.tokenHash);
    notify(
      this.deps.mailer.sendPasswordChanged({
        to: user.email,
        name: user.name,
        at: now,
        ip: meta.ip,
      }),
      'password changed',
      meta.requestId,
    );
  }

  // ---- password reset -------------------------------------------------------------------------------------------

  /** Always resolves the same way for known, unknown and rate-limited emails (only the per-IP limit answers 429). */
  async forgotPassword(input: ForgotPasswordInput, meta: RequestMeta): Promise<void> {
    const { limiter, config } = this.deps;
    if (meta.ip) {
      const ipLimit = await limiter.hit(
        `forgot:ip:${meta.ip}`,
        config.forgotLimitPerIp.limit,
        config.forgotLimitPerIp.windowSec,
      );
      if (!ipLimit.allowed) throw this.rateLimited(ipLimit.retryAfterSec);
    }
    const emailLimit = await limiter.hit(
      `forgot:email:${sha256Hex(input.email)}`,
      config.forgotLimitPerEmail.limit,
      config.forgotLimitPerEmail.windowSec,
    );
    // Nothing changes on these paths, so nothing is recorded; they count as audited no-ops for the coverage guard.
    if (!emailLimit.allowed) {
      noteAuditNoop();
      return;
    }

    const user = await this.deps.db.repo.findUserByEmail(input.email);
    if (!user || user.status !== 'ACTIVE') {
      noteAuditNoop();
      return;
    }

    const now = this.deps.clock();
    const token = randomToken(32);
    const expiresAt = new Date(now.getTime() + this.config.resetTokenTtlMs);

    await this.asUser(user, meta, () =>
      this.deps.db.transaction(async (tx) => {
        await tx.repo.invalidateOpenResetTokens(user.id, now);
        await tx.repo.createResetToken({
          id: uuidv7(),
          userId: user.id,
          tokenHash: sha256Hex(token),
          expiresAt,
        });
        await record(tx.audit, {
          module: 'auth',
          action: 'user.password_reset_requested',
          entity: userEntity(user),
        });
      }),
    );

    // Not awaited: the response must not reveal, by timing, that an account exists.
    notify(
      this.deps.mailer.sendPasswordReset({ to: user.email, name: user.name, token, expiresAt }),
      'password reset',
      meta.requestId,
    );
  }

  async resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
    const now = this.deps.clock();
    const tokenHash = sha256Hex(input.token);
    // Hashed first, so a bad token costs the same as a good one.
    const passwordHash = await hashPassword(input.newPassword);

    const revoked = await this.deps.db.transaction(async (tx) => {
      const userId = await tx.repo.consumeResetToken(tokenHash, now);
      if (!userId) return null;
      const user = await tx.repo.findUserById(userId);
      if (!user || user.status !== 'ACTIVE') return null;

      return this.asUser(user, meta, async () => {
        await tx.repo.setPassword(user.id, passwordHash, now);
        const sessions = await tx.repo.revokeAllSessions(user.id, now);

        const entries: AuditEntry[] = [
          {
            module: 'auth',
            action: 'user.password_changed',
            entity: userEntity(user),
            note: 'Password reset with an emailed link',
          },
        ];
        if (user.lockedUntil && user.lockedUntil > now) {
          entries.push({
            module: 'auth',
            action: 'user.unlocked',
            entity: userEntity(user),
            note: 'Lock cleared by password reset',
          });
        }
        for (const s of sessions) {
          entries.push({
            module: 'auth',
            action: 'session.revoked',
            entity: sessionEntity(s.id, user),
            note: 'All sessions revoked by password reset',
          });
        }
        await recordMany(tx.audit, entries);
        return { user, tokenHashes: sessions.map((s) => s.tokenHash) };
      });
    });

    if (revoked === null) {
      throw new AppError('VALIDATION_ERROR', 'This reset link is invalid or has expired');
    }
    await this.deps.sessions.evictMany(revoked.tokenHashes);
    notify(
      this.deps.mailer.sendPasswordChanged({
        to: revoked.user.email,
        name: revoked.user.name,
        at: now,
        ip: meta.ip,
      }),
      'password changed',
      meta.requestId,
    );
  }
}
