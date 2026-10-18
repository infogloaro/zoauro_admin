import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import {
  dashboardWindow,
  ORDER_STATUSES,
  type DashboardNewRegistrations,
  type DashboardOrderOverview,
  type DashboardOrderStatus,
  type DashboardQuery,
  type DashboardSummary,
  type DashboardTopCategories,
  type DashboardTopVendors,
  type DashboardZoneOrders,
  type PermissionKey,
} from '@zoauro/shared';
import type { AuthContext } from '../../lib/authz';
import type { DashboardRepository, TileScope } from './dashboard.repository';

// Dashboard tiles (M16; doc 09 /dashboard/*, SA-5.1, ZA-5.1, doc 36). Each tile is scoped by its own source module
// (doc 04 section 4.3) and null when the member can view that module nowhere. Answers are cached in Redis for 30 s
// (doc 23: 30–60 s) under a key holding the route, the range, the role and a hash of every tile scope (doc 36: no
// cache shared between different scopes, TC-MZ-6); a Redis failure only means computing again. Money tiles wait for
// the ledger (doc 34, SA-6.7).

const CACHE_TTL_SEC = 30;
const CACHE_VERSION = 'v1';
const TOP = 5;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

type Tile = 'orders' | 'restaurants' | 'homemakers' | 'delivery' | 'customers';
const TILES: Record<Tile, PermissionKey> = {
  orders: 'orders:view',
  restaurants: 'restaurants:view',
  homemakers: 'homemakers:view',
  delivery: 'delivery:view',
  customers: 'customers:view',
};

export class DashboardService {
  constructor(
    private readonly deps: {
      repo: DashboardRepository;
      redis: Pick<Redis, 'get' | 'set'> | null;
      clock: () => Date;
    },
  ) {}

  private scopes(ctx: AuthContext): Record<Tile, TileScope | null> {
    const out = {} as Record<Tile, TileScope | null>;
    for (const [tile, key] of Object.entries(TILES))
      out[tile as Tile] = this.deps.repo.scope(ctx, key);
    return out;
  }

  /** route + range + role + the scope of every tile (sorted ids), hashed. */
  private cacheKey(route: string, ctx: AuthContext, range: string): string {
    const scopes = this.scopes(ctx);
    const text = Object.entries(scopes)
      .map(
        ([t, s]) =>
          `${t}=${s === null ? 'none' : s.kind === 'ALL' ? 'ALL' : [...s.zoneIds].sort().join(',')}`,
      )
      .join(';');
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
    return `dashboard:${CACHE_VERSION}:${route}:${range}:${ctx.isSuperAdmin ? 'SA' : 'ZA'}:${hash}`;
  }

