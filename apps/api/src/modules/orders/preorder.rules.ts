// Pre-orders (D150, D167): a customer orders for a chosen time and place; the order stays PLACED and hidden from the
// vendor and partner apps until the dispatch job releases it at dispatch_at = scheduled_for − prep − travel buffer.
// Pure, so the intake handler, the reschedule route and the dispatch sweep share one calculation. The numbers come
// from the Control Panel setting `orders.preorder` (SettingsReader.preorderRules(zoneId), overridable per zone).

/** The `orders.preorder` setting (packages/shared settings registry, D167). */
export interface PreorderRules {
  minLeadMinutes: number;
  maxAheadDays: number;
  travelBufferMinutes: number;
  /** used when the vendor has no average preparation time */
  prepMinutes: number;
  /** before dispatch */
  cancelCutoffMinutes: number;
  rescheduleCutoffMinutes: number;
  maxReschedules: number;
}

const MINUTE = 60_000;

export type PreorderWindowIssue = 'TOO_SOON' | 'TOO_FAR_AHEAD';

/** null when `scheduledFor` may be booked at `now`; otherwise why not (the caller answers 422). */
export function preorderWindowIssue(
  scheduledFor: Date,
  now: Date,
  rules: PreorderRules,
): PreorderWindowIssue | null {
  const ahead = scheduledFor.getTime() - now.getTime();
  if (ahead < rules.minLeadMinutes * MINUTE) return 'TOO_SOON';
  if (ahead > rules.maxAheadDays * 24 * 60 * MINUTE) return 'TOO_FAR_AHEAD';
  return null;
}

/**
 * When the order is released to the vendor (and the partner search starts): scheduled_for − preparation − travel
 * buffer, never before `now` (a pre-order placed inside its own lead time is released at once). Whole minutes.
 */
export function dispatchAtFor(
  scheduledFor: Date,
  now: Date,
  rules: PreorderRules,
  vendorAvgPrepMinutes?: number | null,
): Date {
  const prep =
    vendorAvgPrepMinutes && vendorAvgPrepMinutes > 0 ? vendorAvgPrepMinutes : rules.prepMinutes;
  const at = scheduledFor.getTime() - (prep + rules.travelBufferMinutes) * MINUTE;
  return new Date(Math.max(at, now.getTime()));
}

export type PreorderChangeBlocker = 'RELEASED' | 'PAST_CUTOFF' | 'TOO_MANY_RESCHEDULES';

/** Cancel by the customer or an admin before dispatch: refused once released or within the cut-off. */
export function cancelBlocker(
  o: { dispatchAt: Date; releasedAt: Date | null },
  now: Date,
  rules: PreorderRules,
): PreorderChangeBlocker | null {
  if (o.releasedAt !== null) return 'RELEASED';
  if (o.dispatchAt.getTime() - now.getTime() < rules.cancelCutoffMinutes * MINUTE)
    return 'PAST_CUTOFF';
  return null;
}

/** Reschedule: as cancel, plus the reschedule cap. The new time is then checked with preorderWindowIssue. */
export function rescheduleBlocker(
  o: { dispatchAt: Date; releasedAt: Date | null; rescheduleCount: number },
  now: Date,
  rules: PreorderRules,
): PreorderChangeBlocker | null {
  if (o.releasedAt !== null) return 'RELEASED';
  if (o.rescheduleCount >= rules.maxReschedules) return 'TOO_MANY_RESCHEDULES';
  if (o.dispatchAt.getTime() - now.getTime() < rules.rescheduleCutoffMinutes * MINUTE)
    return 'PAST_CUTOFF';
  return null;
}

/** The dispatch sweep releases every unreleased PLACED pre-order whose dispatch_at has come. */
export const isDue = (o: { dispatchAt: Date; releasedAt: Date | null }, now: Date): boolean =>
  o.releasedAt === null && o.dispatchAt.getTime() <= now.getTime();
