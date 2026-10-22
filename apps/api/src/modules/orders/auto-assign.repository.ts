import { Prisma, type PrismaClient } from '@prisma/client';
import type { AuditTx } from '../../lib/audit';
import { zonesFor, type AuthContext } from '../../lib/authz';
import { auditTx } from '../../lib/db';
import type { CandidatePartner } from './auto-assign.rules';
import type { OutboxRow, PartnerLockRow } from './orders.repository';

// Auto-assign (D154, D199) on orders, delivery_partners, order_assignment_offers and order_auto_assign_state. Tagged
// template SQL only (parameters bound, never concatenated). Admin reads take the AuthContext and stay inside
// zonesFor(ctx, 'orders:view'); the methods named system* belong to the sweep (SYSTEM actor, every zone).

export interface AutoAssignOrderRow {
  id: string;
  zoneId: string;
  status: string;
  version: number;
  deliveryPartnerId: string | null;
  paymentMethod: string;
  /** the vendor's pickup point; null when the vendor has no coordinates */
  pickupLat: number | null;
  pickupLng: number | null;
  /** a pre-order the dispatch sweep has not released yet is not the engine's */
  unreleasedPreorder: boolean;
}

export interface AutoAssignStateRow {
  attempts: number;
  nextAttemptAt: Date;
  fallbackAt: Date | null;
  lastOutcome: string | null;
}

export interface AutoAssignOfferRow {
  id: string;
  partnerId: string;
  partnerName: string;
  rank: number;
  distanceM: number;
  status: string;
  offeredAt: Date;
  respondedAt: Date | null;
}

interface RawOrder {
  id: string;
  zone_id: string;
  status: string;
  version: number;
  delivery_partner_id: string | null;
  payment_method: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  unreleased_preorder: boolean;
}

const fromRaw = (r: RawOrder): AutoAssignOrderRow => ({
  id: r.id,
  zoneId: r.zone_id,
  status: r.status,
  version: r.version,
  deliveryPartnerId: r.delivery_partner_id,
  paymentMethod: r.payment_method,
  pickupLat: r.pickup_lat,
  pickupLng: r.pickup_lng,
  unreleasedPreorder: r.unreleased_preorder,
});

// vendor coordinates are Decimal(9,6): ::float8 so $queryRaw returns numbers, not Prisma.Decimal
const ORDER_COLUMNS = Prisma.sql`o.id, o.zone_id, o.status::text AS status, o.version, o.delivery_partner_id,
  o.payment_method::text AS payment_method,
  COALESCE(r.lat, h.lat)::float8 AS pickup_lat, COALESCE(r.lng, h.lng)::float8 AS pickup_lng,
  (o.scheduled_for IS NOT NULL AND o.released_at IS NULL) AS unreleased_preorder`;
const ORDER_FROM = Prisma.sql`orders o LEFT JOIN restaurants r ON r.id = o.restaurant_id
  LEFT JOIN homemakers h ON h.id = o.homemaker_id`;

const PARTNER_LOCK_COLUMNS = Prisma.sql`id, name, zone_id, status::text AS status,
  verification_status::text AS verification_status, is_online, verified_at, current_orders, deleted_at,
  force_offline_until, cash_in_hand`;

