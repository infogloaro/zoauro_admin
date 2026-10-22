// Settings History actor and date filters (F9 W2): ?actor=<id>, ?from and ?to as India-time calendar days, turned into
// the instants GET /settings/history filters on. Pure, so it is tested without a browser.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface HistoryFilters {
  actorId: string | null;
  from: string | null;
  to: string | null;
}

export function readHistoryFilters(params: URLSearchParams): HistoryFilters {
  const actor = params.get('actor');
  const from = params.get('from');
  const to = params.get('to');
  return {
    actorId: actor !== null && UUID.test(actor) ? actor : null,
    from: from !== null && DAY.test(from) ? from : null,
    to: to !== null && DAY.test(to) ? to : null,
  };
}

/** Whole India-time days (+05:30, no daylight saving) as the API's bounds; a from after the to is dropped. */
export function toIstBounds(
  from: string | null,
  to: string | null,
): { from?: string; to?: string } {
  const keepFrom = from !== null && (to === null || from <= to);
  return {
    ...(keepFrom ? { from: `${from}T00:00:00+05:30` } : {}),
    ...(to !== null ? { to: `${to}T23:59:59.999+05:30` } : {}),
  };
}
