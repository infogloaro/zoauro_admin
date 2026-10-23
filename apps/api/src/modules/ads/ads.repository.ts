import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  AdCampaignListQuery,
  AdCampaignStatus,
  AdRequestListQuery,
  AdRequestStatus,
  AdSlotListQuery,
  AdSlotStatus,
  AdVendorType,
} from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import { auditTx } from '../../lib/db';

// D201 advertising: the only file that touches Prisma for ads. Every list takes the caller's resolved zone scope
// ('ALL' for a Super Admin without ?zoneId, else the zone ids from zonesFor(ctx, 'ads:view'), possibly empty).

export type Scope = 'ALL' | readonly string[];

const zoneWhere = (scope: Scope) => (scope === 'ALL' ? {} : { zoneId: { in: [...scope] } });
const OPEN: AdCampaignStatus[] = ['SCHEDULED', 'LIVE', 'PAUSED'];
const zone = { select: { id: true, name: true, code: true } } as const;
const named = { select: { id: true, name: true } } as const;
const vendorInclude = { restaurant: named, homemaker: named, hotel: named } as const;

export const slotInclude = { zone } as const;
export const requestInclude = {
  zone,
  ...vendorInclude,
  slot: { select: { id: true, page: true, placement: true, position: true, pricing: true } },
  adTerms: { select: { id: true, version: true, body: true } },
  campaign: { select: { id: true } },
} as const;
export const campaignInclude = {
  zone,
  ...vendorInclude,
  slot: { select: { id: true, page: true, placement: true, position: true } },
  adTerms: { select: { id: true, version: true, body: true } },
} as const;

export type SlotRow = Prisma.AdSlotGetPayload<{ include: typeof slotInclude }>;
export type RequestRow = Prisma.AdRequestGetPayload<{ include: typeof requestInclude }>;
export type CampaignRow = Prisma.AdCampaignGetPayload<{ include: typeof campaignInclude }>;

export interface VendorKey {
  restaurantId: string | null;
  homemakerId: string | null;
  hotelId: string | null;
}

function vendorTypeWhere(t: AdVendorType | undefined) {
  if (t === 'RESTAURANT') return { restaurantId: { not: null } };
  if (t === 'HOMEMAKER') return { homemakerId: { not: null } };
  if (t === 'HOTEL') return { hotelId: { not: null } };
  return {};
}
function vendorNameWhere(q: string | undefined) {
  if (!q) return {};
  const name = { name: { contains: q, mode: 'insensitive' as const } };
  return { OR: [{ restaurant: name }, { homemaker: name }, { hotel: name }] };
}
const statusCounts = <S extends string>(rows: { status: S; _count: { _all: number } }[]) =>
  Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<Record<S, number>>;