  private async cached<T>(
    route: string,
    ctx: AuthContext,
    range: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheKey(route, ctx, range);
    const redis = this.deps.redis;
    if (redis) {
      try {
        const hit = await redis.get(key);
        if (hit) return JSON.parse(hit) as T;
      } catch {
        // Redis down: compute (doc 06: the cache is an optimisation)
      }
    }
    const value = await load();
    if (redis) {
      try {
        await redis.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SEC);
      } catch {
        // best effort
      }
    }
    return value;
  }

  summary(ctx: AuthContext, q: DashboardQuery): Promise<DashboardSummary> {
    return this.cached('summary', ctx, q.range, async () => {
      const now = this.deps.clock();
      const { from, to } = dashboardWindow(q.range, now);
      const s = this.scopes(ctx);
      const repo = this.deps.repo;
      const [byStatus, restaurants, homemakers, partners, customers, withoutTeam, health] =
        await Promise.all([
          s.orders ? repo.ordersByStatus(s.orders, from, to) : null,
          s.restaurants ? repo.vendorCounts('restaurants', s.restaurants) : null,
          s.homemakers ? repo.vendorCounts('homemakers', s.homemakers) : null,
          s.delivery ? repo.partnerCounts(s.delivery, now) : null,
          s.customers ? repo.customerCount(s.customers) : null,
          ctx.isSuperAdmin ? repo.zonesWithoutTeam() : null,
          ctx.isSuperAdmin ? repo.platformHealth(now) : null,
        ]);
      let orders: DashboardSummary['orders'] = null;
      if (byStatus) {
        const total = [...byStatus.values()].reduce((a, b) => a + b, 0);
        const cancelled = byStatus.get('CANCELLED') ?? 0;
        orders = {
          total,
          delivered: byStatus.get('DELIVERED') ?? 0,
          cancelled,
          cancellationRate: total === 0 ? 0 : Math.round((cancelled / total) * 10_000) / 100,
        };
      }
      return {
        range: q.range,
        orders,
        restaurants,
        homemakers,
        deliveryPartners: partners,
        customers,
        zonesWithoutTeam: withoutTeam,
        platformHealth: health,
      };
    });
  }

  orderStatus(ctx: AuthContext, q: DashboardQuery): Promise<DashboardOrderStatus> {
    return this.cached('order-status', ctx, q.range, async () => {
      const s = this.deps.repo.scope(ctx, 'orders:view');
      if (!s) return { range: q.range, data: null };
      const { from, to } = dashboardWindow(q.range, this.deps.clock());
      const byStatus = await this.deps.repo.ordersByStatus(s, from, to);
      return {
        range: q.range,
        data: ORDER_STATUSES.map((status) => ({ status, count: byStatus.get(status) ?? 0 })),
      };
    });
  }

  orderOverview(ctx: AuthContext, q: DashboardQuery): Promise<DashboardOrderOverview> {
    return this.cached('order-overview', ctx, q.range, async () => {
      const { from, to, bucket } = dashboardWindow(q.range, this.deps.clock());
      const s = this.deps.repo.scope(ctx, 'orders:view');
      if (!s) return { range: q.range, bucket, data: null };
      const rows = await this.deps.repo.orderSeries(s, from, to, bucket);
      const byAt = new Map(rows.map((r) => [r.at.getTime(), r]));
      // every bucket of the window, zero when no order fell in it
      const step = bucket === 'hour' ? HOUR_MS : DAY_MS;
      const data: { at: string; orders: number; delivered: number }[] = [];
      for (let t = from.getTime(); t <= to.getTime(); t += step) {
        const r = byAt.get(t);
        data.push({
          at: new Date(t).toISOString(),
          orders: r?.orders ?? 0,
          delivered: r?.delivered ?? 0,
        });
      }
      return { range: q.range, bucket, data };
    });
  }

  /** Per zone when the orders scope spans more than one zone (or every zone), per vendor area for one zone (doc 09). */
  zoneOrders(ctx: AuthContext, q: DashboardQuery): Promise<DashboardZoneOrders> {
    return this.cached('zone-orders', ctx, q.range, async () => {
      const s = this.deps.repo.scope(ctx, 'orders:view');
      const single = s?.kind === 'ZONES' && s.zoneIds.length === 1;
      if (!s) return { range: q.range, by: 'zone', data: null };
      const { from, to } = dashboardWindow(q.range, this.deps.clock());
      return single
        ? { range: q.range, by: 'area', data: await this.deps.repo.ordersByArea(s, from, to) }
        : { range: q.range, by: 'zone', data: await this.deps.repo.ordersByZone(s, from, to) };
    });
  }

  topRestaurants(ctx: AuthContext, q: DashboardQuery): Promise<DashboardTopVendors> {
    return this.cached('top-restaurants', ctx, q.range, async () => {
      const s = this.deps.repo.scope(ctx, 'orders:view');
      if (!s) return { range: q.range, data: null };
      const { from, to } = dashboardWindow(q.range, this.deps.clock());
      return { range: q.range, data: await this.deps.repo.topVendors(s, from, to, TOP) };
    });
  }

  topCategories(ctx: AuthContext, q: DashboardQuery): Promise<DashboardTopCategories> {
    return this.cached('top-categories', ctx, q.range, async () => {
      const s = this.deps.repo.scope(ctx, 'orders:view');
      if (!s) return { range: q.range, data: null };
      const { from, to } = dashboardWindow(q.range, this.deps.clock());
      return { range: q.range, data: await this.deps.repo.topCategories(s, from, to, TOP) };
    });
  }

  newRegistrations(ctx: AuthContext, q: DashboardQuery): Promise<DashboardNewRegistrations> {
    return this.cached('new-registrations', ctx, q.range, async () => {
      const s = this.scopes(ctx);
      const { from, to } = dashboardWindow(q.range, this.deps.clock());
      const iso = <T extends { createdAt: Date }>(rows: T[]) =>
        rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
      const [customers, vendors, partners] = await Promise.all([
        s.customers ? this.deps.repo.newCustomers(s.customers, from, to, TOP) : null,
        s.restaurants || s.homemakers
          ? this.deps.repo.newVendors(s.restaurants, s.homemakers, from, to, TOP)
          : null,
        s.delivery ? this.deps.repo.newPartners(s.delivery, from, to, TOP) : null,
      ]);
      return {
        range: q.range,
        customers: customers ? { count: customers.count, latest: iso(customers.latest) } : null,
        vendors: vendors ? { count: vendors.count, latest: iso(vendors.latest) } : null,
        deliveryPartners: partners ? { count: partners.count, latest: iso(partners.latest) } : null,
      };
    });
  }
}
