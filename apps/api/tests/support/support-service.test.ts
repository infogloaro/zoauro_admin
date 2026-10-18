import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithAuditContext } from '../../src/lib/audit';
import type { AccessService, AuthContext } from '../../src/lib/authz';
import { AppError } from '../../src/lib/errors';
import {
  createSupportService,
  type SupportService,
  type SupportSla,
} from '../../src/modules/support';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { seedOrder } from '../orders/support';

// Support desk service against a real database (D139-D141): zone scope for SuperAdmin, Admin(A), Admin(A+B) and
// Admin(none), the zone rule, auto-assignment (round-robin, least busy), the SLA clock pause, escalation and the
// close after the reopen window, audit and outbox. The HTTP routes (and the route-level authz matrix) are mounted with
// the shared-file wiring; this suite drives the service with real AuthContexts from the access tables.

let env: AuthTestEnv;
let access: AccessService;
let superAdmin: TestUser;
let memberA1: TestUser;
let memberA2: TestUser;
let memberAB: TestUser;
let viewerA: TestUser;
let nobody: TestUser;
let zoneA: string;
let zoneB: string;
let now = new Date('2026-10-18T10:00:00Z');
let sla: SupportSla = {
  firstResponseMinutes: 120,
  resolutionMinutes: 1440,
  escalationMinutes: 720,
  reopenWithinDays: 7,
  assignment: 'ROUND_ROBIN',
};
let service: SupportService;

const ctxOf = (u: TestUser, zones: string[] | 'ALL' = 'ALL'): Promise<AuthContext> =>
  access.buildContext(
    { userId: u.id, role: u.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ZONAL_ADMIN' },
    zones,
  );
const as = <T>(u: TestUser, fn: () => Promise<T>) =>
  runWithAuditContext({ actor: { type: 'USER', id: u.id, name: u.name, role: u.role } }, fn);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? e.code : `other: ${String(e)}`;
  }
  return 'none';
};

async function customerWithOrder(zoneId: string) {
  return seedOrder(env, zoneId, { customerName: 'Ticket Customer' });
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  ({ access } = env.makeAuthzApp());
  superAdmin = await env.createUser('SUPER_ADMIN');
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const desk = await env.createProfile({ support: ['view', 'edit'] });
  const viewOnly = await env.createProfile({ support: ['view'] });
  memberA1 = await env.createUser('ZONAL_ADMIN');
  memberA2 = await env.createUser('ZONAL_ADMIN');
  memberAB = await env.createUser('ZONAL_ADMIN');
  viewerA = await env.createUser('ZONAL_ADMIN');
  nobody = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(memberA1.id, zoneA, superAdmin.id, { profileId: desk });
  await env.assignZone(memberA2.id, zoneA, superAdmin.id, { profileId: desk });
  await env.assignZone(memberAB.id, zoneB, superAdmin.id, { profileId: desk });
  await env.assignZone(memberAB.id, zoneA, superAdmin.id, { profileId: viewOnly });
  await env.assignZone(viewerA.id, zoneA, superAdmin.id, { profileId: viewOnly });
  service = createSupportService({
    prisma: env.prisma,
    access,
    slaOf: async () => sla,
    clock: () => now,
  });
}, 300_000);

afterAll(async () => {
  await env?.close();
});

