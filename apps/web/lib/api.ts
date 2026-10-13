/**
 * Minimal typed fetch client for the ZOAURO API (doc 09 envelopes, doc 23 §4
 * error mapping). Same-origin via the Next rewrite, so cookies flow naturally.
 */

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Array<{ field?: string; issue: string }> | Record<string, unknown>;
  requestId?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorBody['details'];
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.requestId = body.requestId;
  }

  /** 422 field errors keyed by field name (doc 23: map to form fields). */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details) {
        if (d.field) out[d.field] = d.issue;
      }
    }
    return out;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export async function apiFetch<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (MUTATING.has(method)) {
    const csrf = readCookie('csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }

  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (res.status === 204) return undefined as T;

  const json = (await res.json().catch(() => null)) as {
    data?: T;
    meta?: unknown;
    error?: ApiErrorBody;
  } | null;

  if (!res.ok) {
    throw new ApiError(
      res.status,
      json?.error ?? { code: 'UNKNOWN', message: `Request failed (${res.status})` },
    );
  }
  return json as T;
}

export interface Envelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}
