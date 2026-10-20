import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import type { Express, Router } from 'express';
import request from 'supertest';
import { createApp, type AuditCoverageOptions } from '../../../src/app';
import {
  createAudit,
  RedisDeniedRateLimiter,
  uuidv7,
  type DeniedRateLimiter,
} from '../../../src/lib/audit';
import { DEFAULT_AUTH_CONFIG, type AuthConfig } from '../../../src/lib/auth/config';
import { hashPassword, issuePreSessionCsrf } from '../../../src/lib/auth/crypto';
import { authContextMiddleware, type AccessService } from '../../../src/lib/authz';
import { RedisRateLimiter } from '../../../src/lib/rate-limiter';
import { auditTransaction, createPrismaClient } from '../../../src/lib/db';
import {
  createAccessModule,
  createAccessService,
  createZoneTeamPort,
  type AccessMailer,
} from '../../../src/modules/access';
import { createAuditModule } from '../../../src/modules/audit';
import { createHotelsModule } from '../../../src/modules/hotels';
import { createMenuModule } from '../../../src/modules/menu';
import { createOrdersModule } from '../../../src/modules/orders';
import { createSettingsModule } from '../../../src/modules/settings';
import { createCustomersModule } from '../../../src/modules/customers';
import { createUploadsModule } from '../../../src/modules/uploads';
import { createPartnersModule } from '../../../src/modules/delivery-partners';
import { createNotificationsModule } from '../../../src/modules/notifications';
import { createDashboardModule } from '../../../src/modules/dashboard';
import { createSearchModule } from '../../../src/modules/search';
import { noopMailer } from '../../../src/lib/mailer';
import { createVendorsModule } from '../../../src/modules/vendors';
import { createFakeStorage } from '../../uploads/fake-storage';
import {
  createZonesModule,
  stubImpactSources,
  type ImpactSources,
} from '../../../src/modules/zones';
import type { ZonesCacheVersion } from '../../../src/modules/zones/zones.events';
import {
  createAuthModule,
  type AuthMailer,
  type MfaPolicyReader,
  type AuthModule,
  type SmsProvider,
} from '../../../src/modules/auth';
import { generateBackupCodes, hashBackupCode } from '../../../src/modules/auth/mfa/backup-codes';
import { createOtpHasher } from '../../../src/modules/auth/mfa/otp-hash';
import { createSecretBox, mfaSecretAad } from '../../../src/modules/auth/mfa/secret-box';
import { newTotpSecret, totpAt } from '../../../src/modules/auth/mfa/totp';
import { createTestDatabase, type TestDatabase } from '../../audit/support/db';

// Integration environment for the auth tests: a throwaway PostgreSQL database built by `prisma migrate deploy`, the
// real application role (zoauro_app), the local Redis (keys under a private prefix), a controllable clock and a mailer
// that captures reset links.

export const APP_ORIGIN = 'http://localhost:3000';
/** The session secret every test app is built with; also signs the pre-session CSRF token. */
export const TEST_SESSION_SECRET = 'test-session-secret-0123456789-abcdef';
/** 2-step keys of every test app (seal authenticator secrets, hash codes) */
export const TEST_ENCRYPTION_KEY = 'test-encryption-key-0123456789-abcdefgh';
export const TEST_OTP_HMAC_KEY = 'test-otp-hmac-key-0123456789-abcdefghij';

/** What a browser holds after GET /auth/csrf: the zo_csrf cookie and the same token for X-CSRF-Token. */
export function preSessionCsrf(): { cookie: string; token: string } {
  const token = issuePreSessionCsrf(TEST_SESSION_SECRET);
  return { cookie: `zo_csrf=${encodeURIComponent(token)}`, token };
}
export const PASSWORD = 'correct horse battery staple 1';

export interface ResetMail {
  to: string;
  name: string;
  token: string;
  expiresAt: Date;
}

export type PersonaRole = 'SUPER_ADMIN' | 'ZONAL_ADMIN';

