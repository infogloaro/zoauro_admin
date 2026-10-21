import { totpAt } from '../../src/modules/auth/mfa/totp';

// A signed-in browser for the demo seed: cookie jar, Origin and X-CSRF-Token on writes, the 2-step code from the
// account's authenticator secret, and step-up re-authentication when a route asks for it (REAUTH_REQUIRED).

export class DemoHttpError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`${method} ${path} -> ${status} ${JSON.stringify(body).slice(0, 600)}`);
    this.name = 'DemoHttpError';
  }
  get code(): string | undefined {
    return (this.body as { error?: { code?: string } } | undefined)?.error?.code;
  }
}

export interface DemoAccount {
  key: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  password: string;
  totpSecret: string;
}

export class DemoClient {
  private readonly jar = new Map<string, string>();
  private csrf = '';
  /** the last 30 s step used per secret: the server refuses a code twice (replay guard) */
  private static lastStep = new Map<string, number>();

  constructor(
    readonly base: string,
    readonly origin: string,
    readonly account: DemoAccount | null = null,
  ) {}

  private cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private keepCookies(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair?.indexOf('=') ?? -1;
      if (!pair || eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a)) || value === '';
      if (expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  async raw(
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = {
      Origin: this.origin,
      Accept: 'application/json',
      ...extra,
    };
    if (this.jar.size) headers['Cookie'] = this.cookieHeader();
    if (method !== 'GET') headers['X-CSRF-Token'] = this.csrf;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    this.keepCookies(res);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }

  private async code(secret: string): Promise<string> {
    // wait for a fresh 30 s step if this secret already used the current one
    for (;;) {
      const step = Math.floor(Date.now() / 30_000);
      if ((DemoClient.lastStep.get(secret) ?? -1) < step) {
        DemoClient.lastStep.set(secret, step);
        return totpAt(secret, new Date());
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  async login(): Promise<void> {
    const a = this.account;
    if (!a) throw new Error('no account');
    const c = await this.raw('GET', '/auth/csrf');
    this.csrf = (c.json as { token?: string } | null)?.token ?? '';
    const first = await this.raw('POST', '/auth/login', {
      email: a.email,
      password: a.password,
      tab: a.role,
    });
    if (first.status !== 200)
      throw new DemoHttpError('POST', '/auth/login', first.status, first.json);
    let res = first.json as { status: string; csrfToken?: string };
    if (res.status === 'MFA_REQUIRED') {
      const v = await this.raw('POST', '/auth/mfa/verify', {
        method: 'AUTHENTICATOR',
        code: await this.code(a.totpSecret),
      });
      if (v.status !== 200) throw new DemoHttpError('POST', '/auth/mfa/verify', v.status, v.json);
      res = v.json as { status: string; csrfToken?: string };
    }
    if (res.status !== 'OK' || !res.csrfToken)
      throw new Error(`login of ${a.email} ended in ${res.status}`);
    this.csrf = res.csrfToken;
  }

  /** PASSWORD or STRONG step-up for the routes that ask (D47 / doc 52). */
  async reauth(strong = false): Promise<void> {
    const a = this.account;
    if (!a) throw new Error('no account');
    const body = strong
      ? { password: a.password, method: 'AUTHENTICATOR', code: await this.code(a.totpSecret) }
      : { password: a.password };
    const r = await this.raw('POST', '/auth/reauth', body);
    if (r.status !== 200) throw new DemoHttpError('POST', '/auth/reauth', r.status, r.json);
  }

  async call<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<T> {
    let r = await this.raw(method, path, body, extra);
    const code = (r.json as { error?: { code?: string; meta?: { level?: string } } } | null)?.error;
    if (r.status === 401 && code?.code === 'REAUTH_REQUIRED') {
      // STRONG (password + 2-step code) also satisfies the routes that ask for the password only
      await this.reauth(true);
      r = await this.raw(method, path, body, extra);
    }
    if (r.status < 200 || r.status >= 300) throw new DemoHttpError(method, path, r.status, r.json);
    return r.json as T;
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.call<T>('GET', path);
  }
  post<T = unknown>(path: string, body: unknown = {}): Promise<T> {
    return this.call<T>('POST', path, body);
  }
  /** an order write: the version goes in If-Match (doc 09) */
  postVersioned<T = unknown>(path: string, version: number, body: unknown = {}): Promise<T> {
    return this.call<T>('POST', path, body, { 'If-Match': String(version) });
  }
  put<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.call<T>('PUT', path, body);
  }
  patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.call<T>('PATCH', path, body);
  }
  del<T = unknown>(path: string): Promise<T> {
    return this.call<T>('DELETE', path);
  }
}
