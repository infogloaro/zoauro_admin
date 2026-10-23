import {
  OFFER_INVALID_TEXT,
  bestAutomaticOffer,
  offerPaymentMethodOf,
  offerRuleProblems,
  priceOffer,
  type AuditActionKey,
  type IntakeOfferListQuery,
  type IntakeOfferPublic,
  type IntakeOfferQuote,
  type IntakeOfferQuoteInput,
  type IntakeOfferRef,
  type IntakeVendorOfferCreate,
  type OfferInvalidReason,
  type OfferRules,
  type OfferVendorType,
  type PricingCart,
  type PromotionStatus,
} from '@zoauro/shared';
import { record, runAsSystem, uuidv7 } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { statusChangedRows } from './offers.events';
import { OffersDatabase, type OfferRow, type OffersTx } from './offers.repository';

// Offer redemption and the apps' side of offers (doc 10 §8; doc 42 §5.2–5.3; D182 F1–F5, D199–D203, D205).
//
//  - apply: in the ORDER's transaction (`applyWithin`, for order intake) or in its own (`apply`, the demo and tests).
//    The offer row is locked, re-read and priced (shared priceOffer); the app's discount must match; one redemption per
//    order; used_count and spent_paise move with it. The use that takes the last of the total uses ends the offer
//    (EXPIRED); the one that takes the last of the budget pauses it (PAUSED, BUDGET_SPENT). A refusal is 422
//    OFFER_INVALID with meta.reason; when the reason is the budget, the offer is paused in a separate transaction (the
//    order's rolls back).
//  - reverse (F4): an order cancelled before delivery gives the use and the budget back (`reverseForOrder`, called by
//    the orders module after the cancel commits; the sweep catches any it missed). Refunds never do (D201).
//  - the apps: the customer app lists live offers and quotes a cart (read only); the vendor app submits its own
//    vendor-funded offers (PENDING_APPROVAL, decided by the zone's admin) and withdraws them while still pending.
// Checkout groups (D203) arrive with multi-restaurant checkout (D181): `checkoutGroupId` is stored, nothing else yet.

export interface ApplyInput {
  orderId: string;
  customerId: string;
  checkoutGroupId?: string | null;
  cart: PricingCart;
  /** what the app sent: the offer's id (from a quote) or its code */
  offer: { offerId: string } | { code: string };
  /** the app's `discountPaise`; absent = take the Core's figure */
  expectedDiscountPaise?: number;
}

export interface Applied {
  redemptionId: string;
  offerId: string;
  discountPaise: number;
  vendorPaise: number;
  platformPaise: number;
}

export interface AppClientRef {
  id: string;
}

const REVERSE_BATCH = 200;
const BUDGET_SPENT_TEXT = 'Budget spent';
const USES_TAKEN_TEXT = 'Every use taken';

export function offerInvalid(reason: OfferInvalidReason, offerId: string | null): AppError {
  return new AppError(
    'OFFER_INVALID',
    OFFER_INVALID_TEXT[reason],
    [{ field: 'offer', issue: reason }],
    undefined,
    { reason, offerId },
  );
}

export class OfferRedemptions {
  constructor(
    private readonly deps: {
      db: OffersDatabase;
      clock: () => Date;
      rules: () => Promise<OfferRules>;
    },
  ) {}

  // ---- apply ----------------------------------------------------------------------------------------------------------

