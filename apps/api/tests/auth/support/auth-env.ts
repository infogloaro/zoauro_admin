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
import { auditTransaction, createPrismaClient } from '../../../src/lib/db';
import { createAccessService } from '../../../src/modules/access';
import { createAuditModule } from '../../../src/modules/audit';
import { createAuthModule } from '../../../src/modules/auth';
import { createTestDatabase, type TestDatabase } from '../../audit/support/db';

// Integration environment for the auth tests: a throwaway PostgreSQL database built by `prisma migrate deploy`, the
// real application role (zoauro_app), the local Redis (keys under a private prefix), a controllable clock and a mailer
// that captures reset links.

export const APP_ORIGIN = 'http://localhost:3000';
/** The session secret every test app is built with; also signs the pre-session CSRF token. */
export const TEST_SESSION_SECRET = 'test-session-secret-0123456789-abcdef';

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
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  role: PersonaRole;
}

/** Generous limits so ordinary tests never trip the rate limiter; the rate-limit tests pass their own. */
export const TEST_CONFIG: AuthConfig = {
  ...DEFAULT_AUTH_CONFIG,
  loginLimitPerIp: { limit: 10_000, windowSec: 60 },
  loginLimitPerEmail: { limit: 10_000, windowSec: 60 },
  forgotLimitPerIp: { limit: 10_000, windowSec: 60 },
  forgotLimitPerEmail: { limit: 3, windowSec: 900 },
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
  const clock = {
    now: () => new Date(nowMs),
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
  const mails: ResetMail[] = [];
  const mailer = {
    sendPasswordReset: async (m: ResetMail) => {
      mails.push(m);
    },
  };

  const extraClients: Redis[] = [];
  /** `scope` gives the app its own Redis key space, so IP-based rate-limit counters start from zero. */
  function build(
    config: AuthConfig,
    scope: string | undefined,
    extra: AppExtras = {},
  ): { app: Express; access: AccessService; routers: Router[]; extraRouters: Router[] } {
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
      config,
      clock: clock.now,
    });
    const access = createAccessService({
      prisma,
      redis: appRedis,
      ...(extra.accessCacheTtlSec === undefined ? {} : { cacheTtlSec: extra.accessCacheTtlSec }),
    });
    const ok = async (): Promise<void> => undefined;
    // the real module routers, as server.ts mounts them
    const moduleRouters = [auth.router, createAuditModule({ prisma }).router];
    const app = createApp({
      readiness: { database: ok, redis: ok },
      v1: {
        sessionMiddleware: auth.sessionMiddleware,
        authContextMiddleware: authContextMiddleware(access),
        routers: [...moduleRouters, ...(extra.routers ?? [])],
      },
      ...(extra.auditCoverage ? { auditCoverage: extra.auditCoverage } : {}),
    });
    const extraRouters = extra.routers ?? [];
    return { app, access, routers: [...moduleRouters, ...extraRouters], extraRouters };
  }
  function makeApp(config: AuthConfig = TEST_CONFIG, scope?: string): Express {
    return build(config, scope).app;
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
      mfaEnabled?: boolean;
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
        opts.mfaEnabled ?? false,
        opts.mustChangePassword ?? false,
      ],
    );
    return { id, email, name, role };
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
        `INSERT INTO profile_permissions (profile_id, module, can_view, can_add, can_edit, can_delete, can_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          module,
          ...['view', 'add', 'edit', 'delete', 'status'].map((a) => actions.includes(a)),
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
  });

  async function login(
    user: { email: string; role: PersonaRole },
    password = PASSWORD,
    tab: PersonaRole = user.role,
  ) {
    return api().post('/auth/login').send({ email: user.email, password, tab });
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
    db,
    createUser,
    createZone,
    assignZone,
    createProfile,
    addOverride,
    login,
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
