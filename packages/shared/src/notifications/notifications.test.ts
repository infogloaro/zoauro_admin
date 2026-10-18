import { describe, expect, it } from 'vitest';
import {
  createNotificationSchema,
  nextPromotionSendAt,
  rejectNotificationSchema,
  updateNotificationSchema,
  zoneSendAt,
} from './index';

// D100 / D136 promotion window (IST = UTC+05:30) and the D135 request rules.

const W = { promotionalFrom: '09:00', promotionalTo: '21:00' };
/** an IST wall-clock time as a UTC Date */
const ist = (d: string) => new Date(`${d}+05:30`);

describe('nextPromotionSendAt (D100, D136)', () => {
  it('inside the window: as requested', () => {
    expect(nextPromotionSendAt(W, ist('2026-10-17T10:15:00'))).toEqual(ist('2026-10-17T10:15:00'));
    expect(nextPromotionSendAt(W, ist('2026-10-17T09:00:00'))).toEqual(ist('2026-10-17T09:00:00'));
  });
  it('before the window: today 09:00 IST; at or after the end: tomorrow 09:00 IST', () => {
    expect(nextPromotionSendAt(W, ist('2026-10-17T06:30:00'))).toEqual(ist('2026-10-17T09:00:00'));
    expect(nextPromotionSendAt(W, ist('2026-10-17T21:00:00'))).toEqual(ist('2026-10-18T09:00:00'));
    expect(nextPromotionSendAt(W, ist('2026-10-17T23:59:00'))).toEqual(ist('2026-10-18T09:00:00'));
  });
  it('the IST day boundary is respected (02:00 IST is 20:30 UTC the day before)', () => {
    expect(nextPromotionSendAt(W, new Date('2026-10-16T20:30:00Z'))).toEqual(
      ist('2026-10-17T09:00:00'),
    );
  });
  it('a zone window override and MESSAGE are never held', () => {
    const late = { promotionalFrom: '11:00', promotionalTo: '18:30' };
    expect(nextPromotionSendAt(late, ist('2026-10-17T18:45:00'))).toEqual(
      ist('2026-10-18T11:00:00'),
    );
    expect(zoneSendAt('MESSAGE', W, ist('2026-10-17T23:00:00'))).toEqual(
      ist('2026-10-17T23:00:00'),
    );
  });
});

describe('request schemas (D135)', () => {
  const base = {
    kind: 'PROMOTION',
    audience: 'CUSTOMERS',
    zoneIds: ['0192f1d2-0000-7000-8000-00000000000a'],
    title: 'Diwali offers',
    body: 'Flat 20% off this week.',
    channels: ['IN_APP', 'EMAIL'],
  };
  it('accepts a valid notification; refuses short titles, no channel, repeated zones', () => {
    expect(createNotificationSchema.safeParse(base).success).toBe(true);
    expect(createNotificationSchema.safeParse({ ...base, title: 'Hi' }).success).toBe(false);
    expect(createNotificationSchema.safeParse({ ...base, channels: [] }).success).toBe(false);
    expect(
      createNotificationSchema.safeParse({ ...base, zoneIds: [base.zoneIds[0], base.zoneIds[0]] })
        .success,
    ).toBe(false);
    expect(createNotificationSchema.safeParse({ ...base, kind: 'NEWS' }).success).toBe(false);
  });
  it('edits need the version and a change; a rejection needs a note', () => {
    expect(updateNotificationSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateNotificationSchema.safeParse({ title: 'New title', version: 2 }).success).toBe(
      true,
    );
    expect(rejectNotificationSchema.safeParse({ version: 1 }).success).toBe(false);
  });
});
