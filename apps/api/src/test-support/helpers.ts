import type { Express } from 'express';
import { RoleKey, type Role, type User } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/db';
import { hashPassword } from '../lib/passwords';
import { resetRateLimits } from '../lib/rate-limit';

export const TEST_PASSWORD = 'Integration!1234';

export function testApp(): Express {
  return createApp();
}

async function upsertRole(name: RoleKey): Promise<Role> {
  try {
    return await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  } catch (error) {
    // Parallel test files can race the upsert; the row then exists.
    if (error instanceof Error && error.name === 'PrismaClientKnownRequestError') {
      const existing = await prisma.role.findUnique({ where: { name } });
      if (existing) return existing;
    }
    throw error;
  }
}

export async function ensureRoles(): Promise<{ superAdmin: Role; zonalAdmin: Role }> {
  const superAdmin = await upsertRole(RoleKey.SUPER_ADMIN);
  const zonalAdmin = await upsertRole(RoleKey.ZONAL_ADMIN);
  return { superAdmin, zonalAdmin };
}

let seq = 0;
export function uniqueEmail(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}@sa11.test.local`;
}

export async function createUser(opts: {
  email: string;
  role: RoleKey;
  name?: string;
}): Promise<User> {
  const role = await upsertRole(opts.role);
  return prisma.user.create({
    data: {
      name: opts.name ?? 'Test Admin',
      email: opts.email,
      passwordHash: await hashPassword(TEST_PASSWORD),
      roleId: role.id,
      status: 'ACTIVE',
    },
  });
}

export interface Session {
  cookie: string;
  csrf: string;
  email: string;
}

/** superagent may collapse/expand Set-Cookie depending on how it was parsed. */
export function cookieList(res: request.Response): string[] {
  const raw: unknown = res.headers['set-cookie'];
  if (Array.isArray(raw)) return raw as string[];
  return typeof raw === 'string' ? [raw] : [];
}

/** Logs in through the real endpoint and returns cookie + CSRF token (doc 14). */
export async function login(
  app: Express,
  creds: { email: string; role: 'SUPER_ADMIN' | 'ZONAL_ADMIN'; password?: string },
): Promise<Session> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: creds.email,
      password: creds.password ?? TEST_PASSWORD,
      role: creds.role,
      rememberMe: false,
    });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const setCookies = cookieList(res);
  const sid = setCookies.find((c) => c.startsWith('sid='))?.split(';')[0];
  const csrfPair = setCookies.find((c) => c.startsWith('csrf='))?.split(';')[0];
  if (!sid || !csrfPair) throw new Error('login did not set session cookies');
  resetRateLimits(); // shared test IP must not exhaust the per-IP login limit
  return {
    cookie: `${sid}; ${csrfPair}`,
    csrf: decodeURIComponent(csrfPair.slice('csrf='.length)),
    email: creds.email,
  };
}

type Method = 'get' | 'post' | 'patch' | 'delete';

/** Authenticated request with cookie + CSRF header (unless session is null). */
export function call(
  app: Express,
  method: Method,
  path: string,
  opts: { session?: Session | null; body?: unknown; csrf?: string | null } = {},
) {
  const req = request(app)[method](path);
  if (opts.session) {
    req.set('Cookie', opts.session.cookie);
    if (opts.csrf !== null) {
      req.set('x-csrf-token', opts.csrf ?? opts.session.csrf);
    }
  }
  if (opts.body !== undefined) req.send(opts.body as object);
  return req;
}

export async function cleanupUsers(emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.loginHistory.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.auditLog.deleteMany({ where: { actor: { email: { in: emails } } } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
}

export async function cleanupZones(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.auditLog.deleteMany({
    where: { OR: [{ entityId: { in: ids } }, { zoneId: { in: ids } }] },
  });
  await prisma.zone.deleteMany({ where: { id: { in: ids } } });
}
