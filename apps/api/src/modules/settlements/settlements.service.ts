import type {
  CashSettlementCreated,
  CashSettlementCreateInput,
  CashSettlementListQuery,
  CashSettlementListResponse,
  CodBalanceListResponse,
  CodBalanceQuery,
  PayoutListQuery,
  PayoutListResponse,
} from '@zoauro/shared';
import { record, uuidv7 } from '../../lib/audit';
import { assertCanWrite, zonesFor, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { PermissionKey } from '@zoauro/shared';
import type { Scope, SettlementRecord, SettlementsDatabase } from './settlements.repository';

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
    const ids = {
      RESTAURANT: [] as string[],
      HOMEMAKER: [] as string[],
      DELIVERY_PARTNER: [] as string[],
    };
    for (const p of rows) ids[p.payeeType].push(p.payeeId);
    const names = await this.deps.db.repo.payeeNames(ids);

    // D152: the vendor share of vendor-fault refunds decided within each payout's period
    const vendors = rows.filter((p) => p.payeeType !== 'DELIVERY_PARTNER');
    const refunds = vendors.length
      ? await this.deps.db.repo.vendorRefunds(
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
      zoneIds.map(async (zoneId) => ({ zoneId, days: await this.deps.cycleDays(zoneId) })),
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
