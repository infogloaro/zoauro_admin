import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  PlanFeature,
  PlanVendorType,
  VendorPlanCycle,
  VendorPlanListQuery,
  VendorPlanStatus,
  VendorPlanSubscriptionListQuery,
  VendorPlanSubscriptionStatus,
} from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import { zonesFor, type AuthContext } from '../../lib/authz';
import { auditTx } from '../../lib/db';

// ZOAURO → vendor plans (D188): the only file of the plans module that imports Prisma. The catalogue is platform-wide;
// subscriptions belong to the vendor's zone and are bounded by zonesFor(ctx, 'plans:view').

const LIVE: VendorPlanSubscriptionStatus[] = ['TRIAL', 'ACTIVE'];
const zoneRef = { select: { id: true, name: true, code: true } } as const;

const planSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  pricePaise: true,
  cycle: true,
  trialDays: true,
  vendorTypes: true,
  zoneIds: true,
  status: true,
  sortOrder: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  features: { select: { feature: true, value: true }, orderBy: { feature: 'asc' } },
} as const satisfies Prisma.VendorPlanSelect;
export type PlanRow = Prisma.VendorPlanGetPayload<{ select: typeof planSelect }>;

const subSelect = {
  id: true,
  zoneId: true,
  status: true,
  pricePaise: true,
  startedAt: true,
  endsAt: true,
  version: true,
  restaurantId: true,
  homemakerId: true,
  hotelId: true,
  plan: { select: { id: true, code: true, name: true } },
  zone: zoneRef,
  restaurant: { select: { name: true } },
  homemaker: { select: { name: true } },
  hotel: { select: { name: true } },
} as const satisfies Prisma.VendorPlanSubscriptionSelect;
export type SubscriptionRow = Prisma.VendorPlanSubscriptionGetPayload<{ select: typeof subSelect }>;

export interface PlanWrite {
  name?: string;
  description?: string | null;
  pricePaise?: number;
  cycle?: VendorPlanCycle;
  trialDays?: number;
  vendorTypes?: PlanVendorType[];
  zoneIds?: string[];
  sortOrder?: number;
  status?: VendorPlanStatus;
}

