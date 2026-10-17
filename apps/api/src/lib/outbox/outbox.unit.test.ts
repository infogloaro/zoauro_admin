import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OUTBOUND_EVENTS } from './catalogue';
import type { DueDelivery, PublishedRow } from './outbox.repository';
import { createOutboxPublisher, type OutboxStore } from './publisher';
import { envelopeBody, MAX_ATTEMPTS, nextAttemptAfter, signature, webhookHeaders } from './signing';
import {
  devWebhookTransport,
  httpWebhookTransport,
  isAllowedWebhookUrl,
  isPrivateAddress,
  type WebhookTransport,
} from './transport';

const T0 = new Date('2026-10-17T10:00:00Z');

describe('catalogue', () => {
  it('matches contracts/events.catalog.json exactly', () => {
    const file = path.resolve(
      __dirname,
      '../../../../../docs/G-integration/contracts/events.catalog.json',
    );
    const catalog = JSON.parse(readFileSync(file, 'utf8')) as {
      events: { type: string; to: string[] }[];
    };
    expect(Object.fromEntries(catalog.events.map((e) => [e.type, e.to]))).toEqual(OUTBOUND_EVENTS);
  });
});

describe('signing and retries', () => {
  it('signs ts + "." + body with HMAC-SHA256 (doc 43)', () => {
    const mac = createHmac('sha256', 'sec').update('1700000000.{"a":1}').digest('hex');
    expect(signature('sec', 1700000000, '{"a":1}')).toBe(`t=1700000000,v1=${mac}`);
  });

  it('sends the doc 43 headers', () => {
    const h = webhookHeaders({
      eventId: 'e1',
      eventType: 'zone.updated',
      attempt: 3,
      secret: 's',
      rawBody: '{}',
      now: T0,
    });
    expect(h['X-Zoauro-Event-Id']).toBe('e1');
    expect(h['X-Zoauro-Event-Type']).toBe('zone.updated');
    expect(h['X-Zoauro-Attempt']).toBe('3');
    expect(h['X-Zoauro-Timestamp']).toBe(String(T0.getTime() / 1000));
    expect(h['X-Zoauro-Signature']).toBe(signature('s', T0.getTime() / 1000, '{}'));
  });

  it('adds sequence to the stored payload and nothing else', () => {
    expect(JSON.parse(envelopeBody({ eventId: 'e', type: 't', data: { x: 1 } }, 42n))).toEqual({
      eventId: 'e',
      type: 't',
      data: { x: 1 },
      sequence: 42,
    });
  });

  it('retries after 1 m, 5 m, 30 m, 2 h, 6 h, 24 h, then dead letter (7 attempts)', () => {
    const minutes = [1, 2, 3, 4, 5, 6].map((a) => {
      const next = nextAttemptAfter(a, T0);
      return next === null ? null : (next.getTime() - T0.getTime()) / 60_000;
    });
    expect(minutes).toEqual([1, 5, 30, 120, 360, 1440]);
    expect(nextAttemptAfter(7, T0)).toBeNull();
    expect(MAX_ATTEMPTS).toBe(7);
  });
});

describe('SSRF guard', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    'not-an-ip',
  ])('refuses %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '172.32.0.1', '2606:4700::1111'])('allows %s', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );

  const resolver = (map: Record<string, string[]>) => async (h: string) => map[h] ?? [];

  it('needs https, no credentials, and only public addresses', async () => {
    const r = resolver({
      'ok.example': ['8.8.8.8'],
      'mixed.example': ['8.8.8.8', '10.0.0.1'],
      'empty.example': [],
    });
    expect(await isAllowedWebhookUrl('https://ok.example/hook', r)).toBe(true);
    expect(await isAllowedWebhookUrl('http://ok.example/hook', r)).toBe(false);
    expect(await isAllowedWebhookUrl('https://u:p@ok.example/hook', r)).toBe(false);
    expect(await isAllowedWebhookUrl('https://mixed.example/hook', r)).toBe(false);
    expect(await isAllowedWebhookUrl('https://empty.example/hook', r)).toBe(false);
    expect(await isAllowedWebhookUrl('https://localhost/hook', r)).toBe(false);
    expect(await isAllowedWebhookUrl('https://127.0.0.1/hook', r)).toBe(false);
    expect(await isAllowedWebhookUrl('https://[::1]/hook', r)).toBe(false);
    expect(await isAllowedWebhookUrl('not a url', r)).toBe(false);
  });
});

