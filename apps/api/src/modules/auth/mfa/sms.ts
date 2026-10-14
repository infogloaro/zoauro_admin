import type { Redis } from 'ioredis';
import type { MfaPolicy } from '@zoauro/shared';
import { phoneHint } from '@zoauro/shared';

// SMS one-time codes (doc 52 sections 2.2, 5, 6) behind a provider interface. 'none' (the default) fails closed;
// 'console' (local work and tests) keeps messages in memory and prints them, and the API refuses to start with it in
// production (env.ts); 'msg91' is the real adapter (D68, owner 2026-10-14). MSG91 sends a DLT-registered template, so a
// provider receives the code and its lifetime, never free text.

export const SMS_PROVIDERS = ['none', 'console', 'msg91'] as const;
export type SmsProviderName = (typeof SMS_PROVIDERS)[number];

export interface SmsOtp {
  code: string;
  minutes: number;
}

export interface SmsProvider {
  readonly name: SmsProviderName;
  /** true when a message can actually be handed to someone */
  readonly canSend: boolean;
  sendOtp(toE164: string, otp: SmsOtp): Promise<void>;
}

/** The wording to register on the DLT portal (doc 52 section 6); the console provider prints exactly this. */
export const otpSmsText = (otp: SmsOtp): string =>
  `${otp.code} is your ZOAURO Admin verification code. It expires in ${otp.minutes} minutes. Never share it.`;

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
  sendOtp: async () => {
    throw new SmsUnavailableError();
  },
};

/** Development and tests only. The destination is printed as a hint; the body is the message itself (that is its job). */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console' as const;
  readonly canSend = true;
  readonly sent: { to: string; body: string }[] = [];
  constructor(private readonly opts: { print?: boolean } = {}) {}
  async sendOtp(toE164: string, otp: SmsOtp): Promise<void> {
    const body = otpSmsText(otp);
    this.sent.push({ to: toE164, body });
    if (this.opts.print) console.log(`[console SMS] to ${phoneHint(toE164)}: ${body}`);
  }
}

export class SmsDeliveryError extends Error {
  constructor(readonly status: number) {
    super(`SMS provider refused the message (HTTP ${status})`);
    this.name = 'SmsDeliveryError';
  }
}

export interface Msg91Config {
  authKey: string;
  /** the MSG91 template id of the OTP flow (mapped to the DLT template inside MSG91) */
  templateId: string;
  /** default https://control.msg91.com/api/v5/flow */
  url?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * MSG91 Flow API: POST {template_id, recipients:[{mobiles, otp, minutes}]} with the `authkey` header. The template in
 * MSG91 must use the variables ##otp## and ##minutes##. Neither the number nor the code is ever logged.
 */
export class Msg91SmsProvider implements SmsProvider {
  readonly name = 'msg91' as const;
  readonly canSend = true;
  constructor(private readonly cfg: Msg91Config) {}
  async sendOtp(toE164: string, otp: SmsOtp): Promise<void> {
    const res = await (this.cfg.fetch ?? fetch)(
      this.cfg.url ?? 'https://control.msg91.com/api/v5/flow',
      {
        method: 'POST',
        headers: {
          authkey: this.cfg.authKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          template_id: this.cfg.templateId,
          short_url: '0',
          recipients: [
            { mobiles: toE164.replace(/^\+/, ''), otp: otp.code, minutes: String(otp.minutes) },
          ],
        }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 10_000),
      },
    );
    if (!res.ok) throw new SmsDeliveryError(res.status);
    // MSG91 can answer 200 with {"type":"error"}
    const data: unknown = await res.json().catch(() => null);
    if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'error')
      throw new SmsDeliveryError(res.status);
  }
}

export interface SmsEnv {
  SMS_PROVIDER: SmsProviderName;
  SMS_API_KEY?: string | undefined;
  /** the provider's own template id (MSG91 flow template); the DLT id lives inside it */
  SMS_TEMPLATE_ID_OTP?: string | undefined;
}

/** env.ts already refuses 'msg91' without SMS_API_KEY and SMS_TEMPLATE_ID_OTP; fail closed if called without them. */
export function createSmsProvider(env: SmsEnv): SmsProvider {
  if (env.SMS_PROVIDER === 'console') return new ConsoleSmsProvider({ print: true });
  if (env.SMS_PROVIDER === 'msg91' && env.SMS_API_KEY && env.SMS_TEMPLATE_ID_OTP)
    return new Msg91SmsProvider({ authKey: env.SMS_API_KEY, templateId: env.SMS_TEMPLATE_ID_OTP });
  return disabledSmsProvider;
}

/**
 * Doc 52 section 5 / doc 56 P9: the policy may switch SMS on only with a REAL provider and SMS_DLT_TEMPLATE_ID_OTP.
 * 'none' and 'console' are not real providers. Used by PUT /settings/security (P10).
 */
export function smsEnablementProblem(env: {
  SMS_PROVIDER: SmsProviderName;
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
