import { Prisma } from '@prisma/client';
import type { OrderSla, PermissionKey } from '@zoauro/shared';
import { zonesFor, type AuthContext } from '../../lib/authz';

// Order overview (D179 section 3): aggregate SQL over orders (parameters bound, never concatenated), bounded by
// zonesFor(ctx, 'orders:view'); money by the zones where the caller also holds payments:view (D182 O2). "Delayed" =
// minutes in the current status above the orders.sla threshold of that status; a pre-order not yet released is not
// delayed (it is waiting for its dispatch time, D167).

const LIVE = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'ASSIGNED', 'OUT_FOR_DELIVERY'] as const;
const MINUTE = 60_000;

/** When the order entered its current status. */
const ENTERED = Prisma.sql`COALESCE(CASE o.status::text
    WHEN 'PLACED' THEN COALESCE(o.released_at, o.placed_at)
    WHEN 'ACCEPTED' THEN o.accepted_at
    WHEN 'PREPARING' THEN o.accepted_at
    WHEN 'READY' THEN o.ready_at
    ELSE (SELECT max(h.created_at) FROM order_status_history h WHERE h.order_id = o.id AND h.to_status = o.status)
  END, o.updated_at)`;

function threshold(sla: OrderSla): Prisma.Sql {
  return Prisma.sql`(CASE o.status::text
    WHEN 'PLACED' THEN ${sla.acceptMinutes}::int
    WHEN 'ACCEPTED' THEN ${sla.prepareMinutes}::int
    WHEN 'PREPARING' THEN ${sla.prepareMinutes}::int
    WHEN 'READY' THEN ${sla.readyToAssignMinutes}::int
    WHEN 'ASSIGNED' THEN ${sla.assignedToPickupMinutes}::int
    ELSE ${sla.outForDeliveryMinutes}::int END)`;
}

const NOT_WAITING_PREORDER = Prisma.sql`NOT (o.scheduled_for IS NOT NULL AND o.released_at IS NULL)`;
const IS_LIVE = Prisma.sql`o.status::text IN (${Prisma.join(LIVE.map((s) => Prisma.sql`${s}`))})`;

export type Scope = { kind: 'ALL' } | { kind: 'ZONES'; zoneIds: string[] };

