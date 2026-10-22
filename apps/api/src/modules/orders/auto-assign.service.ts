import type {
  AutoAssignOffer,
  AutoAssignStateResponse,
  RunAutoAssignResponse,
} from '@zoauro/shared';
import { record, runAsSystem, uuidv7 } from '../../lib/audit';
import { assertCanWrite, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import { codBlocked, distanceLabel, rankCandidates } from './auto-assign.rules';
import type {
  AutoAssignDatabase,
  AutoAssignOfferRow,
  AutoAssignOrderRow,
  AutoAssignTx,
} from './auto-assign.repository';
import type { OutboxRow } from './orders.repository';
import { partnerProblem } from './orders.service';

// Auto-assign (D154, D199). A zone with delivery.autoAssign.enabled gets each READY order assigned to the nearest
// eligible partner within the radius: the same guards as a manual assign (partnerProblem, D121 cap, D173 COD limit),
// the same version-locked READY -> ASSIGNED, history, audit and outbox, with the System actor. Nobody free: try again
// after offerTimeoutSeconds; after maxAttempts the order is left for manual assignment (fallback_at; audit
// job.auto_assign_fallback; the order page shows it). The worker sweeps every AUTO_ASSIGN_SWEEP_MS; an admin can ask
// for one try now (POST /orders/{id}/auto-assign).

const JOB = 'auto-assign';
/** Technical cadence of the sweep (like the pre-order sweep's 60 s), not a business value. */
export const AUTO_ASSIGN_SWEEP_MS = 10_000;
/** Orders tried per zone per sweep; the next sweep takes the rest. */
export const DUE_BATCH = 25;

export interface AutoAssignSetting {
  enabled: boolean;
  radiusKm: number;
  offerTimeoutSeconds: number;
  maxAttempts: number;
  locationMaxAgeMinutes: number;
}

export interface AutoAssignDeps {
  db: AutoAssignDatabase;
  /** the zone's effective delivery.autoAssign (SettingsReader.autoAssign) */
  setting: (zoneId: string) => Promise<AutoAssignSetting>;
  /** D121 (SettingsReader.maxConcurrentOrders) */
  maxConcurrentOrders: (zoneId: string) => Promise<number>;
  /** D173 (SettingsReader.codLimitPaise) */
  codLimit: (zoneId: string) => Promise<number>;
  clock: () => Date;
}

type Outcome = 'ASSIGNED' | 'NO_PARTNER' | 'FALLBACK';
interface Attempt {
  outcome: Outcome;
  version: number;
  partnerId: string | null;
  offer: AutoAssignOffer | null;
}

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const notReady = () =>
  new AppError(
    'INVALID_STATE_TRANSITION',
    'Only a ready order without a delivery partner can be auto-assigned',
    [{ field: 'status', issue: 'NOT_READY' }],
  );

export class AutoAssignService {
  constructor(private readonly deps: AutoAssignDeps) {}

  /** GET /orders/{id}/auto-assign: the zone's setting, the attempt state and the picks (orders:view). */
  async state(ctx: AuthContext, id: string): Promise<AutoAssignStateResponse> {
    const order = await this.deps.db.repo.findForView(ctx, id);
    if (!order) throw notFound();
    const [s, state, offers] = await Promise.all([
      this.deps.setting(order.zoneId),
      this.deps.db.repo.stateOf(id),
      this.deps.db.repo.offersOf(id),
    ]);
    return {
      orderId: order.id,
      zoneId: order.zoneId,
      setting: {
        enabled: s.enabled,
        radiusKm: s.radiusKm,
        offerTimeoutSeconds: s.offerTimeoutSeconds,
        maxAttempts: s.maxAttempts,
      },
      state: state
        ? {
            attempts: state.attempts,
            nextAttemptAt: state.nextAttemptAt.toISOString(),
            fallbackAt: state.fallbackAt?.toISOString() ?? null,
            lastOutcome:
              state.lastOutcome === 'ASSIGNED' || state.lastOutcome === 'NO_PARTNER'
                ? state.lastOutcome
                : null,
          }
        : null,
      offers: offers.map(offerOut),
    };
  }

  /**
   * POST /orders/{id}/auto-assign ("Try auto-assign again"): orders:edit in the order's zone, If-Match version. The
   * count and the fallback start over, then one try runs now.
   */
  async runNow(ctx: AuthContext, id: string, version: number): Promise<RunAutoAssignResponse> {
    const seen = await this.deps.db.repo.findForView(ctx, id);
    if (!seen) throw notFound();
    assertCanWrite(ctx, 'orders:edit', seen.zoneId);
    const setting = await this.deps.setting(seen.zoneId);
    if (!setting.enabled)
      throw new AppError('INVALID_STATE_TRANSITION', 'Auto-assign is off for this zone', [
        { field: 'zoneId', issue: 'AUTO_ASSIGN_OFF' },
      ]);
    return this.deps.db.transaction(async (tx) => {
      const order = await tx.repo.lockOrder(id);
      if (!order) throw notFound();
      if (order.version !== version)
        throw new AppError(
          'STALE_VERSION',
          'The order changed since it was read',
          undefined,
          undefined,
          { current: { status: order.status, version: order.version } },
        );
      if (order.status !== 'READY' || order.deliveryPartnerId !== null || order.unreleasedPreorder)
        throw notReady();
      await record(tx.audit, {
        module: 'orders',
        action: 'order.auto_assign_requested',
        entity: { type: 'order', id, zoneId: order.zoneId },
        after: { status: order.status },
      });
      const now = this.deps.clock();
      await tx.repo.resetState(id, now);
      // the try itself is the System's, as in the sweep
      const a = await runAsSystem(JOB, () => this.attempt(tx, order, setting, 0, now));
      return {
        outcome: a.outcome,
        order: {
          id,
          status: a.outcome === 'ASSIGNED' ? 'ASSIGNED' : 'READY',
          version: a.version,
          deliveryPartnerId: a.partnerId,
        },
        offer: a.offer,
      };
    });
  }

  /** The sweep: every zone that has it on, up to DUE_BATCH due orders each, one short transaction per order. */
  async sweep(): Promise<{ assigned: number; tried: number }> {
    return runAsSystem(JOB, async () => {
      let assigned = 0;
      let tried = 0;
      for (const zoneId of await this.deps.db.repo.systemZoneIds()) {
        const setting = await this.deps.setting(zoneId);
        if (!setting.enabled) continue;
        const due = await this.deps.db.repo.systemDueIds(zoneId, this.deps.clock(), DUE_BATCH);
        for (const id of due) {
          const outcome = await this.deps.db.transaction(async (tx) => {
            const order = await tx.repo.systemLockOrder(id);
            // taken by a manual write meanwhile, or no longer due: leave it
            if (!order || order.status !== 'READY' || order.deliveryPartnerId !== null) return null;
            if (order.unreleasedPreorder) return null;
            const state = await tx.repo.stateOf(id);
            if (state?.fallbackAt) return null;
            return (await this.attempt(tx, order, setting, state?.attempts ?? 0, this.deps.clock()))
              .outcome;
          });
          if (outcome === null) continue;
          tried += 1;
          if (outcome === 'ASSIGNED') assigned += 1;
        }
      }
      return { assigned, tried };
    });
  }

  /** One try on a locked READY order. `attemptsBefore` is the count already stored (0 after a reset). */
  private async attempt(
    tx: AutoAssignTx,
    order: AutoAssignOrderRow,
    setting: AutoAssignSetting,
    attemptsBefore: number,
    now: Date,
  ): Promise<Attempt> {
    const attempts = attemptsBefore + 1;
    const cap = await this.deps.maxConcurrentOrders(order.zoneId);
    const codLimit = order.paymentMethod === 'COD' ? await this.deps.codLimit(order.zoneId) : null;
    const pickup =
      order.pickupLat !== null && order.pickupLng !== null
        ? { lat: order.pickupLat, lng: order.pickupLng }
        : null;
    const ranked = rankCandidates(
      pickup,
      await tx.repo.systemCandidates(order.zoneId, order.id, cap, now),
      { radiusKm: setting.radiusKm, locationMaxAgeMinutes: setting.locationMaxAgeMinutes },
      now,
    );

    for (const [i, c] of ranked.entries()) {
      // a partner a manual assign is holding is skipped, never waited for
      const partner = await tx.repo.systemLockPartner(c.partner.id);
      if (!partner) continue;
      if (partnerProblem(partner, order.zoneId, cap, now)) continue;
      if (codBlocked(order.paymentMethod, partner.cash_in_hand, codLimit)) continue;

      const version = await tx.repo.systemAssignIfCurrent(order.id, order.version, partner.id);
      if (version === null)
        return { outcome: 'NO_PARTNER', version: order.version, partnerId: null, offer: null };
      await tx.repo.adjustPartnerLoad(partner.id, 1);
      const note = `Auto-assigned: choice ${i + 1}, ${distanceLabel(c.distanceM)} from the pickup`;
      await tx.repo.appendSystemHistory({
        id: uuidv7(),
        orderId: order.id,
        from: 'READY',
        to: 'ASSIGNED',
        note,
      });
      await record(tx.audit, {
        module: 'orders',
        action: 'order.partner_assigned',
        entity: { type: 'order', id: order.id, zoneId: order.zoneId },
        before: { status: 'READY', deliveryPartnerId: null },
        after: { status: 'ASSIGNED', deliveryPartnerId: partner.id },
        note,
      });
      await tx.repo.insertOutbox([
        event('order.status_changed', order, version, now, { from: 'READY', to: 'ASSIGNED', note }),
        event('order.assigned', order, version, now, {
          partnerId: partner.id,
          partnerName: partner.name,
        }),
      ]);
      const offerId = uuidv7();
      const rank = await tx.repo.nextRank(order.id);
      await tx.repo.insertAcceptedOffer({
        id: offerId,
        orderId: order.id,
        partnerId: partner.id,
        zoneId: order.zoneId,
        rank,
        distanceM: c.distanceM,
        at: now,
      });
      await tx.repo.saveState({
        orderId: order.id,
        zoneId: order.zoneId,
        attempts,
        nextAttemptAt: now,
        fallbackAt: null,
        lastOutcome: 'ASSIGNED',
      });
      return {
        outcome: 'ASSIGNED',
        version,
        partnerId: partner.id,
        offer: offerOut({
          id: offerId,
          partnerId: partner.id,
          partnerName: partner.name,
          rank,
          distanceM: c.distanceM,
          status: 'ACCEPTED',
          offeredAt: now,
          respondedAt: now,
        }),
      };
    }

    // nobody free: try again later, or give up after maxAttempts
    const fallback = attempts >= setting.maxAttempts;
    await tx.repo.saveState({
      orderId: order.id,
      zoneId: order.zoneId,
      attempts,
      nextAttemptAt: new Date(now.getTime() + setting.offerTimeoutSeconds * 1000),
      fallbackAt: fallback ? now : null,
      lastOutcome: 'NO_PARTNER',
    });
    if (fallback)
      await record(tx.audit, {
        module: 'system',
        action: 'job.auto_assign_fallback',
        entity: { type: 'order', id: order.id, zoneId: order.zoneId },
        after: { attempts, radiusKm: setting.radiusKm },
      });
    return {
      outcome: fallback ? 'FALLBACK' : 'NO_PARTNER',
      version: order.version,
      partnerId: null,
      offer: null,
    };
  }
}

function offerOut(o: AutoAssignOfferRow): AutoAssignOffer {
  return {
    id: o.id,
    partnerId: o.partnerId,
    partnerName: o.partnerName,
    rank: o.rank,
    distanceM: o.distanceM,
    status: o.status as AutoAssignOffer['status'],
    offeredAt: o.offeredAt.toISOString(),
    respondedAt: o.respondedAt?.toISOString() ?? null,
  };
}

/** Outbox envelope as orders.events.ts (doc 43), with the System actor. */
function event(
  type: string,
  o: { id: string; zoneId: string },
  version: number,
  at: Date,
  data: Record<string, unknown>,
): OutboxRow {
  const id = uuidv7();
  return {
    id,
    eventType: type,
    zoneId: o.zoneId,
    payload: {
      eventId: id,
      type,
      schemaVersion: 1,
      occurredAt: at.toISOString(),
      aggregate: { type: 'order', id: o.id, version },
      audience: { zoneId: o.zoneId, orderId: o.id },
      actor: { type: 'SYSTEM', id: null },
      data,
    },
  };
}
