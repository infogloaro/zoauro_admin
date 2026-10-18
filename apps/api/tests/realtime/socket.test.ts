import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PermissionKey } from '@zoauro/shared';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthContext } from '../../src/lib/authz';
import {
  attachRealtime,
  realtimeMessagesOf,
  realtimeRelay,
  REALTIME_CHANNEL,
  roomsFor,
  subscribeRealtime,
  type RealtimeCaller,
  type RealtimeMessage,
  type RealtimeServer,
} from '../../src/lib/realtime';

// Socket.IO for the admin panel (doc 06 section 6, doc 14 section 4, doc 36; TC-MZ-11, TC-AC-14) on a real HTTP server.
// Clients speak the Engine.IO v4 / Socket.IO v5 protocol over Node's WebSocket (no client library is installed).
// Sessions and access are fakes here; the API wiring (session store, AccessService) is a thin adapter in server.ts.

const ORIGIN = 'http://localhost:3000';
const A = '0192f1d2-0000-7000-8000-00000000000a';
const B = '0192f1d2-0000-7000-8000-00000000000b';
const C = '0192f1d2-0000-7000-8000-00000000000c';

function ctxOf(
  userId: string,
  zones: Record<string, PermissionKey[]>,
  superAdmin = false,
): AuthContext {
  return {
    userId,
    role: superAdmin ? 'SUPER_ADMIN' : 'ZONAL_ADMIN',
    isSuperAdmin: superAdmin,
    assignedZoneIds: superAdmin ? [] : Object.keys(zones),
    permissionsByZone: new Map(Object.entries(zones).map(([z, k]) => [z, new Set(k)])),
    limitsByZone: new Map(),
    requestedZoneIds: 'ALL',
  };
}

/** sid cookie -> member; the access each member has right now (tests change it to simulate scope changes) */
const sessions = new Map<string, RealtimeCaller>();
const access = new Map<string, AuthContext>();
function member(id: string, ctx: AuthContext, opts: { mustChangePassword?: boolean } = {}) {
  const sid = `sid-${id}`;
  sessions.set(sid, {
    userId: id,
    role: ctx.role,
    mustChangePassword: opts.mustChangePassword ?? false,
  });
  access.set(id, ctx);
  return `zo_sid=${sid}`;
}

let http: Server;
let rt: RealtimeServer;
let url: string;