function zoneSql(scope: Scope): Prisma.Sql {
  if (scope.kind === 'ALL') return Prisma.sql`TRUE`;
  if (scope.zoneIds.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`o.zone_id IN (${Prisma.join(scope.zoneIds.map((z) => Prisma.sql`${z}::uuid`))})`;
}

export class OverviewRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  scope(ctx: AuthContext, key: PermissionKey = 'orders:view'): Scope {
    const s = zonesFor(ctx, key);
    return s.kind === 'ALL' ? s : { kind: 'ZONES', zoneIds: [...s.zoneIds] };
  }

  /** Open orders now and how many of them are delayed, per status. */
  async live(
    scope: Scope,
    sla: OrderSla,
    now: Date,
  ): Promise<{ status: string; open: number; delayed: number }[]> {
    const rows = await this.db.$queryRaw<{ status: string; open: bigint; delayed: bigint }[]>`
      SELECT o.status::text AS status, count(*) AS open,
        count(*) FILTER (WHERE ${now}::timestamptz - ${ENTERED} > make_interval(mins => ${threshold(sla)})) AS delayed
      FROM orders o WHERE ${zoneSql(scope)} AND ${IS_LIVE} AND ${NOT_WAITING_PREORDER}
      GROUP BY 1`;
    return rows.map((r) => ({
      status: r.status,
      open: Number(r.open),
      delayed: Number(r.delayed),
    }));
  }

  async readyUnassigned(scope: Scope, sla: OrderSla, now: Date): Promise<number> {
    const since = new Date(now.getTime() - sla.readyToAssignMinutes * MINUTE);
    const r = await this.db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM orders o
      WHERE ${zoneSql(scope)} AND o.status = 'READY' AND o.delivery_partner_id IS NULL AND o.ready_at <= ${since}`;
    return Number(r[0]?.n ?? 0);
  }

  async preordersDueSoon(scope: Scope, now: Date): Promise<number> {
    const until = new Date(now.getTime() + 120 * MINUTE);
    const r = await this.db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM orders o
      WHERE ${zoneSql(scope)} AND o.scheduled_for IS NOT NULL AND o.released_at IS NULL AND o.status = 'PLACED'
        AND o.dispatch_at <= ${until}`;
    return Number(r[0]?.n ?? 0);
  }

  /** Placed in the range: totals, cancellations, average step minutes, payment mix. */
  async inRange(
    scope: Scope,
    from: Date,
    to: Date,
  ): Promise<{
    placed: number;
    cancelled: number;
    accept: number | null;
    prepare: number | null;
    deliver: number | null;
    cod: number;
    online: number;
    wallet: number;
  }> {
    const r = await this.db.$queryRaw<
      {
        placed: bigint;
        cancelled: bigint;
        accept: number | null;
        prepare: number | null;
        deliver: number | null;
        cod: bigint;
        online: bigint;
        wallet: bigint;
      }[]
    >`SELECT count(*) AS placed,
        count(*) FILTER (WHERE o.status = 'CANCELLED') AS cancelled,
        avg(extract(epoch FROM o.accepted_at - o.placed_at) / 60)::float8 AS accept,
        avg(extract(epoch FROM o.ready_at - o.accepted_at) / 60)::float8 AS prepare,
        avg(extract(epoch FROM o.delivered_at - o.ready_at) / 60)::float8 AS deliver,
        count(*) FILTER (WHERE o.payment_method = 'COD') AS cod,
        count(*) FILTER (WHERE o.payment_method = 'ONLINE') AS online,
        count(*) FILTER (WHERE o.payment_method = 'WALLET') AS wallet
      FROM orders o WHERE ${zoneSql(scope)} AND o.placed_at >= ${from} AND o.placed_at <= ${to}`;
    const x = r[0];
    const round = (v: number | null | undefined) =>
      v === null || v === undefined ? null : Math.round(v * 10) / 10;
    return {
      placed: Number(x?.placed ?? 0),
      cancelled: Number(x?.cancelled ?? 0),
      accept: round(x?.accept),
      prepare: round(x?.prepare),
      deliver: round(x?.deliver),
      cod: Number(x?.cod ?? 0),
      online: Number(x?.online ?? 0),
      wallet: Number(x?.wallet ?? 0),
    };
  }

  async topCancelReasons(
    scope: Scope,
    from: Date,
    to: Date,
  ): Promise<{ reason: string; count: number }[]> {
    const rows = await this.db.$queryRaw<{ reason: string; n: bigint }[]>`
      SELECT COALESCE(NULLIF(o.cancel_reason, ''), 'Not given') AS reason, count(*) AS n FROM orders o
      WHERE ${zoneSql(scope)} AND o.status = 'CANCELLED' AND o.placed_at >= ${from} AND o.placed_at <= ${to}
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5`;
    return rows.map((r) => ({ reason: r.reason, count: Number(r.n) }));
  }

  async money(scope: Scope, from: Date, to: Date): Promise<{ gmv: number; delivered: number }> {
    const r = await this.db.$queryRaw<{ gmv: bigint | null; n: bigint }[]>`
      SELECT sum(o.total) AS gmv, count(*) AS n FROM orders o
      WHERE ${zoneSql(scope)} AND o.status = 'DELIVERED' AND o.placed_at >= ${from} AND o.placed_at <= ${to}`;
    return { gmv: Number(r[0]?.gmv ?? 0), delivered: Number(r[0]?.n ?? 0) };
  }

  /** GET /orders?delayed=true: ids of the delayed open orders in scope (capped). */
  async delayedIds(scope: Scope, sla: OrderSla, now: Date, cap = 1000): Promise<string[]> {
    const rows = await this.db.$queryRaw<{ id: string }[]>`SELECT o.id FROM orders o
      WHERE ${zoneSql(scope)} AND ${IS_LIVE} AND ${NOT_WAITING_PREORDER}
        AND ${now}::timestamptz - ${ENTERED} > make_interval(mins => ${threshold(sla)})
      ORDER BY o.placed_at LIMIT ${cap}`;
    return rows.map((r) => r.id);
  }
}
