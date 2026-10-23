import type {
  OfferFunding,
  OfferPaymentMethod,
  OfferScope,
  OfferType,
  OfferVendorType,
  PromotionStatus,
} from './index';

// Offer pricing (doc 10 §8; D182 F2–F4, D199–D202, D205). Pure and shared: the API applies it under the offer row lock
// at order placement, the app quote uses it read-only, and the form preview can show the same figure. Money in paise.
//
// Order of the checks (the first failure is the reason the app gets): live → zone → vendor → minimum order → payment
// method → new customers only → the customer's uses → total uses → a discount above zero → budget.

/** Why an offer cannot be applied (422 OFFER_INVALID, `meta.reason`). */
export const OFFER_INVALID_REASONS = [
  'NOT_FOUND',
  'NOT_ACTIVE',
  'NOT_IN_ZONE',
  'WRONG_VENDOR',
  'MIN_ORDER',
  'PAYMENT_METHOD',
  'NEW_CUSTOMERS_ONLY',
  'CUSTOMER_LIMIT',
  'USES_LIMIT',
  'NO_DISCOUNT',
  'BUDGET_SPENT',
  'DISCOUNT_MISMATCH',
] as const;
export type OfferInvalidReason = (typeof OFFER_INVALID_REASONS)[number];

/** The customer-facing sentence for each reason (the quote shows it; the API message uses it). */
export const OFFER_INVALID_TEXT: Record<OfferInvalidReason, string> = {
  NOT_FOUND: 'This offer does not exist',
  NOT_ACTIVE: 'This offer is not running now',
  NOT_IN_ZONE: 'This offer is not available in this area',
  WRONG_VENDOR: 'This offer is for another restaurant or kitchen',
  MIN_ORDER: 'The order is below the minimum for this offer',
  PAYMENT_METHOD: 'This offer does not work with this payment method',
  NEW_CUSTOMERS_ONLY: 'This offer is for new customers only',
  CUSTOMER_LIMIT: 'This offer has been used the most times allowed',
  USES_LIMIT: 'This offer has run out',
  NO_DISCOUNT: 'This offer gives no discount on this order',
  BUDGET_SPENT: 'This offer has run out',
  DISCOUNT_MISMATCH: 'The discount does not match the offer',
};

/** The parts of an offer the pricing reads (an offer row has them all). */
export interface PricingOffer {
  scope: OfferScope;
  zoneIds: readonly string[];
  restaurantId: string | null;
  homemakerId: string | null;
  type: OfferType;
  /** PERCENT: whole percent; FLAT: paise; FREE_DELIVERY: 0 */
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number;
  newCustomersOnly: boolean;
  paymentMethods: readonly string[];
  perCustomerLimit: number;
  usageLimit: number | null;
  usedCount: number;
  budgetPaise: number | null;
  spentPaise: number;
  fundedBy: OfferFunding;
  vendorSharePct: number | null;
  status: PromotionStatus;
  validFrom: Date;
  validTo: Date;
}

export interface PricingCart {
  /** the vendor's zone (an order's zone is its vendor's, R-ORD-5) */
  zoneId: string;
  vendor: { type: OfferVendorType; id: string };
  /** items only, before tax and delivery */
  subtotalPaise: number;
  /** the zone's delivery charge (doc 42 §6.1: never changed by an offer; free delivery is a discount) */
  deliveryFeePaise: number;
  paymentMethod: OfferPaymentMethod;
}

export interface PricingCustomer {
  /** DELIVERED orders so far (D202 new customers only) */
  deliveredOrders: number;
  /** this customer's APPLIED uses of this offer */
  usesOfOffer: number;
}

export type OfferPrice =
  | { ok: true; discountPaise: number; vendorPaise: number; platformPaise: number }
  | { ok: false; reason: OfferInvalidReason };

/** The discount before the limits that depend on other orders (budget): PERCENT floors to the paisa. */
export function discountOf(
  o: Pick<PricingOffer, 'type' | 'value' | 'maxDiscountPaise'>,
  cart: Pick<PricingCart, 'subtotalPaise' | 'deliveryFeePaise'>,
): number {
  if (o.type === 'PERCENT') {
    const raw = Math.floor((cart.subtotalPaise * o.value) / 100);
    return o.maxDiscountPaise === null ? raw : Math.min(raw, o.maxDiscountPaise);
  }
  if (o.type === 'FLAT') return Math.min(o.value, cart.subtotalPaise);
  return cart.deliveryFeePaise;
}

/**
 * Who pays the discount (F2, D199): VENDOR scope the vendor, PLATFORM and ZONE the platform; SHARED the vendor's share
 * (floored), the platform the rest. The two parts always add up to the discount.
 */
export function splitDiscount(
  discountPaise: number,
  o: Pick<PricingOffer, 'fundedBy' | 'vendorSharePct'>,
): { vendorPaise: number; platformPaise: number } {
  if (o.fundedBy === 'VENDOR') return { vendorPaise: discountPaise, platformPaise: 0 };
  if (o.fundedBy === 'PLATFORM') return { vendorPaise: 0, platformPaise: discountPaise };
  const vendorPaise = Math.floor((discountPaise * (o.vendorSharePct ?? 0)) / 100);
  return { vendorPaise, platformPaise: discountPaise - vendorPaise };
}

