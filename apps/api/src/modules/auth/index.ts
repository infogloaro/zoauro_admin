import type { RequestHandler, Router } from 'express';
import type { Redis } from 'ioredis';
import type { Audit } from '../../lib/audit/audit.service';
import { DEFAULT_AUTH_CONFIG, type AuthConfig, type Clock } from '../../lib/auth/config';
import { requireRecentReauth, sessionMiddleware } from '../../lib/auth/middleware';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { SessionStore } from '../../lib/auth/session-store';
import { RedisRateLimiter } from '../../lib/rate-limiter';
import { AuthDatabase } from './auth.repository';
import { createAuthController } from './auth.controller';
import { createAuthRoutes } from './auth.routes';
import { noopAuthMailer, type AuthMailer } from './auth.mails';
import { AuthService } from './auth.service';
import { createOtpHasher } from './mfa/otp-hash';
import { PendingLoginStore } from './mfa/pending';
import { createMfaPolicyReader, type MfaPolicyReader } from './mfa/policy';
import { createSecretBox } from './mfa/secret-box';
import { OtpService } from './mfa/otp.service';
import { disabledSmsProvider, SmsCircuitBreaker, type SmsProvider } from './mfa/sms';
import { record, runAsSystem } from '../../lib/audit';

export { createAuthMailer, noopAuthMailer, type AuthMailer } from './auth.mails';
export { staticMfaPolicy, type MfaPolicyReader } from './mfa/policy';
export { ConsoleSmsProvider, createSmsProvider, type SmsProvider } from './mfa/sms';

export interface AuthModule {
  router: Router;
  /** Resolves the session cookie; install once, before every router that needs a session. */
  sessionMiddleware: ReturnType<typeof sessionMiddleware>;
  /** Step-up guard for high-risk routes of any module (doc 14 section 4, doc 52 section 2.4); after requireSession */
  requireReauth: (level: ReauthLevel) => RequestHandler;
}

export function createAuthModule(deps: {
  prisma: ConstructorParameters<typeof AuthDatabase>[0];
  redis: Redis;
  /** the process-wide audit service (server.ts); auth uses its rate-limited recordDenied() */
  audit: Pick<Audit, 'recordDenied'>;
  sessionSecret: string;
  appOrigin: string;
  /** reset link, new-login and password-changed mails; default sends nothing (server.ts wires SMTP when SMTP_URL is set) */
  mailer?: AuthMailer;
  config?: AuthConfig;
  clock?: Clock;
  /** 2-step (doc 52 section 5, doc 12): ENCRYPTION_KEY (+ previous while rotating) seals authenticator secrets */
  encryptionKey: string;
  encryptionKeyPrevious?: string;
  /** OTP_HMAC_KEY: one-time and backup codes are stored only as HMACs */
  otpHmacKey: string;
  /** default: the settings key security.mfa with the doc 52 defaults; tests pass a fixed policy */
  mfaPolicy?: MfaPolicyReader;
  /** SMS_PROVIDER (doc 52 section 6): default none, nothing is ever sent */
  sms?: SmsProvider;
}): AuthModule {
  const config = deps.config ?? DEFAULT_AUTH_CONFIG;
  const clock = deps.clock ?? (() => new Date());
  const db = new AuthDatabase(deps.prisma);
  const sessions = new SessionStore({
    redis: deps.redis,
    persistence: db.repo,
    config,
    clock,
    sessionSecret: deps.sessionSecret,
  });
  const limiter = new RedisRateLimiter(deps.redis);
  const mailer = deps.mailer ?? noopAuthMailer;
  const hasher = createOtpHasher(deps.otpHmacKey);
  const sms = deps.sms ?? disabledSmsProvider;
  const breaker = new SmsCircuitBreaker({
    redis: deps.redis,
    clock,
    // doc 52 section 2.2: at 100 % SMS pauses until a Super Admin resumes it; audited as the system. The notifications
    // module that would alert Super Admins in the panel does not exist yet: the log line is the alert for now.
    onPaused: async (sentThisHour, cap) => {
      console.error(`SMS paused: ${sentThisHour} SMS this hour reached the cap of ${cap}`);
      await runAsSystem('sms-circuit-breaker', () =>
        db.transaction((tx) =>
          record(tx.audit, {
            module: 'auth',
            action: 'sms.paused',
            entity: { type: 'setting', label: 'SMS one-time codes' },
            note: `${sentThisHour} SMS this hour reached the hourly cap of ${cap}`,
          }),
        ),
      );
    },
    onWarning: (sentThisHour, cap) =>
      console.warn(`SMS at ${sentThisHour} of the hourly cap of ${cap} (80 %)`),
  });
  const service = new AuthService({
    db,
    sessions,
    limiter,
    audit: deps.audit,
    mailer,
    config,
    clock,
    mfa: {
      pending: new PendingLoginStore({ redis: deps.redis, clock }),
      policy:
        deps.mfaPolicy ??
        createMfaPolicyReader({
          load: (key) => db.repo.getSettingValue(key),
          onInvalid: () => console.error('settings security.mfa is invalid: the defaults apply'),
        }),
      secretBox: createSecretBox({
        current: deps.encryptionKey,
        ...(deps.encryptionKeyPrevious ? { previous: deps.encryptionKeyPrevious } : {}),
      }),
      hasher,
      otp: new OtpService({
        repo: () => db.repo,
        hasher,
        mailer,
        sms,
        breaker,
        limiter,
        clock,
      }),
      sms,
      breaker,
    },
  });
  return {
    router: createAuthRoutes(createAuthController(service, { csrfSecret: deps.sessionSecret }), {
      appOrigin: deps.appOrigin,
      csrfSecret: deps.sessionSecret,
    }),
    sessionMiddleware: sessionMiddleware(sessions),
    requireReauth: (level) => requireRecentReauth(sessions, level),
  };
}