interface AppExtras {
  routers?: Router[];
  accessCacheTtlSec?: number;
  /** default: the app's own (throw under vitest, so any unaudited 2xx write fails the run) */
  auditCoverage?: AuditCoverageOptions;
  /** default: Redis-backed, as server.ts (keys under this env's private prefix) */
  deniedLimiter?: DeniedRateLimiter;
  onDeniedFailure?: (err: unknown) => void;
  /** default: the settings row (none in the test database) = the doc 52 defaults, 2-step required for both roles */
  mfaPolicy?: MfaPolicyReader;
  /** default: no SMS provider (nothing can be sent), as in production today */
  sms?: SmsProvider;
  /** a router built with the module's own step-up guard (routes needing PASSWORD or STRONG re-authentication) */
  routerFactory?: (deps: { requireReauth: AuthModule['requireReauth'] }) => Router;
  /** the zones module's ports and cache counter (default: stubs and this env's Redis), as server.ts mounts it */
  zones?: {
    impactSources?: ImpactSources;
    cache?: ZonesCacheVersion;
    /** a second connection pool (concurrency tests) */
    prisma?: ReturnType<typeof createPrismaClient>;
  };
  /** the M16 tile cache (default: none, fresh counts per test) */
  dashboardCache?: Parameters<typeof createDashboardModule>[0]['redis'];
  /** the M18 rate limiter (default: Redis-backed, as server.ts) */
  searchLimiter?: Parameters<typeof createSearchModule>[0]['limiter'];
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  role: PersonaRole;
  /** base32 secret of the user's authenticator (enrolled by createUser unless { mfa: false }) */
  totpSecret?: string;
}

/**
 * Generous limits so ordinary tests never trip the rate limiter or the session cap (suites sign the same user in many
 * times); the rate-limit and session-cap tests pass their own (DEFAULT_AUTH_CONFIG values).
 */
export const TEST_CONFIG: AuthConfig = {
  ...DEFAULT_AUTH_CONFIG,
  maxSessions: 1_000,
  loginLimitPerIp: { limit: 10_000, windowSec: 60 },
  loginLimitPerEmail: { limit: 10_000, windowSec: 60 },
  forgotLimitPerIp: { limit: 10_000, windowSec: 60 },
  forgotLimitPerEmail: { limit: 3, windowSec: 900 },
  mfaVerifyLimitPerIp: { limit: 10_000, windowSec: 60 },
};

