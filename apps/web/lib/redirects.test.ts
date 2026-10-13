import { describe, expect, it, vi } from 'vitest';
import { setCsrfToken, withCsrf } from './csrf';
import { afterSignIn } from './redirects';

describe('afterSignIn (doc 52 section 2.1)', () => {
  const ok = { redirect: '/zone/dashboard', mustChangePassword: false };

  it('a pending password change comes first', () => {
    expect(afterSignIn({ ...ok, mustChangePassword: true }, '/zone/orders')).toBe(
      '/change-password',
    );
  });

  it('then a safe ?next=, then the API redirect', () => {
    expect(afterSignIn(ok, '/zone/coming-soon')).toBe('/zone/coming-soon');
    expect(afterSignIn(ok, undefined)).toBe('/zone/dashboard');
  });

  it('never another site, even from the API answer', () => {
    expect(afterSignIn(ok, 'https://evil.example/zone')).toBe('/zone/dashboard');
    expect(afterSignIn(ok, '//evil.example')).toBe('/zone/dashboard');
    expect(afterSignIn({ ...ok, redirect: 'https://evil.example' }, null)).toBe('/');
  });
});

describe('withCsrf', () => {
  it('adds the token to state-changing requests only, and never replaces one already set', async () => {
    const seen: { method: string; token: string | null }[] = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        method: init?.method ?? 'GET',
        token: new Headers(init?.headers).get('X-CSRF-Token'),
      });
      return new Response(null, { status: 204 });
    });
    const f = withCsrf(fetchImpl as unknown as typeof fetch);

    await f('/api/v1/auth/login', { method: 'POST' });
    setCsrfToken('pre-session');
    await f('/api/v1/me', { method: 'GET' });
    await f('/api/v1/auth/login', { method: 'POST' });
    await f('/api/v1/me/mfa/primary', { method: 'PUT', headers: { 'X-CSRF-Token': 'session' } });
    setCsrfToken(undefined);

    expect(seen).toEqual([
      { method: 'POST', token: null },
      { method: 'GET', token: null },
      { method: 'POST', token: 'pre-session' },
      { method: 'PUT', token: 'session' },
    ]);
  });
});
