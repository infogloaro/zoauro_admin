import {
  maxRedeemablePoints,
  pointsForOrder,
  type AuditActionKey,
  type CustomerRewards,
  type CustomerRewardsQuery,
  type PermissionKey,
  type RewardAdjustInput,
  type RewardConvertInput,
  type RewardRules,
} from '@zoauro/shared';
import { record, uuidv7 } from '../../lib/audit';
import { can, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { RewardsDatabase, RewardsRepository, RewardsTx } from './rewards.repository';

// Reward points (D169). Admin side: the balance and ledger in the customer tab, grants and deductions with a reason,
// conversion to wallet credit. App side (called by the orders and checkout flows): earn on a delivered order, take the
// earn back when the order is refunded, redeem at checkout; the expiry job. Spending takes the oldest credit first.
// The limits are the zone's `loyalty.values` (D101: null = reward points off in that zone).

const DAY_MS = 86_400_000;
const notFound = () => new AppError('NOT_FOUND', 'Not found');
const forbidden = () => new AppError('FORBIDDEN', 'You do not have permission to do this');
const conflict = (message: string, field?: string) =>
  new AppError('CONFLICT', message, field ? [{ field, issue: message }] : undefined);

export interface RewardsDeps {
  db: RewardsDatabase;
  /** settings `loyalty.values` for a zone (SettingsReader.loyalty) */
  rules: (zoneId: string) => Promise<RewardRules | null>;
  clock: () => Date;
}

export class RewardsService {
  constructor(private readonly deps: RewardsDeps) {}

  // ---- admin: the customer tab --------------------------------------------------------------------------------------

  async view(
    ctx: AuthContext,
    customerId: string,
    q: CustomerRewardsQuery,
  ): Promise<CustomerRewards> {
    const repo = this.deps.db.repo;
    const zoneId = await this.visibleZone(ctx, customerId, 'customers:view');
    const balances = await repo.balances(customerId);
    if (!balances) throw notFound();
    const now = this.deps.clock();
    const [page, expiringSoon, rules] = await Promise.all([
      repo.entries(customerId, { skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      repo.expiringBefore(customerId, now, new Date(now.getTime() + 30 * DAY_MS)),
      zoneId ? this.deps.rules(zoneId) : Promise.resolve(null),
    ]);
    return {
      balance: balances.rewardPoints,
      walletBalancePaise: balances.walletBalance,
      expiringSoon,
      rules,
      entries: page.rows.map((e) => ({
        id: e.id,
        type: e.type,
        points: e.points,
        balanceAfter: e.balanceAfter,
        orderNo: e.orderNo,
        reason: e.reason,
        expiresAt: e.expiresAt?.toISOString() ?? null,
        actor: e.actor,
        createdAt: e.createdAt.toISOString(),
      })),
      meta: { page: q.page, pageSize: q.pageSize, total: page.total },
    };
  }

  /** Grant (> 0) or deduct (< 0) with a reason; needs loyalty:edit in a zone where the customer is visible. */
  async adjust(
    ctx: AuthContext,
    customerId: string,
    input: RewardAdjustInput,
  ): Promise<CustomerRewards> {
    const zoneId = await this.writableZone(ctx, customerId);
    const rules = zoneId ? await this.deps.rules(zoneId) : null;
    const now = this.deps.clock();
    await this.deps.db.transaction(async (tx) => {
      const b = await tx.repo.lockCustomer(customerId);
      if (!b) throw notFound();
      const entryId = uuidv7();
      if (input.points > 0) {
        await tx.repo.insertEntry({
          id: entryId,
          customerId,
          zoneId,
          type: 'MANUAL_GRANT',
          points: input.points,
          balanceAfter: b.rewardPoints + input.points,
          remaining: input.points,
          expiresAt: rules ? new Date(now.getTime() + rules.pointsExpiryDays * DAY_MS) : null,
          orderId: null,
          reason: input.reason,
          actorId: ctx.userId,
          idempotencyKey: null,
        });
        await tx.repo.setBalances(customerId, {
          ...b,
          rewardPoints: b.rewardPoints + input.points,
        });
      } else {
        const take = -input.points;
        if (take > b.rewardPoints)
          throw conflict(`The customer has only ${b.rewardPoints} points`, 'points');
        await spendOldestFirst(tx.repo, customerId, take);
        await tx.repo.insertEntry({
          id: entryId,
          customerId,
          zoneId,
          type: 'MANUAL_DEDUCT',
          points: input.points,
          balanceAfter: b.rewardPoints - take,
          remaining: null,
          expiresAt: null,
          orderId: null,
          reason: input.reason,
          actorId: ctx.userId,
          idempotencyKey: null,
        });
        await tx.repo.setBalances(customerId, { ...b, rewardPoints: b.rewardPoints - take });
      }
      await this.audit(
        tx,
        customerId,
        zoneId,
        'customer.points_adjusted',
        b.rewardPoints,
        input.reason,
      );
    });
    return this.view(ctx, customerId, { page: 1, pageSize: 25 });
  }

  /** Points → wallet credit at the zone's point value; the zone must allow it and the minimum must be reached. */
  async convert(
    ctx: AuthContext,
    customerId: string,
    input: RewardConvertInput,
  ): Promise<CustomerRewards> {
    const zoneId = await this.writableZone(ctx, customerId);
    const rules = zoneId ? await this.deps.rules(zoneId) : null;
    if (!rules) throw conflict('Reward points are off in this zone');
    if (!rules.walletConversionEnabled)
      throw conflict('Converting points to wallet credit is switched off in this zone');
    await this.deps.db.transaction(async (tx) => {
      const b = await tx.repo.lockCustomer(customerId);
      if (!b) throw notFound();
      if (b.rewardPoints < rules.minRedeemPoints)
        throw conflict(`At least ${rules.minRedeemPoints} points are needed to redeem`, 'points');
      if (input.points > b.rewardPoints)
        throw conflict(`The customer has only ${b.rewardPoints} points`, 'points');
      await spendOldestFirst(tx.repo, customerId, input.points);
      const entryId = uuidv7();
      const credit = input.points * rules.pointValuePaise;
      const after = {
        rewardPoints: b.rewardPoints - input.points,
        walletBalance: b.walletBalance + credit,
      };
      await tx.repo.insertEntry({
        id: entryId,
        customerId,
        zoneId,
        type: 'WALLET_CONVERT',
        points: -input.points,
        balanceAfter: after.rewardPoints,
        remaining: null,
        expiresAt: null,
        orderId: null,
        reason: null,
        actorId: ctx.userId,
        idempotencyKey: null,
      });
      await tx.repo.insertWallet({
        id: uuidv7(),
        customerId,
        zoneId,
        amountPaise: credit,
        balanceAfterPaise: after.walletBalance,
        refId: entryId,
        reason: `${input.points} reward points`,
        actorId: ctx.userId,
      });
      await tx.repo.setBalances(customerId, after);
      await this.audit(
        tx,
        customerId,
        zoneId,
        'customer.points_converted',
        b.rewardPoints,
        `${input.points} points to wallet credit`,
      );
    });
    return this.view(ctx, customerId, { page: 1, pageSize: 25 });
  }

  // ---- app side: called by the orders and checkout flows (no AuthContext: the order decides the zone) -------------

  /** Credit points for a delivered order (once per order; the monthly cap trims the credit). Returns the points. */
  async earnForDeliveredOrder(orderId: string): Promise<number> {
    const now = this.deps.clock();
    return this.deps.db.transaction(async (tx) => {
      const order = await tx.repo.deliveredOrder(orderId);
      if (!order) return 0;
      if (await tx.repo.earnEntryOf(orderId)) return 0; // already credited
      const rules = await this.deps.rules(order.zoneId);
      if (!rules) return 0;
      let points = pointsForOrder(order.total, rules);
      if (rules.monthlyEarnCapPoints !== null) {
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const earned = await tx.repo.earnedSince(order.customerId, monthStart);
        points = Math.min(points, Math.max(0, rules.monthlyEarnCapPoints - earned));
      }
      if (points <= 0) return 0;
      const b = await tx.repo.lockCustomer(order.customerId);
      if (!b) return 0;
      await tx.repo.insertEntry({
        id: uuidv7(),
        customerId: order.customerId,
        zoneId: order.zoneId,
        type: 'ORDER_EARN',
        points,
        balanceAfter: b.rewardPoints + points,
        remaining: points,
        expiresAt: new Date(now.getTime() + rules.pointsExpiryDays * DAY_MS),
        orderId,
        reason: null,
        actorId: null,
        idempotencyKey: `earn:${orderId}`,
      });
      await tx.repo.setBalances(order.customerId, { ...b, rewardPoints: b.rewardPoints + points });
      return points;
    });
  }

  /** Take back what an order earned when it is refunded: the unspent part only (spent points stay spent). */
  async reverseForRefundedOrder(orderId: string): Promise<number> {
    return this.deps.db.transaction(async (tx) => {
      const earn = await tx.repo.earnEntryOf(orderId);
      if (!earn || earn.remaining <= 0 || (await tx.repo.reversalExists(orderId))) return 0;
      const order = await tx.repo.deliveredOrder(orderId);
      const customerId = order?.customerId;
      if (!customerId) return 0;
      const b = await tx.repo.lockCustomer(customerId);
      if (!b) return 0;
      const take = Math.min(earn.remaining, b.rewardPoints);
      if (take <= 0) return 0;
      await tx.repo.setRemaining(earn.id, earn.remaining - take);
      await tx.repo.insertEntry({
        id: uuidv7(),
        customerId,
        zoneId: order.zoneId,
        type: 'ORDER_REVERSAL',
        points: -take,
        balanceAfter: b.rewardPoints - take,
        remaining: null,
        expiresAt: null,
        orderId,
        reason: null,
        actorId: null,
        idempotencyKey: `reverse:${orderId}`,
      });
      await tx.repo.setBalances(customerId, { ...b, rewardPoints: b.rewardPoints - take });
      return take;
    });
  }

  /**
   * Redeem at checkout: at most the zone's per-order share, only above the minimum. Returns the discount in paise.
   * The caller (the order placement in the intake flow) runs it in the order's own transaction via `tx`.
   */
  async redeemAtCheckout(
    tx: RewardsTx,
    input: {
      customerId: string;
      zoneId: string;
      orderId: string;
      totalPaise: number;
      points: number;
    },
  ): Promise<number> {
    const rules = await this.deps.rules(input.zoneId);
    if (!rules) throw conflict('Reward points are off in this zone');
    const b = await tx.repo.lockCustomer(input.customerId);
    if (!b) throw notFound();
    const allowed = maxRedeemablePoints(input.totalPaise, b.rewardPoints, rules);
    if (input.points > allowed)
      throw conflict(`At most ${allowed} points can be used on this order`, 'points');
    await spendOldestFirst(tx.repo, input.customerId, input.points);
    await tx.repo.insertEntry({
      id: uuidv7(),
      customerId: input.customerId,
      zoneId: input.zoneId,
      type: 'CHECKOUT_REDEEM',
      points: -input.points,
      balanceAfter: b.rewardPoints - input.points,
      remaining: null,
      expiresAt: null,
      orderId: input.orderId,
      reason: null,
      actorId: null,
      idempotencyKey: `redeem:${input.orderId}`,
    });
    await tx.repo.setBalances(input.customerId, {
      ...b,
      rewardPoints: b.rewardPoints - input.points,
    });
    return input.points * rules.pointValuePaise;
  }

  /** The expiry job: credits past their expiry give up what is left of them. Returns the points expired. */
  async expireDue(limit = 500): Promise<number> {
    const now = this.deps.clock();
    const due = await this.deps.db.repo.dueCredits(now, limit);
    let total = 0;
    for (const customerId of [...new Set(due.map((d) => d.customerId))]) {
      total += await this.deps.db.transaction(async (tx) => {
        const b = await tx.repo.lockCustomer(customerId);
        if (!b) return 0;
        let expired = 0;
        for (const c of due.filter((d) => d.customerId === customerId)) {
          expired += c.remaining;
          await tx.repo.setRemaining(c.id, 0);
        }
        expired = Math.min(expired, b.rewardPoints);
        if (expired <= 0) return 0;
        await tx.repo.insertEntry({
          id: uuidv7(),
          customerId,
          zoneId: null,
          type: 'EXPIRY',
          points: -expired,
          balanceAfter: b.rewardPoints - expired,
          remaining: null,
          expiresAt: null,
          orderId: null,
          reason: null,
          actorId: null,
          idempotencyKey: null,
        });
        await tx.repo.setBalances(customerId, { ...b, rewardPoints: b.rewardPoints - expired });
        return expired;
      });
    }
    return total;
  }

  // ---- helpers --------------------------------------------------------------------------------------------------------

  /** D25: the customer must be visible to the caller; returns the zone the rules and audit use (D63). */
  private async visibleZone(
    ctx: AuthContext,
    customerId: string,
    key: PermissionKey,
  ): Promise<string | null> {
    const repo = this.deps.db.repo;
    if (ctx.isSuperAdmin) {
      if ((await repo.customerName(customerId)) === null) throw notFound();
      return repo.latestZone(customerId);
    }
    const zones = (await repo.zonesOfCustomer(customerId)).filter((z) =>
      ctx.assignedZoneIds.includes(z),
    );
    const visible = zones.find((z) => can(ctx, 'customers:view', z));
    if (!visible) throw notFound();
    return zones.find((z) => can(ctx, key, z)) ?? visible;
  }

  /** loyalty:edit in a zone where the customer is visible (404 when not visible, 403 when the action is missing). */
  private async writableZone(ctx: AuthContext, customerId: string): Promise<string | null> {
    const zoneId = await this.visibleZone(ctx, customerId, 'loyalty:edit');
    if (!ctx.isSuperAdmin && (zoneId === null || !can(ctx, 'loyalty:edit', zoneId)))
      throw forbidden();
    return zoneId;
  }

  private async audit(
    tx: RewardsTx,
    customerId: string,
    zoneId: string | null,
    action: AuditActionKey,
    before: number,
    note: string,
  ): Promise<void> {
    const after = await tx.repo.balances(customerId);
    await record(tx.audit, {
      module: 'customers',
      action,
      entity: {
        type: 'customer',
        id: customerId,
        label: (await tx.repo.customerName(customerId)) ?? 'Customer',
        zoneId,
      },
      before: { rewardPoints: before },
      after: {
        rewardPoints: after?.rewardPoints ?? before,
        walletBalancePaise: after?.walletBalance,
      },
      note,
    });
  }
}

/** Spend `points` from the oldest open credits (the caller holds the customer lock). */
async function spendOldestFirst(
  repo: RewardsRepository,
  customerId: string,
  points: number,
): Promise<void> {
  let left = points;
  for (const c of await repo.openCredits(customerId)) {
    if (left <= 0) break;
    const use = Math.min(c.remaining, left);
    await repo.setRemaining(c.id, c.remaining - use);
    left -= use;
  }
}