export async function createAuthTestEnv() {
  const configuredRedisUrl = process.env['REDIS_URL'];
  if (!configuredRedisUrl)
    throw new Error('REDIS_URL is required for the auth tests (local Redis from pnpm infra:up).');
  const redisUrl: string = configuredRedisUrl;

  const db: TestDatabase = await createTestDatabase();
  const prisma = createPrismaClient(db.appUrl);
  const prefix = `test:${randomBytes(4).toString('hex')}:`;
  const redis = new Redis(redisUrl, { keyPrefix: prefix });
  const rawRedis = new Redis(redisUrl);

  let nowMs = Date.now();
  // object storage for vendors and uploads (in memory; tests put files with storage.put)
  const storage = createFakeStorage();
  const clock = {
    now: () => new Date(nowMs),
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
  const mails: ResetMail[] = [];
  /** emailed one-time codes (the test double is the only place a code is ever kept) */
  const otpMails: { to: string; code: string; purpose: string }[] = [];
  /** 2-step change notices (method added/removed, codes regenerated, reset by admin) */
  const mfaChanges: { to: string; change: string; method: string | null }[] = [];
  /** new-login and password-changed notices, in order */
  const notices: {
    kind: 'NEW_LOGIN' | 'PASSWORD_CHANGED' | 'BACKUP_CODE_USED';
    to: string;
    ip: string | null;
  }[] = [];
  const mailer: AuthMailer = {
    sendPasswordReset: async (m: ResetMail) => {
      mails.push(m);
    },
    sendNewLogin: async (m) => {
      notices.push({ kind: 'NEW_LOGIN', to: m.to, ip: m.ip });
    },
    sendPasswordChanged: async (m) => {
      notices.push({ kind: 'PASSWORD_CHANGED', to: m.to, ip: m.ip });
    },
    sendBackupCodeUsed: async (m) => {
      notices.push({ kind: 'BACKUP_CODE_USED', to: m.to, ip: null });
    },
    sendMfaChanged: async (m) => {
      mfaChanges.push({ to: m.to, change: m.change, method: m.method ?? null });
    },
    sendOtpCode: async (m) => {
      otpMails.push({ to: m.to, code: m.code, purpose: m.purpose });
    },
  };

  /** M03 member emails (TC-AC-13): captured, never sent */
  const accessMails: {
    kind: 'access' | 'reset' | 'request' | 'approved' | 'rejected';
    to: string;
    added: string[];
    removed: string[];
    changed: string[];
  }[] = [];
  const accessMailer: AccessMailer = {
    sendAccessChanged: async (m) => {
      accessMails.push({
        kind: 'access',
        to: m.to,
        added: m.added,
        removed: m.removed,
        changed: m.changed,
      });
    },
    sendPasswordResetByAdmin: async (m) => {
      accessMails.push({ kind: 'reset', to: m.to, added: [], removed: [], changed: [] });
    },
    sendAccessRequestCreated: async (m) => {
      accessMails.push({ kind: 'request', to: m.to, added: [], removed: [], changed: [m.what] });
    },
    sendAccessRequestDecided: async (m) => {
      accessMails.push({
        kind: m.approved ? 'approved' : 'rejected',
        to: m.to,
        added: [],
        removed: [],
        changed: [m.what],
      });
    },
  };

  const extraClients: Redis[] = [];
  /** `scope` gives the app its own Redis key space, so IP-based rate-limit counters start from zero. */
  function build(
    config: AuthConfig,
    scope: string | undefined,
    extra: AppExtras = {},
  ): {
    app: Express;
    access: AccessService;
    zones: ReturnType<typeof createZonesModule>;
    routers: Router[];
    extraRouters: Router[];
  } {
    let appRedis = redis;
    if (scope) {
      appRedis = new Redis(redisUrl, { keyPrefix: `${prefix}${scope}:` });
      extraClients.push(appRedis);
    }
    // the process-wide audit service, built as server.ts builds it
    const audit = createAudit({
      transaction: auditTransaction(prisma),
      deniedLimiter: extra.deniedLimiter ?? new RedisDeniedRateLimiter(appRedis),
      ...(extra.onDeniedFailure ? { onDeniedFailure: extra.onDeniedFailure } : {}),
    });
    const auth = createAuthModule({
      prisma,
      redis: appRedis,
      audit,
      sessionSecret: TEST_SESSION_SECRET,
      appOrigin: APP_ORIGIN,
      mailer,
      encryptionKey: TEST_ENCRYPTION_KEY,
      otpHmacKey: TEST_OTP_HMAC_KEY,
      ...(extra.mfaPolicy ? { mfaPolicy: extra.mfaPolicy } : {}),
      ...(extra.sms ? { sms: extra.sms } : {}),
      config,
      clock: clock.now,
    });
    // as server.ts: settings first, its reader feeds the zone refund caps (D110) to the access context and editor
    const settings = createSettingsModule({
      prisma,
      appOrigin: APP_ORIGIN,
      requireReauth: auth.requireReauth,
      smsReady: () => false,
      clock: clock.now,
    });
    const refundCaps = (zoneIds: readonly string[]) => settings.reader.refundCaps(zoneIds);
    const access = createAccessService({
      prisma,
      redis: appRedis,
      refundCaps,
      ...(extra.accessCacheTtlSec === undefined ? {} : { cacheTtlSec: extra.accessCacheTtlSec }),
    });
    const ok = async (): Promise<void> => undefined;
    // the real module routers, as server.ts mounts them
    const zones = createZonesModule({
      prisma: extra.zones?.prisma ?? prisma,
      redis: appRedis,
      appOrigin: APP_ORIGIN,
      requireReauth: auth.requireReauth,
      clock: clock.now,
      // as server.ts: the real zone team (M03), every other source a stub, unless a test brings its own
      impactSources: extra.zones?.impactSources ?? {
        ...stubImpactSources(),
        team: createZoneTeamPort(prisma),
      },
      ...(extra.zones?.cache ? { cache: extra.zones.cache } : {}),
    });
    const accessControl = createAccessModule({
      prisma,
      access,
      appOrigin: APP_ORIGIN,
      requireReauth: auth.requireReauth,
      evictSessions: auth.evictSessions,
      mailer: accessMailer,
      clock: clock.now,
      refundCaps,
    });
    // as server.ts: vendors and uploads ask each other (who owns a key; is a key uploaded)
    const uploadsGate: { service?: ReturnType<typeof createUploadsModule>['service'] } = {};
    const vendors = createVendorsModule({
      prisma,
      appOrigin: APP_ORIGIN,
      requireReauth: auth.requireReauth,
      storage,
      uploads: {
        assertUploaded: (ctx, fileKey) => {
          if (!uploadsGate.service) throw new Error('uploads module not ready');
          return uploadsGate.service.assertUploaded(ctx, fileKey);
        },
      },
      services: zones.service,
      checklist: settings.reader,
      limiter: new RedisRateLimiter(appRedis),
      clock: clock.now,
    });
    const partners = createPartnersModule({
      prisma,
      appOrigin: APP_ORIGIN,
      requireReauth: auth.requireReauth,
      maxConcurrentOrders: (zoneId) => settings.reader.maxConcurrentOrders(zoneId),
      checklist: settings.reader,
      storage,
      uploads: {
        assertUploaded: (ctx, fileKey) => {
          if (!uploadsGate.service) throw new Error('uploads module not ready');
          return uploadsGate.service.assertUploaded(ctx, fileKey);
        },
      },
      limiter: new RedisRateLimiter(appRedis),
      clock: clock.now,
    });
    const uploads = createUploadsModule({
      storage,
      entities: [vendors.entities, partners.entities],
      appOrigin: APP_ORIGIN,
    });
    uploadsGate.service = uploads.service;
    const menu = createMenuModule({
      prisma,
      appOrigin: APP_ORIGIN,
      uploads: { assertUploaded: (ctx, fileKey) => uploads.service.assertUploaded(ctx, fileKey) },
      clock: clock.now,
    });
    const hotels = createHotelsModule({
      prisma,
      appOrigin: APP_ORIGIN,
      services: zones.service,
      clock: clock.now,
    });
    const moduleRouters = [
      auth.router,
      createAuditModule({ prisma }).router,
      zones.router,
      accessControl.router,
      settings.router,
      createOrdersModule({
        prisma,
        appOrigin: APP_ORIGIN,
        maxConcurrentOrders: (zoneId) => settings.reader.maxConcurrentOrders(zoneId),
        clock: clock.now,
      }).router,
      vendors.router,
      createCustomersModule({
        prisma,
        appOrigin: APP_ORIGIN,
        limiter: new RedisRateLimiter(appRedis),
        clock: clock.now,
      }).router,
      partners.router,
      // M17: sends are not queued here; tests/notifications drive the send step on their own service
      createNotificationsModule({
        prisma,
        appOrigin: APP_ORIGIN,
        settings: settings.reader,
        queue: { enqueue: async () => undefined },
        mailer: noopMailer,
        clock: clock.now,
      }).router,
      createDashboardModule({ prisma, redis: extra.dashboardCache ?? null, clock: clock.now })
        .router,
      createSearchModule({
        prisma,
        limiter: extra.searchLimiter ?? new RedisRateLimiter(appRedis),
      }).router,
      uploads.router,
      menu.router,
      hotels.router,
    ];
    const extraRouters = [
      ...(extra.routers ?? []),
      ...(extra.routerFactory ? [extra.routerFactory({ requireReauth: auth.requireReauth })] : []),
    ];
    const app = createApp({
      readiness: { database: ok, redis: ok },
      v1: {
        sessionMiddleware: auth.sessionMiddleware,
        authContextMiddleware: authContextMiddleware(access),
        routers: [...moduleRouters, ...extraRouters],
      },
      ...(extra.auditCoverage ? { auditCoverage: extra.auditCoverage } : {}),
    });
    return { app, access, zones, routers: [...moduleRouters, ...extraRouters], extraRouters };
  }
  function makeApp(
    config: AuthConfig = TEST_CONFIG,
    scope?: string,
    extra: AppExtras = {},
  ): Express {
    return build(config, scope, extra).app;
  }
  /** App with extra routers and direct access to the AccessService (cache invalidation tests). */
  function makeAuthzApp(extra: AppExtras = {}) {
    return build(TEST_CONFIG, undefined, extra);
  }
  const app = makeApp();

  // ---- fixtures (plain SQL as the owner role: no seed data exists in the schema task) -----------------------------
  const roleIds = { SUPER_ADMIN: uuidv7(), ZONAL_ADMIN: uuidv7() };
  await db.owner.query(
    `INSERT INTO roles (id, name, is_system, updated_at) VALUES ($1, 'SUPER_ADMIN', true, now()), ($2, 'ZONAL_ADMIN', true, now())`,
    [roleIds.SUPER_ADMIN, roleIds.ZONAL_ADMIN],
  );
  const hashes = new Map<string, string>();
  const hashOf = async (pw: string): Promise<string> => {
    let h = hashes.get(pw);
    if (!h) {
      h = await hashPassword(pw);
      hashes.set(pw, h);
    }
    return h;
  };
  const profileId = uuidv7();
  await db.owner.query(
    `INSERT INTO access_profiles (id, name, updated_at) VALUES ($1, 'Test profile', now())`,
    [profileId],
  );
  let counter = 0;

  async function createUser(
    role: PersonaRole,
    opts: {
      password?: string;
      status?: string;
      mustChangePassword?: boolean;
      /** default true: a confirmed authenticator (as after enrolment), so sign-in takes a real second step */
      mfa?: boolean;
      emailPrefix?: string;
    } = {},
  ): Promise<TestUser> {
    counter += 1;
    const id = uuidv7();
    const email = `${opts.emailPrefix ?? 'user'}${counter}-${randomBytes(3).toString('hex')}@example.test`;
    const name = `Test ${role} ${counter}`;
    await db.owner.query(
      `INSERT INTO users (id, name, email, password_hash, role_id, status, mfa_enabled, must_change_password, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [
        id,
        name,
        email,
        await hashOf(opts.password ?? PASSWORD),
        roleIds[role],
        opts.status ?? 'ACTIVE',
        opts.mfa ?? true,
        opts.mustChangePassword ?? false,
      ],
    );
    if (opts.mfa === false) return { id, email, name, role };
    const totpSecret = await enrolAuthenticator(id);
    return { id, email, name, role, totpSecret };
  }

  /** A confirmed, primary authenticator with a fresh secret sealed exactly as enrolment will seal it (doc 52). */
  async function enrolAuthenticator(userId: string): Promise<string> {
    const secret = newTotpSecret();
    await db.owner.query(
      `INSERT INTO user_mfa_methods (id, user_id, type, secret_encrypted, verified_at, is_primary, updated_at)
       VALUES ($1, $2, 'AUTHENTICATOR', $3, now(), true, now())`,
      [
        uuidv7(),
        userId,
        createSecretBox({ current: TEST_ENCRYPTION_KEY }).seal(secret, mfaSecretAad(userId)),
      ],
    );
    await db.owner.query(`UPDATE users SET mfa_enabled = true WHERE id = $1`, [userId]);
    return secret;
  }

  /** Backup codes for a user, stored as the server stores them; returns what the user would have written down. */
  async function addBackupCodes(userId: string, count = 10): Promise<string[]> {
    const codes = generateBackupCodes(count);
    const batch = uuidv7();
    for (const c of codes) {
      await db.owner.query(
        `INSERT INTO mfa_backup_codes (id, user_id, code_hash, batch_id) VALUES ($1, $2, $3, $4)`,
        [uuidv7(), userId, hashBackupCode(createOtpHasher(TEST_OTP_HMAC_KEY), c.normalised), batch],
      );
    }
    return codes.map((c) => c.display);
  }

  async function createZone(): Promise<string> {
    const id = uuidv7();
    // a valid code (doc 53: ^[A-Z][A-Z0-9]{1,5}$) and an ACTIVE zone, as these fixtures were before UPCOMING became the default
    const code = `Z${randomBytes(3).toString('hex').toUpperCase().slice(0, 5)}`;
    await db.owner.query(
      `INSERT INTO zones (id, name, code, city, status, color_hex, updated_at)
       VALUES ($1, $2, $3, 'Chennai', 'ACTIVE', '#2563EB', now())`,
      [id, `Zone ${code}`, code],
    );
    return id;
  }

  async function assignZone(
    userId: string,
    zoneId: string,
    assignedBy: string,
    opts: { profileId?: string; perRefundLimit?: number | null; canReveal?: boolean | null } = {},
  ): Promise<string> {
    const id = uuidv7();
    await db.owner.query(
      `INSERT INTO admin_zone_assignments (id, user_id, zone_id, profile_id, assigned_by, per_refund_limit, can_reveal, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [
        id,
        userId,
        zoneId,
        opts.profileId ?? profileId,
        assignedBy,
        opts.perRefundLimit ?? null,
        opts.canReveal ?? null,
      ],
    );
    return id;
  }

  /** Access profile with the given actions per module, e.g. { orders: ['view', 'edit'] }. */
  async function createProfile(
    permissions: Record<string, string[]>,
    defaults: {
      perRefund?: number;
      dailyRefund?: number;
      canReveal?: boolean;
      canExport?: boolean;
    } = {},
  ): Promise<string> {
    const id = uuidv7();
    await db.owner.query(
      `INSERT INTO access_profiles (id, name, default_per_refund_limit, default_daily_refund_limit, default_can_reveal, default_can_export, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [
        id,
        `Profile ${id}`,
        defaults.perRefund ?? null,
        defaults.dailyRefund ?? null,
        defaults.canReveal ?? false,
        defaults.canExport ?? false,
      ],
    );
    for (const [module, actions] of Object.entries(permissions)) {
      await db.owner.query(
        `INSERT INTO profile_permissions (profile_id, module, can_view, can_add, can_edit, can_delete, can_status, can_export)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          module,
          ...['view', 'add', 'edit', 'delete', 'status', 'export'].map((a) => actions.includes(a)),
        ],
      );
    }
    return id;
  }

  async function addOverride(
    assignmentId: string,
    module: string,
    action: string,
    effect: 'GRANT' | 'DENY',
  ): Promise<void> {
    await db.owner.query(
      `INSERT INTO assignment_overrides (assignment_id, module, action, effect) VALUES ($1, $2, $3::"AccessAction", $4::"OverrideEffect")`,
      [assignmentId, module, action.toUpperCase(), effect],
    );
  }

  // ---- helpers -----------------------------------------------------------------------------------------------------
  const api = (a: Express = app) => ({
    /**
     * Like a browser that has called GET /auth/csrf: carries the pre-session CSRF cookie and header. Session routes
     * replace both (the test's own Cookie and X-CSRF-Token win), so this never satisfies the session-bound check.
     */
    post: (path: string) => {
      const csrf = preSessionCsrf();
      return request(a)
        .post(`/api/v1${path}`)
        .set('Origin', APP_ORIGIN)
        .set('Cookie', csrf.cookie)
        .set('X-CSRF-Token', csrf.token);
    },
    get: (path: string) => request(a).get(`/api/v1${path}`),
    delete: (path: string) => request(a).delete(`/api/v1${path}`).set('Origin', APP_ORIGIN),
  });

  /** The password step only (doc 52 section 2.1 [1]): OK, MFA_REQUIRED or ENROLMENT_REQUIRED, or an error. */
  async function passwordStep(
    user: { email: string; role: PersonaRole },
    password = PASSWORD,
    tab: PersonaRole = user.role,
    opts: { app?: Express; remember?: boolean } = {},
  ) {
    return api(opts.app)
      .post('/auth/login')
      .send({ email: user.email, password, tab, ...(opts.remember ? { remember: true } : {}) });
  }

  /** zo_mfa=<value> from a response, for the next request's Cookie header ('' when none). */
  function pendingCookieOf(res: { headers: Record<string, unknown> }): string {
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw.map(String) : [];
    return (
      list.find((c) => c.startsWith('zo_mfa=') && !c.startsWith('zo_mfa=;'))?.split(';')[0] ?? ''
    );
  }

  /** POST /auth/mfa/verify as a browser would: the pending cookie plus the pre-session CSRF pair. */
  function verify(pendingCookie: string, body: object, target?: Express) {
    const csrf = preSessionCsrf();
    return request(target ?? app)
      .post('/api/v1/auth/mfa/verify')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', `${csrf.cookie}; ${pendingCookie}`)
      .set('X-CSRF-Token', csrf.token)
      .send(body);
  }

  /**
   * A full sign-in: the password, then (when asked) the authenticator code at the test clock. The user's replay marker is
   * reset first so a test can sign the same user in many times; replay protection has its own tests (mfa-login).
   */
  async function login(
    user: { id?: string; email: string; role: PersonaRole; totpSecret?: string },
    password = PASSWORD,
    tab: PersonaRole = user.role,
    opts: { app?: Express; remember?: boolean } = {},
  ) {
    const first = await passwordStep(user, password, tab, opts);
    if (
      first.status !== 200 ||
      first.body.status !== 'MFA_REQUIRED' ||
      !user.totpSecret ||
      !user.id
    )
      return first;
    await db.owner.query(`UPDATE user_mfa_methods SET last_used_step = NULL WHERE user_id = $1`, [
      user.id,
    ]);
    const code = await totpAt(user.totpSecret, clock.now());
    return verify(pendingCookieOf(first), { method: 'AUTHENTICATOR', code }, opts.app);
  }

  /** Logs in and returns the cookie pair and CSRF token for follow-up requests. */
  async function session(user: TestUser, password = PASSWORD) {
    const res = await login(user, password);
    if (res.status !== 200) throw new Error(`login failed in test setup: ${res.status}`);
    return { cookie: cookieOf(res), csrf: res.body.csrfToken as string, res };
  }

  async function auditRows(where = 'true', params: unknown[] = []) {
    const r = await db.owner.query(
      `SELECT action, actor_type, actor_id, actor_name, actor_role, entity_type, entity_id, sensitivity, outcome, note, ip, request_id
       FROM audit_logs WHERE ${where} ORDER BY id`,
      params,
    );
    return r.rows as {
      action: string;
      actor_type: string;
      actor_id: string | null;
      actor_name: string;
      actor_role: string | null;
      entity_type: string;
      entity_id: string | null;
      sensitivity: string;
      outcome: string;
      note: string | null;
      ip: string | null;
      request_id: string | null;
    }[];
  }

  async function userRow(id: string) {
    const r = await db.owner.query(
      `SELECT failed_attempts, locked_until, password_hash, must_change_password, last_login_at FROM users WHERE id = $1`,
      [id],
    );
    return r.rows[0] as {
      failed_attempts: number;
      locked_until: Date | null;
      password_hash: string;
      must_change_password: boolean;
      last_login_at: Date | null;
    };
  }

  async function loginHistory(userId: string) {
    const r = await db.owner.query(
      `SELECT success, reason, email_attempted, ip FROM login_history WHERE user_id = $1 ORDER BY created_at, id`,
      [userId],
    );
    return r.rows as {
      success: boolean;
      reason: string;
      email_attempted: string;
      ip: string | null;
    }[];
  }

  /** Simulates a Redis flush or outage: sessions must keep working from PostgreSQL. */
  async function flushSessionCache(): Promise<void> {
    const keys = await rawRedis.keys(`${prefix}*`);
    if (keys.length > 0) await rawRedis.del(...keys);
  }

  async function close(): Promise<void> {
    await flushSessionCache();
    await Promise.all([
      redis.quit(),
      rawRedis.quit(),
      ...extraClients.map((c) => c.quit()),
      prisma.$disconnect(),
    ]);
    await db.close();
  }

  return {
    app,
    makeApp,
    makeAuthzApp,
    prisma,
    api,
    clock,
    mails,
    otpMails,
    mfaChanges,
    accessMails,
    storage,
    notices,
    db,
    createUser,
    createZone,
    assignZone,
    createProfile,
    addOverride,
    login,
    passwordStep,
    verify,
    pendingCookieOf,
    enrolAuthenticator,
    addBackupCodes,
    session,
    auditRows,
    userRow,
    loginHistory,
    flushSessionCache,
    close,
  };
}

export type AuthTestEnv = Awaited<ReturnType<typeof createAuthTestEnv>>;

/** `name=value` of the session cookie in a response, ready for the Cookie header. */
export function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw.map(String) : [];
  const line = list.find((c) => c.startsWith('zo_sid='));
  if (!line) throw new Error('no session cookie in response');
  return line.split(';')[0] ?? '';
}

export function setCookieLine(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw.map(String) : [];
  return list.find((c) => c.startsWith('zo_sid=')) ?? '';
}