export class AdsRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  // ---- slots ----

  async listSlots(scope: Scope, q: AdSlotListQuery): Promise<{ rows: SlotRow[]; total: number }> {
    const where: Prisma.AdSlotWhereInput = {
      ...zoneWhere(scope),
      deletedAt: null,
      ...(q.adPage ? { page: q.adPage } : {}),
      ...(q.placement ? { placement: q.placement } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const dir = q.sort.direction;
    const orderBy: Prisma.AdSlotOrderByWithRelationInput[] =
      q.sort.field === 'createdAt'
        ? [{ createdAt: dir }, { id: 'asc' }]
        : q.sort.field === 'adPage'
          ? [{ page: dir }, { placement: 'asc' }, { position: 'asc' }, { id: 'asc' }]
          : [{ zone: { name: dir } }, { page: 'asc' }, { placement: 'asc' }, { position: 'asc' }];
    const [rows, total] = await Promise.all([
      this.db.adSlot.findMany({
        where,
        include: slotInclude,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.adSlot.count({ where }),
    ]);
    return { rows, total };
  }

  async slot(id: string): Promise<SlotRow | null> {
    return this.db.adSlot.findFirst({ where: { id, deletedAt: null }, include: slotInclude });
  }

  /** Row lock on the slot: capacity checks and status moves serialise on it. */
  async lockSlot(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM ad_slots WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /** Campaigns holding each slot now (SCHEDULED, LIVE or PAUSED, start ≤ now < end). */
  async bookedNow(slotIds: readonly string[], now: Date): Promise<Map<string, number>> {
    if (slotIds.length === 0) return new Map();
    const rows = await this.db.adCampaign.groupBy({
      by: ['slotId'],
      where: {
        slotId: { in: [...slotIds] },
        status: { in: OPEN },
        startAt: { lte: now },
        endAt: { gt: now },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.slotId, r._count._all]));
  }

  async openCampaignsOnSlot(slotId: string): Promise<number> {
    return this.db.adCampaign.count({ where: { slotId, status: { in: OPEN } } });
  }

  /** Campaigns that may take capacity on the slot in [from, to). */
  async bookedOnSlot(
    slotId: string,
    from: Date,
    to: Date,
  ): Promise<{ startAt: Date; endAt: Date }[]> {
    return this.db.adCampaign.findMany({
      where: { slotId, status: { in: OPEN }, startAt: { lt: to }, endAt: { gt: from } },
      select: { startAt: true, endAt: true },
    });
  }

  async setSlotStatus(
    id: string,
    version: number,
    status: AdSlotStatus,
    by: string,
  ): Promise<boolean> {
    const r = await this.db.adSlot.updateMany({
      where: { id, version, deletedAt: null },
      data: { status, updatedBy: by, version: { increment: 1 } },
    });
    return r.count === 1;
  }

  // ---- requests ----

  async listRequests(
    scope: Scope,
    q: AdRequestListQuery,
  ): Promise<{
    rows: RequestRow[];
    total: number;
    counts: Partial<Record<AdRequestStatus, number>>;
  }> {
    const base: Prisma.AdRequestWhereInput = {
      ...zoneWhere(scope),
      ...(q.adPage ? { page: q.adPage } : {}),
      ...(q.placement ? { placement: q.placement } : {}),
      ...vendorTypeWhere(q.vendorType),
      ...vendorNameWhere(q.q),
    };
    const where = { ...base, ...(q.status ? { status: q.status } : {}) };
    const dir = q.sort.direction;
    const orderBy: Prisma.AdRequestOrderByWithRelationInput[] =
      q.sort.field === 'requestedStartDate'
        ? [{ requestedStartDate: dir }, { id: 'asc' }]
        : q.sort.field === 'quoteExpiresAt'
          ? [{ quoteExpiresAt: { sort: dir, nulls: 'last' } }, { id: 'asc' }]
          : [{ submittedAt: dir }, { id: 'asc' }];
    const [rows, total, groups] = await Promise.all([
      this.db.adRequest.findMany({
        where,
        include: requestInclude,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.adRequest.count({ where }),
      this.db.adRequest.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    return { rows, total, counts: statusCounts(groups) };
  }

  async request(id: string): Promise<RequestRow | null> {
    return this.db.adRequest.findUnique({ where: { id }, include: requestInclude });
  }

  async lockRequest(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM ad_requests WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async updateRequest(
    id: string,
    version: number,
    data: Prisma.AdRequestUncheckedUpdateManyInput,
  ): Promise<boolean> {
    const r = await this.db.adRequest.updateMany({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });
    return r.count === 1;
  }

  /** The zone's newest terms version, else the platform's. */
  async currentTerms(zoneId: string): Promise<{ id: string; version: number } | null> {
    const own = await this.db.adTerms.findFirst({
      where: { zoneId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });
    return (
      own ??
      this.db.adTerms.findFirst({
        where: { zoneId: null },
        orderBy: { version: 'desc' },
        select: { id: true, version: true },
      })
    );
  }

  async openCampaignsOfVendor(v: VendorKey): Promise<number> {
    return this.db.adCampaign.count({
      where: {
        status: { in: OPEN },
        ...(v.restaurantId
          ? { restaurantId: v.restaurantId }
          : v.homemakerId
            ? { homemakerId: v.homemakerId }
            : { hotelId: v.hotelId }),
      },
    });
  }

  // ---- campaigns ----

  async listCampaigns(
    scope: Scope,
    q: AdCampaignListQuery,
  ): Promise<{
    rows: CampaignRow[];
    total: number;
    counts: Partial<Record<AdCampaignStatus, number>>;
  }> {
    const base: Prisma.AdCampaignWhereInput = {
      ...zoneWhere(scope),
      ...(q.adPage ? { slot: { page: q.adPage } } : {}),
      ...vendorTypeWhere(q.vendorType),
      ...vendorNameWhere(q.q),
    };
    const where = { ...base, ...(q.status ? { status: q.status } : {}) };
    const dir = q.sort.direction;
    const orderBy: Prisma.AdCampaignOrderByWithRelationInput[] =
      q.sort.field === 'endAt'
        ? [{ endAt: dir }, { id: 'asc' }]
        : [{ startAt: dir }, { id: 'asc' }];
    const [rows, total, groups] = await Promise.all([
      this.db.adCampaign.findMany({
        where,
        include: campaignInclude,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.adCampaign.count({ where }),
      this.db.adCampaign.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    return { rows, total, counts: statusCounts(groups) };
  }

  async campaign(id: string): Promise<CampaignRow | null> {
    return this.db.adCampaign.findUnique({ where: { id }, include: campaignInclude });
  }

  async lockCampaign(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM ad_campaigns WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async updateCampaign(
    id: string,
    version: number,
    data: Prisma.AdCampaignUncheckedUpdateManyInput,
  ): Promise<boolean> {
    const r = await this.db.adCampaign.updateMany({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });
    return r.count === 1;
  }

  /**
   * Delivered orders of the vendor in the campaign's zone placed inside the live windows (the ranking-commission base,
   * D201); hotels have no orders.
   */
  async deliveredInWindows(
    v: VendorKey,
    zoneId: string,
    windows: readonly [Date, Date][],
  ): Promise<{ count: number; subtotalPaise: number }> {
    if (windows.length === 0 || (!v.restaurantId && !v.homemakerId))
      return { count: 0, subtotalPaise: 0 };
    const r = await this.db.order.aggregate({
      where: {
        ...(v.restaurantId ? { restaurantId: v.restaurantId } : { homemakerId: v.homemakerId }),
        zoneId,
        status: 'DELIVERED',
        OR: windows.map(([from, to]) => ({ placedAt: { gte: from, lt: to } })),
      },
      _count: { _all: true },
      _sum: { subtotal: true },
    });
    return { count: r._count._all, subtotalPaise: r._sum.subtotal ?? 0 };
  }

  // ---- dashboard ----

  async dashboardCounts(scope: Scope, now: Date, since: Date) {
    const z = zoneWhere(scope);
    const [slotsActive, requests, campaigns, ended30d, capacity, booked] = await Promise.all([
      this.db.adSlot.count({ where: { ...z, deletedAt: null, status: 'ACTIVE' } }),
      this.db.adRequest.groupBy({
        by: ['status'],
        where: { ...z, status: { in: ['SUBMITTED', 'QUOTED'] } },
        _count: { _all: true },
      }),
      this.db.adCampaign.groupBy({
        by: ['status'],
        where: { ...z, status: { in: OPEN } },
        _count: { _all: true },
      }),
      this.db.adCampaign.count({
        where: { ...z, status: 'ENDED', endAt: { gte: since } },
      }),
      this.db.adSlot.aggregate({
        where: { ...z, deletedAt: null, status: 'ACTIVE' },
        _sum: { capacity: true },
      }),
      this.db.adCampaign.count({
        where: { ...z, status: { in: OPEN }, startAt: { lte: now }, endAt: { gt: now } },
      }),
    ]);
    return {
      slotsActive,
      requests: statusCounts(requests),
      campaigns: statusCounts(campaigns),
      ended30d,
      capacity: capacity._sum.capacity ?? 0,
      booked,
    };
  }

  /** Every campaign that has been live (for the money figures); demo volume is small. */
  async earningCampaigns(scope: Scope): Promise<CampaignRow[]> {
    return this.db.adCampaign.findMany({
      where: { ...zoneWhere(scope), status: { in: ['LIVE', 'PAUSED', 'ENDED', 'CANCELLED'] } },
      include: campaignInclude,
    });
  }

  /** D182 A2: a vendor's campaigns in the zone still to be deducted (billing PENDING) that were live before `before`. */
  async pendingCampaignsOfVendor(
    v: { restaurantId: string } | { homemakerId: string },
    zoneId: string,
    before: Date,
  ): Promise<CampaignRow[]> {
    return this.db.adCampaign.findMany({
      where: {
        ...v,
        zoneId,
        billingStatus: 'PENDING',
        status: { in: ['LIVE', 'PAUSED', 'ENDED', 'CANCELLED'] },
        startAt: { lt: before },
      },
      include: campaignInclude,
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });
  }

  async userNames(ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((i): i is string => i !== null))];
    if (wanted.length === 0) return new Map();
    const rows = await this.db.user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((u) => [u.id, u.name]));
  }
}

export interface AdsTx {
  repo: AdsRepository;
  audit: AuditTx;
}

export class AdsDatabase {
  readonly repo: AdsRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new AdsRepository(prisma);
  }

  transaction<T>(fn: (tx: AdsTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new AdsRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 15_000 },
    );
  }
}
