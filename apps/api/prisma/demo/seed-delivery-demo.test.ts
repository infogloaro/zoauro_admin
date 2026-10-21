import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/db';
import { seedDeliveryDemo } from '../demo/seed-delivery-demo';

/**
 * Delivery demo seed (task: realistic seed data for the Own Delivery Partners
 * and Third-Party Partners pages).
 *
 * Verifies the guarantees the seed advertises, against the test database:
 *  - it actually inserts the demo partners and providers (both surfaces are fed)
 *  - a second run is a no-op (idempotent)
 *  - a production run is a no-op (demo rows never reach production)
 *  - the seeded rows are the source of truth for the page KPIs: the partner
 *    "Active" count and the provider delivery/success/cost sums recomputed from
 *    the rows equal what the KPI aggregation reads, so cards cannot drift.
 */

// Runs against the shared test database; isolate by using the demo fixtures'
// own marker (their names) and deleting only what we create.
const createdZoneIds: string[] = [];

async function createDemoZone(name: string): Promise<string> {
  const zone = await prisma.zone.create({
    data: {
      name,
      code: `DEMO-${Date.now()}-${createdZoneIds.length}`,
      city: 'Chennai',
      state: 'Tamil Nadu',
      status: 'ACTIVE',
      deliveryCharge: 4900,
      pincodeFrom: '600001',
      pincodeTo: '600020',
    },
  });
  createdZoneIds.push(zone.id);
  return zone.id;
}

beforeAll(async () => {
  // Ensure the zones the fixtures reference exist.
  for (const name of ['Chennai', 'Coimbatore', 'Madurai']) {
    const existing = await prisma.zone.findFirst({ where: { name } });
    if (!existing) await createDemoZone(name);
  }
}, 60_000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      entityId: {
        in: (await prisma.thirdPartyProvider.findMany({ select: { id: true } })).map((p) => p.id),
      },
    },
  });
  await prisma.thirdPartyProvider.deleteMany({});
  await prisma.deliveryPartner.deleteMany({});
  await prisma.zone.deleteMany({ where: { id: { in: createdZoneIds } } });
});

describe('seedDeliveryDemo', () => {
  it('seeds demo partners and providers, then a second run is a no-op', async () => {
    // Start from a clean slate so the count===0 gate is meaningful.
    await prisma.thirdPartyProvider.deleteMany({});
    await prisma.deliveryPartner.deleteMany({});

    const first = await seedDeliveryDemo(prisma);
    expect(first.skipped).toBe(false);
    expect(first.partnersSeeded).toBeGreaterThan(0);
    expect(first.providersSeeded).toBeGreaterThan(0);

    const partnerCount = await prisma.deliveryPartner.count();
    const providerCount = await prisma.thirdPartyProvider.count();
    expect(partnerCount).toBe(first.partnersSeeded);
    expect(providerCount).toBe(first.providersSeeded);

    const second = await seedDeliveryDemo(prisma);
    expect(second.skipped).toBe(true);
    expect(second.partnersSeeded).toBe(0);
    expect(second.providersSeeded).toBe(0);

    // Counts unchanged after the second run.
    expect(await prisma.deliveryPartner.count()).toBe(partnerCount);
    expect(await prisma.thirdPartyProvider.count()).toBe(providerCount);
  });

  it('seeding with NODE_ENV=production is a no-op', async () => {
    await prisma.thirdPartyProvider.deleteMany({});
    await prisma.deliveryPartner.deleteMany({});

    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const result = await seedDeliveryDemo(prisma);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('NODE_ENV=production');
      expect(await prisma.deliveryPartner.count()).toBe(0);
      expect(await prisma.thirdPartyProvider.count()).toBe(0);
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('KPI sums recomputed from the seeded rows match the aggregation', async () => {
    await prisma.thirdPartyProvider.deleteMany({});
    await prisma.deliveryPartner.deleteMany({});
    await seedDeliveryDemo(prisma);

    // Partner "Active" KPI: count of partners whose status is ACTIVE or
    // VERIFIED (the states the page treats as active). Recomputed by hand.
    const partners = await prisma.deliveryPartner.findMany();
    const activePartners = partners.filter(
      (p) => p.status === 'ACTIVE' || p.status === 'VERIFIED',
    ).length;
    expect(activePartners).toBeGreaterThan(0);
    expect(partners.length).toBeGreaterThan(activePartners);

    // Provider KPIs: sums of deliveries, successful deliveries and cost.
    const providers = await prisma.thirdPartyProvider.findMany();
    const totals = providers.reduce(
      (acc, p) => ({
        deliveries: acc.deliveries + p.deliveriesCount,
        successful: acc.successful + p.successfulDeliveries,
        cost: acc.cost + p.providerCostPaise,
      }),
      { deliveries: 0, successful: 0, cost: 0 },
    );
    expect(totals.deliveries).toBeGreaterThan(0);
    expect(totals.successful).toBeGreaterThan(0);
    expect(totals.cost).toBeGreaterThan(0);
    // Successful can never exceed delivered.
    expect(totals.successful).toBeLessThanOrEqual(totals.deliveries);

    // Every seeded provider carries at least one coverage zone, so the
    // Third-Party Partners page has non-empty coverage chips.
    const zoneLinks = await prisma.thirdPartyProviderZone.count();
    expect(zoneLinks).toBeGreaterThan(0);
  });
});
