import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RewardRules } from '@zoauro/shared';
import { runWithAuditContext } from '../../src/lib/audit';
import type { AuthContext } from '../../src/lib/authz';
import { createOrdersModule } from '../../src/modules/orders';
import { createRewardsModule } from '../../src/modules/rewards';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { seedOrder, seedPartner } from './support';

// D169 on a real database: an order that moves to DELIVERED earns reward points when the zone's loyalty values are
// configured, once (idempotent), and nothing when loyalty is off (D101). The orders service calls the rewards module
// after the delivery committed; a rewards failure never undoes the delivery.

let env: AuthTestEnv;
let superAdmin: TestUser;
let zoneOn: string;
let zoneOff: string;

const RULES: RewardRules = {
  earnRatePercent: 5,
  pointsExpiryDays: 180,
  pointValuePaise: 100,
  minRedeemPoints: 10,
  maxRedeemPercentPerOrder: 20,
  monthlyEarnCapPoints: null,
  walletConversionEnabled: false,
};

const sa = (): AuthContext => ({
  userId: superAdmin.id,
  role: 'SUPER_ADMIN',
  isSuperAdmin: true,
  assignedZoneIds: [],
  permissionsByZone: new Map(),
  limitsByZone: new Map(),
  requestedZoneIds: 'ALL',
});

function ordersWithRewards(onDelivered?: (id: string) => Promise<unknown>) {
  return createOrdersModule({
    prisma: env.prisma,
    appOrigin: 'http://localhost:3000',
    maxConcurrentOrders: async () => 5,
    ...(onDelivered ? { onDelivered } : {}),
    clock: env.clock.now,
  }).service;
}

async function deliver(service: ReturnType<typeof ordersWithRewards>, zoneId: string) {
  const partner = await seedPartner(env, zoneId);
  const o = await seedOrder(env, zoneId, { status: 'OUT_FOR_DELIVERY', partnerId: partner });
  const res = await runWithAuditContext(
    { actor: { type: 'USER', id: superAdmin.id, name: superAdmin.name, role: 'SUPER_ADMIN' } },
    () => service.transition(sa(), o.orderId, 1, { to: 'DELIVERED' }),
  );
  expect(res.status).toBe('DELIVERED');
  return o;
}

const entries = async (orderId: string) =>
  (
    await env.db.owner.query(
      `SELECT type, points FROM reward_point_entries WHERE order_id = $1 ORDER BY created_at`,
      [orderId],
    )
  ).rows as { type: string; points: number }[];
const points = async (customerId: string) =>
  (
    (await env.db.owner.query(`SELECT reward_points FROM customers WHERE id = $1`, [customerId]))
      .rows[0] as { reward_points: number }
  ).reward_points;

beforeAll(async () => {
  env = await createAuthTestEnv();
  superAdmin = await env.createUser('SUPER_ADMIN');
  zoneOn = await env.createZone();
  zoneOff = await env.createZone();
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('DELIVERED earns reward points (D169)', () => {
  const rewards = () =>
    createRewardsModule({
      prisma: env.prisma,
      appOrigin: 'http://localhost:3000',
      rules: async (zoneId) => (zoneId === zoneOn ? RULES : null),
      clock: env.clock.now,
    }).service;

  it('credits the points once when loyalty is configured in the zone', async () => {
    const r = rewards();
    const o = await deliver(
      ordersWithRewards((id) => r.earnForDeliveredOrder(id)),
      zoneOn,
    );
    const earned = await entries(o.orderId);
    expect(earned).toHaveLength(1);
    expect(earned[0]?.type).toBe('ORDER_EARN');
    expect(earned[0]?.points ?? 0).toBeGreaterThan(0);
    expect(await points(o.customerId)).toBe(earned[0]?.points);
    // a second call (retry) credits nothing more
    expect(await r.earnForDeliveredOrder(o.orderId)).toBe(0);
    expect(await entries(o.orderId)).toHaveLength(1);
  });

  it('credits nothing when loyalty is off (D101)', async () => {
    const r = rewards();
    const o = await deliver(
      ordersWithRewards((id) => r.earnForDeliveredOrder(id)),
      zoneOff,
    );
    expect(await entries(o.orderId)).toEqual([]);
    expect(await points(o.customerId)).toBe(0);
  });

  it('a failing rewards call never undoes the delivery', async () => {
    const o = await deliver(
      ordersWithRewards(() => Promise.reject(new Error('rewards down'))),
      zoneOn,
    );
    const r = await env.db.owner.query(`SELECT status FROM orders WHERE id = $1`, [o.orderId]);
    expect((r.rows[0] as { status: string }).status).toBe('DELIVERED');
  });
});
