import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createUuidV7, record, runWithAuditContext, uuidv7 } from '../../src/lib/audit';
import type { AuditActor, AuditEntry } from '../../src/lib/audit';
import { auditTx } from '../../src/lib/db';
import { APP_ORIGIN, createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';
import type { MatrixActor, MatrixFixtures, ZoneLabel } from '../authz/matrix/fixtures';
import { prepareFixtures } from '../authz/matrix/run';

// M04 read API (doc 50 section 8) against the real routes, with the authorization-harness actors (F1.6):
// SuperAdmin, Admin(A full), Admin(A+B: full A, read-only B), Admin(A, payments denied), Admin(none).
let env: AuthTestEnv;
let fx: MatrixFixtures;
let app: Express;
const cookies = new Map<string, string>();

const writer: AuditActor = { type: 'USER', id: uuidv7(), name: 'Karthik M', role: 'SUPER_ADMIN' };
const ent = {
  restA: uuidv7(),
  restB: uuidv7(),
  restC: uuidv7(),
  payA: uuidv7(),
  orderA: uuidv7(),
  member: uuidv7(),
  zoneless: uuidv7(),
};

/** The real write path: record() through Prisma as the application role, inside a transaction. */
async function write(e: AuditEntry, actor: AuditActor = writer): Promise<void> {
  await runWithAuditContext(
    { actor, ip: '203.0.113.5', userAgent: 'Chrome', requestId: 'req-1' },
    () => env.prisma.$transaction((tx) => record(auditTx(tx), e)),
  );
}

/** A backdated row (owner role): the id carries the same instant as created_at, as a real row would. */
async function writeAt(
  at: Date,
  module: string,
  action: string,
  entityId: string,
): Promise<string> {
  const id = createUuidV7(() => at.getTime())();
  await env.db.owner.query(
    `INSERT INTO audit_logs (id, created_at, actor_type, actor_name, module, action, entity_type, entity_id, entity_label, zone_id)
     VALUES ($1, $2, 'USER', 'Backdated', $3, $4, 'restaurant', $5, 'Old Mess', $6)`,
    [id, at, module, action, entityId, fx.zones.A],
  );
  return id;
}

const as = (actorName: string) => {
  const cookie = cookies.get(actorName);
  if (!cookie) throw new Error(`no session for ${actorName}`);
  return { get: (path: string) => request(app).get(`/api/v1${path}`).set('Cookie', cookie) };
};
const SA = 'SuperAdmin';
const A_FULL = 'Admin(A full)';
const A_B = 'Admin(A+B: full A, read-only B)';
const A_NOPAY = 'Admin(A, payments denied)';
const NONE = 'Admin(none)';
const ZONALS = [A_FULL, A_B, A_NOPAY, NONE];
const activity = (type: string, id: string, extra = '') =>
  `/audit-logs?entityType=${type}&entityId=${id}${extra}`;

beforeAll(async () => {
  env = await createAuthTestEnv();
  fx = await prepareFixtures(env);
  ({ app } = env.makeAuthzApp());
  const z = (l: ZoneLabel) => fx.zones[l];

  await write({
    module: 'restaurants',
    action: 'restaurant.created',
    entity: { type: 'restaurant', id: ent.restA, label: 'Annapoorna Mess', zoneId: z('A') },
    after: { name: 'Annapoorna Mess' },
  });
  await write({
    module: 'restaurants',
    action: 'restaurant.commission_changed',
    entity: { type: 'restaurant', id: ent.restA, label: 'Annapoorna Mess', zoneId: z('A') },
    before: { commissionPct: 15 },
    after: { commissionPct: 18 },
  });
  // a hidden-module row about the same entity: never shown to a Zonal Admin (TC-AUD-13)
  await write({
    module: 'access',
    action: 'access.profile_set',
    entity: { type: 'restaurant', id: ent.restA, zoneId: z('A') },
    note: 'hidden',
  });
  await write({
    module: 'restaurants',
    action: 'restaurant.created',
    entity: { type: 'restaurant', id: ent.restB, label: 'Bombay Bites', zoneId: z('B') },
    after: { name: 'Bombay Bites' },
  });
  await write({
    module: 'restaurants',
    action: 'restaurant.created',
    entity: { type: 'restaurant', id: ent.restC, label: 'Chettinad 50% Off_Club', zoneId: z('C') },
    after: { name: 'x' },
  });
  await write({
    module: 'payments',
    action: 'reconciliation.mismatch_ack',
    entity: { type: 'payment', id: ent.payA, zoneId: z('A') },
  });
  await write({
    module: 'orders',
    action: 'order.marked_delayed',
    entity: { type: 'order', id: ent.orderA, label: 'ZO-100245', zoneId: z('A') },
  });
  await write({
    module: 'access',
    action: 'access.zone_added',
    entity: { type: 'member', id: ent.member, zoneId: z('A') },
  });
  await write(
    {
      module: 'settings',
      action: 'settings.updated',
      entity: { type: 'setting', id: ent.zoneless, zoneId: null },
    },
    { type: 'SYSTEM', id: null, name: 'System: nightly', role: null },
  );

  for (const a of fx.actors.filter((x) => !x.mustChangePassword))
    cookies.set(a.name, (await env.session(a.user)).cookie);
}, 180_000);
afterAll(async () => {
  await env.close();
});

describe('TC-AUD-9 free listing', () => {
  it.each(ZONALS)(
    '%s without entity mode gets 403, also with only one of entityType / entityId',
    async (n) => {
      for (const path of [
        '/audit-logs',
        '/audit-logs?entityType=restaurant',
        `/audit-logs?entityId=${ent.restA}`,
      ]) {
        const res = await as(n).get(path);
        expect(res.status, path).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    },
  );
  it('Super Admin gets a cursor page with technical fields', async () => {
    const res = await as(SA).get('/audit-logs?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.meta).toMatchObject({ limit: 5, nextCursor: res.body.data[4].id });
    expect('ip' in res.body.data[0]).toBe(true);
  });
  it('anonymous is 401', async () => {
    expect((await request(app).get('/api/v1/audit-logs')).status).toBe(401);
  });
});

describe('TC-AUD-10..13 entity Activity for Zonal Admins', () => {
  it("TC-AUD-10 Admin(A full) sees only that restaurant's rows, without ip / userAgent / requestId", async () => {
    const res = await as(A_FULL).get(activity('restaurant', ent.restA));
    expect(res.status).toBe(200);
    const items = res.body.data as Record<string, unknown>[];
    expect(items.map((i) => i['action'])).toEqual([
      'restaurant.commission_changed',
      'restaurant.created',
    ]);
    for (const i of items) {
      expect(i['entity']).toMatchObject({ id: ent.restA });
      for (const k of ['ip', 'userAgent', 'requestId']) expect(k in i, k).toBe(false);
    }
    expect(JSON.stringify(res.body)).not.toContain('203.0.113.5');
    expect(items[0]).toMatchObject({
      changedFields: ['commissionPct'],
      zone: { id: fx.zones.A },
      actor: { name: 'Karthik M' },
    });
  });
  it('the filters a Zonal Admin may not use are ignored (module=access does not reveal the hidden row)', async () => {
    const res = await as(A_FULL).get(
      activity('restaurant', ent.restA, '&module=access&sensitivity=HIGH&q=zzz'),
    );
    expect(res.status).toBe(200);
    expect((res.body.data as { module: string }[]).every((i) => i.module === 'restaurants')).toBe(
      true,
    );
    expect(res.body.data).toHaveLength(2);
  });
  it('TC-AUD-11 the same member on a restaurant in an unassigned zone gets 404 and no rows', async () => {
    const res = await as(A_FULL).get(activity('restaurant', ent.restC));
    expect(res.status).toBe(404);
    expect(res.body.data).toBeUndefined();
  });
  it("read-only in B is enough for B's Activity; Admin(A full) is 404 there", async () => {
    expect((await as(A_B).get(activity('restaurant', ent.restB))).status).toBe(200);
    expect((await as(A_FULL).get(activity('restaurant', ent.restB))).status).toBe(404);
  });
  it('TC-AUD-12 a deny override (payments:view in A) hides that module in that zone; other modules stay visible', async () => {
    expect((await as(A_NOPAY).get(activity('payment', ent.payA))).status).toBe(404);
    expect((await as(A_FULL).get(activity('payment', ent.payA))).status).toBe(200);
    expect((await as(A_NOPAY).get(activity('order', ent.orderA))).status).toBe(200);
  });
  it('TC-AUD-13 hidden modules and zone-less rows are never returned to a Zonal Admin, even by entity id', async () => {
    for (const n of ZONALS) {
      expect((await as(n).get(activity('member', ent.member))).status, n).toBe(404);
      expect((await as(n).get(activity('setting', ent.zoneless))).status, n).toBe(404);
    }
    expect((await as(SA).get(activity('member', ent.member))).body.data).toHaveLength(1);
  });
  it('Admin(none) sees no entity at all', async () => {
    expect((await as(NONE).get(activity('restaurant', ent.restA))).status).toBe(404);
  });
  it('a later empty page is a normal end of list, not 404', async () => {
    const first = await as(A_FULL).get(activity('restaurant', ent.restA));
    const last = (first.body.data as { id: string }[]).at(-1)?.id ?? '';
    const res = await as(A_FULL).get(activity('restaurant', ent.restA, `&after=${last}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], meta: { limit: 50, nextCursor: null } });
  });
});

describe('GET /audit-logs/{id}', () => {
  const idOf = async (action: string, entityId: string) => {
    const r = await as(SA).get(`/audit-logs?action=${action}&entityId=${entityId}`);
    return (r.body.data as { id: string }[])[0]?.id ?? '';
  };
  it('Super Admin gets changes[] and technical fields', async () => {
    const id = await idOf('restaurant.commission_changed', ent.restA);
    const res = await as(SA).get(`/audit-logs/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      actionLabel: 'Changed commission',
      changes: [{ field: 'commissionPct', before: 15, after: 18 }],
      ip: '203.0.113.5',
      requestId: 'req-1',
    });
  });
  it('a Zonal Admin who can see the row gets it without technical fields; anyone else gets 404', async () => {
    const id = await idOf('restaurant.commission_changed', ent.restA);
    const res = await as(A_FULL).get(`/audit-logs/${id}`);
    expect(res.status).toBe(200);
    for (const k of ['ip', 'userAgent', 'requestId']) expect(k in res.body).toBe(false);
    expect((await as(NONE).get(`/audit-logs/${id}`)).status).toBe(404);
    const hidden = await idOf('access.profile_set', ent.restA);
    for (const n of ZONALS) expect((await as(n).get(`/audit-logs/${hidden}`)).status, n).toBe(404);
    expect((await as(SA).get(`/audit-logs/${uuidv7()}`)).status).toBe(404);
    expect((await as(SA).get('/audit-logs/not-a-uuid')).status).toBe(422);
  });

  // P3.5 (doc 56): by id, a Zonal Admin gets exactly what entity mode of the list would show them, nothing more.
  it('by id, the entity-mode restriction applies: another zone, a hidden module or no zone is 404', async () => {
    const inA = await idOf('restaurant.created', ent.restA);
    const inB = await idOf('restaurant.created', ent.restB);
    const inC = await idOf('restaurant.created', ent.restC);
    const hiddenInA = await idOf('access.profile_set', ent.restA);
    const zoneless = await idOf('settings.updated', ent.zoneless);
    const status = async (who: string, id: string) =>
      (await as(who).get(`/audit-logs/${id}`)).status;

    const expected: Record<string, Record<string, number>> = {
      [A_FULL]: { inA: 200, inB: 404, inC: 404, hiddenInA: 404, zoneless: 404 },
      [A_B]: { inA: 200, inB: 200, inC: 404, hiddenInA: 404, zoneless: 404 },
      [NONE]: { inA: 404, inB: 404, inC: 404, hiddenInA: 404, zoneless: 404 },
    };
    const ids: Record<string, string> = { inA, inB, inC, hiddenInA, zoneless };
    for (const [who, byRow] of Object.entries(expected)) {
      for (const [row, want] of Object.entries(byRow)) {
        const id = ids[row] ?? '';
        expect(id, row).not.toBe('');
        expect(await status(who, id), `${who} ${row}`).toBe(want);
      }
    }
    // the same answer as the list in entity mode, for the same viewers
    expect((await as(A_FULL).get(activity('restaurant', ent.restB))).status).toBe(404);
    expect((await as(A_B).get(activity('restaurant', ent.restC))).status).toBe(404);
    // Super Admin sees every one of them
    for (const id of Object.values(ids)) expect(await status(SA, id)).toBe(200);
  });
});

describe('TC-AUD-14 Super Admin filters', () => {
  const ids = async (path: string) => {
    const res = await as(SA).get(path);
    expect(res.status, path).toBe(200);
    return res.body.data as {
      action: string;
      actor: { name: string; type: string };
      zone: { id: string } | null;
      sensitivity: string;
      outcome: string;
      entity: { label: string | null };
    }[];
  };
  it('actor, actorType, module, action, entity, zone (repeatable), outcome and sensitivity', async () => {
    expect(
      (await ids(`/audit-logs?actorId=${writer.id}`)).every((i) => i.actor.name === 'Karthik M'),
    ).toBe(true);
    expect(
      (await ids('/audit-logs?actorType=SYSTEM&module=settings')).map((i) => i.actor.name),
    ).toEqual(['System: nightly']);
    expect((await ids('/audit-logs?module=orders')).map((i) => i.action)).toEqual([
      'order.marked_delayed',
    ]);
    expect(await ids(`/audit-logs?entityType=restaurant&entityId=${ent.restA}`)).toHaveLength(3); // Super Admin sees the hidden row too
    const zoneAB = await ids(
      `/audit-logs?zoneId=${fx.zones.A}&zoneId=${fx.zones.B}&module=restaurants`,
    );
    expect(new Set(zoneAB.map((i) => i.zone?.id))).toEqual(new Set([fx.zones.A, fx.zones.B]));
    expect(await ids(`/audit-logs?zoneId=${fx.zones.C}&module=restaurants&outcome=DENIED`)).toEqual(
      [],
    );
    const high = await ids('/audit-logs?sensitivity=HIGH&limit=100');
    expect(high.length).toBeGreaterThan(0);
    expect(high.every((i) => i.sensitivity === 'HIGH')).toBe(true);
  });
  it('combined filters are ANDed', async () => {
    expect(await ids(`/audit-logs?module=orders&zoneId=${fx.zones.B}`)).toEqual([]);
    expect(await ids(`/audit-logs?module=orders&zoneId=${fx.zones.A}&actorType=USER`)).toHaveLength(
      1,
    );
  });
  it('q: case-insensitive prefix on entity label or actor name; % and _ are literal', async () => {
    expect(
      (await ids('/audit-logs?q=annapoorna')).every((i) => i.entity.label === 'Annapoorna Mess'),
    ).toBe(true);
    expect((await ids('/audit-logs?q=karth&limit=100')).length).toBeGreaterThan(5);
    expect(await ids('/audit-logs?q=mess')).toEqual([]); // prefix, not substring
    expect(
      (await ids(`/audit-logs?q=${encodeURIComponent('Chettinad 50% Off_')}`)).map(
        (i) => i.entity.label,
      ),
    ).toEqual(['Chettinad 50% Off_Club']);
    expect(await ids(`/audit-logs?q=${encodeURIComponent('Chettinad 5_%')}`)).toEqual([]); // _ is not a wildcard
    expect(await ids(`/audit-logs?q=${encodeURIComponent('%')}`)).toEqual([]); // % is not a wildcard
  });
  it('date range: from / to select by created_at (sent as id bounds + created_at)', async () => {
    const tag = uuidv7();
    const old = await writeAt(
      new Date('2024-03-10T10:00:00Z'),
      'restaurants',
      'restaurant.updated',
      tag,
    );
    await writeAt(new Date('2024-05-10T10:00:00Z'), 'restaurants', 'restaurant.updated', tag);
    const inMarch = await ids(
      `/audit-logs?entityType=restaurant&entityId=${tag}&from=2024-03-01T00:00:00Z&to=2024-03-31T23:59:59Z`,
    );
    expect(inMarch).toHaveLength(1);
    expect((await as(SA).get(`/audit-logs/${old}`)).body.createdAt).toBe(
      '2024-03-10T10:00:00.000Z',
    );
    expect(
      await ids(`/audit-logs?entityType=restaurant&entityId=${tag}&from=2024-06-01T00:00:00Z`),
    ).toEqual([]);
    expect(
      await ids(`/audit-logs?entityType=restaurant&entityId=${tag}&to=2024-04-01T00:00:00Z`),
    ).toHaveLength(1);
  });
  it('bad filters are 422', async () => {
    for (const p of [
      '/audit-logs?limit=101',
      '/audit-logs?from=yesterday',
      '/audit-logs?from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z',
      '/audit-logs?actorType=ROBOT',
      '/audit-logs?after=1',
      '/audit-logs?zoneId=nope',
    ])
      expect((await as(SA).get(p)).status, p).toBe(422);
  });
  it('there is no write endpoint on audit rows', async () => {
    const cookie = cookies.get(SA) ?? '';
    for (const m of ['post', 'put', 'patch', 'delete'] as const)
      expect(
        (
          await request(app)
            [m]('/api/v1/audit-logs')
            .set('Cookie', cookie)
            .set('Origin', APP_ORIGIN)
        ).status,
        m,
      ).toBe(404);
  });
});

describe('TC-AUD-15 cursor pagination through the route while rows arrive', () => {
  it('no duplicates, no gaps, strictly descending ids', async () => {
    const entityId = uuidv7();
    const entry: AuditEntry = {
      module: 'restaurants',
      action: 'restaurant.updated',
      entity: { type: 'restaurant', id: entityId, zoneId: fx.zones.A },
      note: 'page',
    };
    for (let i = 0; i < 23; i++) await write(entry);
    const seen: string[] = [];
    let after: string | null = null;
    let injected = false;
    for (;;) {
      const res = await as(A_FULL).get(
        activity('restaurant', entityId, `&limit=5${after ? `&after=${after}` : ''}`),
      );
      expect(res.status).toBe(200);
      const page = (res.body.data as { id: string }[]).map((r) => r.id);
      seen.push(...page);
      if (!injected) {
        injected = true;
        for (let i = 0; i < 4; i++) await write(entry); // newer rows sort above the cursor
      }
      after = res.body.meta.nextCursor as string | null;
      if (!after) break;
    }
    expect(seen).toHaveLength(23);
    expect(new Set(seen).size).toBe(23);
    for (let i = 1; i < seen.length; i++) expect((seen[i] ?? '') < (seen[i - 1] ?? '')).toBe(true);
  });
});

describe('GET /audit-logs/catalogue', () => {
  it('Super Admin gets modules and labelled actions; Zonal Admins 403', async () => {
    const res = await as(SA).get('/audit-logs/catalogue');
    expect(res.status).toBe(200);
    expect(res.body.modules).toContain('restaurants');
    expect(res.body.actions).toContainEqual({
      key: 'restaurant.commission_changed',
      module: 'restaurants',
      label: 'Changed commission',
    });
    for (const n of ZONALS) expect((await as(n).get('/audit-logs/catalogue')).status, n).toBe(403);
  });
});

describe('System Logs filter options', () => {
  it('actors: admins by case-insensitive name prefix (soft-deleted included), role attached, limit honoured', async () => {
    const res = await as(SA).get('/audit-logs/actors?q=test%20super');
    expect(res.status).toBe(200);
    const rows = res.body.data as { id: string; name: string; role: string | null }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every((r) => r.name.toLowerCase().startsWith('test super') && r.role === 'SUPER_ADMIN'),
    ).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('@'); // names and ids only, never emails
    expect((await as(SA).get('/audit-logs/actors?q=TEST%20SUPER&limit=1')).body.data).toHaveLength(
      1,
    );
    expect((await as(SA).get('/audit-logs/actors?q=zzz-nobody')).body.data).toEqual([]);
    expect((await as(SA).get('/audit-logs/actors')).body.data.length).toBeGreaterThan(0); // no q: first by name
  });
  it('actors: % and _ in q are literal, a bad limit is 422', async () => {
    expect((await as(SA).get('/audit-logs/actors?q=%25')).body.data).toEqual([]);
    expect((await as(SA).get('/audit-logs/actors?q=_est')).body.data).toEqual([]);
    // positive: the fixture admins are named 'Test ZONAL_ADMIN n', so a literal underscore matches them ...
    expect(
      (await as(SA).get('/audit-logs/actors?q=test%20zonal_admin')).body.data.length,
    ).toBeGreaterThan(0);
    // ... and an underscore that was a wildcard would also match this
    expect((await as(SA).get('/audit-logs/actors?q=test%20zonalXadmin')).body.data).toEqual([]);
    expect((await as(SA).get('/audit-logs/actors?limit=21')).status).toBe(422);
  });
  it('zones: every zone with its name, ordered by name', async () => {
    const res = await as(SA).get('/audit-logs/zones');
    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((z) => z.id);
    for (const z of Object.values(fx.zones)) expect(ids).toContain(z);
    const again = await as(SA).get('/audit-logs/zones');
    expect(again.body.data).toEqual(res.body.data); // deterministic order (name, then id)
    expect(res.body.data[0]).toEqual({ id: expect.any(String), name: expect.any(String) });
  });
  it.each(ZONALS)('%s cannot call the option endpoints', async (n) => {
    expect((await as(n).get('/audit-logs/actors')).status).toBe(403);
    expect((await as(n).get('/audit-logs/zones')).status).toBe(403);
  });
});

describe('TC-AUD-23 sign-in lists', () => {
  let member: MatrixActor;
  beforeAll(async () => {
    member = fx.byName(A_FULL);
    await env.login(member.user, 'wrong password 123456'); // a failed attempt
  });
  it('/login-history (Super Admin) lists failed and successful attempts, filters by user and success, masks emails', async () => {
    const res = await as(SA).get(`/login-history?userId=${member.user.id}`);
    expect(res.status).toBe(200);
    const rows = res.body.data as {
      success: boolean;
      emailAttempted: string;
      userId: string;
      reason: string;
    }[];
    expect(rows.some((r) => r.success)).toBe(true);
    expect(rows.some((r) => !r.success)).toBe(true);
    expect(rows.every((r) => r.userId === member.user.id)).toBe(true);
    expect(rows.every((r) => !r.emailAttempted.includes(member.user.email))).toBe(true);
    expect(rows[0]?.emailAttempted).toMatch(/^m\*\*\*@example\.test$/);
    const failed = await as(SA).get(`/login-history?userId=${member.user.id}&success=false`);
    expect((failed.body.data as { success: boolean }[]).every((r) => !r.success)).toBe(true);
    expect((await as(SA).get('/login-history?success=maybe')).status).toBe(422);
  });
  it('/login-history pages by cursor', async () => {
    const first = await as(SA).get('/login-history?limit=2');
    expect(first.body.data).toHaveLength(2);
    const next = await as(SA).get(`/login-history?limit=2&after=${first.body.meta.nextCursor}`);
    expect(next.status).toBe(200);
    expect(next.body.data.map((r: { id: string }) => r.id)).not.toContain(first.body.data[0].id);
  });
  it.each(ZONALS)('%s cannot call /login-history', async (n) => {
    expect((await as(n).get('/login-history')).status).toBe(403);
  });
  it("/me/login-history returns only the caller's own attempts, for every role", async () => {
    for (const n of [SA, ...ZONALS]) {
      const me = fx.byName(n);
      const res = await as(n).get('/me/login-history');
      expect(res.status, n).toBe(200);
      const rows = res.body.data as { userId: string; emailAttempted: string }[];
      expect(rows.length, n).toBeGreaterThan(0);
      expect(
        rows.every((r) => r.userId === me.user.id && r.emailAttempted === me.user.email),
        n,
      ).toBe(true);
    }
    expect((await request(app).get('/api/v1/me/login-history')).status).toBe(401);
  });
});