  /**
   * Inside the order's transaction (order intake): either the order and its redemption exist, or neither. Throws 422
   * OFFER_INVALID; on BUDGET_SPENT call `afterRefused` once the order's transaction has rolled back.
   */
  async applyWithin(tx: OffersTx, input: ApplyInput): Promise<Applied> {
    const found =
      'offerId' in input.offer
        ? await tx.repo.byId(input.offer.offerId)
        : await tx.repo.byCode(input.offer.code);
    if (!found) throw offerInvalid('NOT_FOUND', null);
    await tx.repo.lock(found.id);
    const o = await tx.repo.byId(found.id);
    if (!o) throw offerInvalid('NOT_FOUND', null);
    const now = this.deps.clock();
    const [uses, delivered] = await Promise.all([
      tx.repo.customerUses(input.customerId, [o.id]),
      tx.repo.deliveredOrders(input.customerId),
    ]);
    const price = priceOffer(
      o,
      input.cart,
      { deliveredOrders: delivered, usesOfOffer: uses.get(o.id) ?? 0 },
      now,
    );
    if (!price.ok) throw offerInvalid(price.reason, o.id);
    if (
      input.expectedDiscountPaise !== undefined &&
      input.expectedDiscountPaise !== price.discountPaise
    )
      throw offerInvalid('DISCOUNT_MISMATCH', o.id);

    const redemptionId = uuidv7();
    await tx.repo.insertRedemption({
      id: redemptionId,
      offerId: o.id,
      orderId: input.orderId,
      checkoutGroupId: input.checkoutGroupId ?? null,
      customerId: input.customerId,
      zoneId: input.cart.zoneId,
      discountPaise: price.discountPaise,
      vendorPaise: price.vendorPaise,
      platformPaise: price.platformPaise,
      appliedAt: now,
    });
    await tx.repo.bumpCounters(o.id, 1, price.discountPaise);
    await record(tx.audit, {
      module: 'offers',
      action: 'offer.redeemed',
      entity: { type: 'offer', id: o.id, label: o.title, zoneId: input.cart.zoneId },
      after: {
        orderId: input.orderId,
        discountPaise: price.discountPaise,
        vendorPaise: price.vendorPaise,
        platformPaise: price.platformPaise,
      },
    });

    // the use that takes the last of the uses ends the offer; the last of the budget pauses it (D202)
    const usedNow = o.usedCount + 1;
    const spentNow = o.spentPaise + price.discountPaise;
    if (o.usageLimit !== null && usedNow >= o.usageLimit)
      await this.systemMove(tx, o, 'EXPIRED', USES_TAKEN_TEXT, 'job.offer_uses_taken', now);
    else if (o.budgetPaise !== null && spentNow >= o.budgetPaise)
      await this.systemMove(tx, o, 'PAUSED', BUDGET_SPENT_TEXT, 'job.offer_budget_spent', now);

    return {
      redemptionId,
      offerId: o.id,
      discountPaise: price.discountPaise,
      vendorPaise: price.vendorPaise,
      platformPaise: price.platformPaise,
    };
  }

  /** In its own transaction (the order exists already: the demo, tests). */
  async apply(input: ApplyInput): Promise<Applied> {
    if (!(await this.deps.db.repo.orderExists(input.orderId)))
      throw offerInvalid('NOT_FOUND', null);
    try {
      return await runAsSystem('offer applied', () =>
        this.deps.db.transaction((tx) => this.applyWithin(tx, input)),
      );
    } catch (err) {
      if (err instanceof AppError && err.code === 'OFFER_INVALID') {
        const meta = err.meta as
          { reason?: OfferInvalidReason; offerId?: string | null } | undefined;
        if (meta?.reason && meta.offerId) await this.afterRefused(meta.offerId, meta.reason);
      }
      throw err;
    }
  }

  /**
   * After a refusal (own transaction): BUDGET_SPENT pauses an ACTIVE offer the next use could not fit (D202);
   * USES_LIMIT ends one still ACTIVE. Idempotent; anything else does nothing.
   */
  async afterRefused(offerId: string, reason: OfferInvalidReason): Promise<void> {
    if (reason !== 'BUDGET_SPENT' && reason !== 'USES_LIMIT') return;
    await runAsSystem('offer budget check', () =>
      this.deps.db.transaction(async (tx) => {
        await tx.repo.lock(offerId);
        const o = await tx.repo.byId(offerId);
        if (!o || o.status !== 'ACTIVE') return;
        const now = this.deps.clock();
        if (reason === 'BUDGET_SPENT')
          await this.systemMove(tx, o, 'PAUSED', BUDGET_SPENT_TEXT, 'job.offer_budget_spent', now);
        else await this.systemMove(tx, o, 'EXPIRED', USES_TAKEN_TEXT, 'job.offer_uses_taken', now);
      }),
    );
  }

  // ---- reverse (F4) ---------------------------------------------------------------------------------------------------