describe('http transport', () => {
  const resolve = async () => ['8.8.8.8'];
  const req = { url: 'https://ok.example/h', headers: {}, body: '{}', timeoutMs: 50 };

  it('2xx is delivered, redirects are not followed, other statuses fail', async () => {
    const seen: RequestInit[] = [];
    const fetchWith = (status: number) =>
      (async (_u: string | URL | Request, init?: RequestInit) => {
        if (init) seen.push(init);
        return new Response(null, { status });
      }) as typeof fetch;
    expect(await httpWebhookTransport({ fetch: fetchWith(204), resolve }).send(req)).toMatchObject({
      ok: true,
      httpStatus: 204,
    });
    expect(await httpWebhookTransport({ fetch: fetchWith(302), resolve }).send(req)).toMatchObject({
      ok: false,
      error: 'REDIRECT',
    });
    expect(await httpWebhookTransport({ fetch: fetchWith(500), resolve }).send(req)).toMatchObject({
      ok: false,
      error: 'HTTP_STATUS',
    });
    expect(seen.every((i) => i.redirect === 'manual' && i.method === 'POST')).toBe(true);
  });

  it('refuses a private target without sending anything', async () => {
    let called = false;
    const t = httpWebhookTransport({
      fetch: (async () => {
        called = true;
        return new Response(null);
      }) as typeof fetch,
      resolve: async () => ['10.0.0.5'],
    });
    expect(await t.send(req)).toMatchObject({ ok: false, error: 'REFUSED_URL' });
    expect(called).toBe(false);
  });

  it('reports a timeout', async () => {
    const t = httpWebhookTransport({
      resolve,
      fetch: ((_u: string | URL | Request, init?: RequestInit) =>
        new Promise((_res, rej) =>
          init?.signal?.addEventListener('abort', () => rej(init.signal?.reason)),
        )) as typeof fetch,
    });
    expect(await t.send(req)).toMatchObject({ ok: false, error: 'TIMEOUT' });
  });

  it('dev transport logs ids and host, never the body', async () => {
    const lines: string[] = [];
    const r = await devWebhookTransport((l) => lines.push(l)).send({
      ...req,
      body: '{"customer":"Asha 9876543210"}',
      headers: {
        'X-Zoauro-Event-Id': 'e9',
        'X-Zoauro-Event-Type': 'order.assigned',
        'X-Zoauro-Attempt': '1',
      },
    });
    expect(r.ok).toBe(true);
    expect(lines.join('\n')).toContain('order.assigned e9 attempt 1 -> ok.example');
    expect(lines.join('\n')).not.toContain('9876543210');
  });
});

// ---- publisher against a fake store ----

function delivery(
  over: Partial<DueDelivery> = {},
  sub: Partial<DueDelivery['subscription']> = {},
): DueDelivery {
  return {
    id: 'd1',
    attempt: 1,
    createdAt: T0,
    eventId: 'e1',
    eventType: 'zone.updated',
    sequence: 7n,
    payload: { eventId: 'e1', type: 'zone.updated' },
    ...over,
    subscription: {
      id: 's1',
      url: 'https://ok.example/h',
      secretEncrypted: 'sealed',
      active: true,
      deleted: false,
      clientId: 'c1',
      clientActive: true,
      clientDeleted: false,
      ...sub,
    },
  };
}

function fakeStore(due: DueDelivery[][], published: PublishedRow[][] = []) {
  const calls: { op: string; id?: string; arg?: unknown }[] = [];
  const store: OutboxStore = {
    publishBatch: async () => published.shift() ?? [],
    claimDue: async () => due.shift() ?? [],
    markDelivered: async (id, arg) => void calls.push({ op: 'delivered', id, arg }),
    markRetry: async (id, arg) => void calls.push({ op: 'retry', id, arg }),
    defer: async (id, arg) => void calls.push({ op: 'defer', id, arg }),
    markDead: async (id, arg) => void calls.push({ op: 'dead', id, arg }),
  };
  return { store, calls };
}

const failing: WebhookTransport = {
  name: 'http',
  send: async () => ({ ok: false, httpStatus: 503, responseMs: 5 }),
};
const okSecrets = { open: () => 'whsec' };

