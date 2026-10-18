import { Prisma, type PrismaClient } from '@prisma/client';
import type { OrderStatus, PermissionKey } from '@zoauro/shared';
import { zonesFor, type AuthContext } from '../../lib/authz';

// The only file of the dashboard module (M16) that imports Prisma. Every count is bounded by the zones where the
// member can view the tile's source module (doc 04 section 4.3: orders:view, restaurants:view, homemakers:view,
// delivery:view, customers:view); a member who can view it nowhere gets null and no query runs. A Super Admin with no
// zone requested counts everything (unzoned app sign-ups included). Read-only.

export type TileScope = { kind: 'ALL' } | { kind: 'ZONES'; zoneIds: string[] };

/** Unpaid online orders are hidden until paid (D52), so the dashboard does not count them. */
const COUNTED_ORDER: Prisma.OrderWhereInput = {
  NOT: { paymentMethod: 'ONLINE', paymentStatus: 'PENDING' },
};

export class DashboardRepository {
  constructor(private readonly db: PrismaClient) {}

  /**
   * The zones of one tile: where the member holds dashboard:view AND the tile's module view (doc 04 section 4.3).
   * null = no such zone (the tile is hidden and no query runs).
   */
  scope(ctx: AuthContext, key: PermissionKey): TileScope | null {
    const dash = zonesFor(ctx, 'dashboard:view');
    const s = zonesFor(ctx, key);
    if (dash.kind === 'ALL' && s.kind === 'ALL') return { kind: 'ALL' };
    const ids =
      dash.kind === 'ALL'
        ? (s as { zoneIds: readonly string[] }).zoneIds
        : s.kind === 'ALL'
          ? dash.zoneIds
          : s.zoneIds.filter((z) => dash.zoneIds.includes(z));
    return ids.length === 0 ? null : { kind: 'ZONES', zoneIds: [...ids] };
  }

  private zoneIn(s: TileScope): { zoneId?: { in: string[] } } {
    return s.kind === 'ALL' ? {} : { zoneId: { in: s.zoneIds } };
  }

  private sqlZone(s: TileScope, column: Prisma.Sql): Prisma.Sql {
    return s.kind === 'ALL' ? Prisma.empty : Prisma.sql`AND ${column} = ANY(${s.zoneIds}::uuid[])`;
  }

  private orderWhere(s: TileScope, from: Date, to: Date): Prisma.OrderWhereInput {
    return { AND: [COUNTED_ORDER, this.zoneIn(s), { placedAt: { gte: from, lte: to } }] };
  }