  /**
   * The order was cancelled before delivery: its use and budget come back (offers.rules returnOnCancel). Idempotent;
   * a delivered, not-cancelled or offer-free order changes nothing. Returns whether something was reversed.
   */
  async reverseForOrder(orderId: string): Promise<boolean> {
    const rules = await this.deps.rules();
    if (!rules.returnOnCancel) return false;
    return runAsSystem('offer use returned', () =>
      this.deps.db.transaction(async (tx) => {
        const r = await tx.repo.appliedOfOrder(orderId);
        if (!r || r.order.status !== 'CANCELLED' || r.order.deliveredAt !== null) return false;
        await tx.repo.lock(r.offerId);
        const now = this.deps.clock();
        if (!(await tx.repo.markReversed(r.id, now, 'Order cancelled before delivery')))
          return false;
        await tx.repo.bumpCounters(r.offerId, -1, -r.discountPaise);
        const o = await tx.repo.byId(r.offerId);
        await record(tx.audit, {
          module: 'offers',
          action: 'offer.redemption_reversed',
          entity: {
            type: 'offer',
            id: r.offerId,
            label: o?.title ?? 'Offer',
            zoneId: r.order.zoneId,
          },
          after: { orderId, discountPaise: r.discountPaise },
        });
        return true;
      }),
    );
  }

  /** The sweep's safety net: uses of orders cancelled before delivery that were not returned yet. */
  async reconcile(): Promise<number> {
    const stale = await this.deps.db.repo.staleApplied(REVERSE_BATCH);
    let n = 0;
    for (const s of stale) if (await this.reverseForOrder(s.orderId)) n += 1;
    return n;
  }

  // ---- the customer app -----------------------------------------------------------------------------------------------

  /** GET /intake/v1/offers: live offers for a vendor (its zone + its own) or a zone (PLATFORM + ZONE). */
  async listForApp(client: AppClientRef, q: IntakeOfferListQuery): Promise<IntakeOfferPublic[]> {
    const repo = this.deps.db.repo;
    let offers: OfferRow[];
    if (q.vendorId) {
      const v = await this.vendorOf(client, q.vendorId);
      if (q.zoneId && q.zoneId !== v.zoneId) return [];
      offers = await repo.liveFor(v.zoneId, v);
    } else {
      offers = await repo.liveInZone(q.zoneId ?? '');
    }
    const now = this.deps.clock();
    offers = offers.filter((o) => o.validFrom <= now && now < o.validTo);
    const customerId = q.customerId ? await repo.customerByRef(client.id, q.customerId) : null;
    const uses = customerId
      ? await repo.customerUses(
          customerId,
          offers.map((o) => o.id),
        )
      : new Map<string, number>();
    const vendorRefs = new Map<string, string>();
    for (const id of new Set(offers.map((o) => o.restaurantId ?? o.homemakerId).filter(isString))) {
      const refs = await repo.vendorExternalIds(id);
      const mine = refs.find((r) => r.clientId === client.id) ?? refs[0];
      if (mine) vendorRefs.set(id, mine.externalId);
    }
    return offers.map((o) => {
      const vid = o.restaurantId ?? o.homemakerId;
      return {
        offerId: o.id,
        title: o.title,
        description: o.description,
        code: o.code,
        type: o.type,
        value: o.value,
        maxDiscountPaise: o.maxDiscountPaise,
        minOrderPaise: o.minOrderPaise,
        newCustomersOnly: o.newCustomersOnly,
        validTo: o.validTo.toISOString(),
        usesLeftForCustomer: customerId
          ? Math.max(0, o.perCustomerLimit - (uses.get(o.id) ?? 0))
          : null,
        vendorId: vid ? (vendorRefs.get(vid) ?? null) : null,
      };
    });
  }

