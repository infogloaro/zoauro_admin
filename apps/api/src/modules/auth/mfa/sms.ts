import type { Redis } from 'ioredis';
import type { MfaPolicy } from '@zoauro/shared';
import { phoneHint } from '@zoauro/shared';

// SMS one-time codes (doc 52 sections 2.2, 5, 6): an interface only. No vendor is chosen (D68 is open) and no real
// adapter exists, so SMS stays off: 'none' fails closed; 'console' (local work and tests) keeps messages in memory and
// prints them, and the API refuses to start with it in production (env.ts).

export interface SmsProvider {
  readonly name: 'none' | 'console';
  /** true when a message can actually be handed to someone */
  readonly canSend: boolean;
  send(toE164: string, body: string): Promise<void>;
}

export class SmsUnavailableError extends Error {
  constructor() {
    super('SMS is not available');
    this.name = 'SmsUnavailableError';
  }
}

/** The default: nothing can be sent, ever. */
export const disabledSmsProvider: SmsProvider = {
  name: 'none',
  canSend: false,
  send: async () => {
    throw new SmsUnavailableError();
  },
};

/** Development and tests only. The destination is printed as a hint; the body is the message itself (that is its job). */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console' as const;
  readonly canSend = true;
  readonly sent: { to: string; body: string }[] = [];
  constructor(private readonly opts: { print?: boolean } = {}) {}
  async send(toE164: string, body: string): Promise<void> {
    this.sent.push({ to: toE164, body });
    if (this.opts.print) console.log(`[console SMS] to ${phoneHint(toE164)}: ${body}`);
  }
}

export function createSmsProvider(name: 'none' | 'console'): SmsProvider {
  return name === 'console' ? new ConsoleSmsProvider({ print: true }) : disabledSmsProvider;
}

/**
 * Doc 52 section 5 / doc 56 P9: the policy may switch SMS on only with a REAL provider and SMS_DLT_TEMPLATE_ID_OTP.
 * 'none' and 'console' are not real providers, and no real adapter exists yet (D68), so today this always returns a
 * reason. Used by PUT /settings/security (P10).
 */
export function smsEnablementProblem(env: {
  SMS_PROVIDER: 'none' | 'console';
  SMS_DLT_TEMPLATE_ID_OTP?: string | undefined;
}): string | null {
  if (env.SMS_PROVIDER === 'none' || env.SMS_PROVIDER === 'console')
    return 'SMS needs a real provider (none is configured)';
  if (!env.SMS_DLT_TEMPLATE_ID_OTP) return 'SMS_DLT_TEMPLATE_ID_OTP is not set';
  return null;
}

/**
 * The SMS circuit breaker (doc 52 section 2.2, D67): a global count of SMS per hour. At 80 % of smsHourlyGlobalCap a
 * warning, at 100 % SMS is paused until a Super Admin resumes it (P10); email and authenticator keep working.
 */
export class SmsCircuitBreaker {
  constructor(
    private readonly deps: {
      redis: Redis;
      clock: () => Date;
      /** called once when the cap trips (audit sms.paused as SYSTEM, notify Super Admins) */
      onPaused: (sentThisHour: number, cap: number) => Promise<void>;
      /** called once per hour when 80 % is crossed */
      onWarning?: (sentThisHour: number, cap: number) => void;
    },
  ) {}

  private hourKey(): string {
    return `sms:global:${Math.floor(this.deps.clock().getTime() / 3_600_000)}`;
  }

  async isPaused(): Promise<boolean> {
    return (await this.deps.redis.exists('sms:paused')) === 1;
  }

  /**
   * Counts one SMS about to be sent. False (and nothing must be sent) when SMS is paused or this send would exceed the
   * cap; the send that reaches the cap is the last one.
   */
  async tryCount(policy: MfaPolicy): Promise<boolean> {
    if (await this.isPaused()) return false;
    const key = this.hourKey();
    const n = await this.deps.redis.incr(key);
    if (n === 1) await this.deps.redis.expire(key, 3600);
    const cap = policy.smsHourlyGlobalCap;
    if (n > cap) {
      // SET NX: only the first request over the cap reports the pause
      if ((await this.deps.redis.set('sms:paused', '1', 'NX')) === 'OK') {
        await this.deps.onPaused(n - 1, cap);
      }
      return false;
    }
    if (n === Math.ceil(cap * 0.8)) this.deps.onWarning?.(n, cap);
    return true;
  }

  /** Super Admin "resume SMS" (P10). */
  async resume(): Promise<void> {
    await this.deps.redis.del('sms:paused');
  }
}