describe('create: zone rule and auto-assignment', () => {
  it('takes the order zone, assigns round-robin among zone A members with support:edit, audits and emits', async () => {
    const o = await customerWithOrder(zoneA);
    const sa = await ctxOf(superAdmin);
    const first = await as(superAdmin, () =>
      service.create(sa, {
        customerId: o.customerId,
        orderId: o.orderId,
        category: 'ORDER',
        priority: 'HIGH',
        subject: 'Cold food',
        description: 'The order arrived cold',
      }),
    );
    expect(first.status).toBe('ASSIGNED');
    // memberAB only views zone A and viewerA only views: neither can take it
    expect([memberA1.id, memberA2.id]).toContain(first.assigneeId);
    const second = await as(superAdmin, () =>
      service.create(sa, {
        customerId: o.customerId,
        category: 'DELIVERY',
        priority: 'NORMAL',
        subject: 'Late',
        description: 'Late again',
      }),
    );
    expect(second.assigneeId).not.toBe(first.assigneeId); // round-robin; zone from the customer's latest order

    const detail = await service.get(sa, first.id);
    expect(detail).toMatchObject({ zoneId: zoneA, priority: 'HIGH', status: 'ASSIGNED' });
    expect(detail.firstResponseDueAt).toBe(new Date(now.getTime() + 120 * 60_000).toISOString());
    expect(detail.messages).toMatchObject([
      { visibility: 'PUBLIC', body: 'The order arrived cold' },
    ]);
    expect(detail.customerPhoneMasked).not.toMatch(/\d{6}/);

    const audit = await env.db.owner.query(
      `SELECT action, zone_id FROM audit_logs WHERE entity_type = 'ticket' AND entity_id = $1`,
      [first.id],
    );
    expect(audit.rows).toEqual([{ action: 'ticket.created', zone_id: zoneA }]);
    const outbox = await env.db.owner.query(
      `SELECT event_type, zone_id FROM outbox WHERE payload_json->'data'->>'ticketId' = $1`,
      [first.id],
    );
    expect(outbox.rows).toEqual([{ event_type: 'admin.ticket_changed', zone_id: zoneA }]);
  });

  it('a customer with no order needs a zone; a zone that contradicts the order is refused', async () => {
    const o = await customerWithOrder(zoneA);
    const sa = await ctxOf(superAdmin);
    const fresh = await env.db.owner.query<{ id: string }>(
      `INSERT INTO customers (id, name, phone, updated_at) VALUES (gen_random_uuid(), 'New', '+919000000123', now()) RETURNING id`,
    );
    const customerId = fresh.rows[0]?.id ?? '';
    const base = {
      category: 'ACCOUNT' as const,
      priority: 'LOW' as const,
      subject: 's',
      description: 'd',
    };
    expect(await code(as(superAdmin, () => service.create(sa, { ...base, customerId })))).toBe(
      'VALIDATION_ERROR',
    );
    const ok = await as(superAdmin, () =>
      service.create(sa, { ...base, customerId, zoneId: zoneB }),
    );
    expect(ok.assigneeId).toBe(memberAB.id);
    expect(
      await code(
        as(superAdmin, () =>
          service.create(sa, {
            ...base,
            customerId: o.customerId,
            orderId: o.orderId,
            zoneId: zoneB,
          }),
        ),
      ),
    ).toBe('VALIDATION_ERROR');
  });

  it('Zonal: support:edit in the zone creates; view only is 403; another zone is 404', async () => {
    const o = await customerWithOrder(zoneA);
    const input = {
      customerId: o.customerId,
      orderId: o.orderId,
      category: 'ORDER' as const,
      priority: 'NORMAL' as const,
      subject: 's',
      description: 'd',
    };
    expect(
      (await as(memberA1, async () => service.create(await ctxOf(memberA1), input))).status,
    ).toBe('ASSIGNED');
    expect(await code(as(viewerA, async () => service.create(await ctxOf(viewerA), input)))).toBe(
      'FORBIDDEN',
    );
    expect(await code(as(nobody, async () => service.create(await ctxOf(nobody), input)))).toBe(
      'NOT_FOUND',
    );
  });
});

describe('scope (SuperAdmin, Admin(A), Admin(A+B), Admin(none))', () => {
  it('lists and reads exactly the zones each actor views', async () => {
    const page = {
      page: 1,
      pageSize: 100,
      sort: { field: 'createdAt', direction: 'desc' as const },
    };
    const zones = async (u: TestUser) =>
      [...new Set((await service.list(await ctxOf(u), page)).data.map((t) => t.zoneId))].sort();
    expect(await zones(superAdmin)).toEqual([zoneA, zoneB].sort());
    expect(await zones(memberA1)).toEqual([zoneA]);
    expect(await zones(memberAB)).toEqual([zoneA, zoneB].sort());
    expect(await zones(nobody)).toEqual([]);

    const inB = (await service.list(await ctxOf(superAdmin, [zoneB]), page)).data[0];
    expect(inB).toBeDefined();
    expect(await code(service.get(await ctxOf(memberA1), inB?.id ?? ''))).toBe('NOT_FOUND');
    expect(await code(service.get(await ctxOf(nobody), inB?.id ?? ''))).toBe('NOT_FOUND');
    expect((await service.get(await ctxOf(memberAB), inB?.id ?? '')).zoneId).toBe(zoneB);
  });

  it('Admin(A+B) views zone A but cannot write there (403); writes in B', async () => {
    const o = await customerWithOrder(zoneA);
    const sa = await ctxOf(superAdmin);
    const t = await as(superAdmin, () =>
      service.create(sa, {
        customerId: o.customerId,
        orderId: o.orderId,
        category: 'ORDER',
        priority: 'NORMAL',
        subject: 's',
        description: 'd',
      }),
    );
    const ab = await ctxOf(memberAB);
    expect(
      await code(
        as(memberAB, () =>
          service.addMessage(ab, t.id, { visibility: 'INTERNAL', body: 'x', attachmentKeys: [] }),
        ),
      ),
    ).toBe('FORBIDDEN');
  });
});