  /** POST /intake/v1/offers/quote: the discount this cart would get, reserving nothing. */
  async quote(client: AppClientRef, input: IntakeOfferQuoteInput): Promise<IntakeOfferQuote> {
    const repo = this.deps.db.repo;
    const v = await this.vendorOf(client, input.vendorId);
    const cart: PricingCart = {
      zoneId: v.zoneId,
      vendor: { type: v.type, id: v.id },
      subtotalPaise: input.subtotalPaise,
      deliveryFeePaise: input.deliveryFeePaise,
      paymentMethod: offerPaymentMethodOf(input.paymentMethod),
    };
    const customerId = await repo.customerByRef(client.id, input.customerId);
    // a customer the Core does not know yet has no orders and no uses (their first order creates them)
    const delivered = customerId ? await repo.deliveredOrders(customerId) : 0;
    const now = this.deps.clock();
    if (!input.offerId && !input.code) {
      const live = await repo.liveFor(v.zoneId, v);
      const uses = customerId
        ? await repo.customerUses(
            customerId,
            live.map((o) => o.id),
          )
        : new Map<string, number>();
      const best = bestAutomaticOffer(live, cart, (id) => uses.get(id) ?? 0, delivered, now);
      return best
        ? {
            offerId: best.offer.id,
            title: best.offer.title,
            discountPaise: best.price.discountPaise,
          }
        : { discountPaise: 0 };
    }
    const o = input.offerId ? await repo.byId(input.offerId) : await repo.byCode(input.code ?? '');
    if (!o) throw offerInvalid('NOT_FOUND', null);
    const uses = customerId
      ? await repo.customerUses(customerId, [o.id])
      : new Map<string, number>();
    const price = priceOffer(
      o,
      cart,
      { deliveredOrders: delivered, usesOfOffer: uses.get(o.id) ?? 0 },
      now,
    );
    if (!price.ok) throw offerInvalid(price.reason, o.id);
    return {
      offerId: o.id,
      ...(o.code ? { code: o.code } : {}),
      title: o.title,
      discountPaise: price.discountPaise,
    };
  }

  // ---- the vendor app (F1: the zone's admin decides) ---------------------------------------------------------------------

  /** POST /intake/v1/vendors/{vendorId}/offers: 201 created PENDING_APPROVAL, 200 the same app id sent again. */
  async submitFromApp(
    client: AppClientRef,
    vendorExternalId: string,
    input: IntakeVendorOfferCreate,
  ): Promise<{ httpStatus: 200 | 201; ref: IntakeOfferRef; zoneId: string }> {
    const repo = this.deps.db.repo;
    const v = await this.vendorOf(client, vendorExternalId, true);
    const existing = await repo.offerByRef(client.id, input.offerId);
    if (existing) {
      const o = await repo.byId(existing);
      if (!o) throw new AppError('INTERNAL', 'offer ref without an offer');
      if ((o.restaurantId ?? o.homemakerId) !== v.id)
        throw new AppError('ENTITY_MISMATCH', 'This offer belongs to another vendor');
      return { httpStatus: 200, ref: ref(o, input.offerId), zoneId: v.zoneId };
    }
    const now = this.deps.clock();
    const validFrom = new Date(input.validFrom);
    const validTo = new Date(input.validTo);
    const problems = offerRuleProblems(
      {
        type: input.type,
        value: input.value,
        perCustomerLimit: input.perCustomerLimit,
        validFrom: input.validFrom,
        validTo: input.validTo,
      },
      await this.deps.rules(),
    );
    if (validTo <= now) problems['validTo'] ??= 'The end date has passed';
    const keys = Object.keys(problems);
    if (keys.length > 0)
      throw new AppError(
        'VALIDATION_ERROR',
        Object.values(problems).join('; '),
        keys.map((k) => ({ field: k, issue: problems[k] ?? 'invalid' })),
      );
    const code = input.code ?? null;
    if (code && (await repo.codeTaken(code)))
      throw new AppError('CONFLICT', 'Another offer uses this code', [
        { field: 'code', issue: 'taken' },
      ]);
    const id = uuidv7();
    const won = await this.deps.db.transaction(async (tx) => {
      // the app's id is claimed first, so the same offer sent twice at once is created once
      if (!(await tx.repo.claimOfferRef(client.id, input.offerId, id))) return false;
      await tx.repo.insertFromApp(
        {
          id,
          scope: 'VENDOR',
          restaurantId: v.type === 'RESTAURANT' ? v.id : null,
          homemakerId: v.type === 'HOMEMAKER' ? v.id : null,
          zoneIds: [v.zoneId],
          code,
          title: input.title,
          description: input.description ?? null,
          type: input.type,
          value: input.value,
          maxDiscountPaise: input.maxDiscountPaise ?? null,
          minOrderPaise: input.minOrderPaise,
          newCustomersOnly: input.newCustomersOnly,
          paymentMethods: [],
          perCustomerLimit: input.perCustomerLimit,
          usageLimit: input.usageLimit ?? null,
          budgetPaise: input.budgetPaise ?? null,
          fundedBy: 'VENDOR',
          vendorSharePct: null,
          validFrom,
          validTo,
        },
        client.id,
        now,
      );
      await record(tx.audit, {
        module: 'offers',
        action: 'offer.submitted_by_vendor',
        entity: { type: 'offer', id, label: input.title, zoneId: v.zoneId },
        after: { status: 'PENDING_APPROVAL', type: input.type, value: input.value, code },
      });
      return true;
    });
    if (!won) return this.submitFromApp(client, vendorExternalId, input);
    const o = await repo.byId(id);
    if (!o) throw new AppError('INTERNAL', 'offer not found after insert');
    return { httpStatus: 201, ref: ref(o, input.offerId), zoneId: v.zoneId };
  }

