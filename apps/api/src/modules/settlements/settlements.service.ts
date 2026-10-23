import type {
  CashSettlementCreated,
  CashSettlementCreateInput,
  CashSettlementListQuery,
  CashSettlementListResponse,
  CodBalanceListResponse,
  CodBalanceQuery,
  PartnerPayoutBreakdown,
  PayoutAdFee,
  PayoutDetail,
  PayoutListQuery,
  PayoutListResponse,
  PayoutMarkPaidInput,
  PayoutHistory,
  PayoutOrdersQuery,
  PayoutOrdersResponse,
  PayoutRow,
} from '@zoauro/shared';
import { record, uuidv7 } from '../../lib/audit';
import { assertCanWrite, zonesFor, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import {
  AUDIT_ACTIONS,
  PAYOUT_METHODS,
  type PayoutMethod,
  type PermissionKey,
} from '@zoauro/shared';
import type {
  PayoutRecord,
  Scope,
  SettlementRecord,
  SettlementsDatabase,
  SettlementsRepository,
} from './settlements.repository';

// COD settlement (doc 16 §2, D173) and payouts (doc 16 §5, D152). A Zonal Admin records what a delivery partner handed
// in (settlements:add in the partner's zone); the partner then holds what was expected minus what was handed in. The
// payout job comes later (SA-6.5).

const DAY_MS = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** D182 A2: what the ads module bills a vendor in a payout period (absent until the ads module is wired). */
export type AdFeesFor = (
  payee: { type: 'RESTAURANT' | 'HOMEMAKER'; id: string },
  zoneId: string,
  period: { from: Date; to: Date },
  now: Date,
) => Promise<{ totalPaise: number; rows: PayoutAdFee[] }>;

export interface SettlementsDeps {
  db: SettlementsDatabase;
  /** settings payouts.cycleDays for a zone (D152) */
  cycleDays: (zoneId: string) => Promise<number>;
  /** settings delivery.codLimitPaise for a zone (D173) */
  codLimit: (zoneId: string) => Promise<number>;
  /** settings payouts.partnerShare for a zone (D202), in % */
  partnerShare?: (zoneId: string) => Promise<number>;
  adFees?: AdFeesFor;
  clock: () => Date;
}

/** What a payout pays out now and why (D152, D182 A2, D202). */
interface Amounts {
  vendorRefundsPaise: number;
  adFeesPaise: number;
  adFees: PayoutAdFee[];
  codHeldPaise: number;
  partner: PartnerPayoutBreakdown | null;
  amountToPayPaise: number;
}

export class SettlementsService {
  constructor(private readonly deps: SettlementsDeps) {}

  /** POST /cash-settlements: a hand-in, under a row lock on the partner (doc 16 §2). */
  async record(ctx: AuthContext, input: CashSettlementCreateInput): Promise<CashSettlementCreated> {
    const now = this.deps.clock();
    return this.deps.db.transaction(async (tx) => {
      const p = await tx.repo.lockPartner(input.deliveryPartnerId);
      if (!p?.zoneId) throw new AppError('NOT_FOUND', 'Not found');
      assertCanWrite(ctx, 'settlements:add', p.zoneId);
      if (p.cashInHand !== input.expectedPaise)
        throw new AppError(
          'CONFLICT',
          'The partner’s cash in hand has changed since you opened this; reload and check again',
          [{ field: 'expectedPaise', issue: 'stale' }],
        );
      const id = uuidv7();
      const variance = input.handedInPaise - p.cashInHand;
      const after = p.cashInHand - input.handedInPaise;
      const s = await tx.repo.insertSettlement({
        id,
        deliveryPartnerId: p.id,
        zoneId: p.zoneId,
        expectedAmount: p.cashInHand,
        handedInAmount: input.handedInPaise,
        variance,
        settledBy: ctx.userId,
        settledAt: now,
        note: input.note ?? null,
      });
      await tx.repo.setCashInHand(p.id, after);
      if (input.handedInPaise > 0)
        await tx.repo.insertLedger([
          {
            id: uuidv7(),
            account: 'PLATFORM_CASH',
            debit: input.handedInPaise,
            credit: 0,
            refType: 'cash_settlement',
            refId: id,
          },
          {
            id: uuidv7(),
            account: 'PARTNER_COD_RECEIVABLE',
            debit: 0,
            credit: input.handedInPaise,
            refType: 'cash_settlement',
            refId: id,
          },
        ]);
      await record(tx.audit, {
        module: 'settlements',
        action: 'cod_settlement.confirmed',
        entity: {
          type: 'cod_settlement', // doc 50 entity type
          id,
          label: `COD hand-in of ${p.name}`,
          zoneId: p.zoneId,
        },
        before: { cashInHandPaise: p.cashInHand },
        after: {
          handedInPaise: input.handedInPaise,
          variancePaise: variance,
          cashInHandPaise: after,
        },
        ...(input.note ? { note: input.note } : {}),
      });
      const eventId = uuidv7();
      await tx.repo.insertOutbox({
        id: eventId,
        eventType: 'settlement.confirmed',
        zoneId: p.zoneId,
        payload: {
          eventId,
          type: 'settlement.confirmed',
          schemaVersion: 1,
          occurredAt: now.toISOString(),
          aggregate: { type: 'cash_settlement', id, version: 1 },
          audience: { partnerId: p.id, zoneId: p.zoneId },
          actor: { type: 'ADMIN', id: ctx.userId },
          data: { settlementId: id, confirmedPaise: input.handedInPaise, variancePaise: variance },
        },
      });
      return { ...settlementRow(s), cashInHandAfterPaise: after };
    });
  }

  async settlements(
    ctx: AuthContext,
    q: CashSettlementListQuery,
  ): Promise<CashSettlementListResponse> {
    const scope = scopeOf(ctx, 'settlements:view');
    const [{ rows, total }, t] = await Promise.all([
      this.deps.db.repo.settlements(scope, q),
      this.deps.db.repo.settlementTotals(scope, q),
    ]);
    return {
      data: rows.map(settlementRow),
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        counts: {
          total: t.total,
          withVariance: t.withVariance,
          expectedPaise: t.expected,
          handedInPaise: t.handedIn,
          variancePaise: t.variance,
        },
      },
    };
  }

  async balances(ctx: AuthContext, q: CodBalanceQuery): Promise<CodBalanceListResponse> {
    const scope = scopeOf(ctx, 'settlements:view');
    const [{ rows, total }, t] = await Promise.all([
      this.deps.db.repo.balances(scope, q),
      this.deps.db.repo.balanceTotals(scope, q),
    ]);
    const zoneIds = [...new Set(rows.flatMap((p) => (p.zone ? [p.zone.id] : [])))];
    const limits = new Map(
      await Promise.all(zoneIds.map(async (z) => [z, await this.deps.codLimit(z)] as const)),
    );
    return {
      data: rows.flatMap((p) => {
        if (!p.zone) return []; // the query keeps zoned partners only
        const last = p.cashSettlements[0];
        const limit = limits.get(p.zone.id) ?? 0;
        return [
          {
            partner: { id: p.id, name: p.name, status: p.status, isOnline: p.isOnline },
            zone: p.zone,
            cashInHandPaise: p.cashInHand,
            codLimitPaise: limit,
            overLimit: p.cashInHand >= limit,
            lastSettlement: last
              ? {
                  settledAt: last.settledAt.toISOString(),
                  handedInPaise: last.handedInAmount,
                  variancePaise: last.variance,
                }
              : null,
          },
        ];
      }),
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        counts: { partners: t.partners, withCash: t.withCash, cashInHandPaise: t.cashInHand },
      },
    };
  }

  /** One page of payout rows for an export (D149): the list's scope and mapping, without totals or cycles. */
  async exportPayouts(ctx: AuthContext, q: PayoutListQuery): Promise<PayoutRow[]> {
    const { rows } = await this.deps.db.repo.payouts(scopeOf(ctx, 'payouts:view'), q, false);
    return payoutRows(this.deps.db.repo, rows);
  }

  async payouts(ctx: AuthContext, q: PayoutListQuery): Promise<PayoutListResponse> {
    const scope = scopeOf(ctx, 'payouts:view');
    const [{ rows, total }, t] = await Promise.all([
      this.deps.db.repo.payouts(scope, q),
      this.deps.db.repo.payoutTotals(scope, q),
    ]);
    const now = this.deps.clock();
    // the summary looks back at most 31 days (the longest cycle), then keeps each zone's own cycle
    const s = await this.deps.db.repo.payoutSummary(
      scope,
      q,
      new Date(now.getTime() - 31 * DAY_MS),
    );
    const zoneIds = [...new Set([...rows.map((p) => p.zone.id), ...s.latest.map((l) => l.zoneId)])];
    const [data, cycleList, blocked] = await Promise.all([
      payoutRows(this.deps.db.repo, rows),
      Promise.all(
        zoneIds.map(async (zoneId) => ({ zoneId, days: await this.deps.cycleDays(zoneId) })),
      ),
      Promise.all(
        s.pendingVendors.map((p) =>
          this.deps.db.repo.openVendorRefunds(
            p.payeeId,
            p.zoneId,
            p.periodFrom,
            new Date(p.periodTo.getTime() + DAY_MS),
          ),
        ),
      ),
    ]);
    const cycle = new Map(cycleList.map((c) => [c.zoneId, c.days]));
    const paidNow = s.paid.filter(
      (p) => p.paidAt && p.paidAt.getTime() >= now.getTime() - (cycle.get(p.zoneId) ?? 7) * DAY_MS,
    );
    const pageZones = new Set(rows.map((p) => p.zone.id));
    return {
      data,
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        counts: {
          total: t.total,
          byStatus: t.byStatus,
          grossPaise: t.gross,
          commissionPaise: t.commission,
          netPaise: t.net,
        },
        cycles: cycleList.filter((c) => pageZones.has(c.zoneId)),
        summary: {
          pendingCount: s.pendingCount,
          pendingPaise: s.pendingNet,
          paidThisCycleCount: paidNow.length,
          paidThisCyclePaise: paidNow.reduce((sum, p) => sum + (p.paidAmount ?? p.net), 0),
          blockedCount: blocked.filter((n) => n > 0).length,
          nextPayoutDates: s.latest.map((l) => ({
            zoneId: l.zoneId,
            date: day(new Date(l.periodTo.getTime() + (cycle.get(l.zoneId) ?? 7) * DAY_MS)),
          })),
        },
      },
    };
  }

  /** GET /payouts/{id} (D203): the row, the money block and what is deducted; 404 outside payouts:view. */
  async payout(ctx: AuthContext, id: string): Promise<PayoutDetail> {
    const repo = this.deps.db.repo;
    const p = await repo.payoutInScope(scopeOf(ctx, 'payouts:view'), id);
    if (!p) throw new AppError('NOT_FOUND', 'Not found');
    const from = p.periodFrom;
    const to = new Date(p.periodTo.getTime() + DAY_MS);
    const isVendor = p.payeeType !== 'DELIVERY_PARTNER';
    const [row, amounts, refunds, heldByName] = await Promise.all([
      payoutRows(repo, [p]),
      this.amounts(repo, { ...p, zoneId: p.zone.id }, this.deps.clock()),
      isVendor ? repo.payoutRefunds(p.payeeId, p.zone.id, from, to) : Promise.resolve([]),
      repo.userName(p.heldBy),
    ]);
    const base = row[0];
    if (!base) throw new AppError('NOT_FOUND', 'Not found');
    const refundRows = refunds.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      orderNo: r.order.orderNo,
      status: r.status,
      amountPaise: r.amount,
      vendorSharePaise: r.vendorSharePaise,
      reasonCode: r.reasonCode,
      requestedAt: r.requestedAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      effect: r.status === 'PROCESSED' ? ('COUNTED' as const) : ('OPEN' as const),
    }));
    return {
      ...base,
      deductions: {
        vendorRefundsPaise: amounts.vendorRefundsPaise,
        adFeesPaise: amounts.adFeesPaise,
        codHeldPaise: amounts.codHeldPaise,
      },
      amountToPayPaise:
        p.status === 'PAID' ? (p.paidAmount ?? amounts.amountToPayPaise) : amounts.amountToPayPaise,
      holdReason: p.holdReason,
      heldAt: p.heldAt?.toISOString() ?? null,
      heldByName,
      adjustmentPaise: p.adjustmentPaise,
      adjustmentReason: p.adjustmentReason,
      paidMethod: isPayoutMethod(p.paidMethod) ? p.paidMethod : null,
      paidByName: p.payer?.name ?? null,
      openRefunds: refundRows.filter((r) => r.effect === 'OPEN').length,
      partner: amounts.partner,
      adFees: amounts.adFees,
      refunds: refundRows,
    };
  }

  /** GET /payouts/{id}/orders: the payee's DELIVERED orders in the period; 404 outside payouts:view. */
  async payoutOrders(
    ctx: AuthContext,
    id: string,
    q: PayoutOrdersQuery,
  ): Promise<PayoutOrdersResponse> {
    const repo = this.deps.db.repo;
    const p = await repo.payoutInScope(scopeOf(ctx, 'payouts:view'), id);
    if (!p) throw new AppError('NOT_FOUND', 'Not found');
    const partner = p.payeeType === 'DELIVERY_PARTNER';
    const share = partner ? await this.sharePercent(p.zone.id) : 0;
    const { rows, total } = await repo.payoutOrders(
      { type: p.payeeType, id: p.payeeId },
      p.periodFrom,
      new Date(p.periodTo.getTime() + DAY_MS),
      q.page,
      q.pageSize,
    );
    return {
      data: rows.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        deliveredAt: (o.deliveredAt ?? p.periodTo).toISOString(),
        paymentMethod: o.paymentMethod,
        subtotalPaise: o.subtotal,
        commissionPct: Number(o.commissionPct),
        commissionPaise: o.commissionAmount,
        netPaise: partner ? o.deliveryCharge : o.subtotal - o.commissionAmount,
        deliveryFeePaise: partner ? o.deliveryCharge : null,
        partnerSharePaise: partner ? Math.round((o.deliveryCharge * share) / 100) : null,
      })),
      meta: { page: q.page, pageSize: q.pageSize, total },
    };
  }

  private sharePercent(zoneId: string): Promise<number> {
    return this.deps.partnerShare ? this.deps.partnerShare(zoneId) : Promise.resolve(100);
  }

  /**
   * What the payout pays now (D152, D182 A2, D202): a vendor gets net − vendor-fault refunds − ad fees of the period; a
   * delivery partner gets delivery fees × share − COD still held at period end. Never below 0.
   */
  private async amounts(
    repo: SettlementsRepository,
    p: {
      payeeType: 'RESTAURANT' | 'HOMEMAKER' | 'DELIVERY_PARTNER';
      payeeId: string;
      zoneId: string;
      periodFrom: Date;
      periodTo: Date;
      net: number;
      /** D204: added to the amount to pay (negative allowed) */
      adjustmentPaise: number;
    },
    now: Date,
  ): Promise<Amounts> {
    const from = p.periodFrom;
    const to = new Date(p.periodTo.getTime() + DAY_MS);
    if (p.payeeType === 'DELIVERY_PARTNER') {
      const [fees, held, share] = await Promise.all([
        repo.partnerFees(p.payeeId, from, to),
        repo.codHeldAt(p.payeeId, to),
        this.sharePercent(p.zoneId),
      ]);
      const sharePaise = Math.round((fees.feesPaise * share) / 100);
      return {
        vendorRefundsPaise: 0,
        adFeesPaise: 0,
        adFees: [],
        codHeldPaise: held,
        partner: { ...fees, sharePercent: share, sharePaise, codHeldPaise: held },
        amountToPayPaise: Math.max(sharePaise - held + p.adjustmentPaise, 0),
      };
    }
    const [refunds, ads] = await Promise.all([
      repo.vendorRefunds([p.payeeId], from, to),
      this.deps.adFees
        ? this.deps.adFees({ type: p.payeeType, id: p.payeeId }, p.zoneId, { from, to }, now)
        : Promise.resolve({ totalPaise: 0, rows: [] }),
    ]);
    const vendorRefundsPaise = refunds.reduce((sum, r) => sum + r.paise, 0);
    return {
      vendorRefundsPaise,
      adFeesPaise: ads.totalPaise,
      adFees: ads.rows,
      codHeldPaise: 0,
      partner: null,
      amountToPayPaise: Math.max(
        p.net - vendorRefundsPaise - ads.totalPaise + p.adjustmentPaise,
        0,
      ),
    };
  }

  /**
   * POST /payouts/{id}/mark-paid (doc 16 §5, D152): a Super Admin records a manual payout. Only a PENDING payout; a
   * vendor payout waits while the vendor has open refunds in the period (doc 16 §7). The amount paid is net minus the
   * vendor-fault refunds decided in the period, kept as a snapshot; ledger pair and audit row in the same transaction.
   */
  async markPaid(
    ctx: AuthContext,
    id: string,
    version: number,
    input: PayoutMarkPaidInput,
  ): Promise<PayoutRow> {
    if (!ctx.isSuperAdmin)
      throw new AppError('FORBIDDEN', 'Only a Super Admin can mark a payout paid');
    const now = this.deps.clock();
    return this.deps.db.transaction(async (tx) => {
      const p = await tx.repo.lockPayout(id);
      if (!p) throw new AppError('NOT_FOUND', 'Not found');
      const current = async () => {
        const row = await tx.repo.payoutById(id);
        return row ? (await payoutRows(tx.repo, [row]))[0] : undefined;
      };
      if (p.version !== version)
        throw new AppError(
          'STALE_VERSION',
          'This payout changed; reload it',
          undefined,
          undefined,
          {
            current: await current(),
          },
        );
      if (p.status === 'ON_HOLD')
        throw new AppError('INVALID_STATE_TRANSITION', 'The payout is on hold; release it first', [
          { field: 'status', issue: 'on_hold' },
        ]);
      if (p.status !== 'PENDING')
        throw new AppError('INVALID_STATE_TRANSITION', 'Only a pending payout can be marked paid', [
          { field: 'status', issue: 'not_pending' },
        ]);
      const periodTo = day(p.periodTo);
      if (input.paidOn < periodTo || input.paidOn > istToday(now))
        throw new AppError('VALIDATION_ERROR', 'Paid on must be between the period end and today', [
          { field: 'paidOn', issue: 'out_of_range' },
        ]);
      const from = p.periodFrom;
      const to = new Date(p.periodTo.getTime() + DAY_MS);
      // doc 16 §7: a vendor payout waits for the refunds still open in its period (not a partner's, D202)
      const open =
        p.payeeType === 'DELIVERY_PARTNER'
          ? 0
          : await tx.repo.openVendorRefunds(p.payeeId, p.zoneId, from, to);
      if (open > 0)
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          'The vendor has refunds still open in this period; decide them first',
          [{ field: 'status', issue: 'open_refunds' }],
          undefined,
          { openRefunds: open },
        );
      const paid = (await this.amounts(tx.repo, p, now)).amountToPayPaise;
      const updated = await tx.repo.markPaid(id, version, {
        paidAt: new Date(`${input.paidOn}T00:00:00+05:30`),
        paidBy: ctx.userId,
        paidReference: input.reference,
        paidNote: input.note ?? null,
        paidAmount: paid,
        paidMethod: input.method ?? null,
      });
      if (!updated)
        throw new AppError(
          'STALE_VERSION',
          'This payout changed; reload it',
          undefined,
          undefined,
          {
            current: await current(),
          },
        );
      if (paid > 0)
        await tx.repo.insertLedger([
          {
            id: uuidv7(),
            account: payableAccount(p.payeeType),
            debit: paid,
            credit: 0,
            refType: 'payout',
            refId: id,
          },
          {
            id: uuidv7(),
            account: 'PLATFORM_BANK',
            debit: 0,
            credit: paid,
            refType: 'payout',
            refId: id,
          },
        ]);
      const after = await current();
      if (!after) throw new AppError('NOT_FOUND', 'Not found');
      await record(tx.audit, {
        module: 'payouts',
        action: 'payout.marked_paid',
        entity: {
          type: 'payout',
          id,
          label: `Payout to ${after.payee.name} ${day(p.periodFrom)} to ${periodTo}`,
          zoneId: p.zoneId,
        },
        before: { status: p.status, version: p.version },
        after: {
          status: 'PAID',
          paidPaise: paid,
          paidOn: input.paidOn,
          reference: input.reference,
          method: input.method ?? null,
          adjustmentPaise: p.adjustmentPaise,
        },
        ...(input.note ? { note: input.note } : {}),
      });
      return after;
    });
  }

  /** POST /payouts/{id}/hold (D204): PENDING → ON_HOLD with a reason. */
  holdPayout(ctx: AuthContext, id: string, version: number, reason: string): Promise<PayoutDetail> {
    return this.changePayout(ctx, id, version, { kind: 'hold', reason });
  }

  /** POST /payouts/{id}/release (D204): ON_HOLD → PENDING with a reason. */
  releasePayout(
    ctx: AuthContext,
    id: string,
    version: number,
    reason: string,
  ): Promise<PayoutDetail> {
    return this.changePayout(ctx, id, version, { kind: 'release', reason });
  }

  /** POST /payouts/{id}/adjust (D204): sets the adjustment; the amount to pay stays ≥ 0. */
  adjustPayout(
    ctx: AuthContext,
    id: string,
    version: number,
    input: { adjustmentPaise: number; reason: string },
  ): Promise<PayoutDetail> {
    return this.changePayout(ctx, id, version, { kind: 'adjust', ...input });
  }

  private async changePayout(
    ctx: AuthContext,
    id: string,
    version: number,
    change:
      | { kind: 'hold'; reason: string }
      | { kind: 'release'; reason: string }
      | { kind: 'adjust'; reason: string; adjustmentPaise: number },
  ): Promise<PayoutDetail> {
    if (!ctx.isSuperAdmin)
      throw new AppError('FORBIDDEN', 'Only a Super Admin can change a payout');
    const now = this.deps.clock();
    await this.deps.db.transaction(async (tx) => {
      const p = await tx.repo.lockPayout(id);
      if (!p) throw new AppError('NOT_FOUND', 'Not found');
      if (p.version !== version)
        throw new AppError(
          'STALE_VERSION',
          'This payout changed; reload it',
          undefined,
          undefined,
          {
            current: { status: p.status, version: p.version },
          },
        );
      const from =
        change.kind === 'hold'
          ? ['PENDING']
          : change.kind === 'release'
            ? ['ON_HOLD']
            : ['PENDING', 'ON_HOLD'];
      if (!from.includes(p.status))
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          change.kind === 'release'
            ? 'The payout is not on hold'
            : 'Only a pending or held payout can change',
          [{ field: 'status', issue: change.kind === 'release' ? 'not_on_hold' : 'not_pending' }],
        );
      let data: Parameters<SettlementsRepository['updatePayout']>[3];
      let before: Record<string, unknown>;
      let after: Record<string, unknown>;
      if (change.kind === 'hold') {
        data = { status: 'ON_HOLD', holdReason: change.reason, heldAt: now, heldBy: ctx.userId };
        before = { status: p.status };
        after = { status: 'ON_HOLD' };
      } else if (change.kind === 'release') {
        data = { status: 'PENDING', holdReason: null, heldAt: null, heldBy: null };
        before = { status: p.status, holdReason: p.holdReason };
        after = { status: 'PENDING' };
      } else {
        const old = (await this.amounts(tx.repo, p, now)).amountToPayPaise;
        const base = (await this.amounts(tx.repo, { ...p, adjustmentPaise: 0 }, now))
          .amountToPayPaise;
        const next = base + change.adjustmentPaise;
        if (next < 0)
          throw new AppError('VALIDATION_ERROR', 'The amount to pay cannot go below zero', [
            { field: 'adjustmentPaise', issue: 'below_zero' },
          ]);
        data = { adjustmentPaise: change.adjustmentPaise, adjustmentReason: change.reason };
        before = { adjustmentPaise: p.adjustmentPaise, amountToPayPaise: old };
        after = { adjustmentPaise: change.adjustmentPaise, amountToPayPaise: next };
      }
      if (!(await tx.repo.updatePayout(id, version, from, data)))
        throw new AppError(
          'STALE_VERSION',
          'This payout changed; reload it',
          undefined,
          undefined,
          {
            current: { status: p.status, version: p.version },
          },
        );
      const row = await tx.repo.payoutById(id);
      const payee = row ? (await payoutRows(tx.repo, [row]))[0]?.payee.name : undefined;
      await record(tx.audit, {
        module: 'payouts',
        action:
          change.kind === 'hold'
            ? 'payout.held'
            : change.kind === 'release'
              ? 'payout.released'
              : 'payout.adjusted',
        entity: {
          type: 'payout',
          id,
          label: `Payout to ${payee ?? 'payee'} ${day(p.periodFrom)} to ${day(p.periodTo)}`,
          zoneId: p.zoneId,
        },
        before,
        after,
        note: change.reason,
      });
    });
    return this.payout(ctx, id);
  }

  /** GET /payouts/{id}/history (D204): the payout's audit rows, oldest first; 404 outside payouts:view. */
  async payoutHistory(ctx: AuthContext, id: string): Promise<PayoutHistory> {
    const repo = this.deps.db.repo;
    if (!(await repo.payoutInScope(scopeOf(ctx, 'payouts:view'), id)))
      throw new AppError('NOT_FOUND', 'Not found');
    const labels: Record<string, { label: string } | undefined> = AUDIT_ACTIONS;
    return {
      data: (await repo.payoutAudit(id)).map((r) => ({
        id: r.id,
        action: r.action,
        label: labels[r.action]?.label ?? r.action,
        actor: r.actorId ? { id: r.actorId, name: r.actorName } : null,
        note: r.note,
        before: r.beforeJson,
        after: r.afterJson,
        at: r.createdAt.toISOString(),
      })),
    };
  }
}

