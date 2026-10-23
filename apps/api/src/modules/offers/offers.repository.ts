import { Prisma, type PrismaClient } from '@prisma/client';
import {
  PROMOTION_STATUSES,
  type OfferListQuery,
  type OfferRedemptionListQuery,
  type OfferVendorType,
  type PromotionStatus,
} from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import { zonesFor, type AuthContext } from '../../lib/authz';
import { auditTx } from '../../lib/db';

// Offers (D182): the only file of the offers module that imports Prisma. An offer carries its zones in `zone_ids`
// (PLATFORM: none = every zone). Scope for a Zonal Admin: offers whose zones overlap zonesFor(ctx, 'offers:view'), plus
// PLATFORM offers when that set is not empty (read only for them; writes are checked by the service).

const zoneRef = { select: { id: true, name: true, code: true } } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const offerSelect = {
  id: true,
  scope: true,
  restaurantId: true,
  homemakerId: true,
  zoneIds: true,
  code: true,
  title: true,
  description: true,
  type: true,
  value: true,
  maxDiscountPaise: true,
  minOrderPaise: true,
  newCustomersOnly: true,
  paymentMethods: true,
  perCustomerLimit: true,
  usageLimit: true,
  usedCount: true,
  budgetPaise: true,
  spentPaise: true,
  fundedBy: true,
  vendorSharePct: true,
  validFrom: true,
  validTo: true,
  status: true,
  statusReason: true,
  source: true,
  requestedBy: true,
  requestedBySuperAdmin: true,
  submittedAt: true,
  decidedBy: true,
  decidedAt: true,
  decisionReason: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  restaurant: { select: { name: true } },
  homemaker: { select: { name: true } },
} as const satisfies Prisma.OfferSelect;
export type OfferRow = Prisma.OfferGetPayload<{ select: typeof offerSelect }>;

const redemptionSelect = {
  id: true,
  discountPaise: true,
  vendorPaise: true,
  platformPaise: true,
  status: true,
  appliedAt: true,
  reversedAt: true,
  order: { select: { id: true, orderNo: true } },
  zone: zoneRef,
  customer: { select: { id: true, name: true, phone: true } },
} as const satisfies Prisma.OfferRedemptionSelect;
export type RedemptionRow = Prisma.OfferRedemptionGetPayload<{ select: typeof redemptionSelect }>;

export interface OfferInsert {
  id: string;
  scope: OfferRow['scope'];
  restaurantId: string | null;
  homemakerId: string | null;
  zoneIds: string[];
  code: string | null;
  title: string;
  description: string | null;
  type: OfferRow['type'];
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number;
  newCustomersOnly: boolean;
  paymentMethods: string[];
  perCustomerLimit: number;
  usageLimit: number | null;
  budgetPaise: number | null;
  fundedBy: OfferRow['fundedBy'];
  vendorSharePct: number | null;
  validFrom: Date;
  validTo: Date;
  requestedBy: string;
  requestedBySuperAdmin: boolean;
}

export type OfferWrite = Partial<
  Pick<
    OfferInsert,
    | 'code'
    | 'title'
    | 'description'
    | 'type'
    | 'value'
    | 'maxDiscountPaise'
    | 'minOrderPaise'
    | 'newCustomersOnly'
    | 'paymentMethods'
    | 'perCustomerLimit'
    | 'usageLimit'
    | 'budgetPaise'
    | 'vendorSharePct'
    | 'validFrom'
    | 'validTo'
  >
> & {
  status?: PromotionStatus;
  statusReason?: string | null;
  submittedAt?: Date;
  decidedBy?: string | null;
  decidedAt?: Date | null;
  decisionReason?: string | null;
  deletedAt?: Date;
};

/** One outbox row (doc 43; the publisher adds `sequence`). */
export interface OutboxRow {
  id: string;
  eventType: string;
  zoneId: string | null;
  payload: Record<string, unknown>;
}

