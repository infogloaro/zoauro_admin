import { describe, expect, it } from 'vitest';
import {
  codBlocked,
  distanceLabel,
  haversineM,
  locationOf,
  rankCandidates,
  type CandidatePartner,
} from './auto-assign.rules';

const now = new Date('2026-10-22T10:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const pickup = { lat: 11.0089, lng: 76.953 }; // RS Puram, Coimbatore
const rules = { radiusKm: 5, locationMaxAgeMinutes: 15 };

const partner = (over: Partial<CandidatePartner> & { id: string }): CandidatePartner => ({
  name: over.id,
  currentOrders: 0,
  lastLat: null,
  lastLng: null,
  lastLocationAt: null,
  ...over,
});
/** about `km` north of the pickup point */
const north = (id: string, km: number, extra: Partial<CandidatePartner> = {}) =>
  partner({
    id,
    lastLat: pickup.lat + km / 111.195,
    lastLng: pickup.lng,
    lastLocationAt: minutesAgo(1),
    ...extra,
  });

describe('auto-assign rules (D154, D199)', () => {
  it('measures great-circle distance in metres', () => {
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeGreaterThan(111_000);
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeLessThan(111_400);
    // RS Puram to Gandhipuram, about 1.75 km
    const d = haversineM(pickup, { lat: 11.0183, lng: 76.966 });
    expect(d).toBeGreaterThan(1_650);
    expect(d).toBeLessThan(1_850);
    expect(haversineM(pickup, pickup)).toBe(0);
  });

  it('counts a partner as located only with both coordinates and a fresh timestamp', () => {
    expect(locationOf(north('a', 1), now, 15)).not.toBeNull();
    // a timestamp alone is not a location (the seed wrote such rows before 10-22)
    expect(locationOf(partner({ id: 'b', lastLocationAt: minutesAgo(1) }), now, 15)).toBeNull();
    expect(
      locationOf(partner({ id: 'c', lastLat: 11, lastLocationAt: minutesAgo(1) }), now, 15),
    ).toBeNull();
    expect(locationOf(north('d', 1, { lastLocationAt: minutesAgo(16) }), now, 15)).toBeNull();
    expect(locationOf(north('e', 1, { lastLocationAt: minutesAgo(15) }), now, 15)).not.toBeNull();
    // more than a minute in the future is a clock fault
    expect(locationOf(north('f', 1, { lastLocationAt: minutesAgo(-2) }), now, 15)).toBeNull();
    expect(locationOf(north('g', 1, { lastLocationAt: minutesAgo(-0.5) }), now, 15)).not.toBeNull();
  });

  it('ranks the located partners inside the radius, nearest first', () => {
    const ranked = rankCandidates(
      pickup,
      [north('far', 4), north('near', 1), north('outside', 6), partner({ id: 'unlocated' })],
      rules,
      now,
    );
    expect(ranked.map((r) => r.partner.id)).toEqual(['near', 'far']);
    expect(ranked[0]?.distanceM).toBeGreaterThan(950);
    expect(ranked[0]?.distanceM).toBeLessThan(1_050);
  });

  it('breaks distance ties by load, then by id', () => {
    const ranked = rankCandidates(
      pickup,
      [north('b', 2, { currentOrders: 1 }), north('c', 2), north('a', 2)],
      rules,
      now,
    );
    expect(ranked.map((r) => r.partner.id)).toEqual(['a', 'c', 'b']);
  });

  it('finds nobody without a pickup point, with stale locations or with no partners', () => {
    expect(rankCandidates(null, [north('a', 1)], rules, now)).toEqual([]);
    expect(
      rankCandidates(pickup, [north('a', 1, { lastLocationAt: minutesAgo(30) })], rules, now),
    ).toEqual([]);
    expect(rankCandidates(pickup, [], rules, now)).toEqual([]);
  });

  it('keeps COD orders away from partners at the cash limit (D173)', () => {
    expect(codBlocked('COD', 500_000, 500_000)).toBe(true);
    expect(codBlocked('COD', 499_999, 500_000)).toBe(false);
    expect(codBlocked('ONLINE', 900_000, 500_000)).toBe(false);
    expect(codBlocked('COD', 900_000, null)).toBe(false);
  });

  it('labels distances for the note', () => {
    expect(distanceLabel(850)).toBe('850 m');
    expect(distanceLabel(1_234)).toBe('1.2 km');
  });
});