/** The account a payout settles (doc 16 §4): what the platform owes vendors or delivery partners. */
export const payableAccount = (payeeType: string) =>
  payeeType === 'DELIVERY_PARTNER' ? 'DELIVERY_PAYABLE' : 'VENDOR_PAYABLE';

const isPayoutMethod = (m: string | null): m is PayoutMethod =>
  m !== null && (PAYOUT_METHODS as readonly string[]).includes(m);

/** Today in India as YYYY-MM-DD. */
const istToday = (now: Date) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** The API rows of some payouts: payee names and, for vendors, the vendor-fault refunds of each period (D152). */
async function payoutRows(repo: SettlementsRepository, rows: PayoutRecord[]): Promise<PayoutRow[]> {
  const ids = {
    RESTAURANT: [] as string[],
    HOMEMAKER: [] as string[],
    DELIVERY_PARTNER: [] as string[],
  };
  for (const p of rows) ids[p.payeeType].push(p.payeeId);
  const vendors = rows.filter((p) => p.payeeType !== 'DELIVERY_PARTNER');
  const [names, refunds] = await Promise.all([
    repo.payeeNames(ids),
    vendors.length
      ? repo.vendorRefunds(
          [...new Set(vendors.map((p) => p.payeeId))],
          new Date(Math.min(...vendors.map((p) => p.periodFrom.getTime()))),
          new Date(Math.max(...vendors.map((p) => p.periodTo.getTime())) + DAY_MS),
        )
      : Promise.resolve([]),
  ]);
  const deducted = (p: PayoutRecord) =>
    p.payeeType === 'DELIVERY_PARTNER'
      ? 0
      : refunds
          .filter(
            (r) =>
              r.vendorId === p.payeeId &&
              r.at.getTime() >= p.periodFrom.getTime() &&
              r.at.getTime() < p.periodTo.getTime() + DAY_MS,
          )
          .reduce((sum, r) => sum + r.paise, 0);
  return rows.map((p) => ({
    id: p.id,
    payee: { type: p.payeeType, id: p.payeeId, name: names.get(p.payeeId) ?? 'Unknown payee' },
    zone: p.zone,
    periodFrom: day(p.periodFrom),
    periodTo: day(p.periodTo),
    grossPaise: p.gross,
    commissionPaise: p.commission,
    netPaise: p.net,
    vendorRefundsPaise: deducted(p),
    status: p.status,
    paidAt: p.paidAt?.toISOString() ?? null,
    paidBy: p.payer,
    paidReference: p.paidReference,
    paidNote: p.paidNote,
    paidPaise: p.paidAmount,
    version: p.version,
    createdAt: p.createdAt.toISOString(),
  }));
}

function settlementRow(s: SettlementRecord) {
  return {
    id: s.id,
    zone: s.zone,
    partner: s.deliveryPartner,
    expectedPaise: s.expectedAmount,
    handedInPaise: s.handedInAmount,
    variancePaise: s.variance,
    settledBy: s.settler,
    settledAt: s.settledAt.toISOString(),
    note: s.note,
  };
}

function scopeOf(ctx: AuthContext, key: PermissionKey): Scope {
  const s = zonesFor(ctx, key);
  return s.kind === 'ALL' ? 'ALL' : s.zoneIds;
}