  async ordersByStatus(s: TileScope, from: Date, to: Date): Promise<Map<OrderStatus, number>> {
    const rows = await this.db.order.groupBy({
      by: ['status'],
      where: this.orderWhere(s, from, to),
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.status, r._count._all]));
  }

  /** Orders per IST hour or day; the buckets come back as UTC instants of the IST bucket start. */
  async orderSeries(
    s: TileScope,
    from: Date,
    to: Date,
    bucket: 'hour' | 'day',
  ): Promise<{ at: Date; orders: number; delivered: number }[]> {
    const unit = bucket === 'hour' ? Prisma.sql`'hour'` : Prisma.sql`'day'`;
    const rows = await this.db.$queryRaw<{ at: Date; orders: bigint; delivered: bigint }[]>`
      SELECT (date_trunc(${unit}, o.placed_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS at,
             count(*) AS orders,
             count(*) FILTER (WHERE o.status = 'DELIVERED') AS delivered
      FROM orders o
      WHERE o.placed_at >= ${from} AND o.placed_at <= ${to}
        AND NOT (o.payment_method = 'ONLINE' AND o.payment_status = 'PENDING')
        ${this.sqlZone(s, Prisma.sql`o.zone_id`)}
      GROUP BY 1 ORDER BY 1`;
    return rows.map((r) => ({
      at: r.at,
      orders: Number(r.orders),
      delivered: Number(r.delivered),
    }));
  }

  async ordersByZone(
    s: TileScope,
    from: Date,
    to: Date,
  ): Promise<{ key: string; label: string; orders: number }[]> {
    const rows = await this.db.order.groupBy({
      by: ['zoneId'],
      where: this.orderWhere(s, from, to),
      _count: { _all: true },
    });
    const zones = await this.db.zone.findMany({
      where: { id: { in: rows.map((r) => r.zoneId) } },
      select: { id: true, name: true },
    });
    const name = new Map(zones.map((z) => [z.id, z.name]));
    return rows
      .map((r) => ({ key: r.zoneId, label: name.get(r.zoneId) ?? 'Zone', orders: r._count._all }))
      .sort((a, b) => b.orders - a.orders);
  }

  /** One zone: orders per vendor area (orders carry no area; the restaurant's or home kitchen's is used). */
  async ordersByArea(
    s: TileScope,
    from: Date,
    to: Date,
  ): Promise<{ key: string; label: string; orders: number }[]> {
    const rows = await this.db.$queryRaw<{ area: string; orders: bigint }[]>`
      SELECT coalesce(nullif(trim(coalesce(r.area, h.area)), ''), 'Other') AS area, count(*) AS orders
      FROM orders o
      LEFT JOIN restaurants r ON r.id = o.restaurant_id
      LEFT JOIN homemakers h ON h.id = o.homemaker_id
      WHERE o.placed_at >= ${from} AND o.placed_at <= ${to}
        AND NOT (o.payment_method = 'ONLINE' AND o.payment_status = 'PENDING')
        ${this.sqlZone(s, Prisma.sql`o.zone_id`)}
      GROUP BY 1 ORDER BY 2 DESC, 1`;
    return rows.map((r) => ({ key: r.area, label: r.area, orders: Number(r.orders) }));
  }

  async vendorCounts(
    module: 'restaurants' | 'homemakers',
    s: TileScope,
  ): Promise<{ total: number; active: number; pendingVerification: number; suspended: number }> {
    const where = { deletedAt: null, ...this.zoneIn(s) };
    const delegate = module === 'restaurants' ? this.db.restaurant : this.db.homemaker;
    const count = (extra: object) =>
      (delegate as typeof this.db.restaurant).count({ where: { ...where, ...extra } });
    const [total, active, pendingVerification, suspended] = await Promise.all([
      count({}),
      count({ status: 'ACTIVE' }),
      count({ verificationStatus: 'PENDING' }),
      count({ status: 'SUSPENDED' }),
    ]);
    return { total, active, pendingVerification, suspended };
  }

  async partnerCounts(
    s: TileScope,
    now: Date,
  ): Promise<{ total: number; active: number; pendingVerification: number; onDuty: number }> {
    const where = { deletedAt: null, ...this.zoneIn(s) };
    const [total, active, pendingVerification, onDuty] = await Promise.all([
      this.db.deliveryPartner.count({ where }),
      this.db.deliveryPartner.count({ where: { ...where, status: 'ACTIVE' } }),
      this.db.deliveryPartner.count({ where: { ...where, verificationStatus: 'PENDING' } }),
      // D133: assignable now
      this.db.deliveryPartner.count({
        where: {
          ...where,
          isOnline: true,
          status: 'ACTIVE',
          verificationStatus: 'VERIFIED',
          OR: [{ forceOfflineUntil: null }, { forceOfflineUntil: { lte: now } }],
        },
      }),
    ]);
    return { total, active, pendingVerification, onDuty };
  }

  /** D25: a customer belongs to a zone through a live address or an order there. */
  private customerWhere(s: TileScope): Prisma.CustomerWhereInput {
    if (s.kind === 'ALL') return { deletedAt: null };
    return {
      deletedAt: null,
      OR: [
        { addresses: { some: { zoneId: { in: s.zoneIds }, deletedAt: null } } },
        { orders: { some: { zoneId: { in: s.zoneIds } } } },
      ],
    };
  }

  customerCount(s: TileScope): Promise<number> {
    return this.db.customer.count({ where: this.customerWhere(s) });
  }

  /** R-ACC-4: live zones with no current member (Super Admin only). */
  zonesWithoutTeam(): Promise<number> {
    return this.db.zone.count({
      where: { deletedAt: null, assignments: { none: { revokedAt: null } } },
    });
  }

  /** D34: database-derived health only. */
  async platformHealth(
    now: Date,
  ): Promise<{ pendingVerifications: number; activeSessions: number }> {
    const pending = { deletedAt: null, verificationStatus: 'PENDING' as const };
    const [r, h, p, activeSessions] = await Promise.all([
      this.db.restaurant.count({ where: pending }),
      this.db.homemaker.count({ where: pending }),
      this.db.deliveryPartner.count({ where: pending }),
      this.db.session.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
    ]);
    return { pendingVerifications: r + h + p, activeSessions };
  }

  /** Delivered orders per vendor in the window, top `limit`. */
  async topVendors(s: TileScope, from: Date, to: Date, limit: number) {
    const where = { AND: [this.orderWhere(s, from, to), { status: 'DELIVERED' as const }] };
    const [byRestaurant, byHomemaker] = await Promise.all([
      this.db.order.groupBy({
        by: ['restaurantId'],
        where: { AND: [where, { restaurantId: { not: null } }] },
        _count: { _all: true },
        orderBy: { _count: { restaurantId: 'desc' } },
        take: limit,
      }),
      this.db.order.groupBy({
        by: ['homemakerId'],
        where: { AND: [where, { homemakerId: { not: null } }] },
        _count: { _all: true },
        orderBy: { _count: { homemakerId: 'desc' } },
        take: limit,
      }),
    ]);
    const zone = { select: { id: true, name: true, code: true } } as const;
    const [restaurants, homemakers] = await Promise.all([
      this.db.restaurant.findMany({
        where: {
          id: { in: byRestaurant.flatMap((r) => (r.restaurantId ? [r.restaurantId] : [])) },
        },
        select: { id: true, name: true, zone },
      }),
      this.db.homemaker.findMany({
        where: { id: { in: byHomemaker.flatMap((r) => (r.homemakerId ? [r.homemakerId] : [])) } },
        select: { id: true, name: true, zone },
      }),
    ]);
    const rName = new Map(restaurants.map((v) => [v.id, v]));
    const hName = new Map(homemakers.map((v) => [v.id, v]));
    const rows = [
      ...byRestaurant.flatMap((r) => {
        const v = r.restaurantId ? rName.get(r.restaurantId) : undefined;
        return v
          ? [
              {
                id: v.id,
                vendorType: 'RESTAURANT' as const,
                name: v.name,
                zone: v.zone,
                deliveredOrders: r._count._all,
              },
            ]
          : [];
      }),
      ...byHomemaker.flatMap((r) => {
        const v = r.homemakerId ? hName.get(r.homemakerId) : undefined;
        return v
          ? [
              {
                id: v.id,
                vendorType: 'HOMEMAKER' as const,
                name: v.name,
                zone: v.zone,
                deliveredOrders: r._count._all,
              },
            ]
          : [];
      }),
    ];
    return rows
      .sort((a, b) => b.deliveredOrders - a.deliveredOrders || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  /** Categories by item quantity of delivered orders in the window. */
  async topCategories(s: TileScope, from: Date, to: Date, limit: number) {
    const rows = await this.db.$queryRaw<{ id: string; name: string; quantity: bigint }[]>`
      SELECT c.id, c.name, sum(oi.qty) AS quantity
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN menu_items mi ON mi.id = oi.menu_item_id
      JOIN categories c ON c.id = mi.category_id
      WHERE o.status = 'DELIVERED' AND o.placed_at >= ${from} AND o.placed_at <= ${to}
        ${this.sqlZone(s, Prisma.sql`o.zone_id`)}
      GROUP BY c.id, c.name ORDER BY 3 DESC, 2 LIMIT ${limit}`;
    return rows.map((r) => ({ id: r.id, name: r.name, quantity: Number(r.quantity) }));
  }

  async newCustomers(s: TileScope, from: Date, to: Date, limit: number) {
    const where = { AND: [this.customerWhere(s), { createdAt: { gte: from, lte: to } }] };
    const [count, latest] = await Promise.all([
      this.db.customer.count({ where }),
      this.db.customer.findMany({
        where,
        select: { id: true, name: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
    ]);
    return { count, latest };
  }

  async newVendors(
    restaurants: TileScope | null,
    homemakers: TileScope | null,
    from: Date,
    to: Date,
    limit: number,
  ) {
    const created = { deletedAt: null, createdAt: { gte: from, lte: to } };
    const select = { id: true, name: true, createdAt: true } as const;
    const order = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
    const [rc, rl, hc, hl] = await Promise.all([
      restaurants
        ? this.db.restaurant.count({ where: { ...created, ...this.zoneIn(restaurants) } })
        : 0,
      restaurants
        ? this.db.restaurant.findMany({
            where: { ...created, ...this.zoneIn(restaurants) },
            select,
            orderBy: order,
            take: limit,
          })
        : [],
      homemakers
        ? this.db.homemaker.count({ where: { ...created, ...this.zoneIn(homemakers) } })
        : 0,
      homemakers
        ? this.db.homemaker.findMany({
            where: { ...created, ...this.zoneIn(homemakers) },
            select,
            orderBy: order,
            take: limit,
          })
        : [],
    ]);
    const latest = [
      ...rl.map((v) => ({ ...v, vendorType: 'RESTAURANT' as const })),
      ...hl.map((v) => ({ ...v, vendorType: 'HOMEMAKER' as const })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
    return { count: rc + hc, latest };
  }

  async newPartners(s: TileScope, from: Date, to: Date, limit: number) {
    const where = { deletedAt: null, createdAt: { gte: from, lte: to }, ...this.zoneIn(s) };
    const [count, latest] = await Promise.all([
      this.db.deliveryPartner.count({ where }),
      this.db.deliveryPartner.findMany({
        where,
        select: { id: true, name: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
    ]);
    return { count, latest };
  }
}
