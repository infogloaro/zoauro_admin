import type {
  CashSettlementListQuery,
  CashSettlementListResponse,
  CodBalanceListResponse,
  CodBalanceQuery,
  PayoutListQuery,
  PayoutListResponse,
} from '@zoauro/shared';
import { zonesFor, type AuthContext } from '../../lib/authz';
import type { PermissionKey } from '@zoauro/shared';
import type { Scope, SettlementsRepository } from './settlements.repository';

// COD settlement (doc 16 §2, D173) and payouts (doc 16 §5, D152), read only for the demo: recording a settlement and the
// payout job come later (SA-6.3, SA-6.5).

const DAY_MS = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

export class SettlementsService {
  constructor(
    private readonly repo: SettlementsRepository,
    /** settings payouts.cycleDays for a zone (D152) */
    private readonly cycleDays: (zoneId: string) => Promise<number>,
  ) {}

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
      data: rows.map((s) => ({
        id: s.id,
        zone: s.zone,
        partner: s.deliveryPartner,
        expectedPaise: s.expectedAmount,
        handedInPaise: s.handedInAmount,
        variancePaise: s.variance,
        settledBy: s.settler,
        settledAt: s.settledAt.toISOString(),
        note: s.note,
      })),
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
      this.repo.balances(scope, q),
      this.repo.balanceTotals(scope, q),
    ]);
    return {
      data: rows.flatMap((p) => {
        if (!p.zone) return []; // the query keeps zoned partners only
        const last = p.cashSettlements[0];
        return [
          {
            partner: { id: p.id, name: p.name, status: p.status, isOnline: p.isOnline },
            zone: p.zone,
            cashInHandPaise: p.cashInHand,
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

function scopeOf(ctx: AuthContext, key: PermissionKey): Scope {
  const s = zonesFor(ctx, key);
  return s.kind === 'ALL' ? 'ALL' : s.zoneIds;
}