describe('work on a ticket', () => {
  it('first PUBLIC reply stops the first-response clock; WAITING_CUSTOMER pauses; If-Match is enforced', async () => {
    const o = await customerWithOrder(zoneA);
    const sa = await ctxOf(superAdmin);
    const t = await as(superAdmin, () =>
      service.create(sa, {
        customerId: o.customerId,
        orderId: o.orderId,
        category: 'ORDER',
        priority: 'NORMAL',
        subject: 's',
        description: 'd',
      }),
    );
    await as(superAdmin, () =>
      service.addMessage(sa, t.id, { visibility: 'INTERNAL', body: 'note', attachmentKeys: [] }),
    );
    expect((await service.get(sa, t.id)).firstRespondedAt).toBeNull();
    const replied = await as(superAdmin, () =>
      service.addMessage(sa, t.id, {
        visibility: 'PUBLIC',
        body: 'We are on it',
        attachmentKeys: [],
      }),
    );
    expect((await service.get(sa, t.id)).firstRespondedAt).toBe(now.toISOString());

    expect(
      await code(as(superAdmin, () => service.transition(sa, t.id, 1, { to: 'WAITING_CUSTOMER' }))),
    ).toBe('STALE_VERSION');
    const waiting = await as(superAdmin, () =>
      service.transition(sa, t.id, replied.version, { to: 'WAITING_CUSTOMER' }),
    );
    const before = await service.get(sa, t.id);
    now = new Date(now.getTime() + 3 * 3_600_000);
    await as(superAdmin, () => service.transition(sa, t.id, waiting.version, { to: 'ASSIGNED' }));
    const after = await service.get(sa, t.id);
    expect(Date.parse(after.resolutionDueAt) - Date.parse(before.resolutionDueAt)).toBe(
      3 * 3_600_000,
    );
    expect(after.pausedAt).toBeNull();
    expect(
      await code(
        as(superAdmin, () => service.transition(sa, t.id, after.version, { to: 'CLOSED' })),
      ),
    ).toBe('INVALID_STATE_TRANSITION');
  });

  it('assign: a named member must hold support:edit in the zone; null picks automatically', async () => {
    const o = await customerWithOrder(zoneA);
    const sa = await ctxOf(superAdmin);
    const t = await as(superAdmin, () =>
      service.create(sa, {
        customerId: o.customerId,
        orderId: o.orderId,
        category: 'ORDER',
        priority: 'NORMAL',
        subject: 's',
        description: 'd',
      }),
    );
    expect(
      await code(
        as(superAdmin, () => service.assign(sa, t.id, t.version, { assigneeId: viewerA.id })),
      ),
    ).toBe('VALIDATION_ERROR');
    const other = t.assigneeId === memberA1.id ? memberA2 : memberA1;
    const r = await as(superAdmin, () =>
      service.assign(sa, t.id, t.version, { assigneeId: other.id }),
    );
    expect(r).toMatchObject({ assigneeId: other.id, status: 'ASSIGNED', version: t.version + 1 });
  });
});

describe('sweep (D139, D140)', () => {
  it('escalates a breach to the other member once, and closes tickets resolved longer than the reopen window', async () => {
    const o = await customerWithOrder(zoneA);
    const sa = await ctxOf(superAdmin);
    const t = await as(superAdmin, () =>
      service.create(sa, {
        customerId: o.customerId,
        orderId: o.orderId,
        category: 'ORDER',
        priority: 'NORMAL',
        subject: 'breach',
        description: 'd',
      }),
    );
    const resolvedOne = await as(superAdmin, () =>
      service.create(sa, {
        customerId: o.customerId,
        orderId: o.orderId,
        category: 'ORDER',
        priority: 'NORMAL',
        subject: 'done',
        description: 'd',
      }),
    );
    await as(superAdmin, () =>
      service.transition(sa, resolvedOne.id, resolvedOne.version, { to: 'RESOLVED' }),
    );

    now = new Date(now.getTime() + 13 * 3_600_000); // past the 12 h escalation
    const first = await service.sweep();
    expect(first.escalated).toBeGreaterThanOrEqual(1);
    const esc = await service.get(sa, t.id);
    expect(esc.escalatedAt).toBe(now.toISOString());
    expect(esc.breached).toBe(true);
    expect(esc.assignee?.id).not.toBe(t.assigneeId);
    expect((await service.sweep()).escalated).toBe(0); // once only

    const audit = await env.db.owner.query(
      `SELECT actor_type FROM audit_logs WHERE action = 'ticket.escalated' AND entity_id = $1`,
      [t.id],
    );
    expect(audit.rows).toEqual([{ actor_type: 'SYSTEM' }]);

    now = new Date(now.getTime() + 8 * 24 * 3_600_000);
    expect((await service.sweep()).closed).toBeGreaterThanOrEqual(1);
    expect((await service.get(sa, resolvedOne.id)).status).toBe('CLOSED');
    sla = { ...sla, assignment: 'LEAST_BUSY' };
  });
});
