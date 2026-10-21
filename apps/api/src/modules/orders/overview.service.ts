import {
  DEFAULT_ORDER_SLA,
  type OrderOverview,
  type OrderOverviewQuery,
  type OrderSla,
} from '@zoauro/shared';
import type { AuthContext } from '../../lib/authz';
import { OverviewRepository, type Scope } from './overview.repository';

// Order overview (D179 section 3, D182): GET /orders/overview and the ids behind GET /orders?delayed=true. The SLA
// thresholds come from the `orders.sla` setting of the zone when the overview covers one zone, else the platform
// value (the Control Panel reader; DEFAULT_ORDER_SLA until the setting exists).

const RANGE_MS = { '24h': 24 * 3_600_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 } as const;
const LIVE = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'ASSIGNED', 'OUT_FOR_DELIVERY'] as const;

export interface OverviewDeps {
  prisma: ConstructorParameters<typeof OverviewRepository>[0];
  /** settings orders.sla for a zone, or the platform value for null */
  sla?: (zoneId: string | null) => Promise<OrderSla>;
  clock: () => Date;
}

export class OrderOverviewService {
  private readonly repo: OverviewRepository;

  constructor(private readonly deps: OverviewDeps) {
    this.repo = new OverviewRepository(deps.prisma);
  }

  private async slaFor(scope: Scope): Promise<OrderSla> {
    if (!this.deps.sla) return DEFAULT_ORDER_SLA;
    return this.deps.sla(
      scope.kind === 'ZONES' && scope.zoneIds.length === 1 ? (scope.zoneIds[0] ?? null) : null,
    );
  }

  async overview(ctx: AuthContext, q: OrderOverviewQuery): Promise<OrderOverview> {
    const now = this.deps.clock();
    const from = new Date(now.getTime() - RANGE_MS[q.range]);
    const scope = this.repo.scope(ctx);
    const sla = await this.slaFor(scope);
    const pay = moneyScope(scope, this.repo.scope(ctx, 'payments:view'));
    const [live, readyUnassigned, preordersDueSoon, range, reasons, money] = await Promise.all([
      this.repo.live(scope, sla, now),
      this.repo.readyUnassigned(scope, sla, now),
      this.repo.preordersDueSoon(scope, now),
      this.repo.inRange(scope, from, now),
      this.repo.topCancelReasons(scope, from, now),
      pay ? this.repo.money(pay, from, now) : Promise.resolve(null),
    ]);
    const open = Object.fromEntries(LIVE.map((s) => [s, 0])) as Record<
      (typeof LIVE)[number],
      number
    >;
    const delayed = { ...open };
    for (const r of live)
      if (r.status in open) {
        open[r.status as keyof typeof open] = r.open;
        delayed[r.status as keyof typeof delayed] = r.delayed;
      }
    return {
      zones: scope.kind === 'ALL' ? 'ALL' : scope.zoneIds,
      range: { key: q.range, from: from.toISOString(), to: now.toISOString() },
      sla,
      open,
      delayed,
      delayedTotal: Object.values(delayed).reduce((a, b) => a + b, 0),
      readyUnassigned,
      preordersDueSoon,
      cancellations: {
        count: range.cancelled,
        rate:
          range.placed === 0 ? null : Math.round((range.cancelled / range.placed) * 1000) / 1000,
        topReasons: reasons,
      },
      avgMinutes: { accept: range.accept, prepare: range.prepare, deliver: range.deliver },
      paymentMix: { COD: range.cod, ONLINE: range.online, WALLET: range.wallet },
      money: money
        ? {
            gmv: money.gmv,
            delivered: money.delivered,
            aov: money.delivered === 0 ? null : Math.round(money.gmv / money.delivered),
          }
        : null,
    };
  }

  /** GET /orders?delayed=true */
  async delayedIds(ctx: AuthContext): Promise<string[]> {
    const scope = this.repo.scope(ctx);
    return this.repo.delayedIds(scope, await this.slaFor(scope), this.deps.clock());
  }
}

/** Zones where the caller views orders AND payments; null = none (money hidden, D182 O2). */
function moneyScope(orders: Scope, payments: Scope): Scope | null {
  if (orders.kind === 'ALL' && payments.kind === 'ALL') return orders;
  const o = orders.kind === 'ALL' ? null : new Set(orders.zoneIds);
  const p = payments.kind === 'ALL' ? null : payments.zoneIds;
  const both = p === null ? [...(o ?? [])] : p.filter((z) => o === null || o.has(z));
  return both.length === 0 ? null : { kind: 'ZONES', zoneIds: both };
}
