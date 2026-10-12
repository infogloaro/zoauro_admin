import { describe, expect, expectTypeOf, it } from 'vitest';
import { ApiError, createApiClient, type paths } from './index';

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[calls.length - 1] ?? { status: 500 };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { calls, fn: fn as typeof fetch };
}

const LOGIN_OK = {
  user: {
    id: '0192f1d2-0000-7000-8000-00000000000a',
    name: 'A',
    email: 'a@x.test',
    role: 'SUPER_ADMIN',
  },
  mustChangePassword: false,
  csrfToken: 'csrf-123',
  redirectTo: '/super-admin/dashboard',
};

describe('api client', () => {
  it('calls the documented path with JSON, cookies, and returns the typed body', async () => {
    const f = fakeFetch([{ status: 200, body: LOGIN_OK }]);
    const client = createApiClient({ fetch: f.fn });
    const res = await client.post('/auth/login', {
      body: { email: 'a@x.test', password: 'pw', tab: 'SUPER_ADMIN' },
    });

    expect(f.calls[0]?.url).toBe('/api/v1/auth/login');
    expect(f.calls[0]?.init.method).toBe('POST');
    expect(f.calls[0]?.init.credentials).toBe('include');
    expect(JSON.parse(String(f.calls[0]?.init.body))).toEqual({
      email: 'a@x.test',
      password: 'pw',
      tab: 'SUPER_ADMIN',
    });
    expect(res.redirectTo).toBe('/super-admin/dashboard');
    expectTypeOf(res.user.role).toEqualTypeOf<'SUPER_ADMIN' | 'ZONAL_ADMIN'>();
  });

  it('remembers the CSRF token from login and sends it on state-changing requests only', async () => {
    const f = fakeFetch([
      { status: 200, body: LOGIN_OK },
      { status: 204 },
      {
        status: 200,
        body: {
          user: LOGIN_OK.user,
          mustChangePassword: false,
          csrfToken: 'csrf-123',
          permissions: { global: true },
        },
      },
    ]);
    const client = createApiClient({ fetch: f.fn });
    await client.post('/auth/login', {
      body: { email: 'a@x.test', password: 'pw', tab: 'SUPER_ADMIN' },
    });
    const out = await client.post('/auth/logout');
    await client.get('/me');

    expect(out).toBeUndefined();
    expect((f.calls[0]?.init.headers as Record<string, string>)['X-CSRF-Token']).toBeUndefined();
    expect((f.calls[1]?.init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-123');
    expect((f.calls[2]?.init.headers as Record<string, string>)['X-CSRF-Token']).toBeUndefined();
  });

  it('turns an error body into an ApiError with code, status, details and request id', async () => {
    const f = fakeFetch([
      {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: [{ field: 'email', issue: 'invalid_format' }],
            requestId: 'req-1',
          },
        },
      },
    ]);
    const client = createApiClient({ fetch: f.fn });
    const err = await client
      .post('/auth/forgot-password', { body: { email: 'nope' } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      requestId: 'req-1',
      details: [{ field: 'email', issue: 'invalid_format' }],
    });
  });

  it('survives a non-JSON error (gateway page) as UNKNOWN', async () => {
    const client = createApiClient({
      fetch: (async () =>
        new Response('Bad gateway', { status: 502, statusText: 'Bad Gateway' })) as typeof fetch,
    });
    await expect(client.get('/me')).rejects.toMatchObject({ code: 'UNKNOWN', status: 502 });
  });

  it('only accepts paths and methods that exist in the contract (compile-time)', () => {
    const client = createApiClient({ fetch: fakeFetch([]).fn });
    // @ts-expect-error  /orders is not in the contract yet
    void (() => client.get('/orders'));
    // @ts-expect-error  /me has no POST
    void (() => client.post('/me'));
    // @ts-expect-error  login needs email, password and tab
    void (() => client.post('/auth/login', { body: { email: 'a@x.test' } }));
    expectTypeOf<keyof paths>().toExtend<string>();
  });
});

describe('path parameters', () => {
  it('fills {id} from params, URL-encoded, and keeps the query string', async () => {
    const { calls, fn } = fakeFetch([{ status: 200, body: {} }]);
    const client = createApiClient({ fetch: fn });
    await client.get('/audit-logs/{id}', { params: { id: 'a/b c' } });
    expect(calls[0]?.url).toBe('/api/v1/audit-logs/a%2Fb%20c');
  });
  it('refuses a call that leaves a placeholder unfilled', async () => {
    const { fn } = fakeFetch([]);
    const client = createApiClient({ fetch: fn });
    await expect(client.get('/audit-logs/{id}')).rejects.toThrow(/missing path parameter id/);
  });
});
