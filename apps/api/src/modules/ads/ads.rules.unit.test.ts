import { describe, expect, it } from 'vitest';
import {
  bookedDays,
  bpToPct,
  CAMPAIGN_MOVES,
  canMove,
  commissionPaise,
  DAY_MS,
  fullDates,
  istDate,
  istDayStart,
  istMidnight,
  liveDays,
  liveWindows,
  pctToBp,
  REQUEST_MOVES,
  SLOT_MOVES,
  slotLabel,
  type CampaignTimes,
} from './ads.rules';

// D201 billing maths: IST days, live windows, billed days (ceil, capped), commission in basis points, capacity.

const H = 3_600_000;
const start = istMidnight('2026-10-13'); // 2026-10-12T18:30Z
const at = (days: number, hours = 0) => new Date(start.getTime() + days * DAY_MS + hours * H);
const campaign = (over: Partial<CampaignTimes> = {}): CampaignTimes => ({
  status: 'LIVE',
  startAt: start,
  endAt: at(20),
  cancelledAt: null,
  pauses: [],
  ...over,
});

describe('IST days', () => {
  it('00:00 IST is 18:30 UTC the day before; dates follow IST across UTC midnight', () => {
    expect(start.toISOString()).toBe('2026-10-12T18:30:00.000Z');
    expect(istDate(new Date('2026-10-12T18:29:59Z'))).toBe('2026-10-12');
    expect(istDate(new Date('2026-10-12T18:30:00Z'))).toBe('2026-10-13');
    expect(istDayStart(new Date('2026-10-12T23:00:00Z')).toISOString()).toBe(
      '2026-10-12T18:30:00.000Z',
    );
    expect(istMidnight(new Date('2026-10-13T00:00:00Z'))).toEqual(start);
  });
});

describe('live windows and billed days (A5)', () => {
  it('live 10 d 15 h bills 11 days; never more than the booked days', () => {
    expect(liveDays(campaign(), at(10, 15))).toBe(11);
    expect(liveDays(campaign(), at(10))).toBe(10);
    expect(liveDays(campaign(), at(40))).toBe(20);
    expect(bookedDays(campaign())).toBe(20);
  });

  it('scheduled campaigns have no windows; cancel and now cap the end', () => {
    expect(liveWindows(campaign({ status: 'SCHEDULED' }), at(5))).toEqual([]);
    expect(liveDays(campaign({ status: 'CANCELLED', cancelledAt: at(4) }), at(9))).toBe(4);
    expect(liveWindows(campaign(), at(-1))).toEqual([]);
  });

  it('pauses (closed, two, open) are not billed', () => {
    const one = campaign({ status: 'LIVE', pauses: [{ from: at(2), to: at(4) }] });
    expect(liveWindows(one, at(6))).toEqual([
      [start, at(2)],
      [at(4), at(6)],
    ]);
    expect(liveDays(one, at(6))).toBe(4);
    const two = campaign({
      pauses: [
        { from: at(1), to: at(2) },
        { from: at(3), to: at(5) },
      ],
    });
    expect(liveDays(two, at(6))).toBe(3);
    // campaign C: started 6 days ago, paused 2 days ago and still paused → 4 billed days
    const open = campaign({ status: 'PAUSED', pauses: [{ from: at(4), to: null }] });
    expect(liveDays(open, at(6))).toBe(4);
  });
});

describe('commission in basis points', () => {
  it('parses and prints two decimals', () => {
    expect(pctToBp('4.00')).toBe(400);
    expect(pctToBp('3.5')).toBe(350);
    expect(pctToBp('12.75')).toBe(1275);
    expect(pctToBp('x')).toBeNull();
    expect(bpToPct(350)).toBe('3.50');
    expect(bpToPct(1205)).toBe('12.05');
  });

  it('floors the commission in integer paise', () => {
    expect(commissionPaise(123_456, 400)).toBe(4938); // 4938.24
    expect(commissionPaise(99, 350)).toBe(3);
    expect(commissionPaise(0, 400)).toBe(0);
  });
});

describe('capacity per IST day', () => {
  it('lists the days already at capacity, across midnight UTC', () => {
    const booked = [{ startAt: at(2), endAt: at(5) }];
    expect(fullDates(booked, 1, start, 7)).toEqual(['2026-10-15', '2026-10-16', '2026-10-17']);
    expect(fullDates(booked, 2, start, 7)).toEqual([]);
    expect(fullDates([...booked, { startAt: at(4), endAt: at(6) }], 2, start, 7)).toEqual([
      '2026-10-17',
    ]);
  });
});

describe('transitions', () => {
  it('slots, requests and campaigns', () => {
    expect(canMove(SLOT_MOVES, 'ACTIVE', 'PAUSED')).toBe(true);
    expect(canMove(SLOT_MOVES, 'PAUSED', 'ACTIVE')).toBe(true);
    expect(canMove(SLOT_MOVES, 'RETIRED', 'ACTIVE')).toBe(false);
    expect(canMove(SLOT_MOVES, 'ACTIVE', 'ACTIVE')).toBe(false);
    expect(canMove(REQUEST_MOVES, 'SUBMITTED', 'QUOTED')).toBe(true);
    expect(canMove(REQUEST_MOVES, 'QUOTED', 'QUOTED')).toBe(false);
    for (const s of ['ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'] as const)
      expect(REQUEST_MOVES[s]).toEqual([]);
    expect(canMove(CAMPAIGN_MOVES, 'LIVE', 'PAUSED')).toBe(true);
    expect(canMove(CAMPAIGN_MOVES, 'PAUSED', 'LIVE')).toBe(true);
    expect(canMove(CAMPAIGN_MOVES, 'SCHEDULED', 'PAUSED')).toBe(false);
    expect(CAMPAIGN_MOVES.ENDED).toEqual([]);
    expect(CAMPAIGN_MOVES.CANCELLED).toEqual([]);
  });

  it('labels slots', () => {
    expect(slotLabel({ page: 'HOME', placement: 'BANNER', position: 1 })).toBe('Home · Banner #1');
    expect(slotLabel({ page: 'HOME_FOOD', placement: 'TOP_LISTING', position: 2 })).toBe(
      'Home Food · Top listing #2',
    );
  });
});
