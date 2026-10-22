import type {
  CashSettlementCreated,
  CashSettlementCreateInput,
  CashSettlementListQuery,
  CashSettlementListResponse,
  CodBalanceListResponse,
  CodBalanceQuery,
  PayoutListQuery,
  PayoutListResponse,
  PayoutMarkPaidInput,
  PayoutRow,
} from '@zoauro/shared';
import { record, uuidv7 } from '../../lib/audit';
import { assertCanWrite, zonesFor, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { PermissionKey } from '@zoauro/shared';
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

export interface SettlementsDeps {
  db: SettlementsDatabase;
  /** settings payouts.cycleDays for a zone (D152) */
  cycleDays: (zoneId: string) => Promise<number>;
  /** settings delivery.codLimitPaise for a zone (D173) */
  codLimit: (zoneId: string) => Promise<number>;
  clock: () => Date;
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

  async payouts(ctx: AuthContext, q: PayoutListQuery): Promise<PayoutListResponse> {
    const scope = scopeOf(ctx, 'payouts:view');
    const [{ rows, total }, t] = await Promise.all([
      this.deps.db.repo.payouts(scope, q),
      this.deps.db.repo.payoutTotals(scope, q),
    ]);
    const zoneIds = [...new Set(rows.map((p) => p.zone.id))];
    const [data, cycles] = await Promise.all([
      payoutRows(this.deps.db.repo, rows),
      Promise.all(
        zoneIds.map(async (zoneId) => ({ zoneId, days: await this.deps.cycleDays(zoneId) })),
      ),
    ]);
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
        cycles,
      },
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
      // doc 16 §5: the delivery-partner payout formula is still open (finance to confirm)
      if (p.payeeType === 'DELIVERY_PARTNER')
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          'Delivery-partner payouts cannot be marked paid until the payout formula is confirmed',
          [{ field: 'payeeType', issue: 'formula_open' }],
        );
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
      const open = await tx.repo.openVendorRefunds(p.payeeId, p.zoneId, from, to);
      if (open > 0)
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          'The vendor has refunds still open in this period; decide them first',
          [{ field: 'status', issue: 'open_refunds' }],
          undefined,
          { openRefunds: open },
        );
      const deducted = (await tx.repo.vendorRefunds([p.payeeId], from, to)).reduce(
        (sum, r) => sum + r.paise,
        0,
      );
      const paid = Math.max(p.net - deducted, 0);
      const updated = await tx.repo.markPaid(id, version, {
        paidAt: new Date(`${input.paidOn}T00:00:00+05:30`),
        paidBy: ctx.userId,
        paidReference: input.reference,
        paidNote: input.note ?? null,
        paidAmount: paid,
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
        },
        ...(input.note ? { note: input.note } : {}),
      });
      return after;
    });
  }
}

/** The account a payout settles (doc 16 §4): what the platform owes vendors or delivery partners. */
export const payableAccount = (payeeType: string) =>
  payeeType === 'DELIVERY_PARTNER' ? 'DELIVERY_PAYABLE' : 'VENDOR_PAYABLE';

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
