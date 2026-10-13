import { cookies, headers } from 'next/headers';
import { ApiError, createApiClient } from '@zoauro/api-client';
import type { MeResponse, MeZone } from '@zoauro/shared';

// Server-side session lookup for route guards (Server Components). The browser's cookies are forwarded to the Express
// API (doc 23 section 1); the web never reads the database. This is a convenience for choosing what to render: the API
// enforces the same rule on every request, so a wrong answer here can never expose data.

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

const apiOrigin = (): string => process.env['WEB_INTERNAL_API_URL'] ?? 'http://localhost:4000';

/** GET /me with the visitor's cookies, or null when there is no valid session. Other failures propagate (error page). */
export async function getMe(): Promise<MeResponse | null> {
  const jar = await cookies();
  const cookie = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  if (!cookie) return null;
  const client = createApiClient({
    baseUrl: `${apiOrigin()}/api/v1`,
    fetch: (url, init) =>
      fetch(url, { ...init, cache: 'no-store', headers: { ...init?.headers, cookie } }),
  });
  try {
    return await client.get('/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/** The signed-in user, or null when there is no valid session. */
export async function getSessionUser(): Promise<SessionUser | null> {
  return (await getMe())?.user ?? null;
}

/** What a Super-Admin-only page does for a visitor: sign in first, 404 for anyone else (no hint that it exists). */
export function superAdminGate(user: SessionUser | null): 'login' | 'not-found' | 'ok' {
  if (user === null) return 'login';
  return user.role === 'SUPER_ADMIN' ? 'ok' : 'not-found';
}

// ---- protected areas (doc 18 sections 1 and 7, doc 14) ----------------------------------------------------------------

/** The request path, set by proxy.ts (a layout is not given the URL). */
export async function requestPath(): Promise<string> {
  return (await headers()).get(PATH_HEADER) ?? '/';
}
export const PATH_HEADER = 'x-zo-path';

/** Only our own areas may be a ?next= target: never another site, never a protocol-relative URL. */
export function safeNext(path: string): string | null {
  return !path.includes('..') &&
    /^\/(super-admin|zone|account|coming-soon)(\/[A-Za-z0-9/_\-.]*)?$/.test(path)
    ? path
    : null;
}
export const loginUrl = (path: string): string => {
  const next = safeNext(path);
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
};

export type Area = 'super-admin' | 'zone' | 'shared';
export type Gate =
  | { kind: 'login'; to: string }
  | { kind: 'redirect'; to: string }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'ok'; me: MeResponse; role: 'SUPER_ADMIN' | 'ZONAL_ADMIN'; zones: MeZone[] };

/**
 * Who may enter an area (owner's decision, P14, doc 32):
 *  - nobody signed in: /login?next=<this path>
 *  - /super-admin/* for anyone but a Super Admin: 404, as if it did not exist (doc 18 section 1)
 *  - /zone/* for a Super Admin: the 403 page (the same screens are reached inside /super-admin with a zone filter)
 *  - a Zonal Admin with no zone: /zone/no-zones
 */
export function areaGate(area: Area, me: MeResponse | null, path: string): Gate {
  if (me === null) return { kind: 'login', to: loginUrl(path) };
  const role = me.user.role;
  const zones = me.permissions.global ? [] : me.permissions.zones;
  if (area === 'super-admin' && role !== 'SUPER_ADMIN') return { kind: 'not-found' };
  if (area === 'zone' && role === 'SUPER_ADMIN') return { kind: 'forbidden' };
  if (
    area === 'zone' &&
    zones.length === 0 &&
    path !== '/zone/no-zones' &&
    !path.startsWith('/zone/no-zones/')
  )
    return { kind: 'redirect', to: '/zone/no-zones' };
  return { kind: 'ok', me, role, zones };
}
