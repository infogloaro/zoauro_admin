import { PENDING_LOGIN_COOKIE, PRE_SESSION_CSRF_COOKIE, SESSION_COOKIE } from './config';

/** Lifetime of the pre-session CSRF cookie: long enough to fill in the login and 2-step screens. */
export const PRE_SESSION_CSRF_MAX_AGE_SEC = 2 * 60 * 60;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      /* ignore undecodable cookie */
    }
  }
  return out;
}

/** HTTP-only, Secure, SameSite=Lax (doc 14 section 2). The browser drops it at the absolute timeout. */
export function sessionCookie(token: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** HttpOnly (the token is returned in the body for the header), Secure, SameSite=Strict: web and API share one origin. */
export function preSessionCsrfCookie(token: string): string {
  return `${PRE_SESSION_CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${PRE_SESSION_CSRF_MAX_AGE_SEC}`;
}

/**
 * zo_mfa (doc 52 section 2.1): HttpOnly, Secure, SameSite=Strict, 5 minutes. Path /api/v1 rather than doc 52's
 * /api/auth: the API lives under /api/v1 and the enrolment routes (/me/mfa/*) need it too (doc 32).
 */
export function pendingLoginCookie(token: string, maxAgeSec: number): string {
  return `${PENDING_LOGIN_COOKIE}=${encodeURIComponent(token)}; Path=/api/v1; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`;
}

export function clearedPendingLoginCookie(): string {
  return `${PENDING_LOGIN_COOKIE}=; Path=/api/v1; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