export class PlansRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  private subScope(ctx: AuthContext): Prisma.VendorPlanSubscriptionWhereInput | null {
    const s = zonesFor(ctx, 'plans:view');
    if (s.kind === 'ALL') return {};
    return s.zoneIds.length === 0 ? null : { zoneId: { in: [...s.zoneIds] } };
  }

  async listPlans(
    q: VendorPlanListQuery,
    onlyActive: boolean,
  ): Promise<{ rows: PlanRow[]; total: number }> {
    const where: Prisma.VendorPlanWhereInput = {
      deletedAt: null,
      ...(onlyActive ? { status: 'ACTIVE' } : q.status ? { status: q.status } : {}),
      ...(q.vendorType ? { vendorTypes: { has: q.vendorType } } : {}),
      ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.vendorPlan.findMany({
        where,
        orderBy: [{ [q.sort.field]: q.sort.direction }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: planSelect,
      }),
      this.db.vendorPlan.count({ where }),
    ]);
    return { rows, total };
  }

  async plan(id: string): Promise<PlanRow | null> {
    return this.db.vendorPlan.findFirst({ where: { id, deletedAt: null }, select: planSelect });
  }

  async codeTaken(code: string): Promise<boolean> {
    return (await this.db.vendorPlan.count({ where: { code } })) > 0;
  }

  /** Live subscribers per plan within the actor's view scope. */
  async subscriberCounts(
    ctx: AuthContext,
    planIds: readonly string[],
  ): Promise<Map<string, number>> {
    const scope = this.subScope(ctx);
    if (!scope || planIds.length === 0) return new Map();
    const rows = await this.db.vendorPlanSubscription.groupBy({
      by: ['planId'],
      where: { ...scope, planId: { in: [...planIds] }, status: { in: LIVE } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.planId, r._count._all]));
  }

  async zones(ids: readonly string[]): Promise<{ id: string; name: string; code: string }[]> {
    if (ids.length === 0) return [];
    return this.db.zone.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true, code: true },
    });
  }

  async lockPlan(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM vendor_plans WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async insertPlan(
    row: PlanWrite & { id: string; code: string; createdBy: string },
    features: { feature: PlanFeature; value: number | null }[],
  ) {
    await this.db.vendorPlan.create({
      data: {
        ...row,
        updatedBy: row.createdBy,
        status: 'DRAFT',
      } as Prisma.VendorPlanUncheckedCreateInput,
    });
    if (features.length > 0)
      await this.db.vendorPlanFeature.createMany({
        data: features.map((f) => ({ planId: row.id, ...f })),
      });
  }

  async updatePlan(
    id: string,
    w: PlanWrite,
    actorId: string,
    features?: { feature: PlanFeature; value: number | null }[],
  ) {
    await this.db.vendorPlan.update({
      where: { id },
      data: { ...w, updatedBy: actorId, version: { increment: 1 } },
    });
    if (features) {
      await this.db.vendorPlanFeature.deleteMany({ where: { planId: id } });
      if (features.length > 0)
        await this.db.vendorPlanFeature.createMany({
          data: features.map((f) => ({ planId: id, ...f })),
        });
    }
  }

  async listSubscriptions(
    ctx: AuthContext,
    planId: string,
    q: VendorPlanSubscriptionListQuery,
  ): Promise<{ rows: SubscriptionRow[]; total: number }> {
    const scope = this.subScope(ctx);
    if (!scope) return { rows: [], total: 0 };
    const like = q.q ? { contains: q.q, mode: 'insensitive' as const } : undefined;
    const where: Prisma.VendorPlanSubscriptionWhereInput = {
      ...scope,
      planId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.vendorType === 'RESTAURANT' ? { restaurantId: { not: null } } : {}),
      ...(q.vendorType === 'HOMEMAKER' ? { homemakerId: { not: null } } : {}),
      ...(q.vendorType === 'HOTEL' ? { hotelId: { not: null } } : {}),
      ...(like
        ? {
            OR: [
              { restaurant: { name: like } },
              { homemaker: { name: like } },
              { hotel: { name: like } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.vendorPlanSubscription.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: subSelect,
      }),
      this.db.vendorPlanSubscription.count({ where }),
    ]);
    return { rows, total };
  }

  async subscription(ctx: AuthContext, id: string): Promise<SubscriptionRow | null> {
    const scope = this.subScope(ctx);
    if (!scope) return null;
    return this.db.vendorPlanSubscription.findFirst({ where: { ...scope, id }, select: subSelect });
  }

  async vendor(
    type: PlanVendorType,
    id: string,
  ): Promise<{ id: string; name: string; zoneId: string | null } | null> {
    const where = { id, deletedAt: null };
    const select = { id: true, name: true, zoneId: true } as const;
    if (type === 'RESTAURANT') return this.db.restaurant.findFirst({ where, select });
    if (type === 'HOMEMAKER') return this.db.homemaker.findFirst({ where, select });
    return this.db.hotel.findFirst({ where, select });
  }

  async liveSubscriptionOf(type: PlanVendorType, vendorId: string): Promise<{ id: string } | null> {
    const key =
      type === 'RESTAURANT' ? 'restaurantId' : type === 'HOMEMAKER' ? 'homemakerId' : 'hotelId';
    return this.db.vendorPlanSubscription.findFirst({
      where: { [key]: vendorId, status: { in: LIVE } },
      select: { id: true },
    });
  }

  async insertSubscription(row: {
    id: string;
    planId: string;
    vendor: { type: PlanVendorType; id: string };
    zoneId: string;
    status: VendorPlanSubscriptionStatus;
    pricePaise: number;
    startedAt: Date;
    endsAt: Date | null;
    snapshot: Prisma.InputJsonValue;
    createdBy: string;
  }): Promise<void> {
    const key =
      row.vendor.type === 'RESTAURANT'
        ? 'restaurantId'
        : row.vendor.type === 'HOMEMAKER'
          ? 'homemakerId'
          : 'hotelId';
    await this.db.vendorPlanSubscription.create({
      data: {
        id: row.id,
        planId: row.planId,
        [key]: row.vendor.id,
        zoneId: row.zoneId,
        status: row.status,
        pricePaise: row.pricePaise,
        startedAt: row.startedAt,
        endsAt: row.endsAt,
        planSnapshotJson: row.snapshot,
        source: 'ADMIN',
        createdBy: row.createdBy,
        updatedBy: row.createdBy,
      } as Prisma.VendorPlanSubscriptionUncheckedCreateInput,
    });
  }

  async cancelSubscription(id: string, at: Date, actorId: string): Promise<void> {
    await this.db.vendorPlanSubscription.update({
      where: { id },
      data: { status: 'CANCELLED', endsAt: at, updatedBy: actorId, version: { increment: 1 } },
    });
  }
}

export interface PlansTx {
  repo: PlansRepository;
  audit: AuditTx;
}

export class PlansDatabase {
  readonly repo: PlansRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new PlansRepository(prisma);
  }

  transaction<T>(fn: (tx: PlansTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new PlansRepository(tx), audit: auditTx(tx) }),
      {
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  }
}
