import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Delivery adapters for outbound webhooks (doc 43 section 2, D129 item 4). While D18 is open (the apps may not exist
// yet) the worker uses the dev adapter: it logs the event id and type and reports success, so outbox rows and
// deliveries move through the same states as in production. INTEGRATION_WEBHOOK_DELIVERY=http sends real requests.

export interface WebhookRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface WebhookResult {
  ok: boolean;
  httpStatus: number | null;
  responseMs: number;
  /** short machine reason on failure, never the response body */
  error?: 'REFUSED_URL' | 'TIMEOUT' | 'NETWORK' | 'HTTP_STATUS' | 'REDIRECT';
}

export interface WebhookTransport {
  readonly name: 'dev' | 'http';
  send(req: WebhookRequest): Promise<WebhookResult>;
}

type Log = (line: string) => void;

/** Logs and marks delivered. Logs ids and the target host only: never the body (it can name customers). */
export function devWebhookTransport(log: Log = (l) => console.log(l)): WebhookTransport {
  return {
    name: 'dev',
    send: async (req) => {
      let host = 'invalid-url';
      try {
        host = new URL(req.url).host;
      } catch {
        // keep the placeholder
      }
      log(
        `[outbox:dev] ${req.headers['X-Zoauro-Event-Type'] ?? '?'} ${req.headers['X-Zoauro-Event-Id'] ?? '?'} attempt ${req.headers['X-Zoauro-Attempt'] ?? '?'} -> ${host} (not sent, D18)`,
      );
      return { ok: true, httpStatus: 200, responseMs: 0 };
    },
  };
}

// ---- SSRF guard (doc 43 section 2: HTTPS only, private and loopback addresses refused, no redirects) ----

function ipv4Private(ip: string): boolean {
  const p = ip.split('.').map(Number);
  const [a = 0, b = 0] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && p[2] === 0) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

/** True for loopback, private, link-local, unique-local, multicast and unspecified addresses. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ipv4Private(ip);
  if (kind !== 6) return true; // not an address: refuse
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped?.[1]) return ipv4Private(mapped[1]);
  return (
    v6 === '::' ||
    v6 === '::1' ||
    v6.startsWith('fe8') ||
    v6.startsWith('fe9') ||
    v6.startsWith('fea') ||
    v6.startsWith('feb') || // fe80::/10
    v6.startsWith('fc') ||
    v6.startsWith('fd') || // fc00::/7
    v6.startsWith('ff') // multicast
  );
}

type Resolve = (host: string) => Promise<string[]>;

const resolveAll: Resolve = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** The URL is HTTPS and every address its host resolves to is public. */
export async function isAllowedWebhookUrl(
  raw: string,
  resolve: Resolve = resolveAll,
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  try {
    const addresses = isIP(host) ? [host] : await resolve(host);
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a));
  } catch {
    return false;
  }
}

/**
 * Real delivery: POST with a timeout, redirects not followed, 2xx = delivered. The guard resolves the host before the
 * request; fetch resolves it again, so a DNS answer that changes in between is not caught (doc 32: pin the address
 * with a custom dispatcher when the Integration Hub ships, IH-5).
 */
export function httpWebhookTransport(
  deps: { fetch?: typeof fetch; resolve?: Resolve; clock?: () => number } = {},
): WebhookTransport {
  const doFetch = deps.fetch ?? fetch;
  const clock = deps.clock ?? (() => Date.now());
  return {
    name: 'http',
    send: async (req) => {
      const started = clock();
      if (!(await isAllowedWebhookUrl(req.url, deps.resolve))) {
        return { ok: false, httpStatus: null, responseMs: 0, error: 'REFUSED_URL' };
      }
      try {
        const res = await doFetch(req.url, {
          method: 'POST',
          headers: req.headers,
          body: req.body,
          redirect: 'manual',
          signal: AbortSignal.timeout(req.timeoutMs),
        });
        await res.body?.cancel().catch(() => undefined); // the response body is never read or stored
        const responseMs = clock() - started;
        if (res.status >= 200 && res.status < 300)
          return { ok: true, httpStatus: res.status, responseMs };
        return {
          ok: false,
          httpStatus: res.status,
          responseMs,
          error: res.status >= 300 && res.status < 400 ? 'REDIRECT' : 'HTTP_STATUS',
        };
      } catch (err) {
        const timeout =
          err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        return {
          ok: false,
          httpStatus: null,
          responseMs: clock() - started,
          error: timeout ? 'TIMEOUT' : 'NETWORK',
        };
      }
    },
  };
}