export class OffersRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  /** null = the caller may view offers nowhere */
  private scope(ctx: AuthContext): Prisma.OfferWhereInput | null {
    const s = zonesFor(ctx, 'offers:view');
    if (s.kind === 'ALL') return {};
    if (s.zoneIds.length === 0) return null;
    return { OR: [{ scope: 'PLATFORM' }, { zoneIds: { hasSome: [...s.zoneIds] } }] };
  }

  private where(ctx: AuthContext, q: OfferListQuery, withStatus: boolean) {
    const scope = this.scope(ctx);
    if (!scope) return null;
    const where: Prisma.OfferWhereInput = {
      AND: [
        scope,
        { deletedAt: null },
        ...(withStatus && q.status?.length ? [{ status: { in: q.status } }] : []),
        ...(q.scope ? [{ scope: q.scope }] : []),
        ...(q.type ? [{ type: q.type }] : []),
        ...(q.fundedBy ? [{ fundedBy: q.fundedBy }] : []),
        ...(q.vendorId
          ? [{ OR: [{ restaurantId: q.vendorId }, { homemakerId: q.vendorId }] }]
          : []),
        ...(q.q
          ? [
              {
                OR: [
                  { title: { contains: q.q, mode: 'insensitive' as const } },
                  { code: { contains: q.q, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
    };
    return where;
  }

  async list(
    ctx: AuthContext,
    q: OfferListQuery,
  ): Promise<{ rows: OfferRow[]; total: number; counts: Record<PromotionStatus, number> }> {
    const empty = Object.fromEntries(PROMOTION_STATUSES.map((s) => [s, 0])) as Record<
      PromotionStatus,
      number
    >;
    const where = this.where(ctx, q, true);
    const tabs = this.where(ctx, q, false);
    if (!where || !tabs) return { rows: [], total: 0, counts: empty };
    const [rows, total, grouped] = await Promise.all([
      this.db.offer.findMany({
        where,
        orderBy: [{ [q.sort.field]: q.sort.direction }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: offerSelect,
      }),
      this.db.offer.count({ where }),
      this.db.offer.groupBy({ by: ['status'], where: tabs, _count: { _all: true } }),
    ]);
    for (const g of grouped) empty[g.status] = g._count._all;
    return { rows, total, counts: empty };
  }

  /** One offer the caller may view (null = not found or out of scope). */
  async offer(ctx: AuthContext, id: string): Promise<OfferRow | null> {
    const scope = this.scope(ctx);
    if (!scope) return null;
    return this.db.offer.findFirst({
      where: { AND: [scope, { id, deletedAt: null }] },
      select: offerSelect,
    });
  }

  /** Unscoped read for the service's own checks after a write (the caller already passed the scope). */
  async byId(id: string): Promise<OfferRow | null> {
    return this.db.offer.findFirst({ where: { id, deletedAt: null }, select: offerSelect });
  }

  async lock(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM offers WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async codeTaken(code: string, exceptId?: string): Promise<boolean> {
    const n = await this.db.offer.count({
      where: {
        code: { equals: code, mode: 'insensitive' },
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    return n > 0;
  }

  async zones(ids: readonly string[]): Promise<{ id: string; name: string; code: string }[]> {
    if (ids.length === 0) return [];
    return this.db.zone.findMany({
      where: { id: { in: [...ids] }, deletedAt: null },
      select: { id: true, name: true, code: true },
    });
  }

  async vendor(
    type: OfferVendorType,
    id: string,
  ): Promise<{ id: string; name: string; zoneId: string | null } | null> {
    const where = { id, deletedAt: null };
    const select = { id: true, name: true, zoneId: true } as const;
    return type === 'RESTAURANT'
      ? this.db.restaurant.findFirst({ where, select })
      : this.db.homemaker.findFirst({ where, select });
  }

  async userNames(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((u) => [u.id, u.name]));
  }

  async insert(row: OfferInsert): Promise<void> {
    await this.db.offer.create({
      data: {
        ...row,
        status: 'DRAFT',
        source: 'ADMIN',
        createdBy: row.requestedBy,
        updatedBy: row.requestedBy,
      } as Prisma.OfferUncheckedCreateInput,
    });
  }

  async update(id: string, w: OfferWrite, actorId: string | null): Promise<void> {
    await this.db.offer.update({
      where: { id },
      data: { ...w, updatedBy: actorId, version: { increment: 1 } },
    });
  }

  async redemptions(
    offerId: string,
    q: OfferRedemptionListQuery,
    zoneIds: readonly string[] | 'ALL',
  ): Promise<{ rows: RedemptionRow[]; total: number }> {
    if (zoneIds !== 'ALL' && zoneIds.length === 0) return { rows: [], total: 0 };
    const where: Prisma.OfferRedemptionWhereInput = {
      offerId,
      ...(zoneIds === 'ALL' ? {} : { zoneId: { in: [...zoneIds] } }),
      ...(q.status ? { status: q.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.offerRedemption.findMany({
        where,
        orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: redemptionSelect,
      }),
      this.db.offerRedemption.count({ where }),
    ]);
    return { rows, total };
  }

  async hasRedemptions(offerId: string): Promise<boolean> {
    return (await this.db.offerRedemption.count({ where: { offerId } })) > 0;
  }

  // ---- redemption (doc 10 §8) -----------------------------------------------------------------------------------------

  /** Live offers that may cover this vendor in this zone: PLATFORM, ZONE with the zone, VENDOR for this vendor. */
  async liveFor(
    zoneId: string,
    vendor: { type: OfferVendorType; id: string },
  ): Promise<OfferRow[]> {
    return this.db.offer.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        OR: [
          { scope: 'PLATFORM' },
          { scope: 'ZONE', zoneIds: { has: zoneId } },
          vendor.type === 'RESTAURANT'
            ? { scope: 'VENDOR', restaurantId: vendor.id }
            : { scope: 'VENDOR', homemakerId: vendor.id },
        ],
      },
      orderBy: [{ validTo: 'asc' }, { id: 'asc' }],
      take: 200,
      select: offerSelect,
    });
  }

  /** Live offers of a zone (no vendor named): PLATFORM and ZONE ones only. */
  async liveInZone(zoneId: string): Promise<OfferRow[]> {
    return this.db.offer.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        OR: [{ scope: 'PLATFORM' }, { scope: 'ZONE', zoneIds: { has: zoneId } }],
      },
      orderBy: [{ validTo: 'asc' }, { id: 'asc' }],
      take: 200,
      select: offerSelect,
    });
  }

  /** An offer by its code (codes are unique among live rows, stored upper case). */
  async byCode(code: string): Promise<OfferRow | null> {
    return this.db.offer.findFirst({
      where: { code: { equals: code, mode: 'insensitive' }, deletedAt: null },
      select: offerSelect,
    });
  }

  /** APPLIED uses per offer for one customer. */
  async customerUses(
    customerId: string,
    offerIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (offerIds.length === 0) return new Map();
    const rows = await this.db.offerRedemption.groupBy({
      by: ['offerId'],
      where: { customerId, status: 'APPLIED', offerId: { in: [...offerIds] } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.offerId, r._count._all]));
  }

  async deliveredOrders(customerId: string): Promise<number> {
    return this.db.order.count({ where: { customerId, status: 'DELIVERED' } });
  }

  async insertRedemption(r: {
    id: string;
    offerId: string;
    orderId: string;
    checkoutGroupId: string | null;
    customerId: string;
    zoneId: string;
    discountPaise: number;
    vendorPaise: number;
    platformPaise: number;
    appliedAt: Date;
  }): Promise<void> {
    await this.db.offerRedemption.create({ data: { ...r, status: 'APPLIED' } });
  }

  /** used_count and spent_paise move together with a redemption (applied +, reversed −). */
  async bumpCounters(offerId: string, uses: number, paise: number): Promise<void> {
    await this.db.offer.update({
      where: { id: offerId },
      data: { usedCount: { increment: uses }, spentPaise: { increment: paise } },
    });
  }

  /** The order's live redemption with the order's state (reversal checks). */
  async appliedOfOrder(orderId: string): Promise<{
    id: string;
    offerId: string;
    discountPaise: number;
    order: { status: string; deliveredAt: Date | null; zoneId: string };
  } | null> {
    return this.db.offerRedemption.findFirst({
      where: { orderId, status: 'APPLIED' },
      select: {
        id: true,
        offerId: true,
        discountPaise: true,
        order: { select: { status: true, deliveredAt: true, zoneId: true } },
      },
    });
  }

  async markReversed(id: string, at: Date, reason: string): Promise<boolean> {
    const r = await this.db.offerRedemption.updateMany({
      where: { id, status: 'APPLIED' },
      data: { status: 'REVERSED', reversedAt: at, reverseReason: reason },
    });
    return r.count === 1;
  }

  /** APPLIED uses whose order was cancelled before delivery (the sweep's safety net for F4). */
  async staleApplied(limit: number): Promise<{ orderId: string }[]> {
    return this.db.offerRedemption.findMany({
      where: { status: 'APPLIED', order: { status: 'CANCELLED', deliveredAt: null } },
      orderBy: { appliedAt: 'asc' },
      take: limit,
      select: { orderId: true },
    });
  }

  async orderExists(orderId: string): Promise<boolean> {
    return (await this.db.order.count({ where: { id: orderId } })) === 1;
  }

  // ---- the apps (Integration API, external_refs) ----------------------------------------------------------------------

  /**
   * A vendor named by an app (doc 42 §5.2, doc 32 2026-10-22): this client's own id first (the vendor app); else the
   * Core's id (returned to the vendor app at sign-up, the one id every app shares); else a vendor app's id when exactly
   * one vendor has it. Restaurant first, then Home Food. `ownOnly` (the vendor app's writes): this client's ids only,
   * so one vendor app never acts for a vendor another registered.
   */
  async vendorByRef(
    clientId: string,
    externalId: string,
    ownOnly = false,
  ): Promise<{ type: OfferVendorType; id: string; zoneId: string | null } | null> {
    const kinds = { in: ['restaurant', 'homemaker'] };
    const own = await this.db.externalRef.findMany({
      where: { clientId, externalId, entityType: kinds },
      select: { entityType: true, internalId: true },
    });
    const first = await this.firstVendor(own);
    if (first || ownOnly) return first;
    if (UUID.test(externalId)) {
      for (const type of ['RESTAURANT', 'HOMEMAKER'] as const) {
        const v = await this.vendor(type, externalId);
        if (v) return { type, id: v.id, zoneId: v.zoneId };
      }
    }
    const any = await this.db.externalRef.findMany({
      where: { externalId, entityType: kinds },
      select: { entityType: true, internalId: true },
      take: 3,
    });
    return new Set(any.map((r) => r.internalId)).size === 1 ? this.firstVendor(any) : null;
  }

  private async firstVendor(
    refs: { entityType: string; internalId: string }[],
  ): Promise<{ type: OfferVendorType; id: string; zoneId: string | null } | null> {
    for (const r of refs) {
      const type = r.entityType === 'restaurant' ? 'RESTAURANT' : 'HOMEMAKER';
      const v = await this.vendor(type, r.internalId);
      if (v) return { type, id: v.id, zoneId: v.zoneId };
    }
    return null;
  }

  /** A customer of this app client by the app's id (null = not known to the Core yet). */
  async customerByRef(clientId: string, externalId: string): Promise<string | null> {
    const ref = await this.db.externalRef.findUnique({
      where: { clientId_entityType_externalId: { clientId, entityType: 'customer', externalId } },
      select: { internalId: true },
    });
    return ref?.internalId ?? null;
  }

  async offerByRef(clientId: string, externalId: string): Promise<string | null> {
    const ref = await this.db.externalRef.findUnique({
      where: { clientId_entityType_externalId: { clientId, entityType: 'offer', externalId } },
      select: { internalId: true },
    });
    return ref?.internalId ?? null;
  }

  /** The app's offer id claimed once; false = another request claimed it first. */
  async claimOfferRef(clientId: string, externalId: string, internalId: string): Promise<boolean> {
    const r = await this.db.externalRef.createMany({
      data: [{ clientId, entityType: 'offer', externalId, internalId }],
      skipDuplicates: true,
    });
    return r.count === 1;
  }

  async externalOfferId(clientId: string, internalId: string): Promise<string | null> {
    const ref = await this.db.externalRef.findFirst({
      where: { clientId, entityType: 'offer', internalId },
      select: { externalId: true },
    });
    return ref?.externalId ?? null;
  }

  /** A vendor-app offer (always VENDOR scope, vendor-funded), straight to PENDING_APPROVAL (F1). */
  async insertFromApp(
    row: Omit<OfferInsert, 'requestedBy' | 'requestedBySuperAdmin'>,
    clientId: string,
    at: Date,
  ): Promise<void> {
    await this.db.offer.create({
      data: {
        ...row,
        status: 'PENDING_APPROVAL',
        source: 'APP',
        submittedByClientId: clientId,
        submittedAt: at,
        requestedBy: null,
        requestedBySuperAdmin: false,
      } as Prisma.OfferUncheckedCreateInput,
    });
  }

  async insertOutbox(rows: readonly OutboxRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.outbox.createMany({
      data: rows.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        zoneId: r.zoneId,
        payloadJson: r.payload as Prisma.InputJsonValue,
      })),
    });
  }

  /** The app's id of a vendor (event audience), restaurant or Home Food, for any client. */
  async vendorExternalIds(vendorId: string): Promise<{ clientId: string; externalId: string }[]> {
    return this.db.externalRef.findMany({
      where: { internalId: vendorId, entityType: { in: ['restaurant', 'homemaker'] } },
      select: { clientId: true, externalId: true },
    });
  }

  /** The sweep (D182): SCHEDULED whose start has come, ACTIVE or PAUSED whose end has passed. */
  async due(now: Date, limit: number): Promise<{ id: string; status: PromotionStatus }[]> {
    return this.db.offer.findMany({
      where: {
        deletedAt: null,
        OR: [
          { status: 'SCHEDULED', validFrom: { lte: now } },
          { status: { in: ['ACTIVE', 'PAUSED'] }, validTo: { lte: now } },
        ],
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, status: true },
    });
  }
}

export interface OffersTx {
  repo: OffersRepository;
  audit: AuditTx;
}

export class OffersDatabase {
  readonly repo: OffersRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new OffersRepository(prisma);
  }

  transaction<T>(fn: (tx: OffersTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new OffersRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 10_000 },
    );
  }

  /**
   * The offers view of a transaction another module already opened (order placement, doc 10 §8: the redemption is
   * written in the order's own transaction, so either both exist or neither).
   */
  static within(tx: Prisma.TransactionClient): OffersTx {
    return { repo: new OffersRepository(tx), audit: auditTx(tx) };
  }
}
