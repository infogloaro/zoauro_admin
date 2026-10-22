import { Prisma, type PrismaClient } from '@prisma/client';
import { normaliseIndianMobile, type OrderListQuery, type OrderStatus } from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import { BaseRepository, type AuthContext, type ScopedDelegate } from '../../lib/authz';
import { auditTx } from '../../lib/db';

// The only file of the orders module that imports Prisma (M11). Every read is bounded by zonesFor(ctx, 'orders:view')
// through BaseRepository: a row in a zone the actor cannot view is "not found". Writes re-read the order through the
// same scope and the service checks the action (orders:status / orders:edit) on its zone. Ported from magaraj's dev_cb
// (filters, search, the version-locked update and the status-history row), rebuilt on AuthContext and zone scope.

const listSelect = {
  id: true,
  orderNo: true,
  zoneId: true,
  status: true,
  restaurantId: true,
  homemakerId: true,
  restaurant: { select: { name: true } },
  homemaker: { select: { name: true } },
  customer: { select: { name: true, phone: true } },
  items: { select: { qty: true } },
  total: true,
  paymentMethod: true,
  paymentStatus: true,
  deliveryPartnerId: true,
  placedAt: true,
  version: true,
  // D167 pre-orders
  scheduledFor: true,
  dispatchAt: true,
  releasedAt: true,
  rescheduleCount: true,
  deliveryAddress: true,
  deliveryLat: true,
  deliveryLng: true,
} satisfies Prisma.OrderSelect;
export type OrderListRow = Prisma.OrderGetPayload<{ select: typeof listSelect }>;

