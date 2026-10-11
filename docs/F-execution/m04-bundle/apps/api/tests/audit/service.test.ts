import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connectPools, pgAuditTx, withTransaction } from './support/db';
import {
  AuditError, InMemoryDeniedRateLimiter, createAudit, record, recordMany, runAsSystem, runWithAuditContext, uuidv7,
} from '../../src/lib/audit';
import type { AuditActor, AuditEntry } from '../../src/lib/audit';

const pools = connectPools();
const { app, owner } = pools;
afterAll(() => pools.close());

const ZONE_A = '0192f1d2-0000-7000-8000-00000000000a';
const ZONE_B = '0192f1d2-0000-7000-8000-00000000000b';
const karthik: AuditActor = { type: 'USER', id: '0192f1d2-0000-7000-8000-0000000000c1', name: 'Karthik M', role: 'ZONAL_ADMIN' };
const asKarthik = <T>(fn: () => Promise<T>) => runWithAuditContext({ actor: karthik, ip: '203.0.113.5', userAgent: 'Chrome 129', requestId: 'req-1' }, fn);

async function rows(where = 'true', params: unknown[] = []) {
  return (await owner.query(`SELECT * FROM audit_logs WHERE ${where} ORDER BY id`, params)).rows as Record<string, any>[];
}
beforeEach(async () => { await owner.query('DELETE FROM test_restaurants'); });

/** A service-shaped function: change + audit in one transaction, exactly as doc 50 §7 prescribes. */
async function changeCommission(id: string, pct: number, opts: { failAfterAudit?: boolean; badEntityId?: string } = {}) {
  return withTransaction(app, async (c) => {
    const before = (await c.query('SELECT * FROM test_restaurants WHERE id=$1', [id])).rows[0] as { name: string; zone_id: string; commission_pct: number };
    await c.query('UPDATE test_restaurants SET commission_pct=$2 WHERE id=$1', [id, pct]);
    await record(pgAuditTx(c), {
      module: 'restaurants', action: 'restaurant.commission_changed',
      entity: { type: 'restaurant', id: opts.badEntityId ?? id, label: before.name, zoneId: before.zone_id },
      before: { commissionPct: before.commission_pct }, after: { commissionPct: pct },
    });
    if (opts.failAfterAudit) throw new Error('boom after audit');
  });
}
async function seedRestaurant(zone = ZONE_A, pct = 15) {
  const id = uuidv7();
  await owner.query('INSERT INTO test_restaurants (id, zone_id, name, commission_pct) VALUES ($1,$2,$3,$4)', [id, zone, 'Annapoorna Mess', pct]);
  return id;
}
const pct = async (id: string) => (await owner.query('SELECT commission_pct FROM test_restaurants WHERE id=$1', [id])).rows[0]!.commission_pct as number;