beforeAll(async () => {
  http = createServer();
  rt = attachRealtime(http, {
    appOrigin: ORIGIN,
    authenticate: async (cookie) =>
      sessions.get(/zo_sid=([^;]+)/.exec(cookie ?? '')?.[1] ?? '') ?? null,
    contextOf: async (c) => {
      const ctx = access.get(c.userId);
      if (!ctx) throw new Error('no access');
      return ctx;
    },
    log: () => undefined,
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/socket.io/?EIO=4&transport=websocket`;
});

afterAll(async () => {
  await rt.close();
  await new Promise<void>((r) => http.close(() => r()));
});

interface TestSocket {
  /** resolves with 'connected' or the server's refusal ('UNAUTHENTICATED', 'refused' when the upgrade failed) */
  ready: Promise<string>;
  events: [string, unknown][];
  close(): void;
}

function connect(cookie: string | null, origin = ORIGIN): TestSocket {
  const headers: Record<string, string> = { Origin: origin };
  if (cookie) headers['Cookie'] = cookie;
  const ws = new WebSocket(url, { headers } as unknown as string[]);
  const events: [string, unknown][] = [];
  const ready = new Promise<string>((resolve) => {
    ws.onerror = () => resolve('refused');
    ws.onclose = () => resolve('refused');
    ws.onmessage = (e) => {
      const msg = String(e.data);
      if (msg.startsWith('0'))
        ws.send('40'); // Engine.IO open -> Socket.IO connect to "/"
      else if (msg === '2')
        ws.send('3'); // ping -> pong
      else if (msg.startsWith('40'))
        setTimeout(() => resolve('connected'), 50); // rooms are joined right after
      else if (msg.startsWith('44'))
        resolve((JSON.parse(msg.slice(2)) as { message: string }).message);
      else if (msg.startsWith('42')) {
        const [name, payload] = JSON.parse(msg.slice(2)) as [string, unknown];
        events.push([name, payload]);
      }
    };
  });
  return { ready, events, close: () => ws.close() };
}

const settle = () => new Promise((r) => setTimeout(r, 100));
const orderEvent = (zoneId: string, orderId: string): RealtimeMessage => ({
  kind: 'zone',
  zoneId,
  module: 'orders',
  event: 'order.status_changed',
  payload: { orderId, zoneId, from: 'PLACED', to: 'ACCEPTED' },
});

describe('handshake', () => {
  it('refuses no session, an unknown session, a pending password change and a foreign origin', async () => {
    const ok = member('hs-ok', ctxOf('hs-ok', { [A]: ['orders:view'] }));
    const pending = member('hs-pending', ctxOf('hs-pending', { [A]: ['orders:view'] }), {
      mustChangePassword: true,
    });
    expect(await connect(null).ready).toBe('UNAUTHENTICATED');
    expect(await connect('zo_sid=nope').ready).toBe('UNAUTHENTICATED');
    expect(await connect(pending).ready).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(await connect(ok, 'https://evil.example').ready).toBe('refused');
    const s = connect(ok);
    expect(await s.ready).toBe('connected');
    s.close();
  });
});

describe('rooms and delivery (TC-MZ-11: never an event for a zone or module without view)', () => {
  it('SuperAdmin, Admin(A), Admin(A+B), Admin(none) and Admin(A without orders:view) each get exactly their zones', async () => {
    const sockets = {
      sa: connect(member('sa', ctxOf('sa', {}, true))),
      a: connect(member('a', ctxOf('a', { [A]: ['orders:view'] }))),
      ab: connect(member('ab', ctxOf('ab', { [A]: ['orders:view'], [B]: ['orders:view'] }))),
      none: connect(member('none', ctxOf('none', {}))),
      refundsOnly: connect(member('ro', ctxOf('ro', { [A]: ['refunds:view'] }))),
    };
    for (const s of Object.values(sockets)) expect(await s.ready).toBe('connected');

    await rt.deliver([orderEvent(A, 'o-a'), orderEvent(B, 'o-b'), orderEvent(C, 'o-c')]);
    await settle();
    const got = (s: TestSocket) =>
      s.events.map(([, p]) => (p as { orderId: string }).orderId).sort();
    expect(got(sockets.sa)).toEqual(['o-a', 'o-b', 'o-c']);
    expect(got(sockets.a)).toEqual(['o-a']);
    expect(got(sockets.ab)).toEqual(['o-a', 'o-b']);
    expect(got(sockets.none)).toEqual([]);
    expect(got(sockets.refundsOnly)).toEqual([]);
    expect(sockets.a.events[0]).toEqual([
      'order.status_changed',
      { orderId: 'o-a', zoneId: A, from: 'PLACED', to: 'ACCEPTED' },
    ]);
    for (const s of Object.values(sockets)) s.close();
  });

  it('a client cannot join a room by asking (no join handler exists)', async () => {
    const s = connect(member('asker', ctxOf('asker', { [A]: ['orders:view'] })));
    await s.ready;
    expect(rt.io.listeners('connection')).toHaveLength(1);
    await rt.deliver([orderEvent(B, 'o-b2')]);
    await settle();
    expect(s.events).toEqual([]);
    s.close();
  });
});

describe('scope.changed (TC-AC-14: the socket leaves B rooms)', () => {
  it('re-joins from the access tables and tells the client; other members are untouched', async () => {
    const cookie = member('mv', ctxOf('mv', { [A]: ['orders:view'], [B]: ['orders:view'] }));
    const other = connect(member('other', ctxOf('other', { [B]: ['orders:view'] })));
    const s = connect(cookie);
    await Promise.all([s.ready, other.ready]);

    access.set('mv', ctxOf('mv', { [A]: ['orders:view'], [C]: ['orders:view'] })); // B removed, C added
    await rt.deliver([{ kind: 'scope', userId: 'mv' }]);
    await settle();
    expect(s.events).toEqual([['scope.changed', {}]]);
    expect(other.events).toEqual([]);

    await rt.deliver([orderEvent(A, 'x-a'), orderEvent(B, 'x-b'), orderEvent(C, 'x-c')]);
    await settle();
    const ids = s.events
      .slice(1)
      .map(([, p]) => (p as { orderId: string }).orderId)
      .sort();
    expect(ids).toEqual(['x-a', 'x-c']);
    expect(other.events.map(([, p]) => (p as { orderId: string }).orderId)).toEqual(['x-b']);
    s.close();
    other.close();
  });
});

describe('outbox -> messages', () => {
  it('maps order.status_changed (zone + ids only) and a member scope change; zone changes and app events are not sent', () => {
    expect(
      realtimeMessagesOf({
        eventType: 'order.status_changed',
        zoneId: A,
        payload: {
          aggregate: { id: 'o1' },
          audience: { customerId: 'c' },
          data: { from: 'READY', to: 'ASSIGNED', note: 'x' },
        },
      }),
    ).toEqual(
      [orderEvent(A, 'o1')].map((m) => ({
        ...m,
        payload: { orderId: 'o1', zoneId: A, from: 'READY', to: 'ASSIGNED' },
      })),
    );
    expect(
      realtimeMessagesOf({
        eventType: 'admin.zones_changed',
        zoneId: null,
        payload: { data: { userId: 'u1' } },
      }),
    ).toEqual([{ kind: 'scope', userId: 'u1' }]);
    expect(
      realtimeMessagesOf({
        eventType: 'admin.zones_changed',
        zoneId: A,
        payload: { data: { zoneId: A } },
      }),
    ).toEqual([]);
    expect(realtimeMessagesOf({ eventType: 'zone.updated', zoneId: A, payload: {} })).toEqual([]);
    expect(
      realtimeMessagesOf({ eventType: 'order.status_changed', zoneId: null, payload: {} }),
    ).toEqual([]);
  });

  it('roomsFor: doc 14 room names', () => {
    expect(
      roomsFor(ctxOf('u', { [A]: ['orders:view', 'refunds:view'], [B]: ['refunds:view'] })).sort(),
    ).toEqual([`zone:${A}:orders`, `zone:${A}:refunds`, `zone:${B}:refunds`].sort());
    expect(roomsFor(ctxOf('s', {}, true))).toEqual(['all:orders', 'all:refunds']);
  });
});

describe('relay over Redis (worker -> API)', () => {
  it('publishes what the outbox published and the subscriber delivers it', async () => {
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6390';
    const received: RealtimeMessage[] = [];
    const sub = await subscribeRealtime(redisUrl, (m) => received.push(...m));
    const pub = new Redis(redisUrl);
    try {
      const tag = randomBytes(4).toString('hex');
      await realtimeRelay(pub)([
        {
          eventType: 'order.status_changed',
          zoneId: A,
          payload: { aggregate: { id: `o-${tag}` }, data: { from: 'PLACED', to: 'ACCEPTED' } },
        },
        { eventType: 'zone.updated', zoneId: A, payload: {} },
      ]);
      await pub.publish(REALTIME_CHANNEL, 'not json');
      const deadline = Date.now() + 3000;
      while (
        !received.some((m) => m.kind === 'zone' && m.payload['orderId'] === `o-${tag}`) &&
        Date.now() < deadline
      )
        await new Promise((r) => setTimeout(r, 50));
      expect(
        received.filter((m) => m.kind === 'zone' && m.payload['orderId'] === `o-${tag}`),
      ).toHaveLength(1);
    } finally {
      await sub.close();
      await pub.quit();
    }
  });
});
