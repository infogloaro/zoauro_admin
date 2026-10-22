import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectPools, pgAuditTx, withTransaction } from './support/db';
import { record, runWithAuditContext, uuidv7 } from '../../src/lib/audit';
import type { AuditActor } from '../../src/lib/audit';
import { auditListQuerySchema } from '../../src/lib/audit/shared';
import type { AuditActionKey, AuditModule } from '../../src/lib/audit/shared';
import {
  canSeeRow, entityModeNotFound, matchesPredicate, planAuditList, toDetail, toListItem, zonalPredicate,
} from '../../src/modules/audit';
import type { AuditDbRow, AuditViewer, ZonalPredicate } from '../../src/modules/audit';

const pools = connectPools();
const { app, owner } = pools;
afterAll(() => pools.close());

const A = '0192f1d2-0000-7000-8000-00000000a001'; const B = '0192f1d2-0000-7000-8000-00000000b002'; const C = '0192f1d2-0000-7000-8000-00000000c003';

/** viewer built from {zone → granted permissions}; mirrors can()/zonesFor() of doc 14 §4 */
function zonal(grants: Record<string, string[]>): AuditViewer {
  return {
    role: 'ZONAL_ADMIN',
    can: (p, z) => grants[z]?.includes(p) ?? false,
    zonesFor: (p) => Object.entries(grants).filter(([, ps]) => ps.includes(p)).map(([z]) => z),
  };
}
const superAdmin: AuditViewer = { role: 'SUPER_ADMIN', can: () => true, zonesFor: () => [] };

const actor: AuditActor = { type: 'USER', id: uuidv7(), name: 'Seeder', role: 'SUPER_ADMIN' };
const seed: { module: AuditModule; action: AuditActionKey; type: string; zone: string | null; id: string }[] = [];
async function add(module: AuditModule, action: AuditActionKey, type: string, zone: string | null) {
  const id = uuidv7();
  await runWithAuditContext({ actor, ip: '10.0.0.1', userAgent: 'UA', requestId: 'r' }, () => withTransaction(app, (c) => record(pgAuditTx(c), {
    module, action, entity: { type, id, zoneId: zone }, after: { x: 1 } })));
  seed.push({ module, action, type, zone, id });
}
beforeAll(async () => {
  for (const z of [A, B, C]) {
    await add('restaurants', 'restaurant.updated', 'restaurant', z);
    await add('orders', 'order.marked_delayed', 'order', z);
    await add('menu', 'menu_item.updated', 'menu_item', z);
    await add('payments', 'reconciliation.mismatch_ack', 'payment', z);
    await add('access', 'access.profile_set', 'member', z);
  }
  await add('settings', 'settings.updated', 'setting', null);
  await add('zones', 'zone.updated', 'zone', null);
  await add('integrations', 'integration_client.created', 'api_client', null);
  await add('customers', 'customer.updated', 'customer', null); // zone-less row (customer with no resolvable zone)
});

function sqlFor(pred: ZonalPredicate): { where: string; params: unknown[] } {
  if (pred.length === 0) return { where: 'false', params: [] };
  const params: unknown[] = [];
  const parts = pred.map((p) => { params.push(p.module, p.zoneIds); return `(module = $${params.length - 1} AND zone_id = ANY($${params.length}::uuid[]))`; });
  return { where: parts.join(' OR '), params };
}
async function visibleIds(pred: ZonalPredicate): Promise<Set<string>> {
  const { where, params } = sqlFor(pred);
  const ids = new Set(seed.map((s) => s.id));
  const r = await owner.query(`SELECT entity_id FROM audit_logs WHERE entity_id = ANY($${params.length + 1}::uuid[]) AND (${where})`, [...params, [...ids]]);
  return new Set(r.rows.map((x: { entity_id: string }) => x.entity_id));
}

const viewers: [string, AuditViewer][] = [
  ['A full (restaurants+orders+menu+payments)', zonal({ [A]: ['restaurants:view', 'orders:view', 'menu:view', 'payments:view', 'customers:view'] })],
  ['A+B: full in A, read-only restaurants in B', zonal({ [A]: ['restaurants:view', 'orders:view', 'menu:view'], [B]: ['restaurants:view'] })],
  ['A with payments denied', zonal({ [A]: ['restaurants:view', 'orders:view', 'menu:view'] })],
  ['none', zonal({})],
  ['tries to hold access/settings view (must still see nothing hidden)', zonal({ [A]: ['access:view', 'settings:view', 'zones:view', 'integrations:view', 'audit:view'] })],
];