const detailSelect = {
  ...listSelect,
  subtotal: true,
  tax: true,
  deliveryCharge: true,
  discount: true,
  customer: { select: { id: true, name: true, phone: true, email: true } },
  deliveryPartner: { select: { id: true, name: true } },
  items: {
    select: { id: true, menuItemId: true, nameSnapshot: true, priceSnapshot: true, qty: true },
    orderBy: { id: 'asc' },
  },
  statusHistory: {
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      actorType: true,
      note: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
  payments: {
    select: { id: true, provider: true, method: true, amount: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
  acceptedAt: true,
  readyAt: true,
  deliveredAt: true,
  cancelledAt: true,
  cancelReason: true,
  addressSnapshotJson: true,
} satisfies Prisma.OrderSelect;
export type OrderDetailRow = Prisma.OrderGetPayload<{ select: typeof detailSelect }>;

/** What a write needs to decide: state, version, zone, payment, vendor and partner. */
const writeSelect = {
  id: true,
  zoneId: true,
  status: true,
  version: true,
  paymentMethod: true,
  paymentStatus: true,
  deliveryPartnerId: true,
  // D167: the pre-order cancel cut-off
  scheduledFor: true,
  dispatchAt: true,
  releasedAt: true,
  restaurant: { select: { status: true } },
  homemaker: { select: { status: true } },
} satisfies Prisma.OrderSelect;
export type OrderWriteRow = Prisma.OrderGetPayload<{ select: typeof writeSelect }>;

export interface PartnerLockRow {
  id: string;
  name: string;
  zone_id: string | null;
  status: string;
  is_online: boolean;
  verified_at: Date | null;
  verification_status: string;
  current_orders: number;
  deleted_at: Date | null;
  force_offline_until: Date | null;
  /** paise of COD cash the partner holds (D173) */
  cash_in_hand: number;
}

export interface OutboxRow {
  id: string;
  eventType: string;
  zoneId: string;
  payload: Record<string, unknown>;
}

const SORT_COLUMN = { placedAt: 'placedAt', total: 'total', orderNo: 'orderNo' } as const;

function listWhere(q: OrderListQuery): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];
  if (q.status) and.push({ status: { in: q.status } });
  if (q.paymentMethod) and.push({ paymentMethod: { in: q.paymentMethod } });
  if (q.paymentStatus) and.push({ paymentStatus: { in: q.paymentStatus } });
  if (q.vendorType === 'RESTAURANT') and.push({ restaurantId: { not: null } });
  if (q.vendorType === 'HOMEMAKER') and.push({ homemakerId: { not: null } });
  if (q.restaurantId) and.push({ restaurantId: q.restaurantId });
  if (q.homemakerId) and.push({ homemakerId: q.homemakerId });
  if (q.customerId) and.push({ customerId: q.customerId });
  if (q.deliveryPartnerId) and.push({ deliveryPartnerId: q.deliveryPartnerId });
  if (q.scheduled === true) and.push({ scheduledFor: { not: null } });
  if (q.scheduled === false) and.push({ scheduledFor: null });
  if (q.from) and.push({ placedAt: { gte: new Date(q.from) } });
  if (q.to) and.push({ placedAt: { lte: new Date(q.to) } });
  if (q.q) {
    // LIKE wildcards typed by the member match themselves; a typed mobile also finds the customer's orders (doc 20,
    // D143)
    const contains = {
      contains: q.q.replace(/[\\%_]/g, (c) => `\\${c}`),
      mode: 'insensitive' as const,
    };
    const phone = normaliseIndianMobile(q.q);
    and.push({
      OR: [
        { orderNo: contains },
        { customer: { name: contains } },
        { restaurant: { name: contains } },
        { homemaker: { name: contains } },
        ...(phone ? [{ customer: { phone } }] : []),
      ],
    });
  }
  return and.length > 0 ? { AND: and } : {};
}

export class OrdersRepository extends BaseRepository<Prisma.OrderWhereInput, OrderListRow> {
  constructor(private readonly db: Prisma.TransactionClient) {
    const delegate: ScopedDelegate<Prisma.OrderWhereInput, OrderListRow> = {
      findMany: (a) => db.order.findMany({ ...a, select: listSelect }),
      findFirst: (a) => db.order.findFirst({ ...a, select: listSelect }),
      count: (a) => db.order.count(a),
    };
    super(delegate, 'orders:view');
  }

  protected zoneFilter(zoneIds: readonly string[]): Prisma.OrderWhereInput {
    return { zoneId: { in: [...zoneIds] } };
  }

  protected idFilter(id: string): Prisma.OrderWhereInput {
    return { id };
  }

  async list(
    ctx: AuthContext,
    q: OrderListQuery,
    /** an extra condition from the service (GET /orders?delayed=true: the delayed ids) */
    extra?: Prisma.OrderWhereInput,
  ): Promise<{ rows: OrderListRow[]; total: number }> {
    const base = listWhere(q);
    const where = this.scope(ctx, this.viewPermission, extra ? { AND: [base, extra] } : base);
    if (where === null) return { rows: [], total: 0 };
    const direction = q.sort.direction;
    const field = SORT_COLUMN[q.sort.field as keyof typeof SORT_COLUMN];
    const [rows, total] = await Promise.all([
      this.db.order.findMany({
        where,
        select: listSelect,
        // id breaks ties so pages never repeat or skip a row
        orderBy: [{ [field]: direction }, { id: direction }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.order.count({ where }),
    ]);
    return { rows, total };
  }

  async detail(ctx: AuthContext, id: string): Promise<OrderDetailRow | null> {
    const where = this.scope(ctx, this.viewPermission, this.idFilter(id));
    if (where === null) return null;
    return this.db.order.findFirst({ where, select: detailSelect });
  }

  /** The order as a write sees it, within the actor's view scope (null = 404). */
  async forWrite(ctx: AuthContext, id: string): Promise<OrderWriteRow | null> {
    const where = this.scope(ctx, this.viewPermission, this.idFilter(id));
    if (where === null) return null;
    return this.db.order.findFirst({ where, select: writeSelect });
  }

  /**
   * Version-locked update (dev_cb): only when the order is still in `from` at `version`. Returns false when another
   * write got there first; the service answers 409 STALE_VERSION with the current row.
   */
  async updateIfCurrent(
    ctx: AuthContext,
    input: {
      id: string;
      from: OrderStatus;
      version: number;
      data: Omit<Prisma.OrderUncheckedUpdateManyInput, 'version'>;
    },
  ): Promise<boolean> {
    const scoped = this.scope(ctx, this.viewPermission, {
      id: input.id,
      status: input.from,
      version: input.version,
    });
    if (scoped === null) return false;
    const r = await this.db.order.updateMany({
      where: scoped,
      data: { ...input.data, version: { increment: 1 } },
    });
    return r.count === 1;
  }

  async appendHistory(row: {
    id: string;
    orderId: string;
    from: OrderStatus;
    to: OrderStatus;
    actorId: string;
    note: string | null;
  }): Promise<void> {
    // D121: admin-panel moves are actor_type 'ADMIN' (the events catalog's own value), source_app null
    await this.db.orderStatusHistory.create({
      data: {
        id: row.id,
        orderId: row.orderId,
        fromStatus: row.from,
        toStatus: row.to,
        actorId: row.actorId,
        actorType: 'ADMIN',
        note: row.note,
        sourceApp: null,
      },
    });
  }

  /** Row lock on the partner, so two assignments cannot both pass the cap (doc 10, TC-ORD-4). */
  async lockPartner(id: string): Promise<PartnerLockRow | null> {
    const rows = await this.db.$queryRaw<PartnerLockRow[]>`
      SELECT id, name, zone_id, status::text AS status, verification_status::text AS verification_status, is_online, verified_at, current_orders, deleted_at, force_offline_until, cash_in_hand
      FROM delivery_partners WHERE id = ${id}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  async adjustPartnerLoad(id: string, delta: 1 | -1): Promise<void> {
    await this.db.$executeRaw`
      UPDATE delivery_partners SET current_orders = GREATEST(current_orders + ${delta}, 0), updated_at = now()
      WHERE id = ${id}::uuid`;
  }

  async insertOutbox(rows: readonly OutboxRow[]): Promise<void> {
    await this.db.outbox.createMany({
      data: rows.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        zoneId: r.zoneId,
        payloadJson: r.payload as Prisma.InputJsonValue,
      })),
    });
  }
}

export interface OrdersTx {
  repo: OrdersRepository;
  audit: AuditTx;
}

export class OrdersDatabase {
  readonly repo: OrdersRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new OrdersRepository(prisma);
  }

  transaction<T>(fn: (tx: OrdersTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new OrdersRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 15_000 },
    );
  }
}