export class AutoAssignRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  /** The order if the actor may view it; null when missing or outside the scope (the caller says 404). */
  async findForView(ctx: AuthContext, id: string): Promise<AutoAssignOrderRow | null> {
    const scope = zonesFor(ctx, 'orders:view');
    if (scope.kind === 'ZONES' && scope.zoneIds.length === 0) return null;
    const zoneFilter =
      scope.kind === 'ALL'
        ? Prisma.empty
        : Prisma.sql`AND o.zone_id IN (${Prisma.join(scope.zoneIds.map((z) => Prisma.sql`${z}::uuid`))})`;
    const rows = await this.db.$queryRaw<RawOrder[]>`SELECT ${ORDER_COLUMNS} FROM ${ORDER_FROM}
      WHERE o.id = ${id}::uuid ${zoneFilter}`;
    return rows[0] ? fromRaw(rows[0]) : null;
  }

  async stateOf(orderId: string): Promise<AutoAssignStateRow | null> {
    const rows = await this.db.$queryRaw<
      {
        attempts: number;
        next_attempt_at: Date;
        fallback_at: Date | null;
        last_outcome: string | null;
      }[]
    >`SELECT attempts, next_attempt_at, fallback_at, last_outcome FROM order_auto_assign_state
      WHERE order_id = ${orderId}::uuid`;
    const r = rows[0];
    return r
      ? {
          attempts: r.attempts,
          nextAttemptAt: r.next_attempt_at,
          fallbackAt: r.fallback_at,
          lastOutcome: r.last_outcome,
        }
      : null;
  }

  /** The order's picks, first first (the (order_id, rank) unique index), at most 20. */
  async offersOf(orderId: string): Promise<AutoAssignOfferRow[]> {
    const rows = await this.db.$queryRaw<
      {
        id: string;
        partner_id: string;
        partner_name: string;
        rank: number;
        distance_m: number;
        status: string;
        offered_at: Date;
        responded_at: Date | null;
      }[]
    >`SELECT f.id, f.partner_id, p.name AS partner_name, f.rank, f.distance_m, f.status::text AS status,
        f.offered_at, f.responded_at
      FROM order_assignment_offers f JOIN delivery_partners p ON p.id = f.partner_id
      WHERE f.order_id = ${orderId}::uuid ORDER BY f.rank LIMIT 20`;
    return rows.map((r) => ({
      id: r.id,
      partnerId: r.partner_id,
      partnerName: r.partner_name,
      rank: r.rank,
      distanceM: r.distance_m,
      status: r.status,
      offeredAt: r.offered_at,
      respondedAt: r.responded_at,
    }));
  }

  /** Locks the order (after the caller authorized the write); waits behind a manual assign. */
  async lockOrder(id: string): Promise<AutoAssignOrderRow | null> {
    const rows = await this.db.$queryRaw<RawOrder[]>`SELECT ${ORDER_COLUMNS} FROM ${ORDER_FROM}
      WHERE o.id = ${id}::uuid FOR UPDATE OF o`;
    return rows[0] ? fromRaw(rows[0]) : null;
  }

  /** Zones that can have orders (the service asks the setting of each). */
  async systemZoneIds(): Promise<string[]> {
    const rows = await this.db.$queryRaw<{ id: string }[]>`SELECT id FROM zones
      WHERE deleted_at IS NULL ORDER BY id`;
    return rows.map((r) => r.id);
  }

  /**
   * READY orders of the zone with no partner whose next try is due, oldest first. Not locked: each one is then locked
   * in its own short transaction (systemLockOrder), so manual assigns never wait for a whole batch.
   */
  async systemDueIds(zoneId: string, now: Date, limit: number): Promise<string[]> {
    const rows = await this.db.$queryRaw<{ id: string }[]>`SELECT o.id FROM orders o
      LEFT JOIN order_auto_assign_state s ON s.order_id = o.id
      WHERE o.zone_id = ${zoneId}::uuid AND o.status = 'READY' AND o.delivery_partner_id IS NULL
        AND (o.scheduled_for IS NULL OR o.released_at IS NOT NULL)
        AND (s.order_id IS NULL OR (s.fallback_at IS NULL AND s.next_attempt_at <= ${now}))
      ORDER BY o.placed_at, o.id LIMIT ${limit}`;
    return rows.map((r) => r.id);
  }

  /** The order locked for one try, or null when another transaction holds it (the next sweep tries again). */
  async systemLockOrder(id: string): Promise<AutoAssignOrderRow | null> {
    const rows = await this.db.$queryRaw<RawOrder[]>`SELECT ${ORDER_COLUMNS} FROM ${ORDER_FROM}
      WHERE o.id = ${id}::uuid FOR UPDATE OF o SKIP LOCKED`;
    return rows[0] ? fromRaw(rows[0]) : null;
  }

  /**
   * Partners the D133 picker would offer (online, ACTIVE, VERIFIED, not forced offline; same zone, not deleted, under
   * the cap) who never had this order before. Ranked in memory by auto-assign.rules; at most 200.
   */
  async systemCandidates(
    zoneId: string,
    orderId: string,
    cap: number,
    now: Date,
  ): Promise<CandidatePartner[]> {
    const rows = await this.db.$queryRaw<
      {
        id: string;
        name: string;
        current_orders: number;
        last_lat: number | null;
        last_lng: number | null;
        last_location_at: Date | null;
      }[]
    >`SELECT p.id, p.name, p.current_orders, p.last_lat, p.last_lng, p.last_location_at
      FROM delivery_partners p
      WHERE p.zone_id = ${zoneId}::uuid AND p.deleted_at IS NULL AND p.is_online
        AND p.status = 'ACTIVE' AND p.verification_status = 'VERIFIED'
        AND (p.force_offline_until IS NULL OR p.force_offline_until <= ${now})
        AND p.current_orders < ${cap}
        AND NOT EXISTS (SELECT 1 FROM order_assignment_offers f
          WHERE f.order_id = ${orderId}::uuid AND f.partner_id = p.id)
      ORDER BY p.id LIMIT 200`;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      currentOrders: r.current_orders,
      lastLat: r.last_lat,
      lastLng: r.last_lng,
      lastLocationAt: r.last_location_at,
    }));
  }

  /** The partner locked, or null when a manual assign holds the row (the engine never waits; it takes the next one). */
  async systemLockPartner(id: string): Promise<PartnerLockRow | null> {
    const rows = await this.db.$queryRaw<PartnerLockRow[]>`SELECT ${PARTNER_LOCK_COLUMNS}
      FROM delivery_partners WHERE id = ${id}::uuid FOR UPDATE SKIP LOCKED`;
    return rows[0] ?? null;
  }

  /** READY -> ASSIGNED only at the version read under the lock; returns the new version, or null when it moved. */
  async systemAssignIfCurrent(
    id: string,
    version: number,
    partnerId: string,
  ): Promise<number | null> {
    const rows = await this.db.$queryRaw<{ version: number }[]>`UPDATE orders
      SET status = 'ASSIGNED', delivery_partner_id = ${partnerId}::uuid, version = version + 1, updated_at = now()
      WHERE id = ${id}::uuid AND status = 'READY' AND version = ${version} AND delivery_partner_id IS NULL
      RETURNING version`;
    return rows[0]?.version ?? null;
  }

  async adjustPartnerLoad(id: string, delta: 1 | -1): Promise<void> {
    await this.db.$executeRaw`
      UPDATE delivery_partners SET current_orders = GREATEST(current_orders + ${delta}, 0), updated_at = now()
      WHERE id = ${id}::uuid`;
  }

  /** D121 history row of a system move: actor_type 'SYSTEM', no actor id, no source app. */
  async appendSystemHistory(row: {
    id: string;
    orderId: string;
    from: 'READY';
    to: 'ASSIGNED';
    note: string;
  }): Promise<void> {
    await this.db.orderStatusHistory.create({
      data: {
        id: row.id,
        orderId: row.orderId,
        fromStatus: row.from,
        toStatus: row.to,
        actorId: null,
        actorType: 'SYSTEM',
        note: row.note,
        sourceApp: null,
      },
    });
  }

  /** The order's next offer sequence number, read under the order lock (never reuses a rank after an unassign). */
  async nextRank(orderId: string): Promise<number> {
    const rows = await this.db.$queryRaw<
      { next: number }[]
    >`SELECT (COALESCE(MAX(rank), 0) + 1)::int AS next
      FROM order_assignment_offers WHERE order_id = ${orderId}::uuid`;
    return rows[0]?.next ?? 1;
  }

  /** D199: the pick is assigned at once, so the offer row is born ACCEPTED (offered, expired and answered now). */
  async insertAcceptedOffer(row: {
    id: string;
    orderId: string;
    partnerId: string;
    zoneId: string;
    rank: number;
    distanceM: number;
    at: Date;
  }): Promise<void> {
    await this.db.$executeRaw`INSERT INTO order_assignment_offers
      (id, order_id, partner_id, zone_id, rank, distance_m, status, offered_at, expires_at, responded_at, created_at)
      VALUES (${row.id}::uuid, ${row.orderId}::uuid, ${row.partnerId}::uuid, ${row.zoneId}::uuid, ${row.rank},
        ${row.distanceM}, 'ACCEPTED', ${row.at}, ${row.at}, ${row.at}, ${row.at})`;
  }

  async saveState(row: {
    orderId: string;
    zoneId: string;
    attempts: number;
    nextAttemptAt: Date;
    fallbackAt: Date | null;
    lastOutcome: 'ASSIGNED' | 'NO_PARTNER';
  }): Promise<void> {
    await this.db.$executeRaw`INSERT INTO order_auto_assign_state
      (order_id, zone_id, attempts, next_attempt_at, fallback_at, last_outcome, created_at, updated_at)
      VALUES (${row.orderId}::uuid, ${row.zoneId}::uuid, ${row.attempts}, ${row.nextAttemptAt}, ${row.fallbackAt},
        ${row.lastOutcome}, now(), now())
      ON CONFLICT (order_id) DO UPDATE SET attempts = EXCLUDED.attempts, next_attempt_at = EXCLUDED.next_attempt_at,
        fallback_at = EXCLUDED.fallback_at, last_outcome = EXCLUDED.last_outcome, updated_at = now()`;
  }

  /** "Try auto-assign again": the count starts over and the fallback is cleared. */
  async resetState(orderId: string, now: Date): Promise<void> {
    await this.db.$executeRaw`UPDATE order_auto_assign_state
      SET attempts = 0, fallback_at = NULL, next_attempt_at = ${now}, updated_at = now()
      WHERE order_id = ${orderId}::uuid`;
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

export interface AutoAssignTx {
  repo: AutoAssignRepository;
  audit: AuditTx;
}

export class AutoAssignDatabase {
  readonly repo: AutoAssignRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new AutoAssignRepository(prisma);
  }

  transaction<T>(fn: (tx: AutoAssignTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new AutoAssignRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 15_000 },
    );
  }
}
