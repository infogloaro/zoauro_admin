import { Prisma, type PrismaClient } from '@prisma/client';
import type { AuditTx } from '../../lib/audit';
import { zonesFor, type AuthContext } from '../../lib/authz';
import { auditTx } from '../../lib/db';

// Pre-orders (D150, D167) on the orders table. The pre-order columns (20261020120000_preorders) are read and written
// with tagged-template SQL (parameters bound, never concatenated), so the module does not wait for a regenerated
// Prisma client. Reads by an admin are bounded by zonesFor(ctx, 'orders:view'); the dispatch sweep is the SYSTEM and
// reads every zone.

export interface PreorderRow {
  id: string;
  orderNo: string;
  zoneId: string;
  status: string;
  version: number;
  scheduledFor: Date;
  dispatchAt: Date;
  releasedAt: Date | null;
  rescheduleCount: number;
  deliveryAddress: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
}

interface RawRow {
  id: string;
  order_no: string;
  zone_id: string;
  status: string;
  version: number;
  scheduled_for: Date;
  dispatch_at: Date;
  released_at: Date | null;
  reschedule_count: number;
  delivery_address: string | null;
  delivery_lat: Prisma.Decimal | string | null;
  delivery_lng: Prisma.Decimal | string | null;
}

const num = (v: Prisma.Decimal | string | null): number | null => (v === null ? null : Number(v));
const fromRaw = (r: RawRow): PreorderRow => ({
  id: r.id,
  orderNo: r.order_no,
  zoneId: r.zone_id,
  status: r.status,
  version: r.version,
  scheduledFor: r.scheduled_for,
  dispatchAt: r.dispatch_at,
  releasedAt: r.released_at,
  rescheduleCount: r.reschedule_count,
  deliveryAddress: r.delivery_address,
  deliveryLat: num(r.delivery_lat),
  deliveryLng: num(r.delivery_lng),
});

const COLUMNS = Prisma.sql`id, order_no, zone_id, status::text AS status, version, scheduled_for, dispatch_at,
  released_at, reschedule_count, delivery_address, delivery_lat, delivery_lng`;

export interface OutboxRow {
  id: string;
  eventType: string;
  zoneId: string;
  payload: Record<string, unknown>;
}

export class PreordersRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  /** A pre-order the actor may view; null when missing, not a pre-order or outside the scope (the caller says 404). */
  async find(ctx: AuthContext, id: string): Promise<PreorderRow | null> {
    const scope = zonesFor(ctx, 'orders:view');
    if (scope.kind === 'ZONES' && scope.zoneIds.length === 0) return null;
    const zoneFilter =
      scope.kind === 'ALL'
        ? Prisma.empty
        : Prisma.sql`AND zone_id IN (${Prisma.join(scope.zoneIds.map((z) => Prisma.sql`${z}::uuid`))})`;
    const rows = await this.db.$queryRaw<RawRow[]>`SELECT ${COLUMNS} FROM orders
      WHERE id = ${id}::uuid AND scheduled_for IS NOT NULL ${zoneFilter}`;
    return rows[0] ? fromRaw(rows[0]) : null;
  }

  /** Locks the order row and returns it (after the caller authorized the write). */
  async lock(id: string): Promise<PreorderRow | null> {
    const rows = await this.db.$queryRaw<RawRow[]>`SELECT ${COLUMNS} FROM orders
      WHERE id = ${id}::uuid AND scheduled_for IS NOT NULL FOR UPDATE`;
    return rows[0] ? fromRaw(rows[0]) : null;
  }

  async reschedule(id: string, w: { scheduledFor: Date; dispatchAt: Date }): Promise<void> {
    await this.db
      .$executeRaw`UPDATE orders SET scheduled_for = ${w.scheduledFor}, dispatch_at = ${w.dispatchAt},
      reschedule_count = reschedule_count + 1, version = version + 1, updated_at = now()
      WHERE id = ${id}::uuid`;
  }

  /**
   * Due pre-orders, oldest first, locked for this sweep (SKIP LOCKED: two workers never release the same order):
   * PLACED, not released, dispatch_at reached. Uses the partial index orders_preorders_due.
   */
  async lockDue(now: Date, limit: number): Promise<PreorderRow[]> {
    const rows = await this.db.$queryRaw<RawRow[]>`SELECT ${COLUMNS} FROM orders
      WHERE scheduled_for IS NOT NULL AND released_at IS NULL AND status = 'PLACED' AND dispatch_at <= ${now}
      ORDER BY dispatch_at, id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
    return rows.map(fromRaw);
  }

  /** Marks the order released; bumps the version so the apps apply the event. */
  async release(id: string, at: Date): Promise<number> {
    const rows = await this.db.$queryRaw<{ version: number }[]>`UPDATE orders
      SET released_at = ${at}, version = version + 1, updated_at = now()
      WHERE id = ${id}::uuid AND released_at IS NULL RETURNING version`;
    return rows[0]?.version ?? 0;
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
}

export interface PreordersTx {
  repo: PreordersRepository;
  audit: AuditTx;
}

export class PreordersDatabase {
  readonly repo: PreordersRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new PreordersRepository(prisma);
  }

  transaction<T>(fn: (tx: PreordersTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new PreordersRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 15_000 },
    );
  }
}