/** Whether the offer applies to this vendor in this zone (PLATFORM: every zone; D205). */
export function offerCovers(
  o: Pick<PricingOffer, 'scope' | 'zoneIds' | 'restaurantId' | 'homemakerId'>,
  cart: Pick<PricingCart, 'zoneId' | 'vendor'>,
): OfferInvalidReason | null {
  if (o.scope === 'ZONE' && !o.zoneIds.includes(cart.zoneId)) return 'NOT_IN_ZONE';
  if (o.scope === 'VENDOR') {
    const id = cart.vendor.type === 'RESTAURANT' ? o.restaurantId : o.homemakerId;
    if (id !== cart.vendor.id) return 'WRONG_VENDOR';
  }
  return null;
}

/** The full check and price of one offer for one cart (doc 10 §8). */
export function priceOffer(
  o: PricingOffer,
  cart: PricingCart,
  customer: PricingCustomer,
  now: Date,
): OfferPrice {
  const fail = (reason: OfferInvalidReason): OfferPrice => ({ ok: false, reason });
  if (o.status !== 'ACTIVE' || now < o.validFrom || now >= o.validTo) return fail('NOT_ACTIVE');
  const cover = offerCovers(o, cart);
  if (cover) return fail(cover);
  if (cart.subtotalPaise < o.minOrderPaise) return fail('MIN_ORDER');
  if (o.paymentMethods.length > 0 && !o.paymentMethods.includes(cart.paymentMethod))
    return fail('PAYMENT_METHOD');
  if (o.newCustomersOnly && customer.deliveredOrders > 0) return fail('NEW_CUSTOMERS_ONLY');
  if (customer.usesOfOffer >= o.perCustomerLimit) return fail('CUSTOMER_LIMIT');
  if (o.usageLimit !== null && o.usedCount >= o.usageLimit) return fail('USES_LIMIT');
  const discountPaise = discountOf(o, cart);
  if (discountPaise <= 0) return fail('NO_DISCOUNT');
  // D202: no partial discount from the last of a budget; the offer pauses instead
  if (o.budgetPaise !== null && o.spentPaise + discountPaise > o.budgetPaise)
    return fail('BUDGET_SPENT');
  return { ok: true, discountPaise, ...splitDiscount(discountPaise, o) };
}

/**
 * D201: the discount spread across the order lines, pro rata to line value, floored, the remainder on the largest line
 * (the first of equals). A free-delivery discount covers the delivery charge, not the items: every line gets 0. A line
 * never gets more than its own value. The result has one entry per line, in the same order.
 */
export function allocateDiscount(
  lines: readonly { id: string; amountPaise: number }[],
  discountPaise: number,
  type: OfferType,
): { id: string; discountPaise: number }[] {
  const total = lines.reduce((n, l) => n + l.amountPaise, 0);
  if (type === 'FREE_DELIVERY' || total <= 0 || discountPaise <= 0)
    return lines.map((l) => ({ id: l.id, discountPaise: 0 }));
  const capped = Math.min(discountPaise, total);
  const out = lines.map((l) => ({
    id: l.id,
    discountPaise: Math.floor((capped * l.amountPaise) / total),
  }));
  let left = capped - out.reduce((n, l) => n + l.discountPaise, 0);
  // remainder: largest line first, never above a line's value
  const order = lines
    .map((l, i) => ({ i, amount: l.amountPaise }))
    .sort((a, b) => b.amount - a.amount || a.i - b.i);
  for (const { i, amount } of order) {
    if (left === 0) break;
    const line = out[i];
    if (!line) continue;
    const room = amount - line.discountPaise;
    const add = Math.min(room, left);
    line.discountPaise += add;
    left -= add;
  }
  return out;
}

/**
 * D200: commission is charged on the subtotal minus the vendor-funded part of the discount; the platform-funded part
 * never lowers it. Floors at 0.
 */
export function commissionBasePaise(subtotalPaise: number, vendorDiscountPaise: number): number {
  return Math.max(0, subtotalPaise - vendorDiscountPaise);
}

/** The best automatic (no-code) offer for a cart: the largest discount, then the earliest end, then the id. */
export function bestAutomaticOffer<T extends PricingOffer & { id: string; code: string | null }>(
  offers: readonly T[],
  cart: PricingCart,
  usesOf: (offerId: string) => number,
  deliveredOrders: number,
  now: Date,
): { offer: T; price: Extract<OfferPrice, { ok: true }> } | null {
  let best: { offer: T; price: Extract<OfferPrice, { ok: true }> } | null = null;
  for (const o of offers) {
    if (o.code !== null) continue;
    const p = priceOffer(o, cart, { deliveredOrders, usesOfOffer: usesOf(o.id) }, now);
    if (!p.ok) continue;
    if (
      !best ||
      p.discountPaise > best.price.discountPaise ||
      (p.discountPaise === best.price.discountPaise &&
        (o.validTo < best.offer.validTo ||
          (o.validTo.getTime() === best.offer.validTo.getTime() && o.id < best.offer.id)))
    )
      best = { offer: o, price: p };
  }
  return best;
}