describe('visibility (TC-AUD-9…13)', () => {
  it.each(viewers)('SQL predicate and canSeeRow agree for viewer %s', async (_n, v) => {
    const expected = new Set(seed.filter((s) => canSeeRow(v, { module: s.module, zoneId: s.zone })).map((s) => s.id));
    expect(await visibleIds(zonalPredicate(v))).toEqual(expected);
    for (const s of seed) expect(matchesPredicate(zonalPredicate(v), { module: s.module, zoneId: s.zone })).toBe(expected.has(s.id));
  });
  it('TC-AUD-10/11 member sees only rows of modules and zones they can view', () => {
    const v = viewers[1]![1];
    const seen = seed.filter((s) => canSeeRow(v, { module: s.module, zoneId: s.zone }));
    expect(seen.every((s) => (s.zone === A && ['restaurants', 'orders', 'menu'].includes(s.module)) || (s.zone === B && s.module === 'restaurants'))).toBe(true);
    expect(seen.some((s) => s.zone === C)).toBe(false);
  });
  it('TC-AUD-12 a deny override on restaurants:view in A hides that zone for that module', () => {
    const v = zonal({ [A]: ['orders:view'] });
    expect(canSeeRow(v, { module: 'restaurants', zoneId: A })).toBe(false);
    expect(canSeeRow(v, { module: 'orders', zoneId: A })).toBe(true);
  });
  it('TC-AUD-13 hidden modules and zone-less rows are never visible to a Zonal member, whatever they hold', () => {
    const v = viewers[4]![1];
    for (const m of ['access', 'settings', 'zones', 'integrations', 'audit', 'admins', 'auth', 'system'] as const) expect(canSeeRow(v, { module: m, zoneId: A })).toBe(false);
    expect(canSeeRow(zonal({ [A]: ['restaurants:view'] }), { module: 'restaurants', zoneId: null })).toBe(false);
    expect(zonalPredicate(v)).toEqual([]);
  });
  it('Super Admin sees everything', () => { expect(canSeeRow(superAdmin, { module: 'settings', zoneId: null })).toBe(true); });
});

