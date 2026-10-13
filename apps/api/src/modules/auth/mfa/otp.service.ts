import { randomInt } from 'node:crypto';
import { normaliseIndianMobile, phoneHint, type MfaPolicy } from '@zoauro/shared';
import { uuidv7 } from '../../../lib/audit';
import { maskEmail } from '../../../lib/audit/redact';
import { AppError } from '../../../lib/errors';
import type { RateLimiter } from '../../../lib/rate-limiter';
import type { AuthMailer } from '../auth.mails';
import type { AuthRepository, AuthTx, AuthUser } from '../auth.repository';
import type { OtpHasher } from './otp-hash';
import type { SmsCircuitBreaker, SmsProvider } from './sms';

// One-time codes by email and SMS (doc 52 section 2.2): 6 digits from crypto.randomInt, stored only as
// HMAC(OTP_HMAC_KEY, 'challenge', challengeId, code), never logged. Lifetime, guesses, cooldown and caps come from the
// policy (within the doc 52 floors and ceilings, checked by the shared schema). The destination is ALWAYS the address
// or number on the account record (D72): nothing in a request can choose it.

export type OtpChannel = 'EMAIL_OTP' | 'SMS_OTP';
export type OtpPurpose = 'LOGIN' | 'ENROL_PROOF' | 'ENROL_EMAIL' | 'ENROL_SMS' | 'REAUTH';

export interface SentChallenge {
  sent: boolean;
  hint: string;
  resendAfterSeconds: number;
  expiresInSeconds: number;
}

/** Thrown when the channel cannot be used now: no verified number, SMS off or paused. The route answers 409. */
export const channelUnavailable = (): AppError =>
  new AppError('CONFLICT', 'This method is not available right now');

const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

export class OtpService {
  constructor(
    private readonly deps: {
      repo: () => AuthRepository;
      hasher: OtpHasher;
      mailer: AuthMailer;
      sms: SmsProvider;
      breaker: SmsCircuitBreaker;
      limiter: RateLimiter;
      clock: () => Date;
    },
  ) {}

  /** Where a code for this user and channel goes, or null when the channel has no verified destination. */
  destination(user: AuthUser, channel: OtpChannel): { to: string; hint: string } | null {
    if (channel === 'EMAIL_OTP') return { to: user.email, hint: maskEmail(user.email) };
    // SMS: only the number on the record, and only once it was proven (doc 52 section 2.3)
    const e164 = user.phone ? normaliseIndianMobile(user.phone) : null;
    if (!e164 || !user.phoneVerifiedAt) return null;
    return { to: e164, hint: phoneHint(e164) };
  }

  /**
   * Sends (or resends) a code. Order: cooldown (429 with the seconds left), hourly and daily caps per user and channel
   * (429), the SMS breaker (409), then a new code; a resend replaces the code on the same row.
   */
  async send(
    user: AuthUser,
    purpose: OtpPurpose,
    channel: OtpChannel,
    policy: MfaPolicy,
    meta: { ip: string | null },
    to: { to: string; hint: string },
  ): Promise<SentChallenge> {
    const now = this.deps.clock();
    const repo = this.deps.repo();
    const latest = await repo.findLatestOpenChallenge(user.id, purpose, channel);
    if (latest) {
      const waitMs =
        latest.lastSentAt.getTime() + policy.resendCooldownSeconds * 1000 - now.getTime();
      if (waitMs > 0) throw this.retryAfter(Math.ceil(waitMs / 1000));
    }
    for (const [suffix, limit, windowSec] of [
      ['hour', policy.sendsPerHour, 3600],
      ['day', policy.sendsPerDay, 86_400],
    ] as const) {
      const r = await this.deps.limiter.hit(
        `otp-send:${channel}:${suffix}:${user.id}`,
        limit,
        windowSec,
      );
      if (!r.allowed) throw this.retryAfter(r.retryAfterSec);
    }
    if (channel === 'SMS_OTP' && !(await this.deps.breaker.tryCount(policy)))
      throw channelUnavailable();

    const code = newCode();
    const expiresAt = new Date(now.getTime() + policy.otpTtlSeconds * 1000);
    let challengeId: string;
    if (latest && latest.attempts < latest.maxAttempts) {
      challengeId = latest.id;
      await repo.replaceChallengeCode(latest.id, {
        codeHash: this.hash(latest.id, code),
        expiresAt,
        maxAttempts: policy.otpMaxAttempts,
        lastSentAt: now,
      });
    } else {
      challengeId = uuidv7();
      await repo.createChallenge({
        id: challengeId,
        userId: user.id,
        purpose,
        method: channel,
        codeHash: this.hash(challengeId, code),
        destinationHint: to.hint,
        expiresAt,
        maxAttempts: policy.otpMaxAttempts,
        lastSentAt: now,
        ip: meta.ip,
      });
    }

    let sent = true;
    try {
      if (channel === 'EMAIL_OTP') {
        await this.deps.mailer.sendOtpCode({
          to: to.to,
          name: user.name,
          code,
          expiresAt,
          purpose,
        });
      } else {
        await this.deps.sms.send(
          to.to,
          `${code} is your ZOAURO Admin verification code. It expires in ${Math.round(policy.otpTtlSeconds / 60)} minutes. Never share it.`,
        );
      }
    } catch (err) {
      sent = false; // the code itself is never logged; only that delivery failed
      console.error(
        `one-time code delivery failed (${channel}, ${err instanceof Error ? err.name : 'unknown'})`,
      );
    }
    return {
      sent,
      hint: to.hint,
      resendAfterSeconds: policy.resendCooldownSeconds,
      expiresInSeconds: policy.otpTtlSeconds,
    };
  }

  /**
   * The open, unexpired challenge whose code matches, with its consumption to run in the success transaction; null
   * otherwise. A wrong guess is counted on the challenge (the last allowed one kills the code).
   */
  async check(
    user: AuthUser,
    purpose: OtpPurpose,
    channel: OtpChannel,
    code: string,
  ): Promise<{ consume: (tx: AuthTx) => Promise<boolean> } | null> {
    const now = this.deps.clock();
    const repo = this.deps.repo();
    const latest = await repo.findLatestOpenChallenge(user.id, purpose, channel);
    if (!latest || latest.expiresAt <= now || latest.attempts >= latest.maxAttempts) return null;
    if (!this.deps.hasher.equals(latest.codeHash, this.hash(latest.id, code))) {
      await repo.recordWrongGuess(latest.id, now);
      return null;
    }
    return { consume: (tx) => tx.repo.consumeChallenge(latest.id, this.deps.clock()) };
  }

  private hash(challengeId: string, code: string): string {
    return this.deps.hasher.hash(['challenge', challengeId, code]);
  }

  private retryAfter(seconds: number): AppError {
    const s = Math.max(1, seconds);
    return new AppError('RATE_LIMITED', `Try again in ${s} seconds`, undefined, {
      'Retry-After': String(s),
    });
  }
}
