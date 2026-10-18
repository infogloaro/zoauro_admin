import { describe, expect, it } from 'vitest';
import { dashboardQuerySchema, dashboardWindow, istDayStart } from './schemas';

// M16 ranges in India days (IST = UTC+05:30).

const ist = (d: string) => new Date(`${d}+05:30`);

describe('dashboard ranges (IST)', () => {
  it('istDayStart: 02:00 IST belongs to that IST day, not the UTC one', () => {
    expect(istDayStart(new Date('2026-10-16T20:30:00Z'))).toEqual(ist('2026-10-17T00:00:00'));
    expect(istDayStart(ist('2026-10-17T23:59:00'))).toEqual(ist('2026-10-17T00:00:00'));
  });

  it('today is hourly from IST midnight; 7d and 30d include today; month starts on the 1st', () => {
    const now = ist('2026-10-17T15:00:00');
    expect(dashboardWindow('today', now)).toEqual({
      from: ist('2026-10-17T00:00:00'),
      to: now,
      bucket: 'hour',
    });
    expect(dashboardWindow('7d', now).from).toEqual(ist('2026-10-11T00:00:00'));
    expect(dashboardWindow('30d', now).from).toEqual(ist('2026-09-18T00:00:00'));
    expect(dashboardWindow('month', now)).toMatchObject({
      from: ist('2026-10-01T00:00:00'),
      bucket: 'day',
    });
  });

  it('the range defaults to 7d and is one of four', () => {
    expect(dashboardQuerySchema.parse({}).range).toBe('7d');
    expect(dashboardQuerySchema.safeParse({ range: 'year' }).success).toBe(false);
  });
});