describe('list planning (TC-AUD-9, entity mode)', () => {
  const q = (o: Record<string, unknown>) => auditListQuerySchema.parse(o);
  it('Zonal without entity mode → 403, also when only one of entityType/entityId is given', () => {
    expect(planAuditList(viewers[0]![1], q({}))).toMatchObject({ allowed: false, status: 403 });
    expect(planAuditList(viewers[0]![1], q({ entityType: 'restaurant' }))).toMatchObject({ allowed: false, status: 403 });
  });
  it('Zonal in entity mode keeps only paging and date filters; other filters are dropped', () => {
    const id = uuidv7();
    const plan = planAuditList(viewers[0]![1], q({ entityType: 'restaurant', entityId: id, actorId: uuidv7(), module: 'access', sensitivity: 'HIGH', q: 'x', limit: '10' }));
    expect(plan).toMatchObject({ allowed: true, mode: 'ENTITY' });
    if (plan.allowed && plan.mode === 'ENTITY') {
      expect(Object.keys(plan.filters).filter((k) => (plan.filters as Record<string, unknown>)[k] !== undefined).sort()).toEqual(['entityId', 'entityType', 'limit']);
      expect(plan.filters.limit).toBe(10);
    }
  });
  it('Super Admin keeps all filters', () => {
    const plan = planAuditList(superAdmin, q({ module: 'orders', sensitivity: 'HIGH' }));
    expect(plan).toMatchObject({ allowed: true, mode: 'ALL' });
  });
  it('empty first page in entity mode for a Zonal viewer is 404; a later empty page is not', () => {
    const plan = planAuditList(viewers[0]![1], q({ entityType: 'restaurant', entityId: uuidv7() }));
    expect(entityModeNotFound(plan, 0)).toBe(true);
    expect(entityModeNotFound(plan, 3)).toBe(false);
    const later = planAuditList(viewers[0]![1], q({ entityType: 'restaurant', entityId: uuidv7(), after: uuidv7() }));
    expect(entityModeNotFound(later, 0)).toBe(false);
  });
  it('query validation: limit capped at 100, bad dates rejected, zoneId repeatable', () => {
    expect(() => q({ limit: '101' })).toThrow();
    expect(() => q({ from: 'yesterday' })).toThrow();
    expect(() => q({ from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' })).toThrow();
    expect(q({ zoneId: A }).zoneId).toEqual([A]);
    expect(q({ zoneId: [A, B] }).zoneId).toEqual([A, B]);
  });
});

describe('mapper (TC-AUD-10: no IP/device/request id for Zonal)', () => {
  const row: AuditDbRow = {
    id: uuidv7(), createdAt: new Date('2026-10-10T07:25:03Z'), actorType: 'USER', actorId: uuidv7(), actorName: 'Karthik M', actorRole: 'ZONAL_ADMIN',
    zoneId: A, module: 'restaurants', action: 'restaurant.commission_changed', entityType: 'restaurant', entityId: uuidv7(), entityLabel: 'Annapoorna Mess',
    outcome: 'SUCCESS', sensitivity: 'HIGH', beforeJson: { commissionPct: 15, hours: { close: '22:00' } }, afterJson: { commissionPct: 18, hours: { close: '23:00' } },
    note: null, ip: '203.0.113.5', userAgent: 'Chrome', requestId: 'req-9',
  };
  const names = new Map([[A, 'Coimbatore']]);
  it('Super Admin gets technical fields', () => {
    const d = toDetail(row, { viewerIsSuperAdmin: true, zoneNames: names });
    expect(d).toMatchObject({ ip: '203.0.113.5', userAgent: 'Chrome', requestId: 'req-9', actionLabel: 'Changed commission', zone: { id: A, name: 'Coimbatore' } });
    expect(d.changes).toEqual([
      { field: 'commissionPct', before: 15, after: 18 },
      { field: 'hours.close', before: '22:00', after: '23:00' },
    ]);
  });
  it('Zonal member never receives ip, userAgent or requestId (keys absent, not null)', () => {
    const i = toListItem(row, { viewerIsSuperAdmin: false, zoneNames: names });
    expect('ip' in i).toBe(false); expect('userAgent' in i).toBe(false); expect('requestId' in i).toBe(false);
    expect(JSON.stringify(i)).not.toContain('203.0.113.5');
    expect(i.changedFields).toEqual(['commissionPct', 'hours.close']);
  });
});

describe('TC-AUD-15 cursor pagination', () => {
  it('ids sort identically in JavaScript and PostgreSQL; paging while new rows arrive gives no duplicates, no gaps, strictly descending ids', async () => {
    const tag = uuidv7();
    const insert = async (n: number) => {
      await Promise.all(Array.from({ length: n }, () => runWithAuditContext({ actor: { ...actor, name: `pager-${tag}` } }, () => withTransaction(app, (c) => record(pgAuditTx(c), {
        module: 'zones', action: 'zone.updated', entity: { type: 'zone', id: uuidv7(), zoneId: null }, after: { n: Math.random() } })))));
    };
    await insert(120);
    const page = async (after?: string) => (await owner.query(
      `SELECT id FROM audit_logs WHERE actor_name = $1 ${after ? 'AND id < $3' : ''} ORDER BY id DESC LIMIT $2`, after ? [`pager-${tag}`, 25, after] : [`pager-${tag}`, 25])).rows.map((r: { id: string }) => r.id);
    const seen: string[] = []; let cursor: string | undefined; let injected = false;
    for (;;) {
      const ids = await page(cursor);
      if (ids.length === 0) break;
      seen.push(...ids); cursor = ids[ids.length - 1];
      if (!injected) { injected = true; await insert(30); } // newer rows appear mid-paging: they sort above the cursor and must not disturb it
    }
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    for (let i = 1; i < seen.length; i++) expect(seen[i]! < seen[i - 1]!).toBe(true);
    const jsSorted = [...seen].sort().reverse();
    expect(seen).toEqual(jsSorted);
  });
});