describe('write path', () => {
  it('TC-AUD-1 a service write produces exactly one audit row with actor, zone, module, action, entity, changes, request context', async () => {
    const id = await seedRestaurant();
    await asKarthik(() => changeCommission(id, 18));
    const r = await rows('entity_id=$1', [id]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      actor_type: 'USER', actor_id: karthik.id, actor_name: 'Karthik M', actor_role: 'ZONAL_ADMIN', zone_id: ZONE_A,
      module: 'restaurants', action: 'restaurant.commission_changed', entity_type: 'restaurant', entity_label: 'Annapoorna Mess',
      outcome: 'SUCCESS', sensitivity: 'HIGH', ip: '203.0.113.5', user_agent: 'Chrome 129', request_id: 'req-1',
      before_json: { commissionPct: 15 }, after_json: { commissionPct: 18 },
    });
    expect(await pct(id)).toBe(18);
  });

  it('TC-AUD-2 business step throws after the audit call: neither the change nor the audit row exists', async () => {
    const id = await seedRestaurant();
    await expect(asKarthik(() => changeCommission(id, 25, { failAfterAudit: true }))).rejects.toThrow('boom after audit');
    expect(await pct(id)).toBe(15);
    expect(await rows('entity_id=$1', [id])).toHaveLength(0);
  });

  it('TC-AUD-3 the audit insert genuinely fails in the database: the business change rolls back (fail closed)', async () => {
    const id = await seedRestaurant();
    const before = (await rows()).length;
    await expect(asKarthik(() => changeCommission(id, 30, { badEntityId: 'not-a-uuid' }))).rejects.toThrow(/uuid/i);
    expect(await pct(id)).toBe(15);
    expect(await rows()).toHaveLength(before);
  });

  it('TC-AUD-4 identical values write no row', async () => {
    const id = await seedRestaurant(ZONE_A, 15);
    await asKarthik(() => changeCommission(id, 15));
    expect(await rows('entity_id=$1', [id])).toHaveLength(0);
  });

  it('secrets never reach the table; phone/email are masked; changed phone is still recorded even if the masked form is equal', async () => {
    const id = uuidv7();
    await asKarthik(() => withTransaction(app, (c) => record(pgAuditTx(c), {
      module: 'restaurants', action: 'restaurant.updated',
      entity: { type: 'restaurant', id, label: 'X', zoneId: ZONE_A },
      before: { phone: '9876541234', email: 'a@x.com', passwordHash: 'old' },
      after: { phone: '9876549999', email: 'a@x.com', passwordHash: 'new' },
    })));
    const [r] = await rows('entity_id=$1', [id]);
    expect(r!.before_json).toEqual({ phone: '98****1234', passwordHash: '[redacted]' });
    expect(r!.after_json).toEqual({ phone: '98****9999', passwordHash: '[redacted]' });
    expect(JSON.stringify(r)).not.toContain('9876541234');
    expect(JSON.stringify(r)).not.toContain('"old"');
  });

  it('event-style actions (reveal) write a row without before/after, and recordMany writes all in one call', async () => {
    const cust = uuidv7();
    await asKarthik(() => withTransaction(app, async (c) => {
      const tx = pgAuditTx(c);
      await record(tx, { module: 'customers', action: 'customer.contact_revealed', entity: { type: 'customer', id: cust, label: 'Meena', zoneId: ZONE_A } });
      await recordMany(tx, [
        { module: 'menu', action: 'menu_item.bulk_updated', entity: { type: 'menu_item', zoneId: ZONE_A }, after: { count: 3 } },
        { module: 'menu', action: 'menu_item.bulk_updated', entity: { type: 'menu_item', zoneId: ZONE_B }, after: { count: 2 } },
      ]);
    }));
    const r = await rows('actor_id=$1', [karthik.id]);
    expect(r.filter((x) => x.action === 'customer.contact_revealed')).toHaveLength(1);
    expect(r.filter((x) => x.action === 'menu_item.bulk_updated')).toHaveLength(2);
    expect(r.find((x) => x.action === 'customer.contact_revealed')!.before_json).toBeNull();
  });

  it('user agent is truncated to 300 chars', async () => {
    const id = uuidv7();
    await runWithAuditContext({ actor: karthik, userAgent: 'U'.repeat(500) }, () => withTransaction(app, (c) => record(pgAuditTx(c), {
      module: 'zones', action: 'zone.updated', entity: { type: 'zone', id, zoneId: null }, after: { name: 'Z' } })));
    const [r] = await rows('entity_id=$1', [id]);
    expect(r!.user_agent).toHaveLength(300);
  });

  it('TC-AUD-16 / system actors: runAsSystem and app clients are recorded with their own actor type and name', async () => {
    const id = uuidv7();
    await runAsSystem('payout-run', () => withTransaction(app, (c) => record(pgAuditTx(c), {
      module: 'system', action: 'job.payout_run', entity: { type: 'job', id, zoneId: null }, after: { payouts: 12 } })));
    const vendorApp: AuditActor = { type: 'APP_CLIENT', id: uuidv7(), name: 'Vendor app', role: null };
    const rid = uuidv7();
    await runWithAuditContext({ actor: vendorApp }, () => withTransaction(app, (c) => record(pgAuditTx(c), {
      module: 'restaurants', action: 'restaurant.created', entity: { type: 'restaurant', id: rid, label: 'New Mess', zoneId: ZONE_B }, after: { name: 'New Mess' } })));
    expect((await rows('entity_id=$1', [id]))[0]).toMatchObject({ actor_type: 'SYSTEM', actor_name: 'System: payout-run', actor_id: null });
    expect((await rows('entity_id=$1', [rid]))[0]).toMatchObject({ actor_type: 'APP_CLIENT', actor_name: 'Vendor app' });
  });

  it('TC-AUD-21 history keeps the actor name as it was when the action happened', async () => {
    const id = uuidv7();
    const write = (name: string) => runWithAuditContext({ actor: { ...karthik, name } }, () => withTransaction(app, (c) => record(pgAuditTx(c), {
      module: 'zones', action: 'zone.updated', entity: { type: 'zone', id, zoneId: null }, after: { n: name } })));
    await write('Karthik M'); await write('Karthik Murugan');
    const r = await rows('entity_id=$1', [id]);
    expect(r.map((x) => x.actor_name)).toEqual(['Karthik M', 'Karthik Murugan']);
  });
});

