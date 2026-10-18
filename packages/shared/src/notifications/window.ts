// D100 / D136: a PROMOTION goes out only inside its zone's window (settings notifications.timing, Asia/Kolkata,
// default 09:00–21:00); one requested outside it is held to the next opening. A MESSAGE is never held. India keeps no
// daylight saving, so IST is a fixed UTC+05:30. Pure: the API and the composer preview use the same rule.

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
const DAY_MS = 24 * 60 * 60_000;

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * When a send requested for `at` may go out. `from`/`to` are 'HH:MM' with from < to (the setting's own rule).
 * Inside [from, to) it is `at`; before `from` it is today's opening; at or after `to` it is tomorrow's opening (IST).
 */
export function nextPromotionSendAt(
  window: { promotionalFrom: string; promotionalTo: string },
  at: Date,
): Date {
  const local = at.getTime() + IST_OFFSET_MS;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  const minute = Math.floor((local - dayStart) / 60_000);
  const from = minutesOf(window.promotionalFrom);
  const to = minutesOf(window.promotionalTo);
  if (minute >= from && minute < to) return at;
  const openingDay = minute < from ? dayStart : dayStart + DAY_MS;
  return new Date(openingDay + from * 60_000 - IST_OFFSET_MS);
}

/** The send time of one zone: MESSAGE as requested, PROMOTION held to the zone's window (D136). */
export function zoneSendAt(
  kind: 'MESSAGE' | 'PROMOTION',
  window: { promotionalFrom: string; promotionalTo: string },
  requested: Date,
): Date {
  return kind === 'PROMOTION' ? nextPromotionSendAt(window, requested) : requested;
}
