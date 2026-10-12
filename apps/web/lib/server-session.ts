import { cookies } from 'next/headers';
import { ApiError, createApiClient } from '@zoauro/api-client';

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

/** The signed-in user, or null when there is no valid session. Other failures propagate (the error page shows them). */
export async function getSessionUser(): Promise<SessionUser | null> {
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
    return (await client.get('/me')).user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/** What a Super-Admin-only page does for a visitor: sign in first, 404 for anyone else (no hint that it exists). */
export function superAdminGate(user: SessionUser | null): 'login' | 'not-found' | 'ok' {
  if (user === null) return 'login';
  return user.role === 'SUPER_ADMIN' ? 'ok' : 'not-found';
}