describe('programmer-error guards (these must throw, never be swallowed)', () => {
  const tx = { auditLog: { create: async () => undefined, createMany: async () => undefined } };
  const base: AuditEntry = { module: 'restaurants', action: 'restaurant.updated', entity: { type: 'restaurant', id: uuidv7(), zoneId: ZONE_A }, after: { a: 1 } };
  it('unknown action', async () => {
    await expect(asKarthik(() => record(tx, { ...base, action: 'restaurant.exploded' as never }))).rejects.toMatchObject({ code: 'UNKNOWN_ACTION' });
  });
  it('module does not match the catalogue', async () => {
    await expect(asKarthik(() => record(tx, { ...base, module: 'orders' }))).rejects.toMatchObject({ code: 'MODULE_MISMATCH' });
  });
  it('no actor outside runAsSystem / request context', async () => {
    await expect(record(tx, base)).rejects.toMatchObject({ code: 'NO_ACTOR' });
  });
  it('zone-owned entity without zoneId', async () => {
    await expect(asKarthik(() => record(tx, { ...base, entity: { type: 'restaurant', id: uuidv7() } }))).rejects.toMatchObject({ code: 'ZONE_REQUIRED' });
    await expect(asKarthik(() => record(tx, { ...base, entity: { type: 'restaurant', id: uuidv7(), zoneId: null } }))).rejects.toMatchObject({ code: 'ZONE_REQUIRED' });
  });
  it('customer must pass zoneId explicitly (uuid or null)', async () => {
    const e: AuditEntry = { module: 'customers', action: 'customer.updated', entity: { type: 'customer', id: uuidv7() }, after: { a: 1 } };
    await expect(asKarthik(() => record(tx, e))).rejects.toBeInstanceOf(AuditError);
    await expect(asKarthik(() => record(tx, { ...e, entity: { ...e.entity, zoneId: null } }))).resolves.toBeUndefined();
  });
});

describe('TC-AUD-20 denied attempts', () => {
  it('6 denied attempts inside a minute write one row; a different action or actor still records; after the window it records again', async () => {
    let now = Date.parse('2026-10-10T10:00:00Z');
    const audit = createAudit({
      deniedLimiter: new InMemoryDeniedRateLimiter(() => now),
      transaction: (fn) => withTransaction(app, (c) => fn(pgAuditTx(c))),
    });
    const attempt = (action: 'access.profile_set' | 'settings.updated', actor: AuditActor = karthik) =>
      runWithAuditContext({ actor }, () => audit.recordDenied({ module: action === 'settings.updated' ? 'settings' : 'access', action, entity: { type: 'access_profile', id: uuidv7(), zoneId: null } }));
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) results.push(await attempt('access.profile_set'));
    expect(results).toEqual([true, false, false, false, false, false]);
    expect(await attempt('settings.updated')).toBe(true);
    expect(await attempt('access.profile_set', { ...karthik, id: uuidv7(), name: 'Priya' })).toBe(true);
    now += 61_000;
    expect(await attempt('access.profile_set')).toBe(true);
    const denied = await rows(`outcome='DENIED' AND actor_id=$1`, [karthik.id]);
    expect(denied.filter((r) => r.action === 'access.profile_set')).toHaveLength(2);
    expect(denied.every((r) => r.outcome === 'DENIED')).toBe(true);
  });

  it('a failure while recording a denied attempt never breaks the caller (returns false, reports)', async () => {
    const seen: unknown[] = [];
    const audit = createAudit({
      deniedLimiter: new InMemoryDeniedRateLimiter(),
      transaction: async () => { throw new Error('db down'); },
      onDeniedFailure: (e) => seen.push(e),
    });
    const ok = await asKarthik(() => audit.recordDenied({ module: 'access', action: 'access.limit_set', entity: { type: 'access_profile', id: uuidv7(), zoneId: null } }));
    expect(ok).toBe(false);
    expect(seen).toHaveLength(1);
  });
});