describe('publisher', () => {
  it('delivers with a signature made from the opened secret', async () => {
    let sent: Record<string, string> = {};
    const { store, calls } = fakeStore([[delivery()]]);
    const p = createOutboxPublisher({
      store,
      secrets: okSecrets,
      clock: () => T0,
      transport: {
        name: 'http',
        send: async (r) => {
          sent = r.headers;
          expect(r.headers['X-Zoauro-Signature']).toBe(
            signature('whsec', T0.getTime() / 1000, r.body),
          );
          return { ok: true, httpStatus: 200, responseMs: 3 };
        },
      },
    });
    expect(await p.deliver()).toMatchObject({ DELIVERED: 1 });
    expect(sent['X-Zoauro-Event-Id']).toBe('e1');
    expect(calls).toEqual([
      { op: 'delivered', id: 'd1', arg: { httpStatus: 200, responseMs: 3, at: T0 } },
    ]);
  });

  it('a failure schedules the next attempt; the 7th failure is dead letter with an alert', async () => {
    const { store, calls } = fakeStore([
      [delivery({ attempt: 2 }), delivery({ id: 'd7', attempt: 7 })],
    ]);
    const p = createOutboxPublisher({
      store,
      secrets: okSecrets,
      transport: failing,
      clock: () => T0,
    });
    expect(await p.deliver()).toMatchObject({ RETRY: 1, DEAD: 1 });
    expect(calls[0]).toMatchObject({
      op: 'retry',
      arg: { attempt: 2, httpStatus: 503, nextAttemptAt: new Date(T0.getTime() + 5 * 60_000) },
    });
    expect(calls[1]).toMatchObject({
      op: 'dead',
      id: 'd7',
      arg: {
        alert: { clientId: 'c1', detail: { deliveryId: 'd7', attempts: 7, lastHttpStatus: 503 } },
      },
    });
  });

  it('paused subscription or disabled client waits without spending an attempt, until retention runs out', async () => {
    const old = new Date(T0.getTime() - 15 * 24 * 3_600_000);
    const { store, calls } = fakeStore([
      [
        delivery({}, { active: false }),
        delivery({ id: 'd2' }, { clientActive: false }),
        delivery({ id: 'd3', createdAt: old }, { active: false }),
      ],
    ]);
    let sent = 0;
    const p = createOutboxPublisher({
      store,
      secrets: okSecrets,
      clock: () => T0,
      transport: {
        name: 'http',
        send: async () => ((sent += 1), { ok: true, httpStatus: 200, responseMs: 0 }),
      },
    });
    expect(await p.deliver()).toMatchObject({ DEFERRED: 2, DEAD: 1 });
    expect(sent).toBe(0);
    expect(calls.map((c) => c.op)).toEqual(['defer', 'defer', 'dead']);
    expect((calls[2]?.arg as { alert?: unknown }).alert).toBeUndefined();
  });

  it('deleted subscription is dead at once; a secret that does not open counts as a failed attempt', async () => {
    const { store, calls } = fakeStore([[delivery({}, { deleted: true }), delivery({ id: 'd2' })]]);
    const lines: string[] = [];
    const p = createOutboxPublisher({
      store,
      transport: failing,
      clock: () => T0,
      log: (l) => lines.push(l),
      secrets: {
        open: () => {
          throw new Error('tampered');
        },
      },
    });
    expect(await p.deliver()).toMatchObject({ DEAD: 1, RETRY: 1 });
    expect(calls.map((c) => c.op)).toEqual(['dead', 'retry']);
    expect(lines.join()).not.toContain('sealed');
  });

  it('publish drains full batches, notifies listeners, and a failing listener changes nothing', async () => {
    const row = (n: number): PublishedRow => ({
      id: `o${n}`,
      sequence: BigInt(n),
      eventType: 'zone.updated',
      zoneId: null,
      payload: {},
    });
    const { store } = fakeStore([], [[row(1), row(2)], [row(3)]]);
    const seen: string[] = [];
    const p = createOutboxPublisher({
      store,
      secrets: okSecrets,
      transport: failing,
      config: { batchSize: 2 },
      log: () => undefined,
      listeners: [
        () => {
          throw new Error('boom');
        },
        (rows) => void seen.push(...rows.map((r) => r.id)),
      ],
    });
    expect(await p.publish()).toBe(3);
    expect(seen).toEqual(['o1', 'o2', 'o3']);
  });
});
