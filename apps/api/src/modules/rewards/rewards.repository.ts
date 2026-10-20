import type { Prisma, PrismaClient, RewardEntryType } from '@prisma/client';
import type { AuditTx } from '../../lib/audit';
import { auditTx } from '../../lib/db';

// The only file of the rewards module that imports Prisma. The ledgers are append-only (doc 16): every change is a new
// reward_point_entries / wallet_transactions row carrying the balance after it, plus the running balance on the
// customer row, all in one transaction under a row lock on the customer.

export interface RewardEntryRecord {
  id: string;
  type: RewardEntryType;
  points: number;
  balanceAfter: number;
  orderNo: string | null;
  reason: string | null;
  expiresAt: Date | null;
  actor: { id: string; name: string } | null;
  createdAt: Date;
}

export interface Balances {
  rewardPoints: number;
  walletBalance: number;
}

export interface OpenCredit {
  id: string;
  remaining: number;
}

export class RewardsRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  /** Row lock on the customer; returns the balances (null = no live customer). */
  async lockCustomer(customerId: string): Promise<Balances | null> {
    const rows = await this.db.$queryRaw<{ reward_points: number; wallet_balance: number }[]>`
      SELECT reward_points, wallet_balance FROM customers
      WHERE id = ${customerId}::uuid AND deleted_at IS NULL FOR UPDATE`;
    const r = rows[0];
    return r ? { rewardPoints: r.reward_points, walletBalance: r.wallet_balance } : null;
  }

  async balances(customerId: string): Promise<Balances | null> {
    return this.db.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { rewardPoints: true, walletBalance: true },
    });
  }

  async entries(
    customerId: string,
    page: { skip: number; take: number },
  ): Promise<{ rows: RewardEntryRecord[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.db.rewardPointEntry.findMany({
        where: { customerId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          type: true,
          points: true,
          balanceAfter: true,
          reason: true,
          expiresAt: true,
          createdAt: true,
          order: { select: { orderNo: true } },
          actor: { select: { id: true, name: true } },
        },
      }),
      this.db.rewardPointEntry.count({ where: { customerId } }),
    ]);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        type: r.type,
        points: r.points,
        balanceAfter: r.balanceAfter,
        orderNo: r.order?.orderNo ?? null,
        reason: r.reason,
        expiresAt: r.expiresAt,
        actor: r.actor,
        createdAt: r.createdAt,
      })),
      total,
    };
  }

  /** Points of open credits expiring before `until`. */
  async expiringBefore(customerId: string, now: Date, until: Date): Promise<number> {
    const r = await this.db.rewardPointEntry.aggregate({
      where: { customerId, remaining: { gt: 0 }, expiresAt: { gt: now, lte: until } },
      _sum: { remaining: true },
    });
    return r._sum.remaining ?? 0;
  }

  /** Open credits, the oldest expiry first (credits without expiry last), for oldest-first spending. */
  async openCredits(customerId: string): Promise<OpenCredit[]> {
    const rows = await this.db.rewardPointEntry.findMany({
      where: { customerId, remaining: { gt: 0 } },
      orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, remaining: true },
    });
    return rows.map((r) => ({ id: r.id, remaining: r.remaining ?? 0 }));
  }

  async setRemaining(entryId: string, remaining: number): Promise<void> {
    await this.db.rewardPointEntry.update({ where: { id: entryId }, data: { remaining } });
  }

  /** Points earned from orders since `since` (the monthly cap). */
  async earnedSince(customerId: string, since: Date): Promise<number> {
    const r = await this.db.rewardPointEntry.aggregate({
      where: { customerId, type: 'ORDER_EARN', createdAt: { gte: since } },
      _sum: { points: true },
    });
    return r._sum.points ?? 0;
  }

  async insertEntry(row: {
    id: string;
    customerId: string;
    zoneId: string | null;
    type: RewardEntryType;
    points: number;
    balanceAfter: number;
    remaining: number | null;
    expiresAt: Date | null;
    orderId: string | null;
    reason: string | null;
    actorId: string | null;
    idempotencyKey: string | null;
  }): Promise<void> {
    await this.db.rewardPointEntry.create({ data: row });
  }

  async insertWallet(row: {
    id: string;
    customerId: string;
    zoneId: string | null;
    amountPaise: number;
    balanceAfterPaise: number;
    refId: string;
    reason: string | null;
    actorId: string | null;
  }): Promise<void> {
    await this.db.walletTransaction.create({
      data: { ...row, type: 'REWARD_CONVERT', refType: 'reward_point_entry' },
    });
  }

  async setBalances(customerId: string, b: Balances): Promise<void> {
    await this.db.customer.update({
      where: { id: customerId },
      data: { rewardPoints: b.rewardPoints, walletBalance: b.walletBalance },
    });
  }

  /** A delivered order with its customer and zone; null when missing or not delivered. */
  async deliveredOrder(
    orderId: string,
  ): Promise<{ id: string; customerId: string; zoneId: string; total: number } | null> {
    return this.db.order.findFirst({
      where: { id: orderId, status: 'DELIVERED' },
      select: { id: true, customerId: true, zoneId: true, total: true },
    });
  }

  async earnEntryOf(
    orderId: string,
  ): Promise<{ id: string; points: number; remaining: number } | null> {
    const r = await this.db.rewardPointEntry.findFirst({
      where: { orderId, type: 'ORDER_EARN' },
      select: { id: true, points: true, remaining: true },
    });
    return r ? { id: r.id, points: r.points, remaining: r.remaining ?? 0 } : null;
  }

  async reversalExists(orderId: string): Promise<boolean> {
    return (
      (await this.db.rewardPointEntry.count({ where: { orderId, type: 'ORDER_REVERSAL' } })) > 0
    );
  }

  /** Credits past their expiry that still hold points (the expiry job), grouped by customer. */
  async dueCredits(
    now: Date,
    limit: number,
  ): Promise<{ id: string; customerId: string; remaining: number }[]> {
    const rows = await this.db.rewardPointEntry.findMany({
      where: { remaining: { gt: 0 }, expiresAt: { lte: now } },
      orderBy: [{ customerId: 'asc' }, { expiresAt: 'asc' }],
      take: limit,
      select: { id: true, customerId: true, remaining: true },
    });
    return rows.map((r) => ({ id: r.id, customerId: r.customerId, remaining: r.remaining ?? 0 }));
  }

  // ---- scope helpers (D25, D63): the zones a customer is visible in --------------------------------------------------

  async zonesOfCustomer(customerId: string): Promise<string[]> {
    const [a, o] = await Promise.all([
      this.db.customerAddress.findMany({
        where: { customerId, deletedAt: null, zoneId: { not: null } },
        select: { zoneId: true },
      }),
      this.db.order.findMany({
        where: { customerId },
        distinct: ['zoneId'],
        select: { zoneId: true },
      }),
    ]);
    return [...new Set([...a, ...o].flatMap((r) => (r.zoneId ? [r.zoneId] : [])))].sort();
  }

  /** D63: the zone of the latest order, else of the newest address. */
  async latestZone(customerId: string): Promise<string | null> {
    const order = await this.db.order.findFirst({
      where: { customerId },
      orderBy: { placedAt: 'desc' },
      select: { zoneId: true },
    });
    if (order) return order.zoneId;
    const address = await this.db.customerAddress.findFirst({
      where: { customerId, deletedAt: null, zoneId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { zoneId: true },
    });
    return address?.zoneId ?? null;
  }

  async customerName(customerId: string): Promise<string | null> {
    return (
      (await this.db.customer.findFirst({ where: { id: customerId }, select: { name: true } }))
        ?.name ?? null
    );
  }
}

export interface RewardsTx {
  repo: RewardsRepository;
  audit: AuditTx;
}

export class RewardsDatabase {
  readonly repo: RewardsRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new RewardsRepository(prisma);
  }

  transaction<T>(fn: (tx: RewardsTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new RewardsRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 10_000 },
    );
  }
}
