import { describe, expect, it } from 'vitest';
import { superAdminGate } from '../../../lib/server-session';
import {
  addDays,
  defaultRange,
  hasActivityNarrowing,
  hasSignInNarrowing,
  readActivityFilters,
  readSignInFilters,
  readTab,
  todayInZone,
  toActivityQuery,
  toSignInQuery,
} from './filters';

// 12 Oct 2026, 23:30 UTC is already 13 Oct, 05:00 in Kolkata: "today" must follow the panel's timezone.
const NOW = new Date('2026-10-12T23:30:00Z');
const ZONE = '0192f1d2-0000-7000-8000-000000000004';
const ACTOR = '0192f1d2-1111-7000-8000-000000000007';
const params = (s: string) => new URLSearchParams(s);

describe('date range', () => {
  it("today is the calendar day in Asia/Kolkata, not UTC's", () => {
    expect(todayInZone(NOW)).toBe('2026-10-13');
    expect(todayInZone(new Date('2026-10-12T10:00:00Z'))).toBe('2026-10-12');
  });
  it('the default is the last 7 days including today', () => {
    expect(defaultRange(NOW)).toEqual({ from: '2026-10-07', to: '2026-10-13' });
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('from / to become the start and end of the Kolkata day, in UTC', () => {
    const q = toActivityQuery(readActivityFilters(params('from=2026-10-01&to=2026-10-02'), NOW));
    expect(q.from).toBe('2026-09-30T18:30:00.000Z');
    expect(q.to).toBe('2026-10-02T18:29:59.999Z');
  });
  it('a param that is present but empty means "no bound"; an absent one means the default', () => {
    const f = readActivityFilters(params('from=&to=2026-10-02'), NOW);
    expect(f.from).toBeNull();
    expect(toActivityQuery(f)).not.toHaveProperty('from');
    expect(readActivityFilters(params(''), NOW).from).toBe('2026-10-07');
  });
  it('a malformed date falls back to the default instead of reaching the API', () => {
    expect(readActivityFilters(params('from=yesterday&to=2026-13-45x'), NOW)).toMatchObject({
      from: '2026-10-07',
      to: '2026-10-13',
    });
  });
});

describe('activity filters <-> URL <-> API query', () => {
  it('reads every filter and sends exactly the matching API parameters', () => {
    const f = readActivityFilters(
      params(
        `actor=${ACTOR}&actorName=Karthik&actorType=SYSTEM&module=orders&action=order.marked_delayed&zone=${ZONE}` +
          `&entityType=order&q=ZO-1&outcome=DENIED&sensitive=1`,
      ),
      NOW,
    );
    expect(toActivityQuery(f)).toEqual({
      limit: 50,
      from: '2026-10-06T18:30:00.000Z',
      to: '2026-10-13T18:29:59.999Z',
      actorId: ACTOR,
      actorType: 'SYSTEM',
      module: 'orders',
      action: 'order.marked_delayed',
      zoneId: [ZONE],
      entityType: 'order',
      q: 'ZO-1',
      outcome: 'DENIED',
      sensitivity: 'HIGH',
    });
  });
  it('ignores values the API would reject (bad enums, non-uuid ids, blanks)', () => {
    const f = readActivityFilters(
      params(
        'actor=nope&actorType=ROBOT&module=bank&zone=1&entityId=x&outcome=MAYBE&q=%20%20&sensitive=0',
      ),
      NOW,
    );
    expect(f).toMatchObject({
      actorId: null,
      actorType: null,
      module: null,
      zoneId: null,
      entityId: null,
      outcome: null,
      q: null,
      sensitive: false,
    });
  });
  it('with no filters only the date range and the page size are sent', () => {
    expect(Object.keys(toActivityQuery(readActivityFilters(params(''), NOW))).sort()).toEqual([
      'from',
      'limit',
      'to',
    ]);
  });
  it('knows when a view is narrower than the default (drives the empty-state text)', () => {
    expect(hasActivityNarrowing(readActivityFilters(params(''), NOW), NOW)).toBe(false);
    expect(hasActivityNarrowing(readActivityFilters(params('module=orders'), NOW), NOW)).toBe(true);
    expect(hasActivityNarrowing(readActivityFilters(params('sensitive=1'), NOW), NOW)).toBe(true);
    expect(hasActivityNarrowing(readActivityFilters(params('from=2026-01-01'), NOW), NOW)).toBe(
      true,
    );
  });
});

describe('sign-in filters and tabs', () => {
  it('maps user, result and the date range', () => {
    const f = readSignInFilters(params(`user=${ACTOR}&userName=K&success=false`), NOW);
    expect(toSignInQuery(f)).toEqual({
      limit: 50,
      from: '2026-10-06T18:30:00.000Z',
      to: '2026-10-13T18:29:59.999Z',
      userId: ACTOR,
      success: 'false',
    });
    expect(hasSignInNarrowing(f, NOW)).toBe(true);
    expect(hasSignInNarrowing(readSignInFilters(params(''), NOW), NOW)).toBe(false);
  });
  it('the tab defaults to Activity', () => {
    expect(readTab(params(''))).toBe('activity');
    expect(readTab(params('tab=signins'))).toBe('signins');
    expect(readTab(params('tab=other'))).toBe('activity');
  });
});

describe('route gate (Super Admin only)', () => {
  const user = (role: string) => ({ id: ACTOR, name: 'N', email: 'n@x.test', role });
  it('no session: sign in first; Super Admin: shown; any other role: 404', () => {
    expect(superAdminGate(null)).toBe('login');
    expect(superAdminGate(user('SUPER_ADMIN'))).toBe('ok');
    expect(superAdminGate(user('ZONAL_ADMIN'))).toBe('not-found');
    expect(superAdminGate(user('SOMETHING_ELSE'))).toBe('not-found');
  });
});
