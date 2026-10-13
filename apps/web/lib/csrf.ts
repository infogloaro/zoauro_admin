import type { ApiClient } from '@zoauro/api-client';

// CSRF for the browser (doc 52 section 2.6, doc 14). Two tokens, one header:
//  - before a session exists (login, 2-step, enrolment, forgot/reset password): GET /auth/csrf returns a signed token that
//    is also set as the HttpOnly zo_csrf cookie; it must be echoed in X-CSRF-Token;
//  - with a session: the session's own token, which the shell receives from /me on the server.
// The typed client already sends a token it learned from a response carrying `csrfToken` (login, /me); this module
// covers the other cases. Browser only: the server never sets it, so nothing leaks between requests.

let token: string | undefined;

export function setCsrfToken(value: string | undefined): void {
  token = value;
}

export function currentCsrfToken(): string | undefined {
  return token;
}

/** Adds X-CSRF-Token to state-changing requests that do not carry one yet. */
export function withCsrf(fetchImpl: typeof fetch): typeof fetch {
  return (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || !token) return fetchImpl(input, init);
    const headers = new Headers(init?.headers);
    if (!headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token);
    return fetchImpl(input, { ...init, headers });
  };
}

/** Fetches a pre-session token once per page load (the cookie lives 2 hours; the module state does not survive a reload). */
export async function ensurePreSessionCsrf(client: ApiClient): Promise<void> {
  if (token) return;
  const res = await client.get('/auth/csrf');
  token = res.token;
}
