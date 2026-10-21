import type {
  AuditActionKey,
  CashHandoverInput,
  CashSettlementConfirmInput,
  CashSettlementCreateInput,
  CashSettlementDetail,
  CashSettlementListQuery,
  CashSettlementListResponse,
  CashSettlementRejectInput,
  CashSettlementRow,
  CodBalanceListResponse,
  CodBalanceQuery,
  CodCollectionInput,
  CodCollectionResponse,
  PayoutListQuery,
  PayoutListResponse,
} from '@zoauro/shared';
import { record, uuidv7 } from '../../lib/audit';
import { assertCanWrite, zonesFor, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { PermissionKey } from '@zoauro/shared';
import type {
  OrderCashRow,
  PartnerCashRow,
  Scope,
  SettlementRecord,
  SettlementsDatabase,
  SettlementsRepository,
  SettlementsTx,
} from './settlements.repository';

// COD settlement (doc 16 §2, doc 42, D173) and payouts (doc 16 §5, D152; the payout job comes with M15).
//
// Cash in hand moves in two places, each under a row lock on the partner:
//  - collection: POST /orders/{id}/cod-collection (the customer paid the partner) marks the COD payment PAID and adds
//    the order total to the partner's cash in hand (R-PAY-3); ledger PARTNER_COD_CASH / CUSTOMER_RECEIVABLE.
//  - settlement: what was counted is taken off the cash in hand; expected = the cash in hand at that moment, variance =
//    counted − expected (negative = short). A shortfall stays on the partner's cash in hand for the next settlement and
//    the payout (M15); ledger PLATFORM_CASH / PARTNER_COD_CASH. A hand-over reported by the partner app waits as PENDING
//    until a Zonal Admin counts it (confirm) or rejects it; an admin who counted the cash records it CONFIRMED at once.
// D173: above the zone's float limit the partner gets no new COD orders (enforced in orders assign).

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const state = (message: string, issue: string) =>
  new AppError('INVALID_STATE_TRANSITION', message, [{ field: 'status', issue }]);
const invalid = (field: string, issue: string, message: string) =>
  new AppError('VALIDATION_ERROR', message, [{ field, issue }]);
const stale = (what: string) =>
  new AppError('STALE_VERSION', `This ${what} was changed by someone else. Refresh and try again`, [
    { field: 'version', issue: 'stale' },
  ]);
const rupees = (p: number) => `₹${(p / 100).toFixed(2)}`;

export interface SettlementsDeps {
  db: SettlementsDatabase;
  /** settings payouts.cycleDays for a zone (D152) */
  cycleDays: (zoneId: string) => Promise<number>;
  /** settings cod.floatLimit for a zone (D173) */
  floatLimit?: (zoneId: string) => Promise<{ enabled: boolean; limitPaise: number }>;
  clock: () => Date;
}

const DAY_MS = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

export class SettlementsService {
  private readonly repo: SettlementsRepository;
  private readonly cycleDays: (zoneId: string) => Promise<number>;

  constructor(private readonly deps: SettlementsDeps) {
    this.repo = deps.db.repo;
    this.cycleDays = deps.cycleDays;
  }

  async settlements(
    ctx: AuthContext,
    q: CashSettlementListQuery,
  ): Promise<CashSettlementListResponse> {
    const scope = scopeOf(ctx, 'settlements:view');
    const [{ rows, total }, t] = await Promise.all([
      this.repo.settlements(scope, q),
      this.repo.settlementTotals(scope, q),
    ]);
    return {
      data: rows.map(rowOf),
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
          pending: t.pending,
        },
      },
    };
  }

  async balances(ctx: AuthContext, q: CodBalanceQuery): Promise<CodBalanceListResponse> {
    const scope = scopeOf(ctx, 'settlements:view');
    const [{ rows, total }, t] = await Promise.all([
      this.repo.balances(scope, q),
      this.repo.balanceTotals(scope, q),
    ]);
    const pending = new Map<
      string,
      { id: string; reportedPaise: number; reportedAt: string | null }
    >();
    for (const r of await this.repo.pendingFor(rows.map((p) => p.id)))
      if (!pending.has(r.deliveryPartnerId))
        pending.set(r.deliveryPartnerId, {
          id: r.id,
          reportedPaise: r.reportedAmount ?? 0,
          reportedAt: r.reportedAt?.toISOString() ?? null,
        });
    const limits = new Map<string, number | null>();
    for (const zoneId of new Set(rows.flatMap((p) => (p.zone ? [p.zone.id] : [])))) {
      const f = this.deps.floatLimit ? await this.deps.floatLimit(zoneId) : null;
      limits.set(zoneId, f?.enabled ? f.limitPaise : null);
    }
    return {
      data: rows.flatMap((p) => {
        if (!p.zone) return []; // the query keeps zoned partners only
        const last = p.cashSettlements[0];
        const limit = limits.get(p.zone.id) ?? null;
        return [
          {
            partner: { id: p.id, name: p.name, status: p.status, isOnline: p.isOnline },
            zone: p.zone,
            cashInHandPaise: p.cashInHand,
            lastSettlement: last?.settledAt
              ? {
                  settledAt: last.settledAt.toISOString(),
                  handedInPaise: last.handedInAmount,
                  variancePaise: last.variance,
                }
              : null,
            pendingHandover: pending.get(p.id) ?? null,
            floatLimitPaise: limit,
            overFloatLimit: limit !== null && p.cashInHand >= limit,
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

  // ---- writes (M14) -------------------------------------------------------------------------------------------------

  /** POST /cash-settlements: an admin counted the partner's cash; CONFIRMED at once (doc 16 §2). */
  async record(
    ctx: AuthContext,
    input: CashSettlementCreateInput,
    idempotencyKey: string,
  ): Promise<CashSettlementDetail> {
    const key = `admin:${ctx.userId}:${idempotencyKey}`;
    const id = uuidv7();
    const cash = await this.deps.db.transaction(async (tx) => {
      const partner = await tx.repo.lockPartner(input.deliveryPartnerId);
      if (!partner || partner.deleted_at || !viewable(ctx, 'settlements:view', partner.zone_id))
        throw notFound();
      assertCanWrite(ctx, 'settlements:add', partner.zone_id);
      const expected = partner.cash_in_hand;
      if (expected <= 0 && input.handedInPaise === 0)
        throw invalid('handedInPaise', 'NOTHING_TO_SETTLE', 'The partner holds no COD cash');
      const now = this.deps.clock();
      await tx.repo.insertSettlement({
        id,
        deliveryPartnerId: partner.id,
        zoneId: partner.zone_id,
        expectedAmount: expected,
        handedInAmount: input.handedInPaise,
        variance: input.handedInPaise - expected,
        status: 'CONFIRMED',
        source: 'ADMIN',
        settledBy: ctx.userId,
        settledAt: now,
        reportedAmount: null,
        reportedAt: null,
        reference: input.reference ?? null,
        note: input.note ?? null,
        idempotencyKey: key,
      });
      const zoneId = partner.zone_id;
      return this.settle(
        tx,
        id,
        { ...partner, zone_id: zoneId },
        input.handedInPaise,
        'cod_settlement.recorded',
        ctx.userId,
      );
    });
    return { ...rowOf(await this.load(id)), partnerCashInHandPaise: cash };
  }

  /** POST /cash-settlements/{id}/confirm: the counted amount of a hand-over the partner app reported. */
  async confirm(
    ctx: AuthContext,
    id: string,
    input: CashSettlementConfirmInput,
  ): Promise<CashSettlementDetail> {
    const cur = await this.repo.findSettlement(scopeOf(ctx, 'settlements:view'), id);
    if (!cur) throw notFound();
    assertCanWrite(ctx, 'settlements:edit', cur.zoneId);
    const cash = await this.deps.db.transaction(async (tx) => {
      // the same lock order as record(): partner, then the settlement
      const partner = await tx.repo.lockPartner(cur.deliveryPartnerId);
      await tx.repo.lockSettlement(id);
      const now_ = await tx.repo.findSettlement('ALL', id);
      if (!partner || !partner.zone_id || !now_) throw notFound();
      if (now_.status !== 'PENDING')
        throw state(`This hand-over is already ${now_.status.toLowerCase()}`, 'NOT_PENDING');
      if (now_.version !== input.version) throw stale('hand-over');
      const expected = partner.cash_in_hand;
      const ok = await tx.repo.updateSettlement(id, input.version, {
        status: 'CONFIRMED',
        expectedAmount: expected,
        handedInAmount: input.handedInPaise,
        variance: input.handedInPaise - expected,
        settledBy: ctx.userId,
        settledAt: this.deps.clock(),
        ...(input.note ? { note: input.note } : {}),
      });
      if (!ok) throw stale('hand-over');
      return this.settle(
        tx,
        id,
        { ...partner, zone_id: partner.zone_id },
        input.handedInPaise,
        'cod_settlement.confirmed',
        ctx.userId,
        { status: 'PENDING', reportedPaise: now_.reportedAmount },
      );
    });
    return { ...rowOf(await this.load(id)), partnerCashInHandPaise: cash };
  }

  /** POST /cash-settlements/{id}/reject: the reported hand-over did not happen; no cash moves. */
  async reject(
    ctx: AuthContext,
    id: string,
    input: CashSettlementRejectInput,
  ): Promise<CashSettlementDetail> {
    const cur = await this.repo.findSettlement(scopeOf(ctx, 'settlements:view'), id);
    if (!cur) throw notFound();
    assertCanWrite(ctx, 'settlements:edit', cur.zoneId);
    const cash = await this.deps.db.transaction(async (tx) => {
      const partner = await tx.repo.lockPartner(cur.deliveryPartnerId);
      await tx.repo.lockSettlement(id);
      const now_ = await tx.repo.findSettlement('ALL', id);
      if (!partner || !now_) throw notFound();
      if (now_.status !== 'PENDING')
        throw state(`This hand-over is already ${now_.status.toLowerCase()}`, 'NOT_PENDING');
      if (now_.version !== input.version) throw stale('hand-over');
      const ok = await tx.repo.updateSettlement(id, input.version, {
        status: 'REJECTED',
        settledBy: ctx.userId,
        settledAt: this.deps.clock(),
        note: input.reason,
      });
      if (!ok) throw stale('hand-over');
      await this.audit(
        tx,
        now_,
        'cod_settlement.rejected',
        { status: 'PENDING' },
        {
          status: 'REJECTED',
          reason: input.reason,
        },
      );
      return partner.cash_in_hand;
    });
    return { ...rowOf(await this.load(id)), partnerCashInHandPaise: cash };
  }

  /**
   * Intake POST /partners/{partnerId}/cash-handover (doc 42, cash:handover): a PENDING record for the Zonal Admin to
   * count. The same app key replays the same record. Runs in the API client's audit context.
   */
  async reportFromApp(
    partnerId: string,
    input: CashHandoverInput,
    appKey: string,
  ): Promise<{ id: string; replayed: boolean }> {
    const key = `app:${appKey}`;
    const prior = await this.repo.settlementByKey(key);
    if (prior) return { id: prior.id, replayed: true };
    const id = uuidv7();
    await this.deps.db.transaction(async (tx) => {
      const partner = await tx.repo.lockPartner(partnerId);
      if (!partner || partner.deleted_at || !partner.zone_id) throw notFound();
      await tx.repo.insertSettlement({
        id,
        deliveryPartnerId: partner.id,
        zoneId: partner.zone_id,
        // provisional until the count: the confirm recomputes both against the cash in hand at that moment
        expectedAmount: partner.cash_in_hand,
        handedInAmount: input.amountPaise,
        variance: input.amountPaise - partner.cash_in_hand,
        status: 'PENDING',
        source: 'APP',
        settledBy: null,
        settledAt: null,
        reportedAmount: input.amountPaise,
        reportedAt: new Date(input.at),
        reference: input.reference ?? null,
        note: null,
        idempotencyKey: key,
      });
      const row = await tx.repo.findSettlement('ALL', id);
      if (row)
        await this.audit(tx, row, 'cod_settlement.reported', undefined, {
          status: 'PENDING',
          reportedPaise: input.amountPaise,
          reference: input.reference ?? null,
        });
    });
    return { id, replayed: false };
  }

  /**
   * POST /orders/{id}/cod-collection (orders:status, If-Match): the customer paid the assigned partner in cash. The COD
   * payment becomes PAID (so the order can then be delivered, doc 10) and the total joins the partner's cash in hand.
   */
  async collect(
    ctx: AuthContext,
    orderId: string,
    version: number,
    input: CodCollectionInput,
  ): Promise<CodCollectionResponse> {
    return this.deps.db.transaction(async (tx) => {
      const o = await tx.repo.lockOrder(orderId);
      if (!o || !viewable(ctx, 'orders:view', o.zone_id)) throw notFound();
      assertCanWrite(ctx, 'orders:status', o.zone_id);
      if (o.version !== version)
        throw new AppError(
          'STALE_VERSION',
          'This order was changed by someone else. Refresh and try again',
          [{ field: 'If-Match', issue: 'stale' }],
          undefined,
          { current: { id: o.id, status: o.status, version: o.version } },
        );
      checkCollectable(o);
      const collected = input.collectedPaise ?? o.total;
      if (collected !== o.total)
        throw invalid(
          'collectedPaise',
          'NOT_ORDER_TOTAL',
          `Collect the full order total of ${rupees(o.total)}`,
        );
      const partnerId = o.delivery_partner_id;
      if (!partnerId) throw state('The order has no delivery partner', 'NO_PARTNER');
      const partner = await tx.repo.lockPartner(partnerId);
      if (!partner) throw notFound();
      const paymentId = await tx.repo.markCodPaid(o, uuidv7());
      const cash = await tx.repo.adjustCash(partner.id, o.total);
      await tx.repo.insertLedger([
        {
          id: uuidv7(),
          orderId: o.id,
          account: 'PARTNER_COD_CASH',
          debit: o.total,
          credit: 0,
          refType: 'cod_collection',
          refId: paymentId,
        },
        {
          id: uuidv7(),
          orderId: o.id,
          account: 'CUSTOMER_RECEIVABLE',
          debit: 0,
          credit: o.total,
          refType: 'cod_collection',
          refId: paymentId,
        },
      ]);
      await record(tx.audit, {
        module: 'settlements',
        action: 'cod.collected',
        entity: { type: 'order', id: o.id, label: `Order ${o.order_no}`, zoneId: o.zone_id },
        before: { paymentStatus: o.payment_status, partnerCashInHandPaise: partner.cash_in_hand },
        after: { paymentStatus: 'PAID', partnerCashInHandPaise: cash, collectedPaise: o.total },
      });
      const eventId = uuidv7();
      await tx.repo.insertOutbox([
        {
          id: eventId,
          eventType: 'payment.status_changed',
          zoneId: o.zone_id,
          payload: {
            eventId,
            type: 'payment.status_changed',
            schemaVersion: 1,
            occurredAt: this.deps.clock().toISOString(),
            aggregate: { type: 'order', id: o.id, version: o.version + 1 },
            audience: { zoneId: o.zone_id, orderId: o.id },
            actor: { type: 'ADMIN', id: ctx.userId },
            data: { orderId: o.id, paymentStatus: 'PAID', amountPaise: o.total },
          },
        },
      ]);
      return {
        orderId: o.id,
        paymentId,
        paymentStatus: 'PAID' as const,
        collectedPaise: o.total,
        partner: { id: partner.id, name: partner.name, cashInHandPaise: cash },
        version: o.version + 1,
      };
    });
  }

  /** Cash off the partner, the ledger, the audit row and settlement.confirmed for the partner app. */
  private async settle(
    tx: SettlementsTx,
    id: string,
    partner: PartnerCashRow & { zone_id: string },
    counted: number,
    action: AuditActionKey,
    actorId: string,
    before?: Record<string, unknown>,
  ): Promise<number> {
    const cash = await tx.repo.adjustCash(partner.id, -counted);
    if (counted > 0)
      await tx.repo.insertLedger([
        {
          id: uuidv7(),
          orderId: null,
          account: 'PLATFORM_CASH',
          debit: counted,
          credit: 0,
          refType: 'cash_settlement',
          refId: id,
        },
        {
          id: uuidv7(),
          orderId: null,
          account: 'PARTNER_COD_CASH',
          debit: 0,
          credit: counted,
          refType: 'cash_settlement',
          refId: id,
        },
      ]);
    const row = await tx.repo.findSettlement('ALL', id);
    if (!row) throw notFound();
    await this.audit(tx, row, action, before, {
      status: row.status,
      expectedPaise: row.expectedAmount,
      handedInPaise: row.handedInAmount,
      variancePaise: row.variance,
      partnerCashInHandPaise: cash,
    });
    const eventId = uuidv7();
    await tx.repo.insertOutbox([
      {
        id: eventId,
        eventType: 'settlement.confirmed',
        zoneId: partner.zone_id,
        payload: {
          eventId,
          type: 'settlement.confirmed',
          schemaVersion: 1,
          occurredAt: this.deps.clock().toISOString(),
          aggregate: { type: 'cod_settlement', id, version: row.version },
          audience: { zoneId: partner.zone_id, partnerId: partner.id },
          actor: { type: 'ADMIN', id: actorId },
          data: { settlementId: id, confirmedPaise: counted, variancePaise: row.variance },
        },
      },
    ]);
    return cash;
  }

  private async audit(
    tx: SettlementsTx,
    s: SettlementRecord,
    action: AuditActionKey,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    await record(tx.audit, {
      module: 'settlements',
      action,
      entity: {
        type: 'cod_settlement',
        id: s.id,
        label: `COD hand-in by ${s.deliveryPartner.name}`,
        zoneId: s.zoneId,
      },
      before,
      after,
    });
  }

  private async load(id: string): Promise<SettlementRecord> {
    const r = await this.repo.findSettlement('ALL', id);
    if (!r) throw notFound();
    return r;
  }

  async payouts(ctx: AuthContext, q: PayoutListQuery): Promise<PayoutListResponse> {
    const scope = scopeOf(ctx, 'payouts:view');
    const [{ rows, total }, t] = await Promise.all([
      this.repo.payouts(scope, q),
      this.repo.payoutTotals(scope, q),
    ]);
    const ids = {
      RESTAURANT: [] as string[],
      HOMEMAKER: [] as string[],
      DELIVERY_PARTNER: [] as string[],
    };
    for (const p of rows) ids[p.payeeType].push(p.payeeId);
    const names = await this.repo.payeeNames(ids);

    // D152: the vendor share of vendor-fault refunds decided within each payout's period
    const vendors = rows.filter((p) => p.payeeType !== 'DELIVERY_PARTNER');
    const refunds = vendors.length
      ? await this.repo.vendorRefunds(
          [...new Set(vendors.map((p) => p.payeeId))],
          new Date(Math.min(...vendors.map((p) => p.periodFrom.getTime()))),
          new Date(Math.max(...vendors.map((p) => p.periodTo.getTime())) + DAY_MS),
        )
      : [];
    const deducted = (p: (typeof rows)[number]) =>
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

    const zoneIds = [...new Set(rows.map((p) => p.zone.id))];
    const cycles = await Promise.all(
      zoneIds.map(async (zoneId) => ({ zoneId, days: await this.cycleDays(zoneId) })),
    );
    return {
      data: rows.map((p) => ({
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
        createdAt: p.createdAt.toISOString(),
      })),
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
        cycles,
      },
    };
  }
}

function rowOf(s: SettlementRecord): CashSettlementRow {
  return {
    id: s.id,
    zone: s.zone,
    partner: s.deliveryPartner,
    expectedPaise: s.expectedAmount,
    handedInPaise: s.handedInAmount,
    variancePaise: s.variance,
    status: s.status,
    source: s.source,
    reportedPaise: s.reportedAmount,
    reportedAt: s.reportedAt?.toISOString() ?? null,
    reference: s.reference,
    settledBy: s.settler,
    settledAt: s.settledAt?.toISOString() ?? null,
    note: s.note,
    createdAt: s.createdAt.toISOString(),
    version: s.version,
  };
}

/** Viewable = the module is readable there (else 404, doc 36); the write action is checked by assertCanWrite (403). */
function viewable(ctx: AuthContext, key: PermissionKey, zoneId: string | null): zoneId is string {
  if (!zoneId) return false;
  const s = zonesFor(ctx, key);
  return s.kind === 'ALL' || s.zoneIds.includes(zoneId);
}

function scopeOf(ctx: AuthContext, key: PermissionKey): Scope {
  const s = zonesFor(ctx, key);
  return s.kind === 'ALL' ? 'ALL' : s.zoneIds;
}

/** doc 10 / doc 16 §2: cash is collected from the customer at the door, by the assigned partner, once. */
function checkCollectable(o: OrderCashRow): void {
  if (o.payment_method !== 'COD')
    throw state('Only a cash-on-delivery order is collected in cash', 'NOT_COD');
  if (o.payment_status !== 'PENDING')
    throw state('The cash for this order has already been collected', 'ALREADY_COLLECTED');
  if (o.status !== 'OUT_FOR_DELIVERY' && o.status !== 'ASSIGNED')
    throw state('Cash is collected once the partner has the order', 'NOT_OUT_FOR_DELIVERY');
}
