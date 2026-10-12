import type { ErrorBody, ErrorCode } from '@zoauro/shared';
import type { paths } from './schema';

export type { components, operations, paths } from './schema';

// Typed client for the ZOAURO admin API. The path, method, request body, query and response types come from the generated
// `schema.ts` (apps/api/openapi/openapi.json), so a contract change that is not regenerated fails to compile here.
// Browser use: same-origin, cookies included. The CSRF token from login or /me is remembered and sent on every
// state-changing request.

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

type PathsWith<M extends Method> = {
  [P in keyof paths]: paths[P][M] extends undefined ? never : P;
}[keyof paths];

type Operation<P extends keyof paths, M extends Method> = NonNullable<paths[P][M]>;

type JsonBody<O> = O extends { requestBody: { content: { 'application/json': infer B } } }
  ? B
  : never;

type QueryOf<O> = O extends { parameters: { query?: infer Q } }
  ? Exclude<Q, undefined | never>
  : never;

type Success<O> = O extends { responses: infer R }
  ? {
      [S in keyof R & (200 | 201 | 204)]: R[S] extends { content: { 'application/json': infer B } }
        ? B
        : void;
    }[keyof R & (200 | 201 | 204)]
  : never;

export interface RequestInitOf<O> {
  body?: JsonBody<O>;
  query?: QueryOf<O>;
  /** values for `{name}` placeholders in the path, e.g. { id } for /audit-logs/{id}; URL-encoded */
  params?: Record<string, string>;
  /** required by refund, payment, intake order and cash-settlement POSTs (doc 09) */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/** Thrown for every non-2xx answer. `code` is one of the documented error codes. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'UNKNOWN',
    message: string,
    readonly details: { field: string; issue: string }[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? '/api/v1').replace(/\/$/, '');
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let csrfToken: string | undefined;

  async function request<M extends Method, P extends PathsWith<M>>(
    method: M,
    path: P,
    init: RequestInitOf<Operation<P, M>> = {},
  ): Promise<Success<Operation<P, M>>> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries((init.query ?? {}) as Record<string, unknown>)) {
      if (v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) params.append(k, String(item));
    }
    const query = params.toString();
    const url = String(path).replace(/{([A-Za-z0-9_]+)}/g, (_m, name: string) => {
      const value = init.params?.[name];
      if (value === undefined)
        throw new TypeError(`missing path parameter ${name} for ${String(path)}`);
      return encodeURIComponent(value);
    });
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'get' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
    if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;

    const res = await doFetch(`${baseUrl}${url}${query ? `?${query}` : ''}`, {
      method: method.toUpperCase(),
      headers,
      credentials: 'include',
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      ...(init.signal ? { signal: init.signal } : {}),
    });

    if (res.status === 204) return undefined as Success<Operation<P, M>>;
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      // not JSON (a gateway or proxy error page): still an ApiError, never a SyntaxError
      throw new ApiError(res.status, 'UNKNOWN', res.statusText || 'Unexpected response');
    }

    if (!res.ok) {
      const err = (json as Partial<ErrorBody> | undefined)?.error;
      throw new ApiError(
        res.status,
        err?.code ?? 'UNKNOWN',
        err?.message ?? res.statusText,
        err?.details,
        err?.requestId,
      );
    }
    if (
      typeof json === 'object' &&
      json !== null &&
      'csrfToken' in json &&
      typeof json.csrfToken === 'string'
    ) {
      csrfToken = json.csrfToken;
    }
    return json as Success<Operation<P, M>>;
  }

  return {
    request,
    get: <P extends PathsWith<'get'>>(path: P, init?: RequestInitOf<Operation<P, 'get'>>) =>
      request('get', path, init),
    post: <P extends PathsWith<'post'>>(path: P, init?: RequestInitOf<Operation<P, 'post'>>) =>
      request('post', path, init),
    put: <P extends PathsWith<'put'>>(path: P, init?: RequestInitOf<Operation<P, 'put'>>) =>
      request('put', path, init),
    patch: <P extends PathsWith<'patch'>>(path: P, init?: RequestInitOf<Operation<P, 'patch'>>) =>
      request('patch', path, init),
    delete: <P extends PathsWith<'delete'>>(
      path: P,
      init?: RequestInitOf<Operation<P, 'delete'>>,
    ) => request('delete', path, init),
    /** forget the remembered CSRF token (after logout) */
    clearSession: () => {
      csrfToken = undefined;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