  /** POST /intake/v1/vendors/{vendorId}/offers/{offerId}/withdraw: only while PENDING_APPROVAL (→ CANCELLED). */
  async withdrawFromApp(
    client: AppClientRef,
    vendorExternalId: string,
    offerId: string,
  ): Promise<{ ref: IntakeOfferRef; zoneId: string }> {
    const v = await this.vendorOf(client, vendorExternalId, true);
    return this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(offerId);
      const o = await tx.repo.byId(offerId);
      // another vendor's offer, or one this app did not send: as if it did not exist
      if (!o || (o.restaurantId ?? o.homemakerId) !== v.id || o.source !== 'APP')
        throw new AppError('UNKNOWN_ENTITY', 'No such offer');
      const ext = (await tx.repo.externalOfferId(client.id, o.id)) ?? '';
      if (o.status === 'CANCELLED') return { ref: ref(o, ext), zoneId: v.zoneId };
      if (o.status !== 'PENDING_APPROVAL')
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          'Only an offer still waiting for approval can be withdrawn; ask the zone admin',
          undefined,
          undefined,
          { currentStatus: o.status, version: o.version },
        );
      await tx.repo.update(
        o.id,
        { status: 'CANCELLED', statusReason: 'Withdrawn by the vendor' },
        null,
      );
      await record(tx.audit, {
        module: 'offers',
        action: 'offer.withdrawn_by_vendor',
        entity: { type: 'offer', id: o.id, label: o.title, zoneId: v.zoneId },
        before: { status: o.status },
        after: { status: 'CANCELLED' },
      });
      const after = await tx.repo.byId(o.id);
      if (!after) throw new AppError('INTERNAL', 'offer not found after withdraw');
      return { ref: ref(after, ext), zoneId: v.zoneId };
    });
  }

  // ---- helpers --------------------------------------------------------------------------------------------------------

  /**
   * The vendor an app names, in a zone: 404 UNKNOWN_ENTITY otherwise (a vendor without a zone has no offers yet).
   * `ownOnly`: the vendor app's writes accept only the vendors that app registered.
   */
  private async vendorOf(
    client: AppClientRef,
    externalId: string,
    ownOnly = false,
  ): Promise<{ type: OfferVendorType; id: string; zoneId: string }> {
    const v = await this.deps.db.repo.vendorByRef(client.id, externalId, ownOnly);
    if (!v) throw new AppError('UNKNOWN_ENTITY', 'No such vendor for this app');
    if (v.zoneId === null)
      throw new AppError('VENDOR_UNAVAILABLE', 'The vendor has no zone yet', [
        { field: 'vendorId', issue: 'no_zone' },
      ]);
    return { type: v.type, id: v.id, zoneId: v.zoneId };
  }

  private async systemMove(
    tx: OffersTx,
    o: OfferRow,
    to: PromotionStatus,
    reason: string,
    action: AuditActionKey,
    now: Date,
  ): Promise<void> {
    await tx.repo.update(o.id, { status: to, statusReason: reason }, null);
    await tx.repo.insertOutbox(
      statusChangedRows(o, to, o.version + 1, { type: 'SYSTEM', id: null }, now),
    );
    await record(tx.audit, {
      module: 'system',
      action,
      entity: {
        type: 'offer',
        id: o.id,
        label: o.title,
        zoneId: o.zoneIds.length === 1 ? (o.zoneIds[0] ?? null) : null,
      },
      before: { status: o.status },
      after: { status: to, reason },
    });
  }
}

const isString = (v: string | null): v is string => v !== null;

function ref(o: OfferRow, externalId: string): IntakeOfferRef {
  return { id: o.id, externalOfferId: externalId, status: o.status, version: o.version };
}
