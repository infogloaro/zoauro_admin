import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ZoneDto } from '@zoauro/shared';
import { createPrismaClient } from '../../src/lib/db';
import { createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';
import {
  client,
  countingCache,
  createZone,
  nextCode,
  outboxRows,
  pins,
  reauth,
  zoneAuditRows,
  zoneBody,
  type Signed,
} from './support';

// P11 (doc 56) / doc 53 sections 2.5, 2.6 (R-ZONE-2, R-ZONE-10), 3, 4: integrity of zone writes.
// TC-ZONE-7 (two connections, one pincode), TC-ZONE-24 (outbox), TC-ZONE-25 (audit), rollback and the cache counter.

let env: AuthTestEnv;
let app: Express;
let cache: ReturnType<typeof countingCache>;
let sa: Signed;
const second = { prisma: undefined as ReturnType<typeof createPrismaClient> | undefined };

beforeAll(async () => {
  env = await createAuthTestEnv();
  cache = countingCache();
  ({ app } = env.makeAuthzApp({ zones: { cache } }));
  const s = await env.session(await env.createUser('SUPER_ADMIN'));
  sa = { cookie: s.cookie, csrf: s.csrf };
  await reauth(env, sa);
}, 180_000);
afterAll(async () => {
  await second.prisma?.$disconnect();
  await env.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('TC-ZONE-7: one pincode, two writers', () => {
  it('two concurrent creates on two connection pools: exactly one wins, the other gets PINCODE_OVERLAP', async () => {
    second.prisma = createPrismaClient(env.db.appUrl);
    const { app: app2 } = env.makeAuthzApp({ zones: { prisma: second.prisma, cache } });
    for (let round = 0; round < 5; round += 1) {
      const [p] = pins(1);
      const [r1, r2] = await Promise.all([
        client(sa, app).post('/zones', zoneBody({ pincodes: [p] })),
        client(sa, app2).post('/zones', zoneBody({ pincodes: [p] })),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([201, 409]);
      const loser = r1.status === 409 ? r1 : r2;
      const winner = r1.status === 201 ? r1 : r2;
      expect(loser.body.error.code).toBe('PINCODE_OVERLAP');
      expect(loser.body.error.meta.conflicts).toEqual([
        { pincode: p, zoneId: winner.body.id, zoneName: winner.body.name },
      ]);
      const rows = await env.db.owner.query(
        `SELECT count(*)::int AS n FROM serviceable_pincodes WHERE pincode = $1`,
        [p],
      );
      expect(rows.rows[0].n).toBe(1);
    }
  });

  it('a writer waits for the advisory lock, then sees the committed pincode and names its zone', async () => {
    const [p] = pins(1);
    const holder = await env.db.owner.connect();
    const aId = uuidv7();
    const aName = `Lock holder ${nextCode()}`;
    let settled = false;
    try {
      await holder.query('BEGIN');
      // another Super Admin's pincode change, half way through its transaction
      await holder.query(`SELECT pg_advisory_xact_lock(hashtext('zones.pincodes'))`);
      await holder.query(
        `INSERT INTO zones (id, name, code, city, color_hex, updated_at) VALUES ($1, $2, $3, 'Chennai', '#2563EB', now())`,
        [aId, aName, nextCode()],
      );
      await holder.query(
        `INSERT INTO serviceable_pincodes (id, zone_id, pincode, source, updated_at) VALUES ($1, $2, $3, 'MANUAL', now())`,
        [uuidv7(), aId, p],
      );
      const pending = client(sa, app)
        .post('/zones', zoneBody({ pincodes: [p] }))
        .then((r) => {
          settled = true;
          return r;
        });
      await sleep(700);
      expect(settled, 'the second writer must wait for the lock').toBe(false);
      await holder.query('COMMIT');
      const r = await pending;
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('PINCODE_OVERLAP');
      // the overlap check (not the unique index) refused it: it names the owning zone
      expect(r.body.error.meta.conflicts).toEqual([{ pincode: p, zoneId: aId, zoneName: aName }]);
    } finally {
      if (!settled) await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  });
});

describe('TC-ZONE-24 / 25: each change writes one audit row (its own action), two outbox rows, then bumps the cache', () => {
  it('create, edit, charge, pincodes, activate, deactivate, reactivate, delete', async () => {
    const steps: {
      label: string;
      run: (z: ZoneDto) => Promise<ZoneDto | null>;
      audit: { action: string; sensitivity: string }[];
      change: string;
    }[] = [];
    let zone = await createZone(sa, app, { pincodes: pins(2) });
    const bumps0 = cache.bumps;
    expect(await outboxRows(env, zone.id)).toHaveLength(2);
    expect(await zoneAuditRows(env, zone.id)).toMatchObject([
      { action: 'zone.created', sensitivity: 'NORMAL', zone_id: zone.id, entity_type: 'zone' },
    ]);

    const ok = async (r: { status: number; body: unknown }) => {
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body as ZoneDto;
    };
    steps.push(
      {
        label: 'edit name and colour',
        run: async (z) =>
          ok(
            await client(sa, app).patch(`/zones/${z.id}`, {
              version: z.version,
              name: `${z.name} North`,
              colorHex: '#DC2626',
            }),
          ),
        audit: [{ action: 'zone.updated', sensitivity: 'NORMAL' }],
        change: 'updated',
      },
      {
        label: 'delivery charge',
        run: async (z) =>
          ok(
            await client(sa, app).patch(`/zones/${z.id}`, {
              version: z.version,
              deliveryChargePaise: 3900,
            }),
          ),
        audit: [{ action: 'zone.delivery_charge_changed', sensitivity: 'HIGH' }],
        change: 'delivery_charge_changed',
      },
      {
        label: 'pincodes',
        run: async (z) => {
          const r = await client(sa, app).put(`/zones/${z.id}/pincodes`, { add: pins(3) });
          expect(r.status).toBe(200);
          return r.body.zone as ZoneDto;
        },
        audit: [{ action: 'zone.pincodes_changed', sensitivity: 'HIGH' }],
        change: 'pincodes_changed',
      },
      {
        label: 'activate',
        run: async (z) =>
          ok(await client(sa, app).post(`/zones/${z.id}/activate`, { version: z.version })),
        audit: [{ action: 'zone.activated', sensitivity: 'NORMAL' }],
        change: 'activated',
      },
      {
        label: 'deactivate',
        run: async (z) => {
          const iv = (await client(sa, app).get(`/zones/${z.id}/impact`)).body.impactVersion;
          return ok(
            await client(sa, app).post(`/zones/${z.id}/deactivate`, {
              version: z.version,
              impactVersion: iv,
              reason: 'Rider shortage this week',
            }),
          );
        },
        audit: [{ action: 'zone.deactivated', sensitivity: 'HIGH' }],
        change: 'deactivated',
      },
      {
        label: 'reactivate',
        run: async (z) =>
          ok(await client(sa, app).post(`/zones/${z.id}/activate`, { version: z.version })),
        audit: [{ action: 'zone.activated', sensitivity: 'NORMAL' }],
        change: 'activated',
      },
    );

    for (const step of steps) {
      const outBefore = (await outboxRows(env, zone.id)).length;
      const auditBefore = (await zoneAuditRows(env, zone.id)).length;
      const bumpsBefore = cache.bumps;
      const next = await step.run(zone);
      if (!next) throw new Error(step.label);
      const out = (await outboxRows(env, zone.id)).slice(outBefore);
      expect(
        out.map((o) => o.event_type),
        step.label,
      ).toEqual(['zone.updated', 'admin.zones_changed']);
      // the catalogue payload, exactly (contracts/events.catalog.json)
      const updated = out[0]?.payload_json as {
        data: Record<string, unknown>;
        aggregate: { version: number };
      };
      expect(Object.keys(updated.data).sort(), step.label).toEqual([
        'deliveryChargePaise',
        'name',
        'pincodeRange',
        'status',
        'zoneId',
      ]);
      expect(updated.data).toMatchObject({
        zoneId: next.id,
        name: next.name,
        status: next.status,
        deliveryChargePaise: next.deliveryChargePaise,
        pincodeRange: 'multiple',
      });
      expect(updated.aggregate.version).toBe(next.version);
      expect((out[1]?.payload_json as { data: unknown }).data).toEqual({
        zoneId: next.id,
        change: step.change,
      });
      const audit = (await zoneAuditRows(env, zone.id)).slice(auditBefore);
      expect(
        audit.map((a) => ({ action: a.action, sensitivity: a.sensitivity })),
        step.label,
      ).toEqual(step.audit);
      expect(audit.every((a) => a.zone_id === zone.id)).toBe(true);
      expect(cache.bumps, step.label).toBe(bumpsBefore + 1);
      zone = next;
    }
    expect(cache.bumps).toBe(bumps0 + steps.length);

    // the audit details doc 53 section 4 asks for
    const rows = await zoneAuditRows(env, zone.id);
    const charge = rows.find((r) => r.action === 'zone.delivery_charge_changed');
    expect(charge?.before_json).toEqual({ deliveryChargePaise: 2500 });
    expect(charge?.after_json).toEqual({ deliveryChargePaise: 3900 });
    const pin = rows.find((r) => r.action === 'zone.pincodes_changed');
    expect(pin?.after_json).toMatchObject({ added: 3, pincodeCount: 5 });
    const off = rows.find((r) => r.action === 'zone.deactivated');
    expect(off?.note).toBe('Rider shortage this week');
    expect(off?.after_json).toMatchObject({ status: 'INACTIVE' });
    // a name edit is zone.updated without the charge; a charge edit is not zone.updated
    expect(rows.find((r) => r.action === 'zone.updated')?.after_json).not.toHaveProperty(
      'deliveryChargePaise',
    );

    // delete (a pristine, not live zone)
    const iv = (await client(sa, app).get(`/zones/${zone.id}/impact`)).body.impactVersion;
    const offAgain = await client(sa, app).post(`/zones/${zone.id}/deactivate`, {
      version: zone.version,
      impactVersion: iv,
      reason: 'Merged into another zone',
    });
    expect(offAgain.status).toBe(200);
    const outBefore = (await outboxRows(env, zone.id)).length;
    const del = await client(sa, app).delete(`/zones/${zone.id}`);
    expect(del.status).toBe(204);
    const out = (await outboxRows(env, zone.id)).slice(outBefore);
    expect(out.map((o) => o.event_type)).toEqual(['zone.updated', 'admin.zones_changed']);
    expect((out[0]?.payload_json as { data: unknown }).data).toMatchObject({
      status: 'INACTIVE',
      pincodeRange: '',
    });
    expect((out[1]?.payload_json as { data: unknown }).data).toEqual({
      zoneId: zone.id,
      change: 'deleted',
    });
    const last = (await zoneAuditRows(env, zone.id)).at(-1);
    expect(last).toMatchObject({ action: 'zone.deleted', zone_id: zone.id });
    expect(last?.after_json).toMatchObject({ pincodesReleased: 5 });
  });

  it('pincodeRange carries the range when the zone is defined by it alone', async () => {
    const r = pins(10);
    const z = await createZone(sa, app, { pincodeFrom: r[0], pincodeTo: r[9] });
    const out = await outboxRows(env, z.id);
    expect((out[0]?.payload_json as { data: { pincodeRange: string } }).data.pincodeRange).toBe(
      `${r[0]}-${r[9]}`,
    );
  });

  it('a refused write (409, 422) writes no audit row, no outbox row and does not bump the cache', async () => {
    const z = await createZone(sa, app, { pincodes: pins(1) });
    const outBefore = await outboxRows(env, z.id);
    const auditBefore = await zoneAuditRows(env, z.id);
    const bumps = cache.bumps;
    expect(
      (await client(sa, app).patch(`/zones/${z.id}`, { version: z.version + 5, city: 'X' })).status,
    ).toBe(409);
    expect((await client(sa, app).post(`/zones/${z.id}/activate`, { version: 99 })).status).toBe(
      409,
    );
    const other = await createZone(sa, app, { pincodes: pins(1) });
    const taken = (await client(sa, app).get(`/zones/${other.id}?pincodePageSize=1`)).body.pincodes
      .data[0].pincode as string;
    expect((await client(sa, app).put(`/zones/${z.id}/pincodes`, { add: [taken] })).status).toBe(
      409,
    );
    expect(await outboxRows(env, z.id)).toEqual(outBefore);
    expect(await zoneAuditRows(env, z.id)).toEqual(auditBefore);
    expect(cache.bumps).toBe(bumps + 1); // only the create of `other`
  });

  it('rollback: when the outbox insert fails, the zone, its pincodes and its audit row are not written either', async () => {
    await env.db.owner.query(`
      CREATE FUNCTION test_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.payload_json -> 'data' ->> 'name' = 'Rollback Probe' THEN RAISE EXCEPTION 'probe'; END IF;
        RETURN NEW;
      END $$`);
    await env.db.owner.query(
      `CREATE TRIGGER test_fail_outbox BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION test_fail_outbox()`,
    );
    try {
      const probePins = pins(2);
      const body = zoneBody({ name: 'Rollback Probe', pincodes: probePins });
      const bumps = cache.bumps;
      const r = await client(sa, app).post('/zones', body);
      expect(r.status).toBe(500);
      const zones = await env.db.owner.query(`SELECT id FROM zones WHERE code = $1`, [body.code]);
      expect(zones.rows).toEqual([]);
      const pinsLeft = await env.db.owner.query(
        `SELECT count(*)::int AS n FROM serviceable_pincodes WHERE pincode = ANY($1)`,
        [probePins],
      );
      expect(pinsLeft.rows[0].n).toBe(0);
      const audit = await env.db.owner.query(
        `SELECT count(*)::int AS n FROM audit_logs WHERE entity_label = 'Rollback Probe'`,
      );
      expect(audit.rows[0].n).toBe(0);
      expect(cache.bumps).toBe(bumps);
    } finally {
      await env.db.owner.query(`DROP TRIGGER test_fail_outbox ON outbox`);
      await env.db.owner.query(`DROP FUNCTION test_fail_outbox()`);
    }
  });
});
