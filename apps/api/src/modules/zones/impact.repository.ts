import type { PrismaClient } from '@prisma/client';
import type { ZoneCountSource } from '@zoauro/shared';
import type { ZoneCountPort, ZoneFigures } from './impact.service';

// The real zone count ports (doc 53 section 7), one grouped query per source for any number of zones. The zones service
// passes only zones the caller may see, so the ports count everything in them. The only zones file that reads the other
// modules' tables; it imports Prisma, so it is a repository.

const OPEN = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'ASSIGNED', 'OUT_FOR_DELIVERY'] as const;

type Rows = { zone_id: string; n: number }[];

function port(
  source: ZoneCountSource,
  count: (zoneIds: string[]) => Promise<Map<string, ZoneFigures>>,
): ZoneCountPort {
  return {
    source,
    stub: false,
    countByZone: async (_ctx, zoneIds) => (zoneIds.length === 0 ? new Map() : count([...zoneIds])),
  };
}

function byZone<K extends keyof ZoneFigures>(rows: Rows, key: K): Map<string, ZoneFigures> {
  return new Map(rows.map((r) => [r.zone_id, { [key]: Number(r.n) } as ZoneFigures]));
}

/** Counts for restaurants, homemakers, delivery partners, customers, orders, registrations, refunds and payouts. */
export function createZoneCountPorts(db: PrismaClient): ZoneCountPort[] {
  return [
    port('restaurants', async (ids) => {
      const g = await db.restaurant.groupBy({
        by: ['zoneId'],
        where: { zoneId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      });
      return new Map(
        g.flatMap((r) => (r.zoneId ? [[r.zoneId, { restaurants: r._count._all }]] : [])),
      );
    }),
    port('homemakers', async (ids) => {
      const g = await db.homemaker.groupBy({
        by: ['zoneId'],
        where: { zoneId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      });
      return new Map(
        g.flatMap((r) => (r.zoneId ? [[r.zoneId, { homemakers: r._count._all }]] : [])),
      );
    }),
    port('delivery', async (ids) => {
      const rows = await db.$queryRaw<{ zone_id: string; n: number; online: number }[]>`
        SELECT zone_id, count(*)::int AS n, count(*) FILTER (WHERE is_online)::int AS online
        FROM delivery_partners WHERE zone_id = ANY(${ids}::uuid[]) AND deleted_at IS NULL GROUP BY zone_id`;
      return new Map(rows.map((r) => [r.zone_id, { partners: r.n, partnersOnline: r.online }]));
    }),
    // D25: a customer belongs to the zones of their addresses and orders
    port('customers', async (ids) => {
      const rows = await db.$queryRaw<Rows>`
        SELECT zone_id, count(DISTINCT customer_id)::int AS n FROM (
          SELECT a.zone_id, a.customer_id FROM customer_addresses a
            JOIN customers c ON c.id = a.customer_id AND c.deleted_at IS NULL
            WHERE a.zone_id = ANY(${ids}::uuid[]) AND a.deleted_at IS NULL
          UNION ALL
          SELECT o.zone_id, o.customer_id FROM orders o
            JOIN customers c ON c.id = o.customer_id AND c.deleted_at IS NULL
            WHERE o.zone_id = ANY(${ids}::uuid[])
        ) x GROUP BY zone_id`;
      return byZone(rows, 'customers');
    }),
    // open orders by status; a pre-order not yet released to the vendor counts as scheduled (D167)
    port('orders', async (ids) => {
      const rows = await db.$queryRaw<
        { zone_id: string; status: string; n: number; scheduled: number }[]
      >`
        SELECT zone_id, status::text AS status,
          count(*) FILTER (WHERE scheduled_for IS NULL OR released_at IS NOT NULL)::int AS n,
          count(*) FILTER (WHERE scheduled_for IS NOT NULL AND released_at IS NULL)::int AS scheduled
        FROM orders WHERE zone_id = ANY(${ids}::uuid[]) AND status::text = ANY(${[...OPEN]}::text[])
        GROUP BY zone_id, status`;
      const out = new Map<string, ZoneFigures>();
      for (const r of rows) {
        const cur = out.get(r.zone_id) ?? {
          openOrders: 0,
          openOrdersByStatus: {},
          scheduledOrders: 0,
        };
        out.set(r.zone_id, {
          openOrders: (cur.openOrders ?? 0) + r.n,
          openOrdersByStatus: {
            ...cur.openOrdersByStatus,
            ...(r.n > 0 ? { [r.status]: r.n } : {}),
          },
          scheduledOrders: (cur.scheduledOrders ?? 0) + r.scheduled,
        });
      }
      return out;
    }),
    // the onboarding inbox: vendors and partners waiting for verification (D170)
    port('registrations', async (ids) => {
      const rows = await db.$queryRaw<Rows>`
        SELECT zone_id, count(*)::int AS n FROM (
          SELECT zone_id FROM restaurants WHERE verification_status = 'PENDING' AND deleted_at IS NULL
          UNION ALL SELECT zone_id FROM homemakers WHERE verification_status = 'PENDING' AND deleted_at IS NULL
          UNION ALL SELECT zone_id FROM delivery_partners WHERE verification_status = 'PENDING' AND deleted_at IS NULL
        ) x WHERE zone_id = ANY(${ids}::uuid[]) GROUP BY zone_id`;
      return byZone(rows, 'pendingRegistrations');
    }),
    port('refunds', async (ids) => {
      const g = await db.refund.groupBy({
        by: ['zoneId'],
        where: { zoneId: { in: ids }, status: { in: ['REQUESTED', 'PENDING_APPROVAL'] } },
        _count: { _all: true },
      });
      return new Map(g.map((r) => [r.zoneId, { pendingRefunds: r._count._all }]));
    }),
    // payouts.status is a free code (handoff #1): everything not yet PAID is pending
    port('payouts', async (ids) => {
      const g = await db.payout.groupBy({
        by: ['zoneId'],
        where: { zoneId: { in: ids }, status: { not: 'PAID' } },
        _count: { _all: true },
      });
      return new Map(g.map((r) => [r.zoneId, { pendingPayouts: r._count._all }]));
    }),
  ];
}
