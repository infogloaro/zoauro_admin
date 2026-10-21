import type { PrismaClient } from '@prisma/client';
import {
  DEMO_PARTNER_AREAS,
  DEMO_PARTNERS,
  DEMO_PROVIDERS,
  type DemoPartner,
  type DemoProvider,
} from './delivery-demo-fixtures';

export { DEMO_PARTNER_AREAS, DEMO_PARTNERS, DEMO_PROVIDERS, type DemoPartner, type DemoProvider };

/** The Tamil Nadu zones the demo fixtures reference by name. */
const DEMO_ZONE_NAMES = ['Chennai', 'Coimbatore', 'Madurai'] as const;

export interface DeliveryDemoSeedResult {
  partnersSeeded: number;
  providersSeeded: number;
  /** True when the section did nothing: production env, or data already present. */
  skipped: boolean;
  reason?: string;
}

/**
 * Seeds the fictional demo rows behind the Own Delivery Partners and
 * Third-Party Partners pages (task: realistic seed data).
 *
 * Design notes the seed test asserts:
 *  - Deterministic: values are fixed constants, never random, so KPI cards
 *    always agree with the rows they sum.
 *  - Idempotent: gated on `deliveryPartner.count() === 0`, matching the other
 *    fixture sections, so a re-run never duplicates or errors.
 *  - Production-safe: a `NODE_ENV === 'production'` run never creates demo
 *    records (task requirement).
 *  - Zone-scoped: a fixture whose zone is absent is silently dropped rather
 *    than failing the whole seed, so a partial zone set still seeds.
 *
 * Accepts the client to use so the test can point it at its own database.
 */
export async function seedDeliveryDemo(prisma: PrismaClient): Promise<DeliveryDemoSeedResult> {
  if (process.env.NODE_ENV === 'production') {
    return {
      partnersSeeded: 0,
      providersSeeded: 0,
      skipped: true,
      reason: 'NODE_ENV=production',
    };
  }

  const existingPartners = await prisma.deliveryPartner.count();
  const existingProviders = await prisma.thirdPartyProvider.count();

  const zoneByName = new Map<string, string>(
    await prisma.zone
      .findMany({ where: { name: { in: [...DEMO_ZONE_NAMES] } } })
      .then((rows) => rows.map((z) => [z.name, z.id])),
  );

  let partnersSeeded = 0;
  if (existingPartners === 0) {
    const partnerRows = DEMO_PARTNERS.filter((p) => zoneByName.has(p.zoneName)).map((p) =>
      partnerRow(p, zoneByName.get(p.zoneName) as string),
    );
    if (partnerRows.length > 0) {
      await prisma.deliveryPartner.createMany({ data: partnerRows });
      partnersSeeded = partnerRows.length;
    }
  }

  // Providers are created one-by-one because each carries nested coverage rows.
  // Gated on their own table so a seed can populate the two pages independently:
  // a database that already has own partners but no providers still gets rows.
  let providersSeeded = 0;
  if (existingProviders === 0) {
    const providerRows = DEMO_PROVIDERS.filter((p) => p.zoneNames.every((n) => zoneByName.has(n)));
    for (const p of providerRows) {
      await prisma.thirdPartyProvider.create({
        data: providerRow(p, zoneByName),
      });
      providersSeeded += 1;
    }
  }

  const skipped =
    existingPartners > 0 && existingProviders > 0 && partnersSeeded === 0 && providersSeeded === 0;
  return {
    partnersSeeded,
    providersSeeded,
    skipped,
    ...(skipped
      ? {
          reason: `${existingPartners} delivery-partner and ${existingProviders} provider records already present`,
        }
      : {}),
  };
}

function partnerRow(p: DemoPartner, zoneId: string) {
  return {
    name: p.name,
    zoneId,
    phone: p.phone,
    vehicleType: p.vehicleType,
    vehicleNo: p.vehicleNo,
    area: DEMO_PARTNER_AREAS[p.zoneName] ?? null,
    status: p.status,
    isOnline: p.isOnline,
    ratingAvg: p.ratingAvg,
    deliveriesCount: p.deliveriesCount,
    ordersAssigned: p.ordersAssigned,
    failedDeliveries: p.failedDeliveries,
    avgDeliveryMinutes: p.avgDeliveryMinutes,
    onTimePct: p.onTimePct,
    earningsPaise: p.earningsPaise,
    cashInHand: p.cashInHand,
    settlementStatus: p.settlementStatus,
  };
}

function providerRow(p: DemoProvider, zoneByName: Map<string, string>) {
  return {
    name: p.name,
    providerType: p.providerType,
    contactPerson: p.contactPerson,
    contactEmail: p.contactEmail,
    contactPhone: p.contactPhone,
    status: p.status,
    integrationStatus: p.integrationStatus,
    deliveriesCount: p.deliveriesCount,
    successfulDeliveries: p.successfulDeliveries,
    failedDeliveries: p.failedDeliveries,
    avgDeliveryMinutes: p.avgDeliveryMinutes,
    providerCostPaise: p.providerCostPaise,
    settlementStatus: p.settlementStatus,
    zones: {
      create: p.zoneNames
        .filter((n) => zoneByName.has(n))
        .map((n) => ({ zoneId: zoneByName.get(n) as string })),
    },
  };
}
